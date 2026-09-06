"""Sweep tests exercise real OpenCASCADE solids, previews, Booleans and export."""
import copy
import json
import math
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from server import app, build_document

client = TestClient(app)
EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "Sweep-hollow-handle.lucascad.json"


def sample():
    return json.loads(EXAMPLE.read_text())


def straight():
    doc = sample()
    doc["sketches"][0]["entities"] = doc["sketches"][0]["entities"][:1]
    doc["sketches"][1]["entities"] = [dict(id="path", type="line", a=dict(x=0, y=0), b=dict(x=0, y=55))]
    return doc


def valid(doc):
    response = client.post("/api/document", json=doc)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["properties"]["valid"]
    assert data["properties"]["solidCount"] == 1
    return data


def test_hollow_handle_has_exact_material_volume_and_one_solid():
    result = valid(sample())
    assert result["properties"]["volume"] == pytest.approx(math.pi * (8**2 - 5**2) * (110 + math.pi * 30), rel=1e-6)
    assert len(result["faces"]) > 4


@pytest.mark.parametrize("orientation", ["follow", "fixed"])
def test_straight_sweep_and_reversed_path(orientation):
    doc = straight()
    doc["features"][0]["orientation"] = orientation
    expected = math.pi * 64 * 55
    assert valid(doc)["properties"]["volume"] == pytest.approx(expected, rel=1e-6)
    edge = doc["sketches"][1]["entities"][0]
    edge["a"], edge["b"] = edge["b"], edge["a"]
    assert valid(doc)["properties"]["volume"] == pytest.approx(expected, rel=1e-6)


def test_profile_and_path_edits_propagate_through_rebuild():
    doc = straight()
    before = valid(doc)["properties"]["volume"]
    doc["sketches"][0]["entities"][0]["r"] *= 2
    doc["sketches"][1]["entities"][0]["b"]["y"] *= 2
    assert valid(doc)["properties"]["volume"] == pytest.approx(before * 8, rel=1e-6)


def test_preview_produces_swept_faces_without_committing_geometry():
    doc = sample()
    doc["previewFeature"] = doc["features"].pop()
    response = client.post("/api/document", json=doc)
    assert response.status_code == 200, response.text
    assert response.json()["previewFaces"]
    assert response.json()["properties"]["bodyCount"] == 0
    assert doc["features"] == []


@pytest.mark.parametrize("combine", ["union", "cut"])
def test_sweep_boolean_and_preview(combine):
    doc = straight()
    doc["sketches"].append({"id": "base", "plane": "XY", "entities": [{"id": "disc", "type": "circle", "c": {"x": 0, "y": 0}, "r": 20}]})
    doc["features"].insert(0, {"id": "base", "type": "extrude", "sketchId": "base", "distance": 20, "bodyId": "base", "combine": "new"})
    doc["features"][-1].update(combine=combine, targetBodyId="base")
    result = valid(doc)
    assert (result["properties"]["volume"] > math.pi * 400 * 20) == (combine == "union")
    doc["previewFeature"] = doc["features"].pop()
    response = client.post("/api/document", json=doc)
    assert response.status_code == 200, response.text
    assert response.json()["previewFaces"]


@pytest.mark.parametrize("fault, message", [("open", "not closed"), ("gap", "disconnected"), ("branch", "branches"), ("same", "different sketches"), ("missing", "missing"), ("off-plane", "profile plane"), ("tangent", "tangent")])
def test_invalid_sweeps_report_actionable_errors(fault, message):
    doc = straight()
    if fault == "open":
        doc["sketches"][0]["entities"] = [{"type": "line", "a": {"x": 0, "y": 0}, "b": {"x": 10, "y": 0}}]
    elif fault == "gap":
        doc["sketches"][1]["entities"].append({"type": "line", "a": {"x": 0, "y": 65}, "b": {"x": 0, "y": 100}})
    elif fault == "branch":
        for x in (-20, 20):
            doc["sketches"][1]["entities"].append({"type": "line", "a": {"x": 0, "y": 55}, "b": {"x": x, "y": 80}})
    elif fault == "same":
        doc["features"][0]["sketchIds"][1] = "handle-profile"
    elif fault == "missing":
        doc["features"][0]["sketchIds"][1] = "missing"
    elif fault == "off-plane":
        doc["sketches"][1]["entities"][0]["a"]["y"] = 10
    elif fault == "tangent":
        doc["sketches"][1]["plane"] = "XY"
    response = client.post("/api/document", json=doc)
    assert response.status_code == 422, response.text
    assert message in response.json()["detail"]


def test_spline_path_is_smooth_and_sweeps_as_a_true_solid():
    doc = straight()
    doc["sketches"][1]["entities"] = [{"id": "spline", "type": "spline", "points": [{"x": 0, "y": 0}, {"x": 2, "y": 20}, {"x": 20, "y": 40}, {"x": 25, "y": 65}]}]
    valid(doc)


def test_constant_normal_differs_from_follow_path_on_a_curved_spine():
    doc = straight()
    doc["sketches"][1]["entities"] = [{"id": "curve", "type": "arc", "a": {"x": 0, "y": 0}, "through": {"x": 3, "y": 25}, "b": {"x": 12, "y": 50}}]
    follow = valid(doc)["properties"]["volume"]
    doc["features"][0]["orientation"] = "fixed"
    fixed = valid(doc)["properties"]["volume"]
    assert abs(follow - fixed) > 50


@pytest.mark.parametrize("transition", ["round", "right"])
def test_connected_sharp_line_corners_and_unordered_entities(transition):
    doc = straight()
    doc["features"][0]["transition"] = transition
    doc["sketches"][1]["entities"].insert(0, {"id": "turn", "type": "line", "a": {"x": 0, "y": 55}, "b": {"x": 40, "y": 55}})
    valid(doc)


def test_closed_circle_path_at_its_seam_creates_a_torus():
    doc = straight()
    doc["referenceGeometry"] = [{"id": "profile-plane", "type": "plane", "origin": [30, 0, 0], "normal": [0, 1, 0], "xDir": [1, 0, 0]}]
    doc["sketches"][0]["plane"] = {"kind": "reference-plane", "referenceId": "profile-plane"}
    doc["sketches"][1]["plane"] = "XY"
    doc["sketches"][1]["entities"] = [{"id": "ring", "type": "circle", "c": {"x": 0, "y": 0}, "r": 30}]
    assert valid(doc)["properties"]["volume"] == pytest.approx(2 * math.pi**2 * 30 * 64, rel=1e-6)


@pytest.mark.parametrize("format", ["step", "stl", "obj"])
def test_swept_handle_exports(format):
    response = client.post(f"/api/export/document.{format}", json=sample())
    assert response.status_code == 200, response.text
    assert len(response.content) > 1000


def test_downstream_feature_rebuilds_on_the_sweep():
    doc = sample()
    bodies, _, _ = build_document(doc)
    edge_count = len(bodies["handle-body"].Edges())
    assert edge_count > 3
    # A second extrusion references the sweep's existing result body.
    doc["sketches"].append({"id": "cap", "plane": "XY", "entities": [{"id": "c", "type": "circle", "c": {"x": 0, "y": 0}, "r": 8}]})
    doc["features"].append({"id": "cap", "type": "extrude", "sketchId": "cap", "distance": 3, "combine": "union", "targetBodyId": "handle-body"})
    valid(doc)
