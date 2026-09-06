"""Multiple tire-edge fillets have no two-edge kernel restriction."""
import cadquery as cq

from server import apply_body_feature


def test_four_tire_ring_edges_fillet_in_one_feature():
    tire = cq.Workplane("XY").circle(20).circle(12).extrude(10).val()
    indices = [i for i, edge in enumerate(tire.Edges(), start=1) if edge.geomType() == "CIRCLE"]
    assert len(indices) == 4
    rounded = apply_body_feature(tire, {"type": "fillet", "edgeIndices": indices, "radius": 1})
    assert rounded.isValid()
    assert len(rounded.Solids()) == 1
    assert rounded.Volume() < tire.Volume()
    assert len(rounded.Faces()) > len(tire.Faces())
