import json
from pathlib import Path
import cadquery as cq
import pytest
from fillet_limits import FilletWorkbench, geometry_key
from server import apply_body_feature, build_document, fillet_preview_mesh


def test_body_colors_do_not_invalidate_geometry_cache():
    base = {"features": [{"id": "hull", "type": "extrude", "distance": 20}]}
    colored = {"features": [{**base["features"][0], "bodyColor": "#b87333"}]}
    assert geometry_key(base) == geometry_key(colored)


def workbench(shape):
    calls = []
    def build(document):
        calls.append(document)
        return ({"body": shape},)
    return FilletWorkbench(build, apply_body_feature, fillet_preview_mesh), calls


def request(edges, radius=2, body="body", document=None):
    return {"document": document or {}, "targetBodyId": body, "edgeIndices": edges, "radius": radius}


def test_oversized_cube_default_is_clamped_to_verified_maximum():
    shape = cq.Workplane("XY").box(20, 10, 4).val()
    w, calls = workbench(shape)
    result = w.evaluate(request([1], 200))
    assert result["available"] and result["adjusted"] and result["limitResolved"]
    assert 9.9 < result["radius"] < 10
    assert result["radius"] == result["maxRadius"]
    assert result["previewFaces"]
    for radius in (.01, 1, result["maxRadius"]):
        assert w.evaluate(request([1], radius))["available"]
    assert len(calls) == 1


def test_all_four_ring_edges_and_thin_wall_limit():
    shape = cq.Workplane("XY").circle(20).circle(19).extrude(10).val()
    w, _ = workbench(shape)
    indices = [i for i, edge in enumerate(shape.Edges(), 1) if edge.geomType() == "CIRCLE"]
    result = w.evaluate(request(indices, 2))
    assert len(indices) == 4 and result["available"] and result["adjusted"]
    assert .49 < result["maxRadius"] <= .5
    assert apply_body_feature(shape, {"type": "fillet", "edgeIndices": indices, "radius": result["radius"]}).isValid()


def test_invalid_seam_is_inline_unavailable_not_an_exception():
    shape = cq.Workplane("XY").circle(20).extrude(10).val()
    seam = next(i for i, edge in enumerate(shape.Edges(), 1) if edge.geomType() == "LINE")
    w, _ = workbench(shape)
    result = w.evaluate(request([seam]))
    assert not result["available"]
    assert "seam" in result["message"]


@pytest.mark.parametrize("inner", [False, True])
def test_circular_fillet_in_multi_solid_body_preserves_other_solids(inner):
    cylinder = cq.Workplane("XY").circle(20)
    if inner:
        cylinder = cylinder.circle(10)
    cylinder = cylinder.extrude(20).val()
    blocks = [cq.Workplane("XY").box(10, 10, 30).faces(">Z").workplane().hole(4).val().translate((40, i * 20, 0)) for i in range(3)]
    shape = cq.Compound.makeCompound([cylinder, *blocks])
    edge_index = next(i for i, edge in enumerate(shape.Edges(), 1)
                      if edge.geomType() == "CIRCLE" and abs(edge.radius() - (10 if inner else 20)) < 1e-6 and edge.Center().z > 19)
    w, _ = workbench(shape)
    result = w.evaluate(request([edge_index], 5))
    assert result["available"] and result["previewFaces"]
    assert result["radius"] == pytest.approx(5)
    committed = apply_body_feature(shape, {"type": "fillet", "edgeIndices": [edge_index], "radius": result["radius"]})
    assert committed.isValid() and len(committed.Solids()) == 4
    untouched = [solid for solid in committed.Solids() if solid.Center().x > 30]
    assert len(untouched) == 3
    assert sorted(solid.Volume() for solid in untouched) == pytest.approx(sorted(solid.Volume() for solid in blocks))
    assert sorted(solid.Center().toTuple() for solid in untouched) == sorted(solid.Center().toTuple() for solid in blocks)


def test_fillet_preview_rejects_result_that_drops_a_solid():
    first = cq.Workplane("XY").circle(20).extrude(20).val()
    other = cq.Workplane("XY").box(10, 10, 10).translate((50, 0, 0)).val()
    shape = cq.Compound.makeCompound([first, other])
    edge_index = next(i for i, edge in enumerate(shape.Edges(), 1) if edge.geomType() == "CIRCLE")
    w = FilletWorkbench(lambda doc: ({"body": shape},), lambda body, feature: first, lambda result: [])
    assert not w.evaluate(request([edge_index], 5))["available"]


def test_selection_sets_have_independent_limits_and_presentation_does_not_rebuild():
    shape = cq.Workplane("XY").box(20, 10, 4).val()
    w, calls = workbench(shape)
    w.evaluate(request([1], document={"metadata": {"theme": "tron"}}))
    w.evaluate(request([1, 2], document={"metadata": {"theme": "old-school"}}))
    assert len(calls) == 1 and len(w.limits) == 2
    assert geometry_key({"features": [{"id": "f", "radius": 1}]}) != geometry_key({"features": [{"id": "f", "radius": 2}]})
    with pytest.raises(ValueError):
        w.evaluate(request([999]))


def test_lucascoupe_rocker_and_four_tire_edges():
    document = json.loads((Path(__file__).parents[1] / "examples/LucasCoupe.lucascad.json").read_text())
    bodies, *_ = build_document(document)
    calls = []
    def build(_):
        calls.append(1)
        return (bodies,)
    w = FilletWorkbench(build, apply_body_feature, fillet_preview_mesh)
    # Full saved coupe, not simplified stand-in geometry.
    for body_id, edges in [("sill-right", [1]), ("sill-left", [1])]:
        result = w.evaluate(request(edges, 50, body_id, document))
        assert result["available"] and result["radius"] < 50
        assert apply_body_feature(bodies[body_id], {"type": "fillet", "edgeIndices": edges, "radius": result["radius"]}).isValid()
    tire = bodies["tire-front-right"]
    edges = [i for i, edge in enumerate(tire.Edges(), 1) if edge.geomType() == "CIRCLE" and edge.radius() > 12.1]
    assert len(edges) == 4
    result = w.evaluate(request(edges, 50, "tire-front-right", document))
    assert result["available"] and result["radius"] < 50
    assert len(calls) == 1
