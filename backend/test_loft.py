"""Real OpenCASCADE loft regressions, including Boolean and exchange-file checks."""
import copy
import json
import math
from pathlib import Path

import cadquery as cq
import pytest
from fastapi.testclient import TestClient

from server import app, build_document

client = TestClient(app)


def rectangle(width, height):
    points = [{"x": -width / 2, "y": -height / 2}, {"x": width / 2, "y": -height / 2}, {"x": width / 2, "y": height / 2}, {"x": -width / 2, "y": height / 2}]
    return [{"id": f"edge-{i}", "type": "line", "a": point, "b": points[(i + 1) % 4]} for i, point in enumerate(points)]


def sections(geometries, heights=None):
    heights = heights or [i * 30 for i in range(len(geometries))]
    return {
        "sketches": [{"id": f"s{i}", "name": f"Section {i + 1}", "plane": {"kind": "reference-plane", "referenceId": f"p{i}"}, "entities": geometry} for i, geometry in enumerate(geometries)],
        "referenceGeometry": [{"id": f"p{i}", "type": "plane", "origin": [0, 0, height], "normal": [0, 0, 1], "xDir": [1, 0, 0]} for i, height in enumerate(heights)],
        "features": [{"id": "loft", "name": "Loft 1", "type": "loft", "sketchIds": [f"s{i}" for i in range(len(geometries))], "combine": "new", "bodyId": "hull", "ruled": False}],
    }


def circles(radii, heights=None):
    return sections([[{"id": "circle", "type": "circle", "c": {"x": 0, "y": 0}, "r": radius}] for radius in radii], heights)


def valid(document):
    response = client.post("/api/document", json=document)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["properties"]["valid"]
    assert result["properties"]["solidCount"] == 1
    return result


def test_two_circle_loft_has_exact_frustum_volume():
    result = valid(circles([20, 10]))
    assert result["properties"]["volume"] == pytest.approx(math.pi * 30 / 3 * (400 + 200 + 100), rel=1e-6)


def test_smooth_and_ruled_three_section_lofts_differ_and_rebuild():
    document = sections([rectangle(20, 10), rectangle(50, 30), rectangle(30, 20)])
    smooth = valid(document)["properties"]["volume"]
    document["features"][0]["ruled"] = True
    ruled = valid(document)["properties"]["volume"]
    assert abs(smooth - ruled) > 100
    document["sketches"][1]["entities"] = rectangle(55, 35)
    assert valid(document)["properties"]["volume"] > ruled
    document["features"][0]["sketchIds"].reverse()
    assert valid(document)["properties"]["volume"] > ruled


def test_circle_to_rectangle_with_different_edge_counts():
    document = sections([rectangle(30, 20), [{"id": "circle", "type": "circle", "c": {"x": 0, "y": 0}, "r": 10}]])
    valid(document)


@pytest.mark.parametrize("combine", ["union", "cut"])
def test_loft_boolean_and_live_preview(combine):
    document = circles([10, 5], [0, 30])
    document["sketches"].append({"id": "base", "plane": "XY", "entities": rectangle(50, 50)})
    document["features"].insert(0, {"id": "base", "type": "extrude", "sketchId": "base", "distance": 10, "combine": "new", "bodyId": "base-body"})
    document["features"][-1].update(combine=combine, targetBodyId="base-body")
    result = valid(document)
    assert (result["properties"]["volume"] > 25000) == (combine == "union")
    preview = copy.deepcopy(document)
    preview["previewFeature"] = preview["features"].pop()
    response = client.post("/api/document", json=preview)
    assert response.status_code == 200, response.text
    assert response.json()["previewFaces"]
    assert response.json()["properties"]["volume"] == pytest.approx(25000)


def test_hidden_profiles_and_new_body_preview_are_retained():
    document = circles([12, 6])
    for sketch in document["sketches"]:
        sketch["visible"] = False
    document["previewFeature"] = document["features"].pop()
    response = client.post("/api/document", json=document)
    assert response.status_code == 200, response.text
    assert response.json()["previewFaces"]
    assert len(response.json()["sketches"]) == 2
    assert response.json()["properties"]["bodyCount"] == 0


def test_union_can_start_on_target_face_without_volume_overlap():
    document = circles([10, 5], [10, 30])
    document["sketches"].append({"id": "base", "plane": "XY", "entities": rectangle(50, 50)})
    document["features"].insert(0, {"id": "base", "type": "extrude", "sketchId": "base", "distance": 10, "combine": "new", "bodyId": "base"})
    document["features"][-1].update(combine="union", targetBodyId="base")
    assert valid(document)["properties"]["volume"] > 25000


@pytest.mark.parametrize("case, message", [("one", "at least two"), ("duplicate", "different sketch"), ("missing", "missing sketch"), ("open", "not closed"), ("multiple", "exactly one"), ("coplanar", "shares a plane")])
def test_bad_sections_have_actionable_diagnostics(case, message):
    document = sections([rectangle(20, 20), rectangle(10, 10)])
    if case == "one": document["features"][0]["sketchIds"] = ["s0"]
    if case == "duplicate": document["features"][0]["sketchIds"] = ["s0", "s0"]
    if case == "missing": document["features"][0]["sketchIds"] = ["s0", "gone"]
    if case == "open": document["sketches"][0]["entities"].pop()
    if case == "multiple": document["sketches"][0]["entities"] += [{"id": "hole", "type": "circle", "c": {"x": 0, "y": 0}, "r": 2}]
    if case == "coplanar": document["referenceGeometry"][1]["origin"] = [0, 0, 0]
    response = client.post("/api/document", json=document)
    assert response.status_code == 422, response.text
    assert message in response.json()["detail"]


def test_nonintersecting_loft_cut_fails_in_preview_not_after_commit():
    document = circles([5, 3], [20, 40])
    document["sketches"].append({"id": "base", "plane": "XY", "entities": rectangle(50, 50)})
    document["previewFeature"] = document["features"].pop()
    document["previewFeature"].update(combine="cut", targetBodyId="base")
    document["features"] = [{"id": "base", "type": "extrude", "sketchId": "base", "distance": 10, "combine": "new", "bodyId": "base"}]
    response = client.post("/api/document", json=document)
    assert response.status_code == 422
    assert "does not overlap" in response.json()["detail"]


def test_loft_step_roundtrip_and_json_roundtrip(tmp_path):
    document = sections([rectangle(30, 20), rectangle(60, 35), rectangle(25, 15)])
    result = valid(json.loads(json.dumps(document)))
    response = client.post("/api/export/document.step", json=document)
    assert response.status_code == 200, response.text
    path = tmp_path / "loft.step"
    path.write_bytes(response.content)
    imported = cq.importers.importStep(str(path)).val()
    assert imported.isValid() and len(imported.Solids()) == 1
    assert imported.Volume() == pytest.approx(result["properties"]["volume"], rel=1e-5)


def test_car_body_example_is_a_valid_editable_loft():
    document = json.loads((Path(__file__).parents[1] / "examples" / "loft-car-body.lucascad.json").read_text())
    result = valid(document)
    assert result["properties"]["bounds"]["x"] > 150
    document["sketches"][2]["entities"][0]["b"]["y"] += 1
    document["sketches"][2]["entities"][1]["a"]["y"] += 1
    valid(document)
