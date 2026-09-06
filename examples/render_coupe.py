"""Offscreen, depth-tested engineering render of the actual LucasCad solids."""
import json
import sys
from pathlib import Path
import vtk

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from server import build_document

doc = json.loads((ROOT / "examples/LucasCoupe.lucascad.json").read_text())
bodies = build_document(doc)[0]
renderer = vtk.vtkRenderer()
renderer.SetBackground(0.055, 0.082, 0.11)
for name, body in bodies.items():
    vertices, triangles = body.tessellate(0.12, 0.12)
    points = vtk.vtkPoints()
    for p in vertices:
        points.InsertNextPoint(p.x, p.y, p.z)
    cells = vtk.vtkCellArray()
    for triangle in triangles:
        cells.InsertNextCell(3)
        for index in triangle:
            cells.InsertCellPoint(index)
    mesh = vtk.vtkPolyData(); mesh.SetPoints(points); mesh.SetPolys(cells)
    normals = vtk.vtkPolyDataNormals(); normals.SetInputData(mesh)
    normals.SetFeatureAngle(35); normals.ConsistencyOn(); normals.SplittingOn(); normals.Update()
    mapper = vtk.vtkPolyDataMapper(); mapper.SetInputConnection(normals.GetOutputPort())
    actor = vtk.vtkActor(); actor.SetMapper(mapper)
    color = (0.08, 0.10, 0.12) if name.startswith("tire-") else (0.70, 0.76, 0.81) if name.startswith("rim-") else (0.95, 0.88, 0.64) if name.startswith("headlamp-") else (0.72, 0.10, 0.08) if name.startswith("taillamp-") else (0.14, 0.49, 0.68)
    actor.GetProperty().SetColor(*color)
    actor.GetProperty().SetInterpolationToPhong()
    actor.GetProperty().SetAmbient(.24); actor.GetProperty().SetDiffuse(.72)
    actor.GetProperty().SetSpecular(.25); actor.GetProperty().SetSpecularPower(35)
    renderer.AddActor(actor)
camera = renderer.GetActiveCamera()
camera.SetPosition(245, -340, 220); camera.SetFocalPoint(0, 0, 34); camera.SetViewUp(0, 0, 1)
camera.ParallelProjectionOn(); camera.SetParallelScale(100)
renderer.ResetCameraClippingRange()
title = vtk.vtkTextActor(); title.SetInput("LUCASCOUPE  /  PARAMETRIC CONCEPT")
title.SetDisplayPosition(45, 835); title.GetTextProperty().SetFontSize(24); title.GetTextProperty().SetColor(.85, .92, 1)
renderer.AddActor2D(title)
note = vtk.vtkTextActor(); note.SetInput("Actual kernel solids | diagnostic body colors | 220 mm body length | +X front")
note.SetDisplayPosition(45, 32); note.GetTextProperty().SetFontSize(17); note.GetTextProperty().SetColor(.6, .7, .8)
renderer.AddActor2D(note)
window = vtk.vtkRenderWindow(); window.SetOffScreenRendering(1); window.SetSize(1500, 900); window.SetMultiSamples(8); window.AddRenderer(renderer); window.Render()
capture = vtk.vtkWindowToImageFilter(); capture.SetInput(window); capture.ReadFrontBufferOff(); capture.Update()
writer = vtk.vtkPNGWriter(); writer.SetFileName(str(ROOT / "examples/LucasCoupe-preview.png")); writer.SetInputConnection(capture.GetOutputPort()); writer.Write()
window.Finalize()
print("Saved examples/LucasCoupe-preview.png")
