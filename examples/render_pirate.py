"""Render the actual rebuilt Black Lantern solids, with explanatory part colors."""
import json
import sys
from pathlib import Path
import vtk

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from server import build_document

doc=json.loads((ROOT/'examples/Black-Lantern.lucascad.json').read_text(encoding='utf-8'))
bodies=build_document(doc)[0]
renderer=vtk.vtkRenderer()
renderer.SetBackground(.045,.068,.095);renderer.SetBackground2(.17,.23,.29);renderer.GradientBackgroundOn()
def color(name):
    if name.startswith('sail-'): return (.86,.80,.64)
    if name=='flag': return (.055,.06,.065)
    if name.startswith(('skull','crossbone')): return (.96,.91,.75)
    if name.startswith(('shroud','ratline','sheet','forestay','mainstay','mizzenstay','bobstay','anchor-cable')): return (.22,.18,.12)
    if name.startswith(('cannon','anchor-')): return (.11,.14,.15)
    if name.startswith(('muzzle','helm-','top-rim')): return (.69,.49,.19)
    if name.startswith(('deck','quarterdeck','forecastle','step','hatch','grating')): return (.59,.36,.17)
    if name.startswith(('rail','stanchion','quarter-rail','transom-rail','baluster','wale')): return (.75,.51,.23)
    if name in ['hull','keel','rudder','cabin']: return (.26,.115,.055)
    return (.37,.21,.10)
for name,body in bodies.items():
    vertices,triangles=body.tessellate(.18,.15)
    points=vtk.vtkPoints()
    for p in vertices: points.InsertNextPoint(p.x,p.y,p.z)
    cells=vtk.vtkCellArray()
    for tri in triangles:
        cells.InsertNextCell(3)
        for i in tri: cells.InsertCellPoint(i)
    mesh=vtk.vtkPolyData();mesh.SetPoints(points);mesh.SetPolys(cells)
    normals=vtk.vtkPolyDataNormals();normals.SetInputData(mesh);normals.SetFeatureAngle(35);normals.ConsistencyOn();normals.SplittingOn();normals.Update()
    mapper=vtk.vtkPolyDataMapper();mapper.SetInputConnection(normals.GetOutputPort())
    actor=vtk.vtkActor();actor.SetMapper(mapper);p=actor.GetProperty();p.SetColor(*color(name));p.SetInterpolationToPhong();p.SetAmbient(.3);p.SetDiffuse(.72);p.SetSpecular(.13);p.SetSpecularPower(25)
    renderer.AddActor(actor)
camera=renderer.GetActiveCamera();camera.SetPosition(440,-690,370);camera.SetFocalPoint(25,0,131);camera.SetViewUp(0,0,1);camera.ParallelProjectionOn();camera.SetParallelScale(172);renderer.ResetCameraClippingRange()
for text,x,y,size in [('BLACK LANTERN',44,944,30),('LUCASCAD / THREE-MASTED PIRATE SHIP',46,916,15),('Editable native feature history  |  Actual CAD solids, presentation colors  |  Display model — not a shipbuilding plan',44,28,14)]:
    label=vtk.vtkTextActor();label.SetInput(text);label.SetDisplayPosition(x,y);label.GetTextProperty().SetFontSize(size);label.GetTextProperty().SetColor(.84,.87,.89);renderer.AddViewProp(label)
window=vtk.vtkRenderWindow();window.SetOffScreenRendering(1);window.SetSize(1600,1000);window.SetMultiSamples(8);window.AddRenderer(renderer);window.Render()
capture=vtk.vtkWindowToImageFilter();capture.SetInput(window);capture.ReadFrontBufferOff();capture.Update()
writer=vtk.vtkPNGWriter();writer.SetFileName(str(ROOT/'examples/Black-Lantern-preview.png'));writer.SetInputConnection(capture.GetOutputPort());writer.Write();window.Finalize()
print('Rendered actual ship solids',flush=True)
