from pathlib import Path
from tempfile import NamedTemporaryFile

import cadquery as cq
from fastapi.testclient import TestClient

from server import app


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
