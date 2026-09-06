# Solid lofts in LucasCad

## Workflow

1. Make two or more sketches, each with one closed contour, on distinct section planes. Origin, reference-plane, and planar-face-supported sketches are supported.
2. Optionally select the first sketch, then click **Create → Loft** (beside Revolve). The floating manager opens immediately, including when nothing is preselected.
3. Click section sketches in the feature tree or model in travel order. Hidden sketches are temporarily available for picking. The ordered list has move-up, move-down and remove controls; selecting the same sketch again does not add a duplicate.
4. Choose **Smooth** (blended through the sections) or **Ruled** (straight transitions between adjacent sections). Choose **New body**, **Union with body**, or **Cut body**, and a target when applicable.
5. The shaded preview appears after the candidate validates. Pan/rotate/zoom remain available and the manager can be dragged by its heading. Green is additive material; red shows the material a cut removes.
6. Create the loft. Right-click its feature-tree entry → **Edit feature** to restore its original sections and parameters. Editing rolls the displayed body back before the loft, and validates the entire subsequent history before Apply is enabled. Cancel does not change the saved feature.

Sketches remain linked by ID, so changes to their geometry rebuild the loft. Saving/loading LucasCad JSON preserves the section order and parameters. STEP, STL and OBJ export use the resulting kernel solid.

## SolidWorks research and initial scope

The [SolidWorks Creating the Loft tutorial](https://help.solidworks.com/2026/english/swtutorialonline/t_tut_loft_createloft.htm) describes ordered profile selection, inspecting a shaded preview, and moving profiles up/down before committing. Its selection point determines corresponding connector points.

The [Loft PropertyManager](https://help.solidworks.com/2019/english/SolidWorks/sldworks/HIDD_DVE_FEAT_LOFT.htm?format=P&value=) also offers face/edge profiles, start/end constraints, guide curves, and other advanced shape controls. [Loft synchronization](https://help.solidworks.com/2025/English/SolidWorks/sldworks/c_Loft_Synchronization_Overview.htm) uses editable connectors to control correspondence.

This release implements **closed-sketch solid lofts**, using OpenCASCADE through-section solids and automatic wire correspondence. It is not full SolidWorks loft parity. Manual seam/connectors, point-ended lofts, guide curves, centerlines, endpoint tangency/curvature, thin/open-surface lofts, and multiple contours/holes per section are not yet supported. Smooth interpolation can overshoot between sections; inspect the preview or use Ruled/add stations for tighter control. Same-plane sections and invalid contours produce explicit errors rather than silently dropping geometry.

## Example

Open `examples/loft-car-body.lucascad.json` through LucasCad's Open command. It is a five-station, eight-edge-section car-body envelope, not a finished car. Right-click its loft to switch Smooth/Ruled or reorder sections. Edit an individual section sketch to change the body shape.

## Verification — 2026-09-05

- `pnpm test`: production build, 91 existing/integration contract and geometry tests, and 7 real React DOM component interaction tests pass.
- `.venv/Scripts/python.exe -m pytest backend -q`: 55 tests pass, including 16 loft-specific kernel/API cases.
- Loft checks include frustum volume, three-section smooth/ruled results, circle-to-rectangle edge-count changes, section edits/order reversal, New/Union/Cut previews, face-touching Union, open/missing/duplicate/multi-contour/copanar rejection, JSON preservation and STEP re-import.
- DOM tests exercise empty/preselected managers, reordering, removal, transition/result controls, errors, cancellation, and ignoring stale asynchronous validation. These are not browser mouse tests.
- Live backend smoke test rebuilt the supplied car envelope as one valid solid (10 faces, about 315868.3 mm³).
- Follow-up Chrome mouse testing completed: drew two circles on XY/80 mm planes, preselected the first in the tree, picked the second in 3D, reordered profiles, changed to Ruled and created one solid. Right-click Edit restored those parameters. Removing a profile disabled Apply, and Cancel restored the unchanged solid. Added a rectangle on a 160 mm plane, edited the loft to three ordered sections and Smooth, then applied successfully. Reused hidden sketches for valid Cut and Union previews and cancelled the temporary second feature; the three-section solid is left open in Chrome.
- Browser trials exposed and verified fixes for two issues: Create/Apply/Cancel falling below the flyout on short screens (now a fixed footer with independently scrolling fields), and Fit ignoring preview-only geometry during feature rollback (now includes preview faces and visible/pickable sketches). The panel was also successfully dragged by its header.
- Remaining visual polish: mesh-derived outlines can show triangulation artifacts on strongly curved loft faces; exact topological edge rendering would be cleaner. Kernel validity and successful preview validation do not imply full aesthetic/surface-quality parity with SolidWorks.
- Repository-wide `tsc --noEmit` remains blocked by existing sketch-reference narrowing and Cloudflare type errors outside the loft additions. The production build passes.

Next high-value loft extension: editable connector alignment, followed by guide curves and endpoint tangency controls for automotive body shaping.
