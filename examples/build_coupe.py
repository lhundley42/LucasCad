"""Build an editable LucasCad concept coupe, using only shipped feature records.

Run from the repository root with .venv/Scripts/python.exe examples/build_coupe.py.
No imported mesh or hidden CAD operation is used in the project history.
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from server import build_document, plane_for_sketch
import cadquery as cq

doc = {"schemaVersion": 2, "units": "mm", "sketches": [], "features": [], "referenceGeometry": []}


def plane(name, origin, normal, xdir):
    rid = f"plane-{len(doc['referenceGeometry']) + 1}"
    doc["referenceGeometry"].append({"id": rid, "name": name, "type": "plane", "origin": origin, "normal": normal, "xDir": xdir, "sourceLabel": name, "visible": False})
    return {"kind": "reference-plane", "referenceId": rid}


def polygon(points, prefix="edge"):
    pts = [{"x": x, "y": y} for x, y in points]
    return [{"id": f"{prefix}-{i}", "type": "line", "a": p, "b": pts[(i + 1) % len(pts)]} for i, p in enumerate(pts)]


def circle(x, y, radius, name="circle"):
    return {"id": name, "type": "circle", "c": {"x": x, "y": y}, "r": radius}


def sketch(name, support, entities):
    sid = f"sketch-{len(doc['sketches']) + 1}"
    doc["sketches"].append({"id": sid, "name": name, "plane": support, "entities": entities, "visible": False})
    return sid


def feature(name, kind, **parameters):
    record = {"id": f"feature-{len(doc['features']) + 1}", "name": name, "type": kind, **parameters}
    doc["features"].append(record)
    return record


def extrude(name, sid, distance, body=None, target=None, combine="new", direction=1):
    return feature(name, "extrude", sketchId=sid, distance=distance, distancePlus=distance, distanceMinus=distance, extent="one-sided", direction=direction, combine=combine, **({"bodyId": body, "bodyName": name} if combine == "new" else {"targetBodyId": target}))


def checkpoint(label):
    bodies, _, _ = build_document(doc)
    assert all(body.isValid() and len(body.Solids()) == 1 for body in bodies.values()), label
    print(f"{label}: {len(bodies)} valid solids, {len(doc['features'])} features", flush=True)
    return bodies


# 1:20-scale envelope. +X is the nose; +Z is up; wheels are symmetric about Y=0.
sections = []
for x, w, top in [(-110, 32, 40), (-90, 40, 45), (-55, 44, 48), (0, 44, 48), (55, 42, 46), (88, 38, 42), (110, 29, 35)]:
    support = plane(f"Body station X={x}", [x, 0, 0], [1, 0, 0], [0, 1, 0])
    points = [(-w*.82, 23), (w*.82, 23), (w, 28), (w, top-5), (w*.7, top), (-w*.7, top), (-w, top-5), (-w, 28)]
    sections.append(sketch(f"Body section {x:+} mm", support, polygon(points)))
feature("Coupe body — seven-section loft", "loft", sketchIds=sections, ruled=False, combine="new", bodyId="bodywork", bodyName="Lower bodywork")
arch_plane = plane("Wheel-arch cutting plane", [0, 60, 0], [0, -1, 0], [1, 0, 0])
arches = sketch("Front and rear wheel arch circles", arch_plane, [circle(-68, 20, 22, "rear-arch"), circle(68, 20, 22, "front-arch")])
extrude("Wheel arches — through both sides", arches, 120, target="bodywork", combine="cut")
checkpoint("Lofted body and wheel arches")

# Cabin: a four-sided roof prism, hollowed from below, with real window openings.
cab_plane = plane("Cabin side profile", [0, 32, 0], [0, -1, 0], [1, 0, 0])
cab = sketch("Cabin roof and raked screens", cab_plane, polygon([(-66, 44), (49, 44), (17, 73), (-35, 73)]))
extrude("Cabin envelope", cab, 64, body="cabin")
bodies = checkpoint("Cabin envelope")
bottom = min(enumerate(bodies["cabin"].Faces(), 1), key=lambda item: item[1].Center().z)[0]
feature("Hollow cabin — 1.5 mm walls", "shell", targetBodyId="cabin", faceIndices=[bottom], thickness=1.5, outward=False)
checkpoint("Cabin shell")

window_plane = plane("Side windows through cabin", [0, 40, 0], [0, -1, 0], [1, 0, 0])
windows = polygon([(-56, 49), (-12, 49), (-12, 68), (-33, 68)], "rear-window") + polygon([(-7, 49), (38, 49), (15, 68), (-7, 68)], "front-window")
win = sketch("Side windows with B-pillars", window_plane, windows)
extrude("Open both side-window pairs", win, 80, target="cabin", combine="cut")
bodies = checkpoint("Side windows")

for label, sign in [("Windshield", 1), ("Rear screen", -1)]:
    bodies = build_document(doc)[0]
    candidates = [(i, f) for i, f in enumerate(bodies["cabin"].Faces(), 1) if f.geomType() == "PLANE" and f.normalAt().x * sign > 0.4 and f.normalAt().z > 0.3]
    idx, face = max(candidates, key=lambda item: item[1].Area())
    support = {"kind": "face", "bodyId": "cabin", "faceIndex": idx, "faceId": f"cabin:face-{idx}"}
    local = plane_for_sketch({"plane": support}, bodies)
    # Outer-wire vertices are ordered around the planar face, then inset homothetically.
    pts = [local.toLocalCoords(vertex.Center()) for vertex in face.outerWire().Vertices()]
    pts.sort(key=lambda p: math.atan2(p.y, p.x))
    sid = sketch(f"{label} opening", support, polygon([(p.x*.80, p.y*.70) for p in pts]))
    extrude(f"{label} aperture", sid, 3, target="cabin", combine="cut", direction=-1)
checkpoint("All window apertures")

# Tires are annular solids of revolution. Rims and recessed centers use extrusion.
for axle, x in [("Rear", -68), ("Front", 68)]:
    for label, side in [("left", -1), ("right", 1)]:
        wheel = f"{axle.lower()}-{label}"
        support = plane(f"{axle} {label} tire section", [x, side*44, 20], [0, 0, 1], [1, 0, 0])
        axis_id = f"axis-{wheel}"
        doc["referenceGeometry"].append({"id": axis_id, "type": "axis", "name": f"{axle} {label} axle", "origin": [x, side*44, 20], "direction": [0, 1, 0], "sourceLabel": "Wheel center axis", "visible": False})
        tire = sketch(f"{axle} {label} tire radial section", support, polygon([(12, -7), (18, -7), (20, -5), (20, 5), (18, 7), (12, 7)]))
        feature(f"{axle} {label} tire — revolve", "revolve", sketchId=tire, axis={"kind": "reference-axis", "referenceId": axis_id, "label": f"{axle} {label} axle"}, angle=360, combine="new", bodyId=f"tire-{wheel}", bodyName=f"{axle} {label} tire")
        face_plane = plane(f"{axle} {label} wheel face", [x, side*51, 20], [0, -side, 0], [1, 0, 0])
        rim = sketch(f"{axle} {label} rim ring", face_plane, [circle(0, 0, 12), circle(0, 0, 9.5, "rim-hole")])
        rim_id = f"rim-{wheel}"
        extrude(f"{axle} {label} rim", rim, 12, body=rim_id)
        for i in range(5):
            angle = i * math.tau / 5
            points = [(r*math.cos(angle)-t*math.sin(angle), r*math.sin(angle)+t*math.cos(angle)) for r, t in [(0, -1.4), (11, -1.2), (11, 1.2), (0, 1.4)]]
            spoke = sketch(f"{axle} {label} spoke {i+1}", face_plane, polygon(points))
            extrude(f"{axle} {label} spoke {i+1}", spoke, 2.5, target=rim_id, combine="union")
        hub = sketch(f"{axle} {label} hub", face_plane, [circle(0, 0, 4)])
        extrude(f"{axle} {label} hub cap", hub, 3.5, target=rim_id, combine="union")
    checkpoint(f"{axle} wheel pair")

# Small solid details use datum planes rather than unstable generated face indices.
front = plane("Front lamps and grille", [109, 0, 0], [1, 0, 0], [0, 1, 0])
for y, label in [(-20, "left"), (20, "right")]:
    lamp = sketch(f"Front {label} lamp", front, polygon([(y-6, 29), (y+6, 29), (y+6, 34), (y-6, 34)]))
    extrude(f"Front {label} headlamp", lamp, 2.5, body=f"headlamp-{label}")
grille = sketch("Lower grille aperture", plane("Grille cutter", [114, 0, 0], [1, 0, 0], [0, 1, 0]), polygon([(-14, 25), (14, 25), (14, 29), (-14, 29)]))
extrude("Recessed front grille", grille, 8, target="bodywork", combine="cut", direction=-1)
rear = plane("Rear lamps", [-109, 0, 0], [-1, 0, 0], [0, -1, 0])
for y, label in [(-22, "left"), (22, "right")]:
    lamp = sketch(f"Rear {label} lamp", rear, polygon([(y-6, 31), (y+6, 31), (y+6, 36), (y-6, 36)]))
    extrude(f"Rear {label} taillamp", lamp, 2, body=f"taillamp-{label}")

for label, side in [("left", -1), ("right", 1)]:
    support = plane(f"{label.title()} sill plane", [0, side*43, 0], [0, side, 0], [1, 0, 0])
    # Frame local Y runs opposite Z on the positive-Y side.
    points = [(x, -side*z) for x, z in [(-42, 24), (42, 24), (42, 27), (-42, 27)]]
    sid = sketch(f"{label.title()} sill profile", support, polygon(points))
    extrude(f"{label.title()} rocker sill", sid, 2, body=f"sill-{label}")

bodies = checkpoint("Complete concept coupe")
path = ROOT / "examples" / "LucasCoupe.lucascad.json"
path.write_text(json.dumps(doc, indent=2), encoding="utf-8")
cq.exporters.export(cq.Compound.makeCompound(list(bodies.values())), str(ROOT / "examples" / "LucasCoupe.step"))
print(f"Saved {path.name}: {len(doc['sketches'])} sketches, {len(doc['features'])} features", flush=True)
