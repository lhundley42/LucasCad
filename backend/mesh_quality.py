"""Display/export tessellation: bounded absolute tolerances, exact surface normals."""
import math
import cadquery as cq
from OCP.BRep import BRep_Tool
from OCP.BRepGProp import BRepGProp_Face
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepTools import BRepTools
from OCP.TopAbs import TopAbs_REVERSED
from OCP.TopLoc import TopLoc_Location
from OCP.gp import gp_Pnt, gp_Vec

DEFAULT_MESH_QUALITY = 40


def mesh_settings(value=None):
    try:
        quality = float(value) if value is not None else DEFAULT_MESH_QUALITY
    except (TypeError, ValueError):
        quality = DEFAULT_MESH_QUALITY
    if not math.isfinite(quality):
        quality = DEFAULT_MESH_QUALITY
    quality = max(0, min(100, quality))
    return {"quality": quality, "linearDeflectionMm": 0.15 * (0.01 / 0.15) ** (quality / 100), "angularDeflectionRad": 0.2 * (0.05 / 0.2) ** (quality / 100)}


def mesh_shape(shape, settings):
    # OCCT may reuse old triangulations, ignoring a changed angular tolerance.
    # Clear only polygon data; exact B-rep geometry remains untouched.
    BRepTools.Clean_s(shape.wrapped)
    mesher = BRepMesh_IncrementalMesh(shape.wrapped, settings["linearDeflectionMm"], False, settings["angularDeflectionRad"], True)
    if not mesher.IsDone():
        raise ValueError("Unable to tessellate the model at this quality. Try a lower render quality.")


def edge_points(edge, tolerance):
    points = edge.sample(float(tolerance))[0]
    if edge.IsClosed() and points and points[0].sub(points[-1]).Length > 1e-7:
        points.append(points[0])
    return [[p.x, p.y, p.z] for p in points]


def face_mesh(face, settings):
    location = TopLoc_Location()
    poly = BRep_Tool.Triangulation_s(face.wrapped, location)
    if poly is None:
        raise ValueError("A model face could not be triangulated.")
    transform = location.Transformation()
    reverse = face.wrapped.Orientation() == TopAbs_REVERSED
    vertices, normals, triangles = [], [], []
    evaluator = BRepGProp_Face(face.wrapped)
    point, normal = gp_Pnt(), gp_Vec()
    for i in range(1, poly.NbNodes() + 1):
        p = poly.Node(i).Transformed(transform)
        vertices.append([p.X(), p.Y(), p.Z()])
        try:
            uv = poly.UVNode(i)
            evaluator.Normal(uv.X(), uv.Y(), point, normal)
            n = cq.Vector(normal).normalized()
            normals.append([n.x, n.y, n.z])
        except Exception:
            normals.append([0, 0, 0])
    for t in poly.Triangles():
        indices = [t.Value(1)-1, t.Value(2)-1, t.Value(3)-1]
        if reverse:
            indices[1], indices[2] = indices[2], indices[1]
        triangles.append(indices)
    # Rare poles/singularities: use incident triangle normals only at that node.
    missing = {i for i, n in enumerate(normals) if sum(v*v for v in n) < 0.5}
    for a, b, c in triangles:
        if missing.intersection((a, b, c)):
            n = cq.Vector(vertices[b]).sub(cq.Vector(vertices[a])).cross(cq.Vector(vertices[c]).sub(cq.Vector(vertices[a])))
            for i in (a, b, c):
                if i in missing:
                    normals[i] = [normals[i][0]+n.x, normals[i][1]+n.y, normals[i][2]+n.z]
    for i in missing:
        length = math.sqrt(sum(v*v for v in normals[i]))
        normals[i] = [v/length for v in normals[i]] if length > 1e-15 else [0, 0, 1]
    return {"vertices": vertices, "triangles": triangles, "normals": normals,
            "boundaries": [edge_points(edge, settings["linearDeflectionMm"]) for edge in face.Edges()]}
