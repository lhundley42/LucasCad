# Black Lantern — pirate-ship workflow exercise

## Deliverable and method

`examples/Black-Lantern.lucascad.json` is an editable LucasCad project, not an imported display mesh. The construction script authors ordinary LucasCad sketch/datum/feature records and passes them through the application's real `build_document` kernel. I used the actual application in Chrome for loading, body selection, visibility, fitting and undo/redo trials. I did **not** manually draw every repeated part with the mouse.

The finished display model has 186 valid solid bodies, 191 features and 216 sketches. +X points toward the bow; the rudder is at the -X stern. Features include:

- Five-waterline outer hull loft and four-waterline subtractive interior loft.
- Keel, stern rudder, planked deck, open gunports and ten hollow cannon barrels with muzzle bands.
- Windowed stern cabin, raised quarterdeck, staircase, two grated hatches and forecastle.
- Swept handrails and hull wales, railing posts and stern balusters.
- Three masts, fighting tops, four billowed lofted square sails, a jib and a lateen sail.
- Yardarms, bowsprit, stays, shrouds, sheets and 36 ratlines.
- Two anchors, a revolved wheel rim with eight spokes, and a skull-and-crossbones pennant.

`Black-Lantern.step` contains the actual solids. `Black-Lantern-preview.png` is a depth-tested render of those same solids with presentation-only wood, canvas, metal and rope colors. This example loads the saved Old School global theme. LucasCad now supports native per-body color overrides through body-tree right-click → Appearance; the existing PNG still uses separate VTK lighting, and its presentation palette has not been applied to this example JSON. This is a decorative concept model, not a historically exact vessel, seaworthy design, collision-free rigging assembly or print-ready union.

The sail layout was informed by [National Historic Ships' fittings guide](https://www.nationalhistoricships.org.uk/sites/default/files/2023-02/c_fittings.compressed.pdf), which describes square sails on the fore/main masts and a lateen sail on the mizzen, and the [Vasa Museum sailing-ship exhibit](https://www.vasamuseet.se/en/visit/exhibitions/sailing-ship). This model combines those references freely rather than claiming to reconstruct Vasa.

## Small workflow findings

| Workflow | Evidence | Resolution |
| --- | --- | --- |
| Hide the ship, show just the helm, press Fit | The ring stayed tiny because invisible hull/masts still contributed to bounds. | **Fixed:** Fit uses visible solids and current sketch visibility. No CAD rebuild. |
| Press Fit while a model is still loading | Toggling the grid/CSY redrew the old mesh and consumed the pending Fit, so the loaded ship needed a second click. | **Fixed:** pending Fit is retained until the matching document mesh arrives. |
| Undo a visibility change with the ribbon | Ctrl+Z worked, but Undo was disabled and Redo always disabled. | **Fixed:** both buttons use the document history, just like the keyboard. Pending commands cancel before committed history changes. |
| Inspect one detail among 182–186 bodies | Hide all, scroll to the body, show it, then Fit was unnecessarily repetitive. | **Fixed:** right-click a body → **Isolate body and fit**. Undo restores the previous visibility set; View → Solids can show everything. |
| Find a specific section or repeated rigging part | Hundreds of similarly named rows make the long tree cumbersome, even with collapsible groups. | **Next:** tree search and named folders/subassemblies. The model uses descriptive names as an interim aid. |
| Repeat posts, cannons and rigging solids | There is no solid/body pattern command; sketch patterns do not replicate a whole multi-feature part. | **Next major value:** linked body/component linear and circular patterns, then assembly groups. Repeated parts here remain independently editable native features. |
| Shell a tightly pinched multi-section hull at 2.4 mm | Both the primary offset and existing fallback failed with this hull. | **Model workaround, not kernel fix:** a subtractive inner loft provides explicit interior clearance. General robust shelling at tight joins is a larger geometry task. |
| Distinguish canvas, timber and metal inside CAD | Global model color alone could not distinguish the parts. | **Fixed:** body-tree right-click → Appearance provides a picker, hex color and Use theme color. Overrides persist as body-creator display metadata in JSON and support undo/redo; selection colors take precedence. This is flat body color, not a material/lighting editor. |
| Open the fully detailed model at high mesh quality | The completed model produces about 1.27 million display triangles at quality 55; first load is noticeably slower than selection/visibility changes. | **Deferred:** progressive/cached body tessellation and adaptive detail for tiny rigging. Render quality can already be reduced in Settings without changing exact STEP geometry. |

## Verification

- Full project rebuild: every final body is a valid, positive-volume single solid.
- Regression checks cover native feature types, unique record IDs, sail/cannon/ratline/wale counts and bow/stern placement.
- Chrome: reproduced Fit/toolbar defects before changes; confirmed isolated helm fitting, toolbar Undo/Redo, and body isolation with reversible visibility.
- Isolation test: 182 visible bodies → 1 → Undo → 182, with the viewport's geometry-request counter unchanged at 3. Final trim details increase the saved model to 186 bodies.
- Unit/integration tests cover hidden solids, stale sketch visibility, history buttons, cancellation, consumed-body visibility and preservation of geometry parameters.

Use normal **Open** to load the saved project. The isolated browser test fixture also supports `http://127.0.0.1:4312/tests/browser/fillet.html?model=pirate`; its Open button loads a read-only test copy and cannot overwrite a disk file. This fixture is not the normal application or production bundle.

To regenerate: `.venv/Scripts/python.exe examples/build_pirate.py`, then `.venv/Scripts/python.exe examples/render_pirate.py`.
