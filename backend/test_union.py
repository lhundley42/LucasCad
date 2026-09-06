import json
import cadquery as cq
import pytest
from fastapi.testclient import TestClient
from server import app, build_document, document_payload, union_bodies


def document(offsets=(0, 5, 10)):
    sketches, features = [], []
    for i, x in enumerate(offsets):
        points = [{"x": x, "y": 0}, {"x": x + 10, "y": 0}, {"x": x + 10, "y": 10}, {"x": x, "y": 10}]
        sketches.append({"id": f"s{i}", "plane": "XY", "entities": [{"id": f"e{j}", "type": "line", "a": p, "b": points[(j + 1) % 4]} for j, p in enumerate(points)]})
        features.append({"id": f"e{i}", "type": "extrude", "sketchId": f"s{i}", "combine": "new", "bodyId": f"b{i}", "distance": 10})
    return {"sketches": sketches, "features": features}


def union(ids=("b0", "b1", "b2")):
    return {"id": "union", "name": "Union 1", "type": "union", "bodyIds": list(ids), "targetBodyId": ids[0]}


@pytest.mark.parametrize("offsets,volume", [((0, 5, 10), 2000), ((0, 10, 20), 3000), ((0, 20, 10), 3000)])
def test_overlapping_touching_and_late_bridge_union(offsets, volume):
    doc = document(offsets)
    doc["features"].append(union())
    bodies, _, results = build_document(json.loads(json.dumps(doc)))
    assert list(bodies) == ["b0"]
    assert bodies["b0"].isValid() and len(bodies["b0"].Solids()) == 1
    assert bodies["b0"].Volume() == pytest.approx(volume)
    assert results[-1] == {"id": "union", "bodyId": "b0"}
    doc["features"].pop()
    assert len(build_document(doc)[0]) == 3


def test_preview_preserves_sources_then_commit_consumes_only_selected_bodies():
    doc = document((0, 5, 100))
    doc["previewFeature"] = union(("b0", "b1"))
    preview = document_payload(doc)
    assert preview["properties"]["bodyCount"] == 3
    assert preview["previewFaces"]
    assert preview["previewTargetBodyIds"] == ["b0", "b1"]
    doc["features"].append(doc.pop("previewFeature"))
    committed = document_payload(doc)
    assert committed["properties"]["bodyCount"] == 2
    assert {face["bodyId"] for face in committed["faces"]} == {"b0", "b2"}
    assert not committed["previewFaces"]


@pytest.mark.parametrize("ids,message", [(("b0",), "at least two"), (("b0", "b0"), "only once"), (("b0", "missing"), "missing"), (("b0", "b2"), "touch or overlap")])
def test_invalid_selection_is_clear_and_does_not_mutate_sources(ids, message):
    bodies = build_document(document((0, 5, 100)))[0]
    with pytest.raises(ValueError, match=message):
        union_bodies(bodies, union(ids))
    assert len(bodies) == 3
    assert all(body.isValid() for body in bodies.values())


def test_union_supports_editing_source_and_later_fillet():
    doc = document()
    doc["features"].append(union())
    doc["features"].append({"id": "fillet", "type": "fillet", "targetBodyId": "b0", "edgeIndices": [1], "radius": 1})
    assert build_document(doc)[0]["b0"].isValid()
    doc["features"][0]["distance"] = 12
    assert build_document(doc)[0]["b0"].isValid()


def test_endpoint_rejects_disjoint_union_without_server_error():
    doc = document((0, 100))
    doc["features"].append(union(("b0", "b1")))
    response = TestClient(app).post("/api/document", json=doc)
    assert response.status_code == 422
    assert "touch or overlap" in response.json()["detail"]


@pytest.mark.parametrize("extension", ["step", "stl", "obj"])
def test_unioned_body_exports(extension):
    doc = document()
    doc["features"].append(union())
    response = TestClient(app).post(f"/api/export/document.{extension}", json=doc)
    assert response.status_code == 200, response.text
    assert len(response.content) > 100
