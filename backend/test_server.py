import math
from pathlib import Path
from tempfile import NamedTemporaryFile

import cadquery as cq
from fastapi.testclient import TestClient

from server import app, face_selection_metadata


client = TestClient(app)


def rectangle(x1: float, y1: float, x2: float, y2: float) -> list[dict]:
    points = [{"x": x1, "y": y1}, {"x": x2, "y": y1}, {"x": x2, "y": y2}, {"x": x1, "y": y2}]
    return [{"id": f"line-{index}", "type": "line", "a": point, "b": points[(index + 1) % 4]} for index, point in enumerate(points)]


def test_box_geometry_properties():
    result = client.get("/api/box?length=100&width=60&height=20")
    assert result.status_code == 200
    payload = result.json()
    assert payload["properties"]["valid"] is True
    assert payload["properties"]["solidCount"] == 1
    assert payload["properties"]["volume"] == 120000
    assert len(payload["faces"]) == 6


def test_flipped_origin_sketch_reverses_its_frame_normal():
    normal = client.post("/api/document", json={"sketches": [{"id": "normal", "plane": "XY", "entities": []}], "features": []})
    flipped = client.post("/api/document", json={"sketches": [{"id": "flipped", "plane": "XY", "flipped": True, "entities": []}], "features": []})
    assert normal.status_code == 200
    assert flipped.status_code == 200
    normal_direction = normal.json()["sketches"][0]["frame"]["normal"]
    flipped_direction = flipped.json()["sketches"][0]["frame"]["normal"]
    assert flipped_direction == [-component for component in normal_direction]


def test_step_export_is_step_exchange_file():
    result = client.get("/api/export/box.step")
    assert result.status_code == 200
    assert result.content.startswith(b"ISO-10303-21")
    with NamedTemporaryFile(suffix=".step", delete=False) as handle:
        path = Path(handle.name)
        handle.write(result.content)
    try:
        imported = cq.importers.importStep(str(path)).val()
        assert imported.isValid()
        assert len(imported.Solids()) == 1
        assert round(imported.Volume(), 5) == 120000
    finally:
        path.unlink(missing_ok=True)


def test_document_exports_binary_stl_and_grouped_obj_meshes():
    document = {
        "sketches": [{"id": "base", "plane": "XY", "entities": rectangle(-20, -15, 20, 15)}],
        "features": [{"id": "base-feature", "type": "extrude", "sketchId": "base", "combine": "new", "bodyId": "body-1", "distance": 20}],
    }
    stl = client.post("/api/export/document.stl", json=document)
    assert stl.status_code == 200, stl.text
    assert stl.headers["content-type"].startswith("model/stl")
    assert "lucascad-document.stl" in stl.headers["content-disposition"]
    assert len(stl.content) >= 84
    triangle_count = int.from_bytes(stl.content[80:84], "little")
    assert triangle_count >= 12
    assert len(stl.content) == 84 + triangle_count * 50

    obj = client.post("/api/export/document.obj", json=document)
    assert obj.status_code == 200, obj.text
    assert obj.headers["content-type"].startswith("model/obj")
    assert "lucascad-document.obj" in obj.headers["content-disposition"]
    text = obj.text
    assert text.startswith("# LucasCad Wavefront OBJ")
    assert "\no body-1\n" in text
    vertices = [line for line in text.splitlines() if line.startswith("v ")]
    faces = [line for line in text.splitlines() if line.startswith("f ")]
    assert len(vertices) >= 8
    assert len(faces) >= 12
    assert max(int(index) for face in faces for index in face.split()[1:]) <= len(vertices)


def test_closed_sketch_extrudes_to_exact_solid():
    result = client.post("/api/model", json={"operation": "extrude", "distance": 20, "entities": rectangle(-50, -30, 50, 30)})
    assert result.status_code == 200
    payload = result.json()
    assert payload["properties"]["valid"] is True
    assert payload["properties"]["solidCount"] == 1
    assert round(payload["properties"]["volume"], 5) == 120000


def test_three_line_triangle_is_a_closed_extrudable_profile():
    triangle = [
        {"id": "side-a", "type": "line", "a": {"x": 0, "y": 0}, "b": {"x": 40, "y": 0}},
        {"id": "side-b", "type": "line", "a": {"x": 40, "y": 0}, "b": {"x": 10, "y": 30}},
        {"id": "side-c", "type": "line", "a": {"x": 10, "y": 30}, "b": {"x": 0, "y": 0}},
    ]
    validation = client.post("/api/sketch/validate", json={"entities": triangle})
    assert validation.status_code == 200
    assert validation.json()["closed"] is True
    assert validation.json()["profileCount"] == 1
    result = client.post("/api/model", json={"operation": "extrude", "distance": 8, "entities": triangle})
    assert result.status_code == 200, result.text
    assert round(result.json()["properties"]["volume"], 5) == 600 * 8


def test_triangle_endpoint_gaps_inside_profile_tolerance_are_healed():
    triangle = [
        {"id": "side-a", "type": "line", "a": {"x": 0.02, "y": 0.01}, "b": {"x": 40, "y": 0}},
        {"id": "side-b", "type": "line", "a": {"x": 39.98, "y": 0.01}, "b": {"x": 10, "y": 30}},
        {"id": "side-c", "type": "line", "a": {"x": 10.01, "y": 29.98}, "b": {"x": 0, "y": 0}},
    ]
    validation = client.post("/api/sketch/validate", json={"entities": triangle})
    assert validation.status_code == 200
    assert validation.json()["closed"] is True
    result = client.post("/api/model", json={"operation": "extrude", "distance": 8, "entities": triangle})
    assert result.status_code == 200, result.text
    assert result.json()["properties"]["solidCount"] == 1


def test_closed_spline_ignores_duplicate_double_click_endpoint():
    spline = {
        "id": "closed-spline",
        "type": "spline",
        "points": [
            {"x": -20, "y": 0}, {"x": -5, "y": 15}, {"x": 15, "y": 8},
            {"x": 20, "y": 0}, {"x": 8, "y": -14}, {"x": -12, "y": -10},
            {"x": -20, "y": 0}, {"x": -20, "y": 0},
        ],
    }
    validation = client.post("/api/sketch/validate", json={"entities": [spline]})
    assert validation.status_code == 200
    assert validation.json()["closed"] is True
    extrusion = client.post("/api/model", json={"operation": "extrude", "distance": 5, "entities": [spline]})
    assert extrusion.status_code == 200, extrusion.text


def test_closed_spline_tangent_handles_drive_extruded_curve():
    points = [{"x": -10, "y": 0}, {"x": 0, "y": 12}, {"x": 10, "y": 0}, {"x": 0, "y": -12}, {"x": -10, "y": 0}]
    handles = [
        {"in": {"x": -10, "y": -5}, "out": {"x": -10, "y": 5}},
        {"in": {"x": -5, "y": 12}, "out": {"x": 5, "y": 12}},
        {"in": {"x": 10, "y": 5}, "out": {"x": 10, "y": -5}},
        {"in": {"x": 5, "y": -12}, "out": {"x": -5, "y": -12}},
        {"in": {"x": -10, "y": -5}, "out": {"x": -10, "y": 5}},
    ]
    spline = {"id": "handled-spline", "type": "spline", "points": points, "handles": handles}
    result = client.post("/api/model", json={"operation": "extrude", "distance": 4, "entities": [spline]})
    assert result.status_code == 200, result.text
    assert result.json()["properties"]["solidCount"] == 1


def test_symmetric_and_bidirectional_extrusions_span_both_sketch_directions():
    sketch = {"id": "profile", "plane": "XY", "entities": rectangle(-5, -4, 5, 4)}
    symmetric = client.post("/api/document", json={
        "sketches": [sketch],
        "features": [{"id": "symmetric", "type": "extrude", "sketchId": "profile", "combine": "new", "bodyId": "body-1", "extent": "symmetric", "distance": 6, "distancePlus": 6, "distanceMinus": 6}],
    })
    assert symmetric.status_code == 200, symmetric.text
    assert round(symmetric.json()["properties"]["volume"], 5) == 80 * 12

    bidirectional = client.post("/api/document", json={
        "sketches": [sketch],
        "features": [{"id": "bidirectional", "type": "extrude", "sketchId": "profile", "combine": "new", "bodyId": "body-1", "extent": "bidirectional", "distance": 6, "distancePlus": 6, "distanceMinus": 4}],
    })
    assert bidirectional.status_code == 200, bidirectional.text
    assert round(bidirectional.json()["properties"]["volume"], 5) == 80 * 10


def test_document_returns_kernel_generated_phantom_preview_without_committing_it():
    result = client.post("/api/document", json={
        "sketches": [{"id": "profile", "plane": "XY", "entities": rectangle(-5, -4, 5, 4)}],
        "features": [],
        "previewFeature": {"type": "extrude", "sketchId": "profile", "combine": "new", "extent": "bidirectional", "distance": 6, "distancePlus": 6, "distanceMinus": 4},
    })
    assert result.status_code == 200, result.text
    assert result.json()["properties"]["bodyCount"] == 0
    assert len(result.json()["previewFaces"]) > 0


def test_consumed_multi_profile_sketch_returns_every_curve_for_3d_highlighting():
    triangle = [
        {"id": "side-a", "type": "line", "a": {"x": -15, "y": -10}, "b": {"x": 15, "y": -10}},
        {"id": "side-b", "type": "line", "a": {"x": 15, "y": -10}, "b": {"x": 0, "y": 18}},
        {"id": "side-c", "type": "line", "a": {"x": 0, "y": 18}, "b": {"x": -15, "y": -10}},
    ]
    sketch = {"id": "profile", "plane": "XY", "entities": [{"id": "outer-circle", "type": "circle", "c": {"x": 0, "y": 0}, "r": 50}, *triangle]}
    result = client.post("/api/document", json={
        "sketches": [sketch],
        "features": [{"id": "extrude", "type": "extrude", "sketchId": "profile", "combine": "new", "bodyId": "body-1", "distance": 10}],
    })
    assert result.status_code == 200, result.text
    paths = {path["id"]: path["points"] for path in result.json()["sketches"][0]["paths"]}
    assert set(paths) == {"outer-circle", "side-a", "side-b", "side-c"}
    assert len(paths["outer-circle"]) >= 32
    assert paths["outer-circle"][0] == paths["outer-circle"][-1]


def test_closed_sketch_revolves_around_selected_construction_axis():
    entities = rectangle(10, -20, 30, 20)
    entities.append({"id": "axis", "type": "line", "a": {"x": 0, "y": -50}, "b": {"x": 0, "y": 50}, "construction": True})
    result = client.post("/api/model", json={"operation": "revolve", "angle": 360, "axis": "construction", "entities": entities})
    assert result.status_code == 200
    payload = result.json()
    assert payload["properties"]["valid"] is True
    assert payload["properties"]["solidCount"] == 1
    assert round(payload["properties"]["volume"], 3) == round(3.141592653589793 * (30**2 - 10**2) * 40, 3)


def test_document_revolve_tracks_a_selected_sketch_line_axis_reference():
    entities = rectangle(10, -20, 30, 20)
    entities.append({"id": "axis-line", "type": "line", "a": {"x": 0, "y": -50}, "b": {"x": 0, "y": 50}, "construction": True})
    result = client.post("/api/document", json={
        "sketches": [{"id": "profile", "plane": "XY", "entities": entities}],
        "features": [{
            "id": "revolve", "type": "revolve", "sketchId": "profile", "combine": "new", "bodyId": "body-1", "angle": 360,
            "axis": {"kind": "sketch-line", "sketchId": "profile", "entityId": "axis-line", "label": "Sketch 1 · line"},
        }],
    })
    assert result.status_code == 200, result.text
    assert result.json()["properties"]["solidCount"] == 1
    assert round(result.json()["properties"]["volume"], 3) == round(math.pi * (30**2 - 10**2) * 40, 3)


def test_document_revolve_accepts_a_global_origin_axis_reference():
    result = client.post("/api/document", json={
        "sketches": [{"id": "profile", "plane": "XY", "entities": rectangle(10, -20, 30, 20)}],
        "features": [{
            "id": "revolve", "type": "revolve", "sketchId": "profile", "combine": "new", "bodyId": "body-1", "angle": 360,
            "axis": {"kind": "origin-axis", "axis": "y", "label": "Origin Y axis"},
        }],
    })
    assert result.status_code == 200, result.text
    assert result.json()["properties"]["solidCount"] == 1


def test_document_revolve_accepts_a_coplanar_straight_model_edge_reference():
    result = client.post("/api/document", json={
        "sketches": [
            {"id": "base", "plane": "XY", "entities": rectangle(-10, -10, 10, 10)},
            {"id": "profile", "plane": {"kind": "face", "bodyId": "base-body", "faceIndex": 1, "faceId": "base-body:face-1"}, "entities": rectangle(20, 5, 30, 10)},
        ],
        "features": [
            {"id": "extrude", "type": "extrude", "sketchId": "base", "combine": "new", "bodyId": "base-body", "distance": 10},
            {
                "id": "revolve", "type": "revolve", "sketchId": "profile", "combine": "new", "bodyId": "turned-body", "angle": 360,
                "axis": {"kind": "model-edge", "bodyId": "base-body", "edgeIndex": 3, "label": "Base body · edge 3"},
            },
        ],
    })
    assert result.status_code == 200, result.text
    assert result.json()["properties"]["bodyCount"] == 2


def test_reference_plane_can_support_a_rebuildable_sketch_and_extrusion():
    result = client.post("/api/document", json={
        "referenceGeometry": [{"id": "plane-1", "name": "Plane 1", "type": "plane", "origin": [0, 0, 12], "normal": [0, 0, 1], "xDir": [1, 0, 0], "sourceLabel": "XY origin plane", "visible": True}],
        "sketches": [{"id": "profile", "plane": {"kind": "reference-plane", "referenceId": "plane-1"}, "entities": rectangle(-5, -4, 5, 4)}],
        "features": [{"id": "extrude", "type": "extrude", "sketchId": "profile", "combine": "new", "bodyId": "body-1", "distance": 5}],
    })
    assert result.status_code == 200, result.text
    assert result.json()["properties"]["bodyCount"] == 1
    assert result.json()["sketches"][0]["frame"]["origin"] == [0.0, 0.0, 12.0]


def test_reference_axis_can_drive_a_revolve_feature():
    result = client.post("/api/document", json={
        "referenceGeometry": [{"id": "axis-1", "name": "Axis 1", "type": "axis", "origin": [0, 0, 0], "direction": [0, 1, 0], "sourceLabel": "Origin Y axis", "visible": True}],
        "sketches": [{"id": "profile", "plane": "XY", "entities": rectangle(10, -20, 30, 20)}],
        "features": [{"id": "revolve", "type": "revolve", "sketchId": "profile", "combine": "new", "bodyId": "body-1", "angle": 360, "axis": {"kind": "reference-axis", "referenceId": "axis-1", "label": "Axis 1"}}],
    })
    assert result.status_code == 200, result.text
    assert result.json()["properties"]["solidCount"] == 1


def test_open_sketch_is_rejected_with_actionable_message():
    result = client.post("/api/model", json={"operation": "extrude", "distance": 20, "entities": [{"id": "line", "type": "line", "a": {"x": 0, "y": 0}, "b": {"x": 10, "y": 0}}]})
    assert result.status_code == 422
    assert "open profile" in result.json()["detail"]


def test_sketch_validation_reports_unconnected_endpoints():
    result = client.post("/api/sketch/validate", json={"entities": [{"id": "line", "type": "line", "a": {"x": 0, "y": 0}, "b": {"x": 10, "y": 0}}]})
    assert result.status_code == 200
    assert result.json()["closed"] is False
    assert len(result.json()["openEndpoints"]) == 2


def test_sketch_validation_reports_degenerate_geometry_without_crashing():
    result = client.post("/api/sketch/validate", json={"entities": [{"id": "line", "type": "line", "a": {"x": 2, "y": 2}, "b": {"x": 2, "y": 2}}]})
    assert result.status_code == 200
    assert result.json()["closed"] is False
    assert "zero length" in result.json()["issues"][0]


def test_sketch_validation_warns_about_branching_zero_thickness_junctions():
    entities = [
        {"id": "a", "type": "line", "a": {"x": 0, "y": 0}, "b": {"x": 10, "y": 0}},
        {"id": "b", "type": "line", "a": {"x": 10, "y": 0}, "b": {"x": 10, "y": 10}},
        {"id": "c", "type": "line", "a": {"x": 10, "y": 10}, "b": {"x": 0, "y": 10}},
        {"id": "d", "type": "line", "a": {"x": 0, "y": 10}, "b": {"x": 0, "y": 0}},
        {"id": "branch-1", "type": "line", "a": {"x": 0, "y": 0}, "b": {"x": -5, "y": -5}},
        {"id": "branch-2", "type": "line", "a": {"x": -5, "y": -5}, "b": {"x": 0, "y": 0}},
    ]
    result = client.post("/api/sketch/validate", json={"entities": entities})
    assert result.status_code == 200
    assert any("zero-thickness" in warning for warning in result.json()["warnings"])


def test_document_replays_new_body_and_cut_feature():
    document = {
        "sketches": [
            {"id": "base", "plane": "XY", "entities": rectangle(-50, -30, 50, 30)},
            {"id": "hole", "plane": "XY", "entities": [{"id": "circle", "type": "circle", "c": {"x": 0, "y": 0}, "r": 10}]},
        ],
        "features": [
            {"id": "extrude-base", "name": "Extrude 1", "type": "extrude", "sketchId": "base", "combine": "new", "bodyId": "body-1", "distance": 20},
            {"id": "cut-hole", "name": "Extrude 2", "type": "extrude", "sketchId": "hole", "combine": "cut", "targetBodyId": "body-1", "distance": 20},
        ],
    }
    result = client.post("/api/document", json=document)
    assert result.status_code == 200, result.text
    payload = result.json()
    assert payload["properties"]["bodyCount"] == 1
    assert round(payload["properties"]["volume"], 3) == round(120000 - 3.141592653589793 * 10**2 * 20, 3)
    assert len(payload["sketches"]) == 2
    assert len(payload["edges"]) == payload["properties"]["edgeCount"]
    assert all(len(edge["points"]) >= 2 for edge in payload["edges"])


def test_document_reports_axis_metadata_for_every_edge_and_round_surfaces():
    document = {
        "sketches": [{"id": "round", "plane": "XY", "entities": [{"id": "circle", "type": "circle", "c": {"x": 0, "y": 0}, "r": 10}]}],
        "features": [{"id": "extrude-round", "type": "extrude", "sketchId": "round", "combine": "new", "bodyId": "body-1", "distance": 20}],
    }
    result = client.post("/api/document", json=document)
    assert result.status_code == 200, result.text
    payload = result.json()
    assert all(edge.get("axisOrigin") and edge.get("axisDirection") for edge in payload["edges"])
    circular_edges = [edge for edge in payload["edges"] if edge.get("geometryType") == "CIRCLE"]
    assert circular_edges and all(edge["axisKind"] == "center" for edge in circular_edges)
    cylindrical_faces = [face for face in payload["faces"] if face.get("geometryType") == "CYLINDER"]
    assert cylindrical_faces and all(face.get("axisOrigin") and face.get("axisDirection") and face.get("axisKind") == "center" for face in cylindrical_faces)


def test_toroidal_surface_reports_its_center_axis():
    torus = cq.Workplane("XZ").moveTo(20, 0).circle(5).revolve(360, (0, 0), (0, 1)).val()
    toroidal_face = next(face for face in torus.Faces() if face.geomType() == "TORUS")
    metadata = face_selection_metadata(toroidal_face)
    assert metadata["geometryType"] == "TORUS"
    assert metadata["axisKind"] == "center"
    assert metadata["axisOrigin"] == [0.0, 0.0, 0.0]
    assert metadata["axisDirection"] == [0.0, 0.0, 1.0]


def test_document_unions_an_overlapping_profile_into_the_target_body():
    document = {
        "sketches": [
            {"id": "base", "plane": "XY", "entities": rectangle(-50, -30, 50, 30)},
            {"id": "extension", "plane": "XY", "entities": rectangle(40, -10, 70, 10)},
        ],
        "features": [
            {"id": "base-feature", "type": "extrude", "sketchId": "base", "combine": "new", "bodyId": "body-1", "distance": 20},
            {"id": "union-feature", "type": "extrude", "sketchId": "extension", "combine": "union", "targetBodyId": "body-1", "distance": 20},
        ],
    }
    result = client.post("/api/document", json=document)
    assert result.status_code == 200, result.text
    assert result.json()["properties"]["bodyCount"] == 1
    assert round(result.json()["properties"]["volume"], 5) == 128000


def test_document_applies_constant_radius_fillet_to_selected_cube_edge():
    document = {
        "sketches": [{"id": "base", "plane": "XY", "entities": rectangle(-20, -15, 20, 15)}],
        "features": [
            {"id": "base-feature", "type": "extrude", "sketchId": "base", "combine": "new", "bodyId": "body-1", "distance": 20},
            {"id": "fillet-1", "type": "fillet", "targetBodyId": "body-1", "edgeIndices": [1], "radius": 2},
        ],
    }
    result = client.post("/api/document", json=document)
    assert result.status_code == 200, result.text
    payload = result.json()
    assert payload["properties"]["valid"] is True
    assert payload["properties"]["bodyCount"] == 1
    assert payload["properties"]["edgeCount"] > 12
    assert payload["properties"]["volume"] < 24000


def test_document_applies_symmetric_chamfer_to_selected_cube_edge():
    document = {
        "sketches": [{"id": "base", "plane": "XY", "entities": rectangle(-20, -15, 20, 15)}],
        "features": [
            {"id": "base-feature", "type": "extrude", "sketchId": "base", "combine": "new", "bodyId": "body-1", "distance": 20},
            {"id": "chamfer-1", "type": "chamfer", "targetBodyId": "body-1", "edgeIndices": [1], "distance": 2},
        ],
    }
    result = client.post("/api/document", json=document)
    assert result.status_code == 200, result.text
    payload = result.json()
    assert payload["properties"]["valid"] is True
    assert payload["properties"]["bodyCount"] == 1
    assert payload["properties"]["edgeCount"] > 12
    assert payload["properties"]["volume"] < 24000


def test_document_applies_distance_distance_chamfer_to_selected_cube_edge():
    document = {
        "sketches": [{"id": "base", "plane": "XY", "entities": rectangle(-20, -15, 20, 15)}],
        "features": [
            {"id": "base-feature", "type": "extrude", "sketchId": "base", "combine": "new", "bodyId": "body-1", "distance": 20},
            {"id": "chamfer-1", "type": "chamfer", "targetBodyId": "body-1", "edgeIndices": [1], "method": "distance-distance", "distance": 2, "distance2": 4},
        ],
    }
    result = client.post("/api/document", json=document)
    assert result.status_code == 200, result.text
    assert 0 < result.json()["properties"]["volume"] < 24000


def test_document_applies_angle_distance_chamfer_and_supports_flipping_sides():
    base = {
        "sketches": [{"id": "base", "plane": "XY", "entities": rectangle(-20, -15, 20, 15)}],
        "features": [{"id": "base-feature", "type": "extrude", "sketchId": "base", "combine": "new", "bodyId": "body-1", "distance": 20}],
    }
    preview = {"type": "chamfer", "targetBodyId": "body-1", "edgeIndices": [1], "method": "angle-distance", "distance": 2, "distance2": 2, "angle": 30, "flip": False}
    forward = client.post("/api/document", json={**base, "previewFeature": preview})
    flipped = client.post("/api/document", json={**base, "previewFeature": {**preview, "flip": True}})
    assert forward.status_code == 200, forward.text
    assert flipped.status_code == 200, flipped.text
    assert forward.json()["previewFaces"]
    assert flipped.json()["previewFaces"]


def test_document_drafts_cube_side_faces_from_neutral_face():
    document = {
        "sketches": [{"id": "base", "plane": "XY", "entities": rectangle(-20, -15, 20, 15)}],
        "features": [
            {"id": "base-feature", "type": "extrude", "sketchId": "base", "combine": "new", "bodyId": "body-1", "distance": 20},
            {"id": "draft-1", "type": "draft", "targetBodyId": "body-1", "neutralFaceIndex": 5, "faceIndices": [1, 2, 3, 4], "angle": 3, "reverse": False},
        ],
    }
    result = client.post("/api/document", json=document)
    assert result.status_code == 200, result.text
    payload = result.json()
    assert payload["properties"]["valid"] is True
    assert payload["properties"]["bodyCount"] == 1
    assert payload["properties"]["faceCount"] == 6
    assert payload["properties"]["volume"] != 24000


def test_document_drafts_closed_spline_hull_without_failing_at_its_joining_point():
    hull = {
        "id": "hull-spline",
        "type": "spline",
        "points": [
            {"x": -42, "y": 0}, {"x": -24, "y": -16}, {"x": 20, "y": -19},
            {"x": 50, "y": 0}, {"x": 20, "y": 19}, {"x": -24, "y": 16}, {"x": -42, "y": 0},
        ],
    }
    base = {
        "sketches": [{"id": "hull", "plane": "XY", "entities": [hull]}],
        "features": [{"id": "hull-extrude", "type": "extrude", "sketchId": "hull", "combine": "new", "bodyId": "body-1", "distance": 18}],
    }
    rebuilt = client.post("/api/document", json=base)
    assert rebuilt.status_code == 200, rebuilt.text
    body_faces = [face for face in rebuilt.json()["faces"] if face["bodyId"] == "body-1"]
    neutral = next(face for face in body_faces if face["planar"] and face["normal"][2] < -0.99)
    curved_sides = [face for face in body_faces if face["geometryType"] not in ("PLANE", "CYLINDER", "CONE")]
    assert curved_sides

    preview = client.post("/api/document", json={
        **base,
        "previewFeature": {
            "type": "draft", "targetBodyId": "body-1", "neutralFaceIndex": neutral["faceIndex"],
            "faceIndices": [face["faceIndex"] for face in curved_sides], "angle": 3, "reverse": False,
        },
    })
    assert preview.status_code == 200, preview.text
    payload = preview.json()
    assert payload["previewTargetBodyId"] == "body-1"
    assert payload["previewFaces"]
    assert payload["properties"]["valid"] is True


def test_document_drafts_a_pointed_canoe_built_from_connected_spline_spans():
    spans = [
        [(-60, 0), (-45, -12), (0, -24)],
        [(0, -24), (45, -12), (60, 0)],
        [(60, 0), (45, 12), (0, 24)],
        [(0, 24), (-45, 12), (-60, 0)],
    ]
    entities = [
        {"id": f"canoe-span-{index}", "type": "spline", "points": [{"x": x, "y": y} for x, y in points]}
        for index, points in enumerate(spans)
    ]
    base = {
        "sketches": [{"id": "canoe", "plane": "XY", "entities": entities}],
        "features": [{"id": "canoe-extrude", "type": "extrude", "sketchId": "canoe", "combine": "new", "bodyId": "body-1", "distance": 18}],
    }
    extruded = client.post("/api/document", json=base)
    assert extruded.status_code == 200, extruded.text
    faces = extruded.json()["faces"]
    neutral = next(face for face in faces if face["planar"] and face["normal"][2] > 0.99)
    swept_sides = [face for face in faces if face["geometryType"] == "EXTRUSION"]
    assert len(swept_sides) == 4

    drafted = client.post("/api/document", json={
        **base,
        "features": [*base["features"], {
            "id": "canoe-draft", "type": "draft", "targetBodyId": "body-1",
            "neutralFaceIndex": neutral["faceIndex"],
            "faceIndices": [face["faceIndex"] for face in swept_sides],
            "angle": 10, "reverse": False,
        }],
    })
    assert drafted.status_code == 200, drafted.text
    payload = drafted.json()
    assert payload["properties"]["valid"] is True
    assert payload["properties"]["solidCount"] == 1
    assert payload["properties"]["faceCount"] >= 6


def test_document_shells_a_box_inward_and_removes_the_selected_opening_face():
    base = {
        "sketches": [{"id": "base", "plane": "XY", "entities": rectangle(-20, -15, 20, 15)}],
        "features": [{"id": "base-feature", "type": "extrude", "sketchId": "base", "combine": "new", "bodyId": "body-1", "distance": 20}],
    }
    rebuilt = client.post("/api/document", json=base)
    assert rebuilt.status_code == 200, rebuilt.text
    top = max((face for face in rebuilt.json()["faces"] if face["planar"]), key=lambda face: face["center"][2])
    shelled = client.post("/api/document", json={
        **base,
        "features": [*base["features"], {"id": "shell-1", "type": "shell", "targetBodyId": "body-1", "faceIndices": [top["faceIndex"]], "thickness": 2, "outward": False}],
    })
    assert shelled.status_code == 200, shelled.text
    payload = shelled.json()
    assert payload["properties"]["valid"] is True
    assert payload["properties"]["solidCount"] == 1
    assert math.isclose(payload["properties"]["volume"], 7152, rel_tol=1e-6)
    outward_preview = client.post("/api/document", json={
        **base,
        "previewFeature": {"type": "shell", "targetBodyId": "body-1", "faceIndices": [top["faceIndex"]], "thickness": 2, "outward": True},
    })
    assert outward_preview.status_code == 200, outward_preview.text
    assert outward_preview.json()["previewTargetBodyId"] == "body-1"
    assert outward_preview.json()["previewFaces"]


def test_document_shells_a_ten_degree_drafted_closed_spline_boat_hull():
    hull = {
        "id": "hull-spline",
        "type": "spline",
        "points": [
            {"x": -42, "y": 0}, {"x": -24, "y": -16}, {"x": 20, "y": -19},
            {"x": 50, "y": 0}, {"x": 20, "y": 19}, {"x": -24, "y": 16}, {"x": -42, "y": 0},
        ],
    }
    base = {
        "sketches": [{"id": "hull", "plane": "XY", "entities": [hull]}],
        "features": [{"id": "hull-extrude", "type": "extrude", "sketchId": "hull", "combine": "new", "bodyId": "body-1", "distance": 18}],
    }
    extruded = client.post("/api/document", json=base)
    assert extruded.status_code == 200, extruded.text
    base_faces = extruded.json()["faces"]
    neutral = next(face for face in base_faces if face["planar"] and face["normal"][2] < -0.99)
    curved_sides = [face for face in base_faces if face["geometryType"] not in ("PLANE", "CYLINDER", "CONE")]
    drafted = {
        **base,
        "features": [*base["features"], {"id": "hull-draft", "type": "draft", "targetBodyId": "body-1", "neutralFaceIndex": neutral["faceIndex"], "faceIndices": [face["faceIndex"] for face in curved_sides], "angle": 10, "reverse": False}],
    }
    drafted_result = client.post("/api/document", json=drafted)
    assert drafted_result.status_code == 200, drafted_result.text
    top = max((face for face in drafted_result.json()["faces"] if face["planar"]), key=lambda face: face["center"][2])
    shelled = client.post("/api/document", json={
        **drafted,
        "features": [*drafted["features"], {"id": "hull-shell", "type": "shell", "targetBodyId": "body-1", "faceIndices": [top["faceIndex"]], "thickness": 1.5, "outward": False}],
    })
    assert shelled.status_code == 200, shelled.text
    payload = shelled.json()
    assert payload["properties"]["valid"] is True
    assert payload["properties"]["solidCount"] == 1
    assert 0 < payload["properties"]["volume"] < drafted_result.json()["properties"]["volume"]
    assert payload["properties"]["faceCount"] > drafted_result.json()["properties"]["faceCount"]


def test_body_feature_preview_replaces_target_with_phantom_result():
    document = {
        "sketches": [{"id": "base", "plane": "XY", "entities": rectangle(-20, -15, 20, 15)}],
        "features": [{"id": "base-feature", "type": "extrude", "sketchId": "base", "combine": "new", "bodyId": "body-1", "distance": 20}],
        "previewFeature": {"type": "fillet", "targetBodyId": "body-1", "edgeIndices": [1], "radius": 2},
    }
    result = client.post("/api/document", json=document)
    assert result.status_code == 200, result.text
    assert result.json()["previewTargetBodyId"] == "body-1"
    assert len(result.json()["previewFaces"]) > 6


def test_sketch_can_be_attached_to_a_planar_body_face():
    document = {
        "sketches": [
            {"id": "base", "plane": "XY", "entities": rectangle(-50, -30, 50, 30)},
            {"id": "face-sketch", "plane": {"kind": "face", "bodyId": "body-1", "faceIndex": 6}, "entities": [{"id": "circle", "type": "circle", "c": {"x": 0, "y": 0}, "r": 8}]},
        ],
        "features": [{"id": "base-feature", "type": "extrude", "sketchId": "base", "combine": "new", "bodyId": "body-1", "distance": 20}],
    }
    result = client.post("/api/document", json=document)
    assert result.status_code == 200, result.text
    face_sketch = next(sketch for sketch in result.json()["sketches"] if sketch["id"] == "face-sketch")
    assert face_sketch["visible"] is True
    assert len(face_sketch["paths"]) == 1
    assert all(abs(point[2] - 20) < 1e-5 for point in face_sketch["paths"][0]["points"])
    assert abs(face_sketch["frame"]["origin"][2] - 20) < 1e-5


def test_cut_from_top_face_defaults_into_body_with_negative_sketch_direction():
    document = {
        "sketches": [
            {"id": "base", "plane": "XY", "entities": rectangle(-50, -30, 50, 30)},
            {"id": "face-hole", "plane": {"kind": "face", "bodyId": "body-1", "faceIndex": 6}, "entities": [{"id": "circle", "type": "circle", "c": {"x": 0, "y": 0}, "r": 8}]},
        ],
        "features": [
            {"id": "base-feature", "type": "extrude", "sketchId": "base", "combine": "new", "bodyId": "body-1", "distance": 20, "direction": 1},
            {"id": "face-cut", "type": "extrude", "sketchId": "face-hole", "combine": "cut", "targetBodyId": "body-1", "distance": 30, "direction": -1},
        ],
    }
    result = client.post("/api/document", json=document)
    assert result.status_code == 200, result.text
    expected_volume = 120000 - 3.141592653589793 * 8**2 * 20
    assert round(result.json()["properties"]["volume"], 3) == round(expected_volume, 3)


def test_document_keeps_unconsumed_sketch_visible_without_extruding_it():
    document = {"sketches": [{"id": "sketch-1", "name": "Sketch 1", "plane": "XZ", "entities": rectangle(-20, -10, 20, 10)}], "features": []}
    result = client.post("/api/document", json=document)
    assert result.status_code == 200
    payload = result.json()
    assert payload["properties"]["solidCount"] == 0
    assert payload["sketches"][0]["visible"] is True
    assert len(payload["sketches"][0]["paths"]) == 4
