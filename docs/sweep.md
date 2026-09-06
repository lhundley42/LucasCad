# Sweep

Sweep carries a closed sketch profile along a second, connected sketch path. Use it for handles, pipes, rails and cable-like parts.

## Workflow

1. Draw the profile at a path endpoint, ideally on a plane normal to the path's starting direction. Holes inside the profile are supported.
2. Draw the path in another sketch. Lines, arcs, splines, circles and ellipses are supported. All non-construction geometry must form one connected, non-branching chain.
3. Choose **Create → Sweep**. A preselected sketch fills the Profile field. Otherwise click the profile in the tree or 3D view, then the path.
4. Choose **Follow path** or **Keep normal constant**. For sharp path corners choose **Round** or **Miter**.
5. Choose **New body**, **Union with body**, or **Cut body**. Inspect the live preview, then create the feature. Validation includes downstream features when editing.

Click either reference field to reselect it; Swap exchanges the profile and path. The nonmodal panel can be dragged by its title bar, and model navigation stays available. Right-click the built Sweep in the feature tree to edit it. Edits to either source sketch rebuild the sweep; save/load and Ctrl+Z preserve all references and parameters.

## Demonstration model

Open `examples/Sweep-hollow-handle.lucascad.json` in LucasCad. It contains a 16 mm outer-diameter, 3 mm-wall tube swept along two 55 mm straight legs and a radius-30 semicircle. It is one hollow solid, not a tessellated imitation. The profile is on XY and the path on XZ. Show the two sketches to inspect them, or edit the Sweep to see the references and preview.

The material volume is `π × (8² − 5²) × (110 + 30π)` mm³. Regression tests compare this analytic value with the actual OpenCASCADE solid. `render_sweep.py` rebuilds the model, exports STEP/STL, and renders its actual tessellation for an offscreen illustration.

## SolidWorks references and scope

- [Creating a Basic Sweep](https://help.solidworks.com/2022/english/SolidWorks/sldworks/t_creating_a_sweep.htm): profile and path selection.
- [Sweep Rules](https://help.solidworks.com/2018/english/SolidWorks/sldworks/c_sweep_rules.htm): a closed profile for solids; a connected path intersecting the profile plane.
- [Orientation/Twist Control](https://help.solidworks.com/2012/English/SolidWorks/sldworks/Orientation_Twist_Control_Option.htm): following the path versus keeping sections parallel to the original profile.

This first implementation supports sketch-based solid sweeps, not every SolidWorks sweep variant. Guide curves, twist-angle laws, automatic circular-profile generation, selection of existing solid edges as paths, 3D-sketch paths, thin/surface sweeps and mid-path/bidirectional starts are not yet implemented. For a closed path, place the profile at its seam. Tight bends, self-intersections or a constant-normal section becoming tangent to the path can prevent a valid solid; the panel reports the failure and does not commit it. There is no automatic relocation of misplaced sketches.
