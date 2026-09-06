# Interactive fillets

Select solid edges and choose **Modify → Fillet**, or start Fillet and pick edges. Shift-click adds/removes edges; while the command is active, ordinary edge clicks also toggle the selection. A single radius applies to the entire selected edge set.

The floating dialog finds a usable initial radius and displays a kernel-tested approximate maximum. Oversized defaults/typed values are clamped; the radius slider and gold on-model arrow use the same limit. All controls work in millimeters or inches. Drag the header to move the dialog; normal model navigation remains available.

Radius changes preview only the target solid, leaving other bodies and selection targets intact. Pointer updates are coalesced (one active request, newest pending request). Stale replies cannot replace newer selections. The base document and edge-set limits are cached separately. The last valid preview stays visible while the same selection's radius is being recalculated.

Invalid seams or conflicting edge sets report inside the dialog. They never add a failed feature to the document. Creation/editing also validates the full candidate feature history before committing; a downstream failure leaves the original document unchanged. Tree editing restores original parameters. Ctrl+Z undoes a committed fillet.

## Meaning of the limit

This is a **conservative, verified usable limit**, not an analytic proof of a global maximum. The kernel is probed with shrinking/growing radii, then a bounded binary search (about 0.2% or 0.001 mm bracket tolerance). Expensive searches may stop early and show “Tested radius limit” instead of “Maximum radius ≈”. CAD topology can have discontinuous valid ranges, so each requested preview is validated even below the displayed limit. One long kernel call cannot be interrupted by the search's time budget.

## SolidWorks reference

The selection → radius → preview → apply/edit workflow follows the official [FilletXpert tutorial](https://help.solidworks.com/2011/english/SolidWorks/sldworks/LegacyHelp/Sldworks/Features/FilletXpert.htm?id=19.6.16.2) and [constant-size fillet PropertyManager](https://help.solidworks.com/2026/english/SolidWorks/sldworks/r_constant_size_fillets.htm). LucasCad's tested-limit search and gold radius manipulator are additional convenience controls, not claims of complete SolidWorks FilletXpert parity. Variable-radius, face/full-round fillets and automatic feature reordering remain separate future work.

## Regression coverage

- Backend: oversized box, 1 mm thin-walled ring, invalid cylinder seam, changing edge selections, cache reuse, both saved LucasCoupe rockers and four outer tire rings in one operation.
- Components: default adjustment, slider/arrow clamp, request coalescing, stale responses, cancellation, downstream commit failure, real Three.js raycast/drag behavior.
- Chrome: actual application loaded with a read-only copy of LucasCoupe; sill default 2 mm reduced to approximately 1.996 mm, arrow drag to approximately 0.67 mm, 500 mm input clamped, successful 0.8 mm creation, post-build editing and Ctrl+Z; multi-edge tire selections and preview.
- Chrome thin-wall fixture: 1 mm ring wall, default 2 mm automatically reduced to approximately 0.998 mm; successful 0.5 mm fillet committed and displayed without recovery or visibility toggles.
- Viewport integration: radius/selection changes use only the fillet endpoint; accepted preview remains through commit until the finished mesh arrives; Cancel restores the original immediately.

Run `pnpm test` and `.venv/Scripts/python.exe -m pytest backend -q`.

For repeatable manual browser trials, run `pnpm exec vite --config tests/browser/vite.config.ts` and open `http://127.0.0.1:4312/tests/browser/fillet.html`. **Open** loads the saved LucasCoupe test copy without a native file dialog; it cannot save over a disk file. Add `?model=box` or `?model=thin-ring` for smaller fixtures. All CAD calculations use the normal backend on port 4311; only the file picker is replaced. This test entry point is not part of the production app build.
