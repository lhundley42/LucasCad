from pathlib import Path
from tempfile import NamedTemporaryFile

import cadquery as cq
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response


app = FastAPI(title="Basic CAD geometry service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)

PROFILE_CONNECT_TOLERANCE = 0.05


def make_box(length: float, width: float, height: float) -> cq.Shape:
    return cq.Workplane("XY").box(length, width, height, centered=(True, True, False)).val()


def vector(point: dict, plane: cq.Plane | None = None) -> cq.Vector:
    local = cq.Vector(float(point["x"]), float(point["y"]), 0)
    return plane.toWorldCoords(local) if plane else local


def points_match(first: dict, second: dict, tolerance: float = PROFILE_CONNECT_TOLERANCE) -> bool:
    return abs(float(first["x"]) - float(second["x"])) < tolerance and abs(float(first["y"]) - float(second["y"])) < tolerance


def point_distance(first: dict, second: dict) -> float:
    return ((float(first["x"]) - float(second["x"])) ** 2 + (float(first["y"]) - float(second["y"])) ** 2) ** 0.5


def sketch_wires(entities: list[dict], plane: cq.Plane | None = None) -> tuple[list[cq.Wire], list[dict]]:
    active_plane = plane or cq.Plane.named("XY")
    wires: list[cq.Wire] = []
    open_entities: list[tuple[str, dict, dict, dict]] = []
    construction = [entity for entity in entities if entity.get("construction")]

    for entity in entities:
        if entity.get("construction"):
            continue
        entity_type = entity.get("type")
        if entity_type == "line":
            open_entities.append((entity_type, entity, entity["a"], entity["b"]))
        elif entity_type == "arc":
            open_entities.append((entity_type, entity, entity["a"], entity["b"]))
        elif entity_type == "spline":
            points = entity.get("points", [])
            if len(points) < 2:
                continue
            is_closed = points_match(points[0], points[-1])
            edge = cq.Edge.makeSpline([vector(point, active_plane) for point in (points[:-1] if is_closed else points)], periodic=is_closed)
            if is_closed:
                wires.append(cq.Wire.assembleEdges([edge]))
            else:
                open_entities.append((entity_type, entity, points[0], points[-1]))
        elif entity_type == "circle":
            wires.append(cq.Wire.makeCircle(float(entity["r"]), vector(entity["c"], active_plane), active_plane.zDir))
        elif entity_type == "ellipse":
            wires.append(cq.Wire.makeEllipse(float(entity["rx"]), float(entity["ry"]), vector(entity["c"], active_plane), active_plane.zDir, active_plane.xDir))

    endpoint_values = [point for _, _, start, end in open_entities for point in (start, end)]
    parents = list(range(len(endpoint_values)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(first: int, second: int) -> None:
        first_root, second_root = find(first), find(second)
        if first_root != second_root:
            parents[second_root] = first_root

    for first_index, first in enumerate(endpoint_values):
        for second_index in range(first_index + 1, len(endpoint_values)):
            if points_match(first, endpoint_values[second_index]):
                union(first_index, second_index)

    grouped: dict[int, list[dict]] = {}
    for index, point in enumerate(endpoint_values):
        grouped.setdefault(find(index), []).append(point)
    representatives = {
        root: {"x": sum(float(point["x"]) for point in points) / len(points), "y": sum(float(point["y"]) for point in points) / len(points)}
        for root, points in grouped.items()
    }
    snapped_endpoints = [representatives[find(index)] for index in range(len(endpoint_values))]

    open_edges: list[tuple[cq.Edge, dict, dict]] = []
    for index, (entity_type, entity, _, _) in enumerate(open_entities):
        start, end = snapped_endpoints[index * 2], snapped_endpoints[index * 2 + 1]
        if entity_type == "line":
            edge = cq.Edge.makeLine(vector(start, active_plane), vector(end, active_plane))
        elif entity_type == "arc":
            edge = cq.Edge.makeThreePointArc(vector(start, active_plane), vector(entity["through"], active_plane), vector(end, active_plane))
        else:
            spline_points = [{"x": float(point["x"]), "y": float(point["y"])} for point in entity.get("points", [])]
            spline_points[0], spline_points[-1] = start, end
            edge = cq.Edge.makeSpline([vector(point, active_plane) for point in spline_points])
        open_edges.append((edge, start, end))

    remaining = list(open_edges)
    while remaining:
        component = [remaining.pop(0)]
        changed = True
        while changed:
            changed = False
            endpoints = [point for _, start, end in component for point in (start, end)]
            for candidate in list(remaining):
                if any(points_match(candidate[1], point) or points_match(candidate[2], point) for point in endpoints):
                    component.append(candidate)
                    remaining.remove(candidate)
                    changed = True
        wire = cq.Wire.assembleEdges([edge for edge, _, _ in component])
        if not wire.IsClosed():
            raise ValueError("The sketch contains an open profile. Close connected endpoints before creating a solid.")
        wires.append(wire)

    if not wires:
        raise ValueError("The sketch does not contain a closed profile.")
    return wires, construction


def make_feature(payload: dict, plane: cq.Plane | None = None) -> cq.Shape:
    entities = payload.get("entities") or []
    active_plane = plane or cq.Plane.named("XY")
    wires, construction = sketch_wires(entities, active_plane)
    operation = payload.get("operation", "extrude")
    if operation == "extrude":
        distance = float(payload.get("distance", 20))
        if distance == 0:
            raise ValueError("Extrusion distance must be non-zero.")
        extent = payload.get("extent", "one-sided")
        requested_direction = payload.get("direction")
        direction = (-1 if distance < 0 else 1) if requested_direction is None else (-1 if float(requested_direction) < 0 else 1)

        def extrude_in_direction(signed_distance: float) -> cq.Shape:
            return cq.Workplane(active_plane).newObject(wires).toPending().extrude(signed_distance, combine=False).val()

        if extent == "one-sided":
            result = extrude_in_direction(abs(distance) * direction)
        elif extent in ("symmetric", "bidirectional"):
            plus_distance = abs(float(payload.get("distancePlus", distance)))
            minus_distance = plus_distance if extent == "symmetric" else abs(float(payload.get("distanceMinus", distance)))
            if plus_distance == 0 or minus_distance == 0:
                raise ValueError("Both extrusion directions must have a non-zero distance.")
            result = extrude_in_direction(plus_distance).fuse(extrude_in_direction(-minus_distance))
        else:
            raise ValueError(f"Unsupported extrusion extent: {extent}")
    elif operation == "revolve":
        workplane = cq.Workplane(active_plane).newObject(wires).toPending()
        angle = float(payload.get("angle", 360))
        axis_mode = payload.get("axis", "profile-left")
        if axis_mode == "construction":
            axes = [entity for entity in construction if entity.get("type") == "line"]
            if not axes:
                raise ValueError("Draw a construction centerline before selecting it as the revolve axis.")
            axis_start = (float(axes[0]["a"]["x"]), float(axes[0]["a"]["y"]))
            axis_end = (float(axes[0]["b"]["x"]), float(axes[0]["b"]["y"]))
        elif axis_mode == "origin-x":
            axis_start, axis_end = (-1.0, 0.0), (1.0, 0.0)
        elif axis_mode == "origin-y":
            axis_start, axis_end = (0.0, -1.0), (0.0, 1.0)
        else:
            points = []
            for entity in entities:
                if entity.get("construction"):
                    continue
                points.extend(entity.get(key) for key in ("a", "b", "c", "through") if entity.get(key))
                points.extend(entity.get("points", []))
            if not points:
                raise ValueError("The sketch does not contain geometry that can define a revolve axis.")
            minimum_x = min(float(point["x"]) for point in points)
            axis_start, axis_end = (minimum_x, -1.0), (minimum_x, 1.0)
        result = workplane.revolve(angle, axis_start, axis_end, combine=False).val()
    else:
        raise ValueError(f"Unsupported feature operation: {operation}")
    if not result.isValid() or not result.Solids():
        raise ValueError("The selected profile and feature settings did not create a valid solid.")
    return result


def analyze_sketch_entities(entities: list[dict]) -> dict:
    endpoints: list[dict] = []
    closed_primitives = 0
    drawable = [entity for entity in entities if not entity.get("construction")]
    issues = []
    for index, entity in enumerate(drawable, start=1):
        entity_type = entity.get("type")
        try:
            if entity_type == "line":
                if point_distance(entity["a"], entity["b"]) < 1e-5:
                    issues.append(f"Line {index} has zero length; move or delete it.")
                else:
                    endpoints.extend([entity["a"], entity["b"]])
            elif entity_type == "arc":
                if point_distance(entity["a"], entity["b"]) < 1e-5:
                    issues.append(f"Arc {index} has coincident start and end points.")
                else:
                    endpoints.extend([entity["a"], entity["b"]])
            elif entity_type == "circle":
                if float(entity["r"]) <= 1e-5:
                    issues.append(f"Circle {index} has zero radius.")
                else:
                    closed_primitives += 1
            elif entity_type == "ellipse":
                if float(entity["rx"]) <= 1e-5 or float(entity["ry"]) <= 1e-5:
                    issues.append(f"Ellipse {index} has a zero-length radius.")
                else:
                    closed_primitives += 1
            elif entity_type == "spline":
                points = entity.get("points", [])
                if len(points) < 2 or all(points_match(points[0], point) for point in points[1:]):
                    issues.append(f"Spline {index} needs at least two distinct points.")
                elif points_match(points[0], points[-1]):
                    closed_primitives += 1
                else:
                    endpoints.extend([points[0], points[-1]])
            else:
                issues.append(f"Entity {index} has an unsupported or missing geometry type.")
        except (KeyError, TypeError, ValueError):
            issues.append(f"Entity {index} is missing required geometry values.")

    groups: list[dict] = []
    for point in endpoints:
        match = next((group for group in groups if points_match(group["point"], point)), None)
        if match:
            match["count"] += 1
        else:
            groups.append({"point": {"x": float(point["x"]), "y": float(point["y"])}, "count": 1})
    open_endpoints = [group["point"] for group in groups if group["count"] % 2 == 1]
    if not drawable:
        issues.append("The sketch contains no profile geometry.")
    if open_endpoints:
        issues.append(f"{len(open_endpoints)} unconnected endpoint{'s' if len(open_endpoints) != 1 else ''} prevent a closed profile.")
    profile_count = closed_primitives
    if not issues:
        try:
            wires, _ = sketch_wires(entities)
            profile_count = len(wires)
        except Exception as error:
            issues.append(str(error))
    return {"closed": not issues and profile_count > 0, "profileCount": profile_count, "openEndpoints": open_endpoints, "issues": issues}


def plane_for_sketch(sketch: dict, bodies: dict[str, cq.Shape]) -> cq.Plane:
    plane_spec = sketch.get("plane", "XY")
    if isinstance(plane_spec, str):
        if plane_spec not in ("XY", "XZ", "YZ"):
            raise ValueError(f"Unsupported origin plane: {plane_spec}")
        return cq.Plane.named(plane_spec)
    if plane_spec.get("kind") != "face":
        raise ValueError("Sketch plane must be an origin plane or a planar body face.")
    body_id = plane_spec.get("bodyId")
    face_index = int(plane_spec.get("faceIndex", 0))
    if body_id not in bodies or face_index < 1:
        raise ValueError("The selected sketch support face no longer exists.")
    faces = bodies[body_id].Faces()
    if face_index > len(faces):
        raise ValueError("The selected sketch support face changed during rebuild.")
    face = faces[face_index - 1]
    try:
        if face.geomType() != "PLANE":
            raise ValueError("The selected face is not planar.")
        normal = face.normalAt().normalized()
        reference = cq.Vector(1, 0, 0) if abs(normal.x) < 0.9 else cq.Vector(0, 1, 0)
        x_direction = (reference - normal.multiply(reference.dot(normal))).normalized()
        return cq.Plane(face.Center(), x_direction, normal)
    except Exception as error:
        raise ValueError("Sketches can currently be attached only to planar body faces.") from error


def tessellated_edge_points(edge: cq.Edge) -> list[cq.Vector]:
    result = edge.tessellate(0.25)
    points = result[0] if isinstance(result, tuple) else result
    if len(points) < 2:
        sample_count = max(32, min(256, int(edge.Length() / 2)))
        sampled = edge.sample(sample_count)
        points = sampled[0] if isinstance(sampled, tuple) else sampled
    if edge.IsClosed() and points and points[0].sub(points[-1]).Length > 1e-6:
        points = [*points, points[0]]
    return points


def sketch_curve_payload(sketch: dict, plane: cq.Plane) -> dict:
    paths = []
    for entity in sketch.get("entities", []):
        entity_type = entity.get("type")
        try:
            if entity_type == "line":
                points = [vector(entity["a"], plane), vector(entity["b"], plane)]
            elif entity_type == "arc":
                points = tessellated_edge_points(cq.Edge.makeThreePointArc(vector(entity["a"], plane), vector(entity["through"], plane), vector(entity["b"], plane)))
            elif entity_type == "spline":
                source = entity.get("points", [])
                if len(source) < 2:
                    continue
                periodic = points_match(source[0], source[-1])
                points = tessellated_edge_points(cq.Edge.makeSpline([vector(point, plane) for point in (source[:-1] if periodic else source)], periodic=periodic))
            elif entity_type == "circle":
                points = tessellated_edge_points(cq.Wire.makeCircle(float(entity["r"]), vector(entity["c"], plane), plane.zDir).Edges()[0])
            elif entity_type == "ellipse":
                points = tessellated_edge_points(cq.Wire.makeEllipse(float(entity["rx"]), float(entity["ry"]), vector(entity["c"], plane), plane.zDir, plane.xDir).Edges()[0])
            else:
                continue
            paths.append({"id": entity.get("id"), "construction": bool(entity.get("construction")), "points": [[point.x, point.y, point.z] for point in points]})
        except Exception:
            continue
    return {
        "id": sketch.get("id"),
        "name": sketch.get("name", "Sketch"),
        "visible": sketch.get("visible", True),
        "frame": {
            "origin": [plane.origin.x, plane.origin.y, plane.origin.z],
            "xDir": [plane.xDir.x, plane.xDir.y, plane.xDir.z],
            "yDir": [plane.yDir.x, plane.yDir.y, plane.yDir.z],
            "normal": [plane.zDir.x, plane.zDir.y, plane.zDir.z],
        },
        "paths": paths,
    }


def build_document(payload: dict) -> tuple[dict[str, cq.Shape], list[dict], list[dict]]:
    sketches = {sketch["id"]: sketch for sketch in payload.get("sketches", [])}
    bodies: dict[str, cq.Shape] = {}
    plane_cache: dict[str, cq.Plane] = {}
    feature_results = []
    for feature in payload.get("features", []):
        sketch_id = feature.get("sketchId")
        if sketch_id not in sketches:
            raise ValueError(f"Feature {feature.get('name', feature.get('id'))} references a missing sketch.")
        sketch = sketches[sketch_id]
        plane = plane_for_sketch(sketch, bodies)
        plane_cache[sketch_id] = plane
        tool = make_feature({**feature, "operation": feature.get("type"), "entities": sketch.get("entities", [])}, plane)
        tool_shape = tool.Solids()[0] if len(tool.Solids()) == 1 else tool
        combine = feature.get("combine", "new")
        if combine == "new":
            body_id = feature.get("bodyId") or f"body-{len(bodies) + 1}"
            bodies[body_id] = tool_shape
        else:
            body_id = feature.get("targetBodyId")
            if body_id not in bodies:
                raise ValueError("Select an existing target body for the union or cut operation.")
            result = bodies[body_id].fuse(tool_shape) if combine == "union" else bodies[body_id].cut(tool_shape)
            if not result.isValid() or not result.Solids():
                raise ValueError(f"The {combine} operation did not create a valid solid. Check that the feature intersects the target body.")
            bodies[body_id] = result.Solids()[0] if len(result.Solids()) == 1 else result
        feature_results.append({"id": feature.get("id"), "bodyId": body_id})

    sketch_payloads = []
    for sketch in sketches.values():
        try:
            plane = plane_cache.get(sketch["id"]) or plane_for_sketch(sketch, bodies)
            sketch_payloads.append(sketch_curve_payload(sketch, plane))
        except ValueError:
            sketch_payloads.append({"id": sketch["id"], "name": sketch.get("name", "Sketch"), "visible": False, "paths": []})
    return bodies, sketch_payloads, feature_results


def document_payload(payload: dict) -> dict:
    bodies, sketches, feature_results = build_document(payload)
    faces = []
    edges = []
    for body_id, body in bodies.items():
        for index, face in enumerate(body.Faces(), start=1):
            vertices, triangles = face.tessellate(0.15, 0.2)
            faces.append({"id": f"{body_id}:face-{index}", "bodyId": body_id, "faceIndex": index, "vertices": [[point.x, point.y, point.z] for point in vertices], "triangles": [list(triangle) for triangle in triangles]})
        for index, edge in enumerate(body.Edges(), start=1):
            points = tessellated_edge_points(edge)
            if len(points) > 1:
                edges.append({"id": f"{body_id}:edge-{index}", "bodyId": body_id, "edgeIndex": index, "points": [[point.x, point.y, point.z] for point in points]})
    preview_faces = []
    preview_feature = payload.get("previewFeature")
    if preview_feature:
        sketch_map = {sketch["id"]: sketch for sketch in payload.get("sketches", [])}
        preview_sketch = sketch_map.get(preview_feature.get("sketchId"))
        if preview_sketch:
            preview_plane = plane_for_sketch(preview_sketch, bodies)
            preview_shape = make_feature({**preview_feature, "operation": preview_feature.get("type", "extrude"), "entities": preview_sketch.get("entities", [])}, preview_plane)
            target_body = bodies.get(preview_feature.get("targetBodyId"))
            if target_body and preview_feature.get("combine") == "cut":
                preview_shape = preview_shape.intersect(target_body)
            elif target_body and preview_feature.get("combine") == "union":
                preview_shape = preview_shape.cut(target_body)
            for index, face in enumerate(preview_shape.Faces(), start=1):
                vertices, triangles = face.tessellate(0.15, 0.2)
                preview_faces.append({"id": f"preview:face-{index}", "bodyId": "preview", "faceIndex": index, "vertices": [[point.x, point.y, point.z] for point in vertices], "triangles": [list(triangle) for triangle in triangles]})
    compound = cq.Compound.makeCompound(list(bodies.values())) if bodies else None
    bounds = compound.BoundingBox() if compound else None
    return {
        "faces": faces,
        "edges": edges,
        "previewFaces": preview_faces,
        "sketches": sketches,
        "featureResults": feature_results,
        "properties": {
            "valid": all(body.isValid() for body in bodies.values()),
            "solidCount": sum(len(body.Solids()) for body in bodies.values()),
            "bodyCount": len(bodies),
            "faceCount": len(faces),
            "edgeCount": sum(len(body.Edges()) for body in bodies.values()),
            "volume": sum(body.Volume() for body in bodies.values()),
            "bounds": {"x": bounds.xlen if bounds else 100, "y": bounds.ylen if bounds else 100, "z": bounds.zlen if bounds else 100},
        },
    }


def shape_payload(shape: cq.Shape) -> dict:
    faces = []
    for index, face in enumerate(shape.Faces(), start=1):
        vertices, triangles = face.tessellate(0.15, 0.2)
        faces.append(
            {
                "id": f"face-{index}",
                "vertices": [[point.x, point.y, point.z] for point in vertices],
                "triangles": [list(triangle) for triangle in triangles],
            }
        )
    box = shape.BoundingBox()
    return {
        "faces": faces,
        "properties": {
            "valid": shape.isValid(),
            "solidCount": len(shape.Solids()),
            "faceCount": len(shape.Faces()),
            "edgeCount": len(shape.Edges()),
            "volume": shape.Volume(),
            "bounds": {"x": box.xlen, "y": box.ylen, "z": box.zlen},
        },
    }


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "kernel": "Open CASCADE via CadQuery"}


@app.get("/api/box")
def box(
    length: float = Query(100, gt=0, le=10000),
    width: float = Query(60, gt=0, le=10000),
    height: float = Query(20, gt=0, le=10000),
) -> dict:
    return shape_payload(make_box(length, width, height))


@app.post("/api/model")
def model(payload: dict = Body(...)) -> dict:
    try:
        return shape_payload(make_feature(payload))
    except (ValueError, TypeError, KeyError, RuntimeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/sketch/validate")
def validate_sketch(payload: dict = Body(...)) -> dict:
    return analyze_sketch_entities(payload.get("entities") or [])


@app.post("/api/document")
def document(payload: dict = Body(...)) -> dict:
    try:
        return document_payload(payload)
    except (ValueError, TypeError, KeyError, RuntimeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/api/export/box.step")
def export_box(
    length: float = Query(100, gt=0, le=10000),
    width: float = Query(60, gt=0, le=10000),
    height: float = Query(20, gt=0, le=10000),
) -> Response:
    shape = make_box(length, width, height)
    with NamedTemporaryFile(suffix=".step", delete=False) as handle:
        path = Path(handle.name)
    try:
        cq.exporters.export(shape, str(path), exportType="STEP")
        content = path.read_bytes()
    finally:
        path.unlink(missing_ok=True)
    return Response(
        content=content,
        media_type="model/step",
        headers={"Content-Disposition": 'attachment; filename="basic-cad-part.step"'},
    )


@app.post("/api/export/feature.step")
def export_feature(payload: dict = Body(...)) -> Response:
    try:
        shape = make_feature(payload)
    except (ValueError, TypeError, KeyError, RuntimeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    with NamedTemporaryFile(suffix=".step", delete=False) as handle:
        path = Path(handle.name)
    try:
        cq.exporters.export(shape, str(path), exportType="STEP")
        content = path.read_bytes()
    finally:
        path.unlink(missing_ok=True)
    return Response(content=content, media_type="model/step", headers={"Content-Disposition": 'attachment; filename="basic-cad-feature.step"'})


@app.post("/api/export/document.step")
def export_document(payload: dict = Body(...)) -> Response:
    try:
        bodies, _, _ = build_document(payload)
        if not bodies:
            raise ValueError("The document does not contain any solid bodies to export.")
        shape = cq.Compound.makeCompound(list(bodies.values()))
    except (ValueError, TypeError, KeyError, RuntimeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    with NamedTemporaryFile(suffix=".step", delete=False) as handle:
        path = Path(handle.name)
    try:
        cq.exporters.export(shape, str(path), exportType="STEP")
        content = path.read_bytes()
    finally:
        path.unlink(missing_ok=True)
    return Response(content=content, media_type="model/step", headers={"Content-Disposition": 'attachment; filename="basic-cad-document.step"'})
