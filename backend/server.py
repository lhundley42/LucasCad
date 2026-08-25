import math
from pathlib import Path
from tempfile import NamedTemporaryFile

import cadquery as cq
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepOffsetAPI import BRepOffsetAPI_DraftAngle
from OCP.gp import gp_Dir, gp_Pln, gp_Pnt


app = FastAPI(title="LucasCad geometry service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://lucascad.localhost:4310", "http://localhost:4310", "http://127.0.0.1:4310"],
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


def clean_spline_points(points: list[dict]) -> list[dict]:
    cleaned: list[dict] = []
    for point in points:
        normalized = {"x": float(point["x"]), "y": float(point["y"])}
        if not cleaned or not points_match(cleaned[-1], normalized, tolerance=1e-5):
            cleaned.append(normalized)
    return cleaned


def spline_curve_points(entity: dict, samples_per_span: int = 16) -> list[dict]:
    points = clean_spline_points(entity.get("points", []))
    handles = entity.get("handles")
    if len(points) < 2 or not isinstance(handles, list) or len(handles) != len(points):
        return points
    sampled: list[dict] = []
    for index in range(len(points) - 1):
        start, end = points[index], points[index + 1]
        start_handle, end_handle = handles[index].get("out"), handles[index + 1].get("in")
        if not start_handle or not end_handle:
            return points
        for sample in range(samples_per_span):
            amount = sample / samples_per_span; inverse = 1 - amount
            sampled.append({
                "x": inverse ** 3 * start["x"] + 3 * inverse ** 2 * amount * float(start_handle["x"]) + 3 * inverse * amount ** 2 * float(end_handle["x"]) + amount ** 3 * end["x"],
                "y": inverse ** 3 * start["y"] + 3 * inverse ** 2 * amount * float(start_handle["y"]) + 3 * inverse * amount ** 2 * float(end_handle["y"]) + amount ** 3 * end["y"],
            })
    return [*sampled, points[-1]]


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
            points = spline_curve_points(entity)
            if len(points) < 2:
                continue
            is_closed = points_match(points[0], points[-1])
            edge = cq.Edge.makeSpline([vector(point, active_plane) for point in (points[:-1] if is_closed else points)], periodic=is_closed)
            if is_closed:
                wires.append(cq.Wire.assembleEdges([edge]))
            else:
                open_entities.append((entity_type, {**entity, "points": points}, points[0], points[-1]))
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
        axis_line = payload.get("axisLine")
        if axis_line:
            world_start = cq.Vector(*[float(value) for value in axis_line["start"]])
            world_end = cq.Vector(*[float(value) for value in axis_line["end"]])
            local_start = active_plane.toLocalCoords(world_start)
            local_end = active_plane.toLocalCoords(world_end)
            if abs(local_start.z) > 0.05 or abs(local_end.z) > 0.05:
                raise ValueError("The selected revolve axis must lie in the profile sketch plane.")
            axis_start = (local_start.x, local_start.y)
            axis_end = (local_end.x, local_end.y)
            if cq.Vector(local_end.x - local_start.x, local_end.y - local_start.y, 0).Length < 1e-6:
                raise ValueError("The selected revolve axis has no usable length.")
        elif axis_mode == "construction":
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


def indexed_items(items: list, requested: list, label: str) -> list:
    indices = sorted({int(index) for index in requested})
    if not indices:
        raise ValueError(f"Select at least one {label}.")
    if indices[0] < 1 or indices[-1] > len(items):
        raise ValueError(f"A selected {label} no longer exists after rebuilding earlier features.")
    return [items[index - 1] for index in indices]


def faces_cover_neutral_boundary(neutral_face: cq.Face, draft_faces: list[cq.Face]) -> bool:
    """Return true when the selected side faces own the complete neutral outline.

    Open CASCADE's face-by-face draft builder only accepts planes, cylinders,
    and cones.  An extrusion of a closed spline instead has one swept side
    face whose boundary owns the full neutral outline.  Recognizing that case
    lets us rebuild the prism as a loft without silently drafting unrelated
    faces on a segmented profile.
    """
    selected_edges = [edge for face in draft_faces for edge in face.Edges()]
    return all(any(boundary.isSame(selected) for selected in selected_edges) for boundary in neutral_face.outerWire().Edges())


def make_full_profile_draft(body: cq.Shape, neutral_face: cq.Face, draft_faces: list[cq.Face], angle: float, reverse: bool) -> cq.Shape:
    if neutral_face.innerWires():
        raise ValueError("Curved-face draft currently requires a neutral face without holes.")
    if not faces_cover_neutral_boundary(neutral_face, draft_faces):
        raise ValueError("Select every curved side face around the neutral-face outline so their corner joins can rebuild together.")

    normal = neutral_face.normalAt().normalized()
    center = neutral_face.Center()
    opposite_caps: list[tuple[float, cq.Face]] = []
    for face in body.Faces():
        if face.isSame(neutral_face) or face.geomType() != "PLANE":
            continue
        try:
            face_normal = face.normalAt().normalized()
            signed_height = face.Center().sub(center).dot(normal)
            if abs(face_normal.dot(normal)) > 0.999 and abs(signed_height) > 1e-6:
                opposite_caps.append((signed_height, face))
        except Exception:
            continue
    if not opposite_caps:
        raise ValueError("The curved draft requires a parallel opposite cap so the original extrusion height can be preserved.")

    signed_height, _ = max(opposite_caps, key=lambda item: abs(item[0]))
    draft_distance = abs(signed_height) * math.tan(math.radians(angle)) * (-1 if reverse else 1)
    base_wire = neutral_face.outerWire()
    offset_wires: list[cq.Wire] = []
    for transition in ("intersection", "arc"):
        try:
            offset_wires = base_wire.offset2D(draft_distance, kind=transition)
            if offset_wires:
                break
        except Exception:
            offset_wires = []
    if len(offset_wires) != 1:
        raise ValueError("The pointed or curved outline cannot support this draft angle. Reduce the angle or simplify the neutral outline.")

    opposite_wire = offset_wires[0].translate(normal.multiply(signed_height))
    result = cq.Solid.makeLoft([base_wire, opposite_wire], ruled=False)
    if not result.isValid() or not result.Solids():
        raise ValueError("The curved draft did not create a valid joined solid. Reduce the angle or reverse its direction.")
    return result


def inward_offset_wire(wire: cq.Wire, thickness: float) -> cq.Wire:
    """Return the smaller of the two planar offsets, independent of wire orientation."""
    original_area = cq.Face.makeFromWires(wire).Area()
    candidates: list[tuple[float, cq.Wire]] = []
    for signed_distance in (-thickness, thickness):
        try:
            for offset in wire.offset2D(signed_distance, kind="intersection"):
                area = cq.Face.makeFromWires(offset).Area()
                if 1e-6 < area < original_area - 1e-6:
                    candidates.append((area, offset))
        except Exception:
            continue
    if not candidates:
        raise ValueError("The opening profile is too tight for this wall thickness.")
    return max(candidates, key=lambda candidate: candidate[0])[1]


def make_planar_open_shell_fallback(body: cq.Shape, removed_face: cq.Face, thickness: float) -> cq.Shape:
    """Shell lofted/drafted hulls whose pointed spline join defeats OCC's offset shell."""
    if removed_face.geomType() != "PLANE":
        raise ValueError("The fallback shell opening must be planar.")
    opening_normal = removed_face.normalAt().normalized()
    opening_center = removed_face.Center()
    opposite_candidates: list[tuple[float, cq.Face]] = []
    for face in body.Faces():
        if face.isSame(removed_face) or face.geomType() != "PLANE":
            continue
        normal = face.normalAt().normalized()
        alignment = abs(normal.dot(opening_normal))
        separation = abs(face.Center().sub(opening_center).dot(opening_normal))
        if alignment > 0.98 and separation > thickness * 1.05:
            opposite_candidates.append((separation, face))
    if not opposite_candidates:
        raise ValueError("No opposite planar wall can define the inside bottom of this shell.")
    depth, opposite_face = max(opposite_candidates, key=lambda candidate: candidate[0])
    if depth <= thickness * 1.05:
        raise ValueError("The body is not deep enough for this wall thickness.")

    opening_inner = inward_offset_wire(removed_face.outerWire(), thickness)
    bottom_inner = inward_offset_wire(opposite_face.outerWire(), thickness)
    toward_opening = opening_center.sub(opposite_face.Center()).normalized()
    bottom_inner = bottom_inner.translate(toward_opening.multiply(thickness))
    try:
        cavity = cq.Solid.makeLoft([bottom_inner, opening_inner], ruled=False)
        result = body.cut(cavity)
    except Exception as error:
        raise ValueError("The inset hull profiles could not form a continuous interior cavity.") from error
    if not result.isValid() or not result.Solids():
        raise ValueError("The inset hull profiles did not create a valid thin-walled solid.")
    return result.Solids()[0] if len(result.Solids()) == 1 else result


def apply_body_feature(body: cq.Shape, feature: dict) -> cq.Shape:
    operation = feature.get("type") or feature.get("operation")
    if operation in ("fillet", "chamfer"):
        edges = indexed_items(body.Edges(), feature.get("edgeIndices") or [], "edge")
        size = float(feature.get("radius" if operation == "fillet" else "distance", 2))
        if size <= 0:
            raise ValueError(f"{operation.title()} size must be greater than zero.")
        selector = cq.Workplane(obj=body).newObject(edges)
        try:
            if operation == "fillet":
                result = selector.fillet(size).val()
            else:
                method = feature.get("method", "symmetric")
                second_size = None
                if method == "distance-distance":
                    second_size = float(feature.get("distance2", size))
                elif method == "angle-distance":
                    angle = float(feature.get("angle", 45))
                    if angle <= 0 or angle >= 90:
                        raise ValueError("Chamfer angle must be greater than 0° and less than 90°.")
                    second_size = size * math.tan(math.radians(angle))
                elif method != "symmetric":
                    raise ValueError("Unsupported chamfer method.")
                if second_size is not None and second_size <= 0:
                    raise ValueError("Both chamfer distances must be greater than zero.")
                first_size = size
                if second_size is not None and feature.get("flip"):
                    first_size, second_size = second_size, first_size
                result = selector.chamfer(first_size, second_size).val()
        except Exception as error:
            if isinstance(error, ValueError) and str(error).startswith(("Chamfer angle", "Both chamfer", "Unsupported chamfer")):
                raise
            noun = "radius" if operation == "fillet" else "distance"
            raise ValueError(f"The {operation} could not be created. Reduce the {noun} or select different edges.") from error
    elif operation == "draft":
        faces = body.Faces()
        neutral_index = int(feature.get("neutralFaceIndex", 0))
        if neutral_index < 1 or neutral_index > len(faces):
            raise ValueError("Select a planar neutral face for the draft.")
        neutral_face = faces[neutral_index - 1]
        if neutral_face.geomType() != "PLANE":
            raise ValueError("The neutral face must be planar.")
        draft_faces = indexed_items(faces, feature.get("faceIndices") or [], "face to draft")
        if neutral_index in {int(index) for index in feature.get("faceIndices") or []}:
            raise ValueError("The neutral face cannot also be a face to draft.")
        angle = abs(float(feature.get("angle", 3)))
        if angle <= 0 or angle >= 89:
            raise ValueError("Draft angle must be greater than 0° and less than 89°.")
        unsupported_faces = [face for face in draft_faces if face.geomType() not in ("PLANE", "CYLINDER", "CONE")]
        if unsupported_faces:
            result = make_full_profile_draft(body, neutral_face, draft_faces, angle, bool(feature.get("reverse")))
        else:
            normal = neutral_face.normalAt().normalized()
            if feature.get("reverse"):
                normal = normal.multiply(-1)
            center = neutral_face.Center()
            direction = gp_Dir(normal.x, normal.y, normal.z)
            neutral_plane = gp_Pln(gp_Pnt(center.x, center.y, center.z), direction)
            builder = BRepOffsetAPI_DraftAngle(body.wrapped)
            try:
                for face in draft_faces:
                    builder.Add(face.wrapped, direction, math.radians(angle), neutral_plane, True)
                    if not builder.AddDone():
                        raise ValueError("One of the selected faces cannot be drafted from this neutral plane.")
                builder.Build()
                if not builder.IsDone():
                    raise ValueError("The selected faces and angle did not create a valid draft.")
                result = cq.Shape.cast(builder.Shape())
            except ValueError:
                raise
            except Exception as error:
                raise ValueError("The draft could not be created. Reduce the angle or select different faces.") from error
    elif operation == "shell":
        removed_faces = indexed_items(body.Faces(), feature.get("faceIndices") or [], "face to remove")
        thickness = abs(float(feature.get("thickness", 2)))
        if thickness <= 0:
            raise ValueError("Shell thickness must be greater than zero.")
        signed_thickness = thickness if feature.get("outward") else -thickness
        try:
            result = cq.Workplane(obj=body).newObject(removed_faces).shell(signed_thickness).val()
        except Exception as error:
            if not feature.get("outward") and len(removed_faces) == 1:
                try:
                    result = make_planar_open_shell_fallback(body, removed_faces[0], thickness)
                except Exception as fallback_error:
                    raise ValueError("The inward shell could not be created. Reduce the wall thickness, remove a different face, or simplify tight corners.") from fallback_error
            else:
                direction = "outward" if feature.get("outward") else "inward"
                raise ValueError(f"The {direction} shell could not be created. Reduce the wall thickness, remove a different face, or simplify tight corners.") from error
    else:
        raise ValueError(f"Unsupported body feature operation: {operation}")
    if not result.isValid() or not result.Solids():
        raise ValueError(f"The {operation} operation did not create a valid solid.")
    return result.Solids()[0] if len(result.Solids()) == 1 else result


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
                points = clean_spline_points(entity.get("points", []))
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


def plane_for_sketch(sketch: dict, bodies: dict[str, cq.Shape], references: dict[str, dict] | None = None) -> cq.Plane:
    plane_spec = sketch.get("plane", "XY")
    if isinstance(plane_spec, str):
        if plane_spec not in ("XY", "XZ", "YZ"):
            raise ValueError(f"Unsupported origin plane: {plane_spec}")
        plane = cq.Plane.named(plane_spec)
        return cq.Plane(plane.origin, plane.xDir, plane.zDir.multiply(-1)) if sketch.get("flipped") else plane
    if plane_spec.get("kind") == "reference-plane":
        reference = (references or {}).get(plane_spec.get("referenceId"))
        if not reference or reference.get("type") != "plane":
            raise ValueError("The selected reference plane no longer exists.")
        plane = cq.Plane(cq.Vector(*reference["origin"]), cq.Vector(*reference["xDir"]), cq.Vector(*reference["normal"]))
        return cq.Plane(plane.origin, plane.xDir, plane.zDir.multiply(-1)) if sketch.get("flipped") else plane
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
        plane = cq.Plane(face.Center(), x_direction, normal)
        return cq.Plane(plane.origin, plane.xDir, plane.zDir.multiply(-1)) if sketch.get("flipped") else plane
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
                source = spline_curve_points(entity)
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
            paths.append({"id": entity.get("id"), "type": entity_type, "construction": bool(entity.get("construction")), "points": [[point.x, point.y, point.z] for point in points]})
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


def resolve_revolve_axis(feature: dict, sketches: dict[str, dict], bodies: dict[str, cq.Shape], references: dict[str, dict] | None = None) -> dict | None:
    reference = feature.get("axis")
    if not isinstance(reference, dict):
        return None
    kind = reference.get("kind")
    if kind == "origin-axis":
        directions = {"x": ((-1.0, 0.0, 0.0), (1.0, 0.0, 0.0)), "y": ((0.0, -1.0, 0.0), (0.0, 1.0, 0.0)), "z": ((0.0, 0.0, -1.0), (0.0, 0.0, 1.0))}
        if reference.get("axis") not in directions:
            raise ValueError("The selected origin axis is not available.")
        start, end = directions[reference["axis"]]
        return {"start": list(start), "end": list(end)}
    if kind == "sketch-line":
        sketch = sketches.get(reference.get("sketchId"))
        if not sketch:
            raise ValueError("The sketch containing the revolve axis no longer exists.")
        entity = next((item for item in sketch.get("entities", []) if item.get("id") == reference.get("entityId")), None)
        if not entity or entity.get("type") != "line":
            raise ValueError("The selected sketch line no longer exists.")
        axis_plane = plane_for_sketch(sketch, bodies, references)
        start, end = vector(entity["a"], axis_plane), vector(entity["b"], axis_plane)
        return {"start": [start.x, start.y, start.z], "end": [end.x, end.y, end.z]}
    if kind == "model-edge":
        body = bodies.get(reference.get("bodyId"))
        edge_index = int(reference.get("edgeIndex", 0))
        if not body or edge_index < 1 or edge_index > len(body.Edges()):
            raise ValueError("The selected revolve edge no longer exists after rebuilding earlier features.")
        edge = body.Edges()[edge_index - 1]
        if edge.geomType() != "LINE":
            raise ValueError("A revolve axis must be a straight model edge.")
        vertices = edge.Vertices()
        if len(vertices) < 2:
            raise ValueError("The selected revolve edge has no usable length.")
        start, end = vertices[0].Center(), vertices[-1].Center()
        return {"start": [start.x, start.y, start.z], "end": [end.x, end.y, end.z]}
    if kind == "reference-axis":
        axis = (references or {}).get(reference.get("referenceId"))
        if not axis or axis.get("type") != "axis":
            raise ValueError("The selected reference axis no longer exists.")
        origin = cq.Vector(*axis["origin"]); direction = cq.Vector(*axis["direction"]).normalized()
        start, end = origin.sub(direction), origin.add(direction)
        return {"start": [start.x, start.y, start.z], "end": [end.x, end.y, end.z]}
    raise ValueError("The selected revolve axis reference is not supported.")


def build_document(payload: dict) -> tuple[dict[str, cq.Shape], list[dict], list[dict]]:
    sketches = {sketch["id"]: sketch for sketch in payload.get("sketches", [])}
    references = {reference["id"]: reference for reference in payload.get("referenceGeometry", [])}
    bodies: dict[str, cq.Shape] = {}
    plane_cache: dict[str, cq.Plane] = {}
    feature_results = []
    for feature in payload.get("features", []):
        if feature.get("type") in ("fillet", "chamfer", "draft", "shell"):
            body_id = feature.get("targetBodyId")
            if body_id not in bodies:
                raise ValueError(f"Feature {feature.get('name', feature.get('id'))} references a missing target body.")
            bodies[body_id] = apply_body_feature(bodies[body_id], feature)
            feature_results.append({"id": feature.get("id"), "bodyId": body_id})
            continue
        sketch_id = feature.get("sketchId")
        if sketch_id not in sketches:
            raise ValueError(f"Feature {feature.get('name', feature.get('id'))} references a missing sketch.")
        sketch = sketches[sketch_id]
        plane = plane_for_sketch(sketch, bodies, references)
        plane_cache[sketch_id] = plane
        axis_line = resolve_revolve_axis(feature, sketches, bodies, references) if feature.get("type") == "revolve" else None
        tool = make_feature({**feature, "operation": feature.get("type"), "entities": sketch.get("entities", []), **({"axisLine": axis_line} if axis_line else {})}, plane)
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
            plane = plane_cache.get(sketch["id"]) or plane_for_sketch(sketch, bodies, references)
            sketch_payloads.append(sketch_curve_payload(sketch, plane))
        except ValueError:
            sketch_payloads.append({"id": sketch["id"], "name": sketch.get("name", "Sketch"), "visible": False, "paths": []})
    return bodies, sketch_payloads, feature_results


def face_selection_metadata(face: cq.Face) -> dict:
    center = face.Center()
    try:
        normal = face.normalAt().normalized()
        normal_payload = [normal.x, normal.y, normal.z]
    except Exception:
        normal_payload = [0.0, 0.0, 0.0]
    geometry_type = face.geomType()
    metadata = {"center": [center.x, center.y, center.z], "normal": normal_payload, "planar": geometry_type == "PLANE", "geometryType": geometry_type}
    try:
        adaptor = BRepAdaptor_Surface(face.wrapped)
        surface = adaptor.Cylinder() if geometry_type == "CYLINDER" else adaptor.Cone() if geometry_type == "CONE" else adaptor.Torus() if geometry_type == "TORUS" else None
        if surface:
            axis = surface.Axis(); origin = axis.Location(); direction = axis.Direction()
            metadata.update({"axisOrigin": [origin.X(), origin.Y(), origin.Z()], "axisDirection": [direction.X(), direction.Y(), direction.Z()], "axisKind": "center"})
    except Exception:
        pass
    return metadata


def edge_selection_metadata(edge: cq.Edge) -> dict:
    geometry_type = edge.geomType()
    try:
        if geometry_type in ("CIRCLE", "ELLIPSE"):
            adaptor = BRepAdaptor_Curve(edge.wrapped)
            curve = adaptor.Circle() if geometry_type == "CIRCLE" else adaptor.Ellipse()
            axis = curve.Axis(); origin = axis.Location(); direction = axis.Direction()
            return {"geometryType": geometry_type, "axisOrigin": [origin.X(), origin.Y(), origin.Z()], "axisDirection": [direction.X(), direction.Y(), direction.Z()], "axisKind": "center"}
        origin = edge.positionAt(0.5); direction = edge.tangentAt(0.5).normalized()
        return {"geometryType": geometry_type, "axisOrigin": [origin.x, origin.y, origin.z], "axisDirection": [direction.x, direction.y, direction.z], "axisKind": "coincident" if geometry_type == "LINE" else "tangent"}
    except Exception:
        return {"geometryType": geometry_type}


def document_payload(payload: dict) -> dict:
    bodies, sketches, feature_results = build_document(payload)
    references = {reference["id"]: reference for reference in payload.get("referenceGeometry", [])}
    faces = []
    edges = []
    for body_id, body in bodies.items():
        for index, face in enumerate(body.Faces(), start=1):
            vertices, triangles = face.tessellate(0.15, 0.2)
            faces.append({"id": f"{body_id}:face-{index}", "bodyId": body_id, "faceIndex": index, "vertices": [[point.x, point.y, point.z] for point in vertices], "triangles": [list(triangle) for triangle in triangles], **face_selection_metadata(face)})
        for index, edge in enumerate(body.Edges(), start=1):
            points = tessellated_edge_points(edge)
            if len(points) > 1:
                edges.append({"id": f"{body_id}:edge-{index}", "bodyId": body_id, "edgeIndex": index, "linear": edge.geomType() == "LINE", "points": [[point.x, point.y, point.z] for point in points], **edge_selection_metadata(edge)})
    preview_faces = []
    preview_target_body_id = None
    preview_feature = payload.get("previewFeature")
    if preview_feature:
        preview_shape = None
        if preview_feature.get("type") in ("fillet", "chamfer", "draft", "shell"):
            preview_target_body_id = preview_feature.get("targetBodyId")
            target_body = bodies.get(preview_target_body_id)
            if target_body:
                preview_shape = apply_body_feature(target_body, preview_feature)
        else:
            sketch_map = {sketch["id"]: sketch for sketch in payload.get("sketches", [])}
            preview_sketch = sketch_map.get(preview_feature.get("sketchId"))
            if preview_sketch:
                preview_plane = plane_for_sketch(preview_sketch, bodies, references)
                preview_axis_line = resolve_revolve_axis(preview_feature, sketch_map, bodies, references) if preview_feature.get("type") == "revolve" else None
                preview_shape = make_feature({**preview_feature, "operation": preview_feature.get("type", "extrude"), "entities": preview_sketch.get("entities", []), **({"axisLine": preview_axis_line} if preview_axis_line else {})}, preview_plane)
                target_body = bodies.get(preview_feature.get("targetBodyId"))
                if target_body and preview_feature.get("combine") == "cut":
                    preview_shape = preview_shape.intersect(target_body)
                elif target_body and preview_feature.get("combine") == "union":
                    preview_shape = preview_shape.cut(target_body)
        if preview_shape:
            for index, face in enumerate(preview_shape.Faces(), start=1):
                vertices, triangles = face.tessellate(0.15, 0.2)
                preview_faces.append({"id": f"preview:face-{index}", "bodyId": "preview", "faceIndex": index, "vertices": [[point.x, point.y, point.z] for point in vertices], "triangles": [list(triangle) for triangle in triangles], **face_selection_metadata(face)})
    compound = cq.Compound.makeCompound(list(bodies.values())) if bodies else None
    bounds = compound.BoundingBox() if compound else None
    return {
        "faces": faces,
        "edges": edges,
        "previewFaces": preview_faces,
        "previewTargetBodyId": preview_target_body_id,
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
        headers={"Content-Disposition": 'attachment; filename="lucascad-part.step"'},
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
    return Response(content=content, media_type="model/step", headers={"Content-Disposition": 'attachment; filename="lucascad-feature.step"'})


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
    return Response(content=content, media_type="model/step", headers={"Content-Disposition": 'attachment; filename="lucascad-document.step"'})
