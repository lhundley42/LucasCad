// Real application and real CAD backend. Only the OS file picker is replaced,
// so repeatable browser QA cannot overwrite the user's open or saved document.
import React from "react";
import { createRoot } from "react-dom/client";
import Home from "../../app/page";
import coupe from "../../examples/LucasCoupe.lucascad.json";
import "../../app/globals.css";
import "../../app/dialogs.css";
import "../../app/modeling.css";

const model = new URLSearchParams(location.search).get("model");
const points = [{x:0,y:0},{x:20,y:0},{x:20,y:10},{x:0,y:10}];
const fixture = model === "thin-ring" ? {schemaVersion:2,units:"mm",sketches:[{id:"s",name:"Thin ring",plane:"XY",visible:false,entities:[{id:"outer",type:"circle",c:{x:0,y:0},r:20},{id:"inner",type:"circle",c:{x:0,y:0},r:19}]}],features:[{id:"e",name:"Thin ring extrusion",type:"extrude",sketchId:"s",bodyId:"ring",bodyName:"Thin ring",combine:"new",distance:10}]}
  : model === "box" ? {schemaVersion:2,units:"mm",sketches:[{id:"s",name:"Box",plane:"XY",visible:false,entities:points.map((a,i)=>({id:`line-${i}`,type:"line",a,b:points[(i+1)%4]}))}],features:[{id:"e",name:"Box extrusion",type:"extrude",sketchId:"s",bodyId:"box",bodyName:"Box",combine:"new",distance:4}]}
  : coupe;
const filename = `${model || "LucasCoupe"} — fillet test copy.lucascad.json`;
Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: async () => [{
  name: filename,
  getFile: async () => new File([JSON.stringify(fixture)], filename, {type:"application/json"}),
  createWritable: async () => { throw new Error("This browser test copy does not write to disk."); },
}] });
createRoot(document.getElementById("root")!).render(<Home />);
