"""Black Lantern: editable display-model pirate ship built with LucasCad features.

Every solid is rebuilt by backend.server.build_document from ordinary sketch,
datum, loft, extrusion, shell, revolve or sweep records. No imported mesh/BREP.
Dimensions are millimeters; +X bow, -X stern, +Z up. Not a seaworthy design.
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from server import build_document
import cadquery as cq

doc = {"schemaVersion": 2, "units": "mm", "sketches": [], "features": [], "referenceGeometry": [],
       "metadata": {"settings": {"meshQuality": 55, "unitSystem": "metric", "theme": {"preset": "old-school"}}}}

def plane(name, origin, normal=(0,0,1), xdir=(1,0,0)):
    rid = f"datum-{len(doc['referenceGeometry'])+1}"
    doc["referenceGeometry"].append(dict(id=rid, name=name, type="plane", origin=list(origin), normal=list(normal), xDir=list(xdir), visible=False))
    return dict(kind="reference-plane", referenceId=rid)

def point(p): return dict(x=p[0],y=p[1])
def polygon(points, prefix="line"):
    return [dict(id=f"{prefix}-{i}",type="line",a=point(p),b=point(points[(i+1)%len(points)])) for i,p in enumerate(points)]
def rect(x,y,w,h,prefix="line"): return polygon([(x,y),(x+w,y),(x+w,y+h),(x,y+h)],prefix)
def circle(r,x=0,y=0,id="circle"): return dict(id=id,type="circle",c=point((x,y)),r=r)
def spline(points,id="spline"): return dict(id=id,type="spline",points=[point(p) for p in points])
def sketch(name,support,entities):
    sid=f"sketch-{len(doc['sketches'])+1}"
    doc["sketches"].append(dict(id=sid,name=name,plane=support,entities=entities,visible=False))
    return sid
def feature(name,kind,**parameters):
    fid=f"feature-{len(doc['features'])+1}"
    doc["features"].append(dict(id=fid,name=name,type=kind,**parameters))
    return fid
def extrude(name,support,entities,distance,body=None,target=None):
    sid=sketch(name+" profile",support,entities)
    return feature(name,"extrude",sketchId=sid,distance=distance,direction=1,extent="one-sided",combine="cut" if target else "new",**(dict(targetBodyId=target) if target else dict(bodyId=body,bodyName=name)))
def box(name,x,y,z,w,d,h,body): return extrude(name,plane(name+" base",(x,y,z)),rect(0,0,w,d),h,body)
def rod(name,a,b,r,body,inner=None):
    start,end=cq.Vector(*a),cq.Vector(*b); delta=end.sub(start); n=delta.normalized()
    x=n.cross(cq.Vector(0,0,1) if abs(n.z)<.9 else cq.Vector(0,1,0)).normalized()
    entities=[circle(r)]+([circle(inner,id="bore")] if inner else [])
    return extrude(name,plane(name+" end",a,n.toTuple(),x.toTuple()),entities,delta.Length,body)
def checkpoint(label):
    bodies=build_document(doc)[0]
    assert all(b.isValid() and len(b.Solids())==1 for b in bodies.values()),label
    print(f"{label}: {len(bodies)} valid solids / {len(doc['features'])} features",flush=True)
    return bodies

def outline(w,scale=1):
    pts=[(-130*scale,-w*.78),(-90*scale,-w),(0,-w),(95*scale,-w*.66),(150*scale,0),(95*scale,w*.66),(0,w),(-90*scale,w),(-130*scale,w*.78)]
    return [spline(pts),dict(id="transom",type="line",a=point(pts[-1]),b=point(pts[0]))]

# Five-waterline outer and subtractive inner lofts, with actual open gunports.
profiles=[]
for z,w,s in [(-4,4,.76),(6,23,.89),(26,38,.97),(46,43,1),(58,42.5,1.02)]:
    profiles.append(sketch(f"Hull waterline Z {z}",plane(f"Waterline {z}",(0,0,z)),outline(w,s)))
feature("Hull — five waterline loft","loft",sketchIds=profiles,ruled=False,combine="new",bodyId="hull",bodyName="Hull / open gunports")
bodies=checkpoint("Lofted hull")
inner=[]
for z,w,s in [(10,18,.82),(26,33,.93),(46,39,.96),(61,39,.98)]:
    inner.append(sketch(f"Inner hull waterline Z {z}",plane(f"Inner waterline {z}",(0,0,z)),outline(w,s)))
feature("Hull interior — subtractive loft","loft",sketchIds=inner,ruled=False,combine="cut",targetBodyId="hull")
checkpoint("Hollow hull")
gun_x=[-90,-48,-6,36,78]
ports=sum([rect(x-5,35,10,10,f"port-{i}") for i,x in enumerate(gun_x)],[])
extrude("Ten open gunports",plane("Gunport cutting plane",(0,65,0),(0,-1,0),(1,0,0)),ports,130,target="hull")
extrude("Main deck",plane("Main deck Z54",(0,0,54)),outline(39.5,.985),3,"deck")
extrude("Deck plank seams",plane("Deck seam depth",(0,0,56.8)),sum([rect(-143,y,300,.25,f"seam-{i}") for i,y in enumerate(range(-30,31,6))],[]),.5,target="deck")
extrude("Keel and stem",plane("Keel center plane",(0,1.8,0),(0,-1,0),(1,0,0)),polygon([(-122,4),(-119,-10),(95,-10),(148,25),(150,38),(99,1)]),3.6,"keel")
extrude("Stern rudder",plane("Rudder center plane",(0,2,0),(0,-1,0),(1,0,0)),polygon([(-134,40),(-143,37),(-148,-9),(-132,-9)]),4,"rudder")
checkpoint("Deck keel and ports")

# Cabin, windows and stepped quarterdeck.
box("Captain's cabin",-129,-25,57,49,50,23,"cabin")
win=sum([rect(x,64,9,10,f"window-{i}") for i,x in enumerate([-119,-102])],[])
extrude("Cabin side windows",plane("Cabin window cutter",(0,35,0),(0,-1,0),(1,0,0)),win,70,target="cabin")
extrude("Stern gallery windows",plane("Stern gallery cutter",(-135,0,0),(1,0,0),(0,1,0)),sum([rect(y,64,9,10,f"stern-window-{i}") for i,y in enumerate([-19,-4,11])],[]),12,target="cabin")
box("Quarterdeck cap",-134,-30,80,58,60,3,"quarterdeck")
box("Forecastle platform",96,-17,58,25,34,7,"forecastle")
for i in range(6): box(f"Companionway step {i+1}",-78+i*3.2,-9,78-i*3.8,3.4,18,2,"step-"+str(i))
for label,x,y in [("Forward",49,0),("Aft",-55,0)]:
    box(label+" hatch coaming",x-10,y-12,57,20,24,3,"hatch-"+label)
    for i in range(5): box(f"{label} hatch grating {i+1}",x-8+i*4,y-10,60,1.2,20,.7,f"grating-{label}-{i}")
for side in [-1,1]:
    for i,x in enumerate(gun_x):
        # Muzzle bore is real; all artillery is decorative at model scale.
        rod(f"{'Port' if side<0 else 'Starboard'} cannon {i+1}",(x,side*31,40),(x,side*49,40),2.7,f"cannon-{side}-{i}",1.5)
        rod(f"Cannon muzzle band {side}/{i}",(x,side*46,40),(x,side*48,40),3.2,f"muzzle-{side}-{i}",2.7)
checkpoint("Cabin and battery")

# Main rails follow spline plan-view paths using the shipped Sweep operation.
for side in [-1,1]:
    pts=[(-74,side*42),(-30,side*43.5),(35,side*41),(95,side*28),(141,side*5)]
    path=sketch(f"{'Port' if side<0 else 'Starboard'} railing path",plane("Railing path level",(0,0,65)),[spline(pts)])
    tangent=cq.Vector(pts[1][0]-pts[0][0],pts[1][1]-pts[0][1],0).normalized()
    prof=sketch("Railing circular section",plane("Railing section",(*pts[0],65),tangent.toTuple(),(0,0,1)),[circle(1.1)])
    feature(f"{'Port' if side<0 else 'Starboard'} swept handrail","sweep",sketchIds=[prof,path],orientation="follow",transition="round",combine="new",bodyId=f"rail-{side}",bodyName="Swept handrail")
    for i,(x,y) in enumerate([(-70,42),(-42,43),(0,43),(40,40),(77,33),(107,22),(132,11)]):
        rod(f"Rail stanchion {side}/{i}",(x,side*y,57),(x,side*y,65),.65,f"stanchion-{side}-{i}")
    rod(f"Quarterdeck rail {side}",(-132,side*28,91),(-78,side*28,91),1.1,f"quarter-rail-{side}")
    for i,x in enumerate([-129,-112,-95,-79]): rod(f"Quarterdeck baluster {side}/{i}",(x,side*28,83),(x,side*28,91),.75,f"baluster-{side}-{i}")
rod("Transom handrail",(-132,-28,91),(-132,28,91),1.1,"transom-rail")
bodies=checkpoint("Swept rails")

# Two raised longitudinal wales articulate the hull rather than faking a texture.
for z,w in [(28,39.2),(50,43.5)]:
    section=cq.Workplane("XY").newObject([bodies['hull']]).section(z).val()
    outer=max(section.Faces(),key=lambda face:face.Area()).outerWire()
    curved=max(outer.Edges(),key=lambda edge:edge.Length())
    samples=[curved.positionAt(i/60) for i in range(61)]
    for side in [-1,1]:
        # Sample the actual loft section instead of assuming a scaled waterline;
        # that assumption made the trim weave in and out of the lofted hull.
        pts=[(p.x*1.001,p.y*1.012) for p in samples if p.y*side>.3]
        if pts[0][0]>pts[-1][0]: pts.reverse()
        path=sketch(f"Wale path {z}/{side}",plane("Wale level",(0,0,z)),[spline(pts)])
        n=cq.Vector(pts[1][0]-pts[0][0],pts[1][1]-pts[0][1],0).normalized()
        prof=sketch(f"Wale section {z}/{side}",plane("Wale section",(*pts[0],z),n.toTuple(),(0,0,1)),[circle(.9)])
        feature(f"Hull wale {z}/{side}","sweep",sketchIds=[prof,path],orientation="follow",transition="round",combine="new",bodyId=f"wale-{z}-{side}",bodyName=f"Hull wale {z}/{side}")

# Three raked masts, yardarms and billowing thin-solid lofted sails.
mast_data=[("Fore",70,245,[(212,70,57),(147,84,69)]),("Main",-16,282,[(247,76,55),(184,100,78)]),("Mizzen",-105,215,[])]
for label,x,top,yards in mast_data:
    rod(label+" mast",(x,0,57),(x-7,0,top),2.3,"mast-"+label)
    crow_z=top-42
    extrude(label+" fighting top",plane(label+" top platform",(x-5,0,crow_z)),[circle(7)],1.7,"top-"+label)
    extrude(label+" top rim",plane(label+" top rim",(x-5,0,crow_z+1.7)),[circle(7),circle(6.1,id="hole")],3,"top-rim-"+label)
    for j,(z,width,height) in enumerate(yards):
        rod(f"{label} yard {j+1}",(x-6,-width/2-4,z),(x-6,width/2+4,z),1.35,f"yard-{label}-{j}")
        sections=[]
        # Profile width narrows towards the head; fore-and-aft belly peaks mid-sail.
        for k,t in enumerate([0,.28,.65,1]):
            w=width*(1-.18*t); belly=10*math.sin(math.pi*t)
            support=plane(f"{label} sail {j+1} station {k}",(x-5+belly,0,z-height+height*t))
            sections.append(sketch(f"{label} sail {j+1} section {k}",support,rect(0,-w/2,.65,w)))
        feature(f"{label} {'topsail' if j==0 else 'course'} — billowed loft","loft",sketchIds=sections,ruled=False,combine="new",bodyId=f"sail-{label}-{j}",bodyName=f"{label} {'topsail' if j==0 else 'course'}")
        for side in [-1,1]:
            end=(x-6,side*(yards[1][1]/2+3),yards[1][0]) if j==0 else (x+22,side*31,60)
            rod(f"{label} sheet {j}/{side}",(x-5,side*width/2,z-height),end,.35,f"sheet-{label}-{j}-{side}")
    # Shrouds and ratlines on both sides; not a production rigging plan.
    for side in [-1,1]:
        for i,dx in enumerate([-30,-18,-6]): rod(f"{label} shroud {side}/{i}",(x+dx,side*(27 if label=='Mizzen' else 37),83 if label=='Mizzen' else 58),(x-5,side*2,crow_z),.42,f"shroud-{label}-{side}-{i}")
        for i,t in enumerate([.12,.25,.38,.51,.64,.77]):
            z=(83 if label=='Mizzen' else 58)*(1-t)+crow_z*t
            y=side*((27 if label=='Mizzen' else 37)*(1-t)+2*t)
            mid=(x-18)*(1-t)+(x-5)*t
            rod(f"{label} ratline {side}/{i}",(mid-12*(1-t),y,z),(mid+12*(1-t),y,z),.23,f"ratline-{label}-{side}-{i}")
checkpoint("Masts square sails and shrouds")

rod("Bowsprit",(116,0,64),(205,0,98),2,"bowsprit")
rod("Forestay",(205,0,98),(63,0,242),.55,"forestay")
rod("Main stay",(63,0,160),(-23,0,277),.5,"mainstay")
rod("Mizzen stay",(-22,0,180),(-112,0,209),.4,"mizzenstay")
rod("Bowsprit bobstay",(200,0,95),(139,0,22),.45,"bobstay")
extrude("Triangular jib",plane("Jib center plane",(0,.5,0),(0,-1,0),(1,0,0)),polygon([(195,99),(68,231),(83,111)]),.65,"sail-jib")
extrude("Mizzen lateen sail",plane("Lateen center plane",(0,.7,0),(0,-1,0),(1,0,0)),polygon([(-153,112),(-72,191),(-106,106)]),.65,"sail-lateen")
rod("Lateen yard",(-155,0,112),(-70,0,194),1.2,"lateen-yard")

# Wheel with a revolved annular rim, separate radial handles, and deck pedestal.
box("Helm pedestal",-98,-3,83,5,6,9,"helm-pedestal")
wheel_profile=sketch("Helm rim radial section",plane("Helm rim section",(-95,0,96)),rect(-.65,5,1.3,1.2))
axis="helm-axis"
doc['referenceGeometry'].append(dict(id=axis,type="axis",name="Helm spindle",origin=[-95,0,96],direction=[1,0,0],visible=False))
feature("Ship's wheel rim — revolve","revolve",sketchId=wheel_profile,axis=dict(kind="reference-axis",referenceId=axis,label="Helm spindle"),angle=360,combine="new",bodyId="helm-rim",bodyName="Helm rim")
rod("Wheel hub",(-97,0,96),(-93,0,96),1.3,"helm-hub")
for i in range(8):
    a=i*math.tau/8
    rod(f"Wheel spoke and grip {i+1}",(-95,0,96),(-95,7.3*math.cos(a),96+7.3*math.sin(a)),.48,f"helm-spoke-{i}")
for side in [-1,1]:
    y=side*24
    rod(f"Anchor shank {side}",(122,y,54),(133,y,31),.8,f"anchor-shank-{side}")
    rod(f"Anchor stock {side}",(121,y-6,53),(121,y+6,53),.8,f"anchor-stock-{side}")
    extrude(f"Anchor flukes {side}",plane("Anchor plane",(0,y+.65,0),(0,-1,0),(1,0,0)),polygon([(133,31),(122,29),(118,33),(118,26),(128,26),(133,28),(138,26),(148,26),(148,33),(144,29)]),1.3,f"anchor-flukes-{side}")
    rod(f"Anchor cable {side}",(120,y,56),(115,side*13,67),.5,f"anchor-cable-{side}")

# Forked pirate pennant, with skull silhouette and crossed-bone cutouts.
flag_plane=plane("Pirate pennant",(0,.4,0),(0,-1,0),(1,0,0))
extrude("Jolly Roger pennant",flag_plane,polygon([(-23,276),(-61,276),(-53,266),(-63,255),(-23,255)]),.8,"flag")
skull=polygon([(-42.4,261.5),(-37.6,261.5),(-37.6,264),(-36.4,266),(-36.8,269),(-38.5,270.7),(-41.5,270.7),(-43.2,269),(-43.6,266),(-42.4,264)])
# Keep separated holes so each contour is a valid independent cut.
extrude("Skull badge",plane("Raised skull badge",(0,-.6,0),(0,-1,0),(1,0,0)),skull,0.6,"skull-badge")
for i,(a,b) in enumerate([((-49,-1.4,260),(-32,-1.4,270)),((-49,-1.4,270),(-32,-1.4,260))]): rod(f"Crossbone {i+1}",a,b,.6,f"crossbone-{i}")
checkpoint("Complete Black Lantern")

if __name__ == '__main__':
    bodies=checkpoint("Final rebuild")
    path=ROOT/'examples'/'Black-Lantern.lucascad.json'
    path.write_text(json.dumps(doc,indent=2),encoding='utf-8')
    cq.exporters.export(cq.Compound.makeCompound(list(bodies.values())),str(ROOT/'examples'/'Black-Lantern.step'))
    print(f"Saved {path.name}: {len(doc['sketches'])} sketches, {len(doc['features'])} features",flush=True)
