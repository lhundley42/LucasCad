import math
import struct
import cadquery as cq
import pytest
from fastapi.testclient import TestClient
from server import app, build_document, document_payload
from mesh_quality import mesh_settings, mesh_shape, face_mesh


def cylinder():
    return {"sketches": [{"id": "s", "plane": "XY", "entities": [{"id": "c", "type": "circle", "c": {"x": 0, "y": 0}, "r": 20}]}], "features": [{"id": "e", "type": "extrude", "sketchId": "s", "combine": "new", "bodyId": "body", "distance": 30}]}


def test_quality_bounds_defaults_and_absolute_tolerances():
    assert mesh_settings(None)["quality"] == 40
    for invalid in ("oops", {}, float("nan"), float("inf")):
        assert mesh_settings(invalid)["quality"] == 40
    assert mesh_settings(-100)["quality"] == 0
    assert mesh_settings(1000)["quality"] == 100
    assert mesh_settings(100)["linearDeflectionMm"] == pytest.approx(.01)
    assert mesh_settings(100)["angularDeflectionRad"] == pytest.approx(.05)


def test_high_quality_adds_triangles_without_changing_exact_geometry_or_face_ids():
    coarse = document_payload({**cylinder(), "meshQuality": 0})
    fine = document_payload({**cylinder(), "meshQuality": 100})
    assert fine["properties"]["triangleCount"] > coarse["properties"]["triangleCount"] * 3
    assert fine["properties"]["volume"] == pytest.approx(coarse["properties"]["volume"], rel=1e-10)
    assert [f["id"] for f in fine["faces"]] == [f["id"] for f in coarse["faces"]]
    assert all(f["boundaries"] for f in fine["faces"])


def test_remeshing_same_shape_can_increase_and_decrease_quality():
    shape=cq.Workplane('XY').sphere(20).val()
    counts=[]
    for quality in (0,100,0):
        settings=mesh_settings(quality);mesh_shape(shape,settings)
        counts.append(sum(len(face_mesh(face,settings)["triangles"]) for face in shape.Faces()))
    assert counts[1] > counts[0] * 3
    assert counts[0] == counts[2]


def test_exact_normals_follow_translated_curved_surfaces_and_preserve_inner_orientation():
    shape=cq.Workplane('XY').circle(20).circle(15).extrude(30).val().translate((7,9,11))
    settings=mesh_settings(0);mesh_shape(shape,settings)
    for face in shape.Faces():
        mesh=face_mesh(face,settings)
        for point,normal in list(zip(mesh["vertices"],mesh["normals"]))[::11]:
            assert sum(v*v for v in normal) == pytest.approx(1,abs=1e-6)
            expected=face.normalAt(cq.Vector(point))
            assert cq.Vector(normal).dot(expected)>0.99999


def test_stl_and_obj_quality_match_viewport_tessellation():
    client=TestClient(app);counts=[]
    for quality in (0,100):
        doc={**cylinder(),"meshQuality":quality}
        stl=client.post('/api/export/document.stl',json=doc)
        assert stl.status_code==200
        count=struct.unpack_from('<I',stl.content,80)[0]
        assert len(stl.content)==84+count*50
        assert count == document_payload(doc)["properties"]["triangleCount"]
        obj=client.post('/api/export/document.obj',json=doc)
        assert obj.status_code==200
        assert sum(line.startswith('f ') for line in obj.text.splitlines())==count
        counts.append(count)
    assert counts[1]>counts[0]*3


def test_stp_alias_keeps_exact_solid_independent_of_mesh_quality(tmp_path):
    client=TestClient(app)
    for quality in (0,100):
        response=client.post('/api/export/document.stp',json={**cylinder(),"meshQuality":quality})
        assert response.status_code==200
        path=tmp_path/f'quality{quality}.step';path.write_bytes(response.content)
        imported=cq.importers.importStep(str(path)).val()
        assert imported.isValid()
        assert imported.Volume()==pytest.approx(math.pi*400*30,rel=1e-8)
