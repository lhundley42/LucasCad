import assert from 'node:assert/strict';
import test from 'node:test';
import {Vector3, OrthographicCamera, Quaternion} from 'three';
import {sketchPlaneProjection, projectSketchPoint, unprojectSketchPoint, sketchBillboard, snapToNearestSketchNormal} from '../app/components/sketchProjection.ts';
import {entityInSelectionBox} from '../app/components/sketchGeometry.ts';

const near=(a,b,epsilon=1e-7)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
function setup(rotation=0, tilt=0, flipped=false) {
  const q=new Quaternion().setFromAxisAngle(new Vector3(1,1,0).normalize(),rotation);
  const frame={origin:new Vector3(37,-91,142),xDir:new Vector3(1,0,0).applyQuaternion(q),yDir:new Vector3(0,1,0).applyQuaternion(q),normal:new Vector3(0,0,1).applyQuaternion(q)};
  if(flipped) {frame.yDir.negate();frame.normal.negate();}
  const camera=new OrthographicCamera(-260,260,180,-180,0.1,10000);
  const target=frame.origin.clone().addScaledVector(frame.xDir,24).addScaledVector(frame.yDir,-13);
  camera.position.copy(target).addScaledVector(frame.normal,-1000);camera.up.copy(frame.yDir).negate();camera.lookAt(target);
  const orbit=new Quaternion().setFromAxisAngle(frame.xDir,tilt);
  camera.position.sub(target).applyQuaternion(orbit).add(target);camera.quaternion.premultiply(orbit);camera.up.applyQuaternion(orbit);
  camera.zoom=2.7;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  return {camera,target,frame};
}

test('sketch affine projection matches actual 3D camera and inverts on both sides of offset/rotated/flipped planes',()=>{
  for(const rotation of [0,Math.PI/2,1.17]) for(const tilt of [0,0.6,1.4,Math.PI-0.3,Math.PI]) for(const flipped of [false,true]) {
    const {camera,target,frame}=setup(rotation,tilt,flipped);
    target.add(new Vector3(31,-20,18));camera.position.add(new Vector3(31,-20,18));camera.updateMatrixWorld(true);
    const view=sketchPlaneProjection(camera,target,frame);
    for(const point of [{x:0,y:0},{x:43,y:-70},{x:-139,y:250}]) {
      const actual=frame.origin.clone().addScaledVector(frame.xDir,point.x).addScaledVector(frame.yDir,point.y).project(camera);
      const projected=projectSketchPoint(point,view.projection);
      near(projected.x,view.center.x+actual.x*260/camera.zoom);near(projected.y,view.center.y-actual.y*180/camera.zoom);
      const inverted=unprojectSketchPoint(projected,view.projection);near(inverted.x,point.x);near(inverted.y,point.y);
      const matrix=sketchBillboard(point,0.7,view.projection).slice(7,-1).split(' ').map(Number);
      const [a,b,c,d]=view.projection;near(a*matrix[0]+c*matrix[1],0.7);near(b*matrix[0]+d*matrix[1],0);near(a*matrix[2]+c*matrix[3],0);near(b*matrix[2]+d*matrix[3],0.7);
    }
  }
});

test('Normal takes the shortest rotation to either side, keeps zoom and follows the same roll',()=>{
  for(const tilt of [0.6,2.4]) {
    const {camera,target,frame}=setup(0.7,tilt);
    const before=camera.quaternion.clone(),direction=camera.getWorldDirection(new Vector3()),zoom=camera.zoom;
    const desired=frame.normal.clone().multiplyScalar(direction.dot(frame.normal)>0?1:-1);
    const shortest=new Quaternion().setFromUnitVectors(direction,desired).multiply(before);
    snapToNearestSketchNormal(camera,target,frame);
    near(camera.getWorldDirection(new Vector3()).dot(desired),1);near(camera.quaternion.angleTo(shortest),0);near(camera.zoom,zoom);
    near(target.clone().sub(frame.origin).dot(frame.normal),0);
  }
});

test('exact edge-on is rejected instead of creating invalid geometry; near edge-on stays editable',()=>{
  assert.equal(unprojectSketchPoint({x:1,y:2},[1,0,0,0,0,0]),null);
  assert.deepEqual(unprojectSketchPoint({x:1,y:0.002},[1,0,0,0.001,0,0]),{x:1,y:2});
});

test('box selection is evaluated in screen orientation, including reversed local X',()=>{
  const project=p=>({x:-p.y,y:p.x*0.5});
  const line={id:'line',type:'line',a:{x:0,y:0},b:{x:10,y:10}};
  assert.ok(entityInSelectionBox(line,{x:-2,y:12},{x:12,y:-2},project));
  assert.equal(entityInSelectionBox(line,{x:3,y:8},{x:8,y:3},project),false);
  assert.ok(entityInSelectionBox(line,{x:8,y:3},{x:3,y:8},project));
});
