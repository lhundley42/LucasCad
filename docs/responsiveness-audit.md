# LucasCoupe responsiveness audit — 2026-09-05

## Findings

This is primarily unnecessary work in the interaction architecture, not evidence
that the CAD kernel cannot handle a 16-solid model.

The user-loaded Chrome document contained the original coupe plus two 1 mm
fillets and a failing 4 mm chamfer on a rear rim. Selecting the Right rocker sill
body immediately changed the status to Rebuilding. Entering Fillet selection did
the same, without opening the parameter manager because no edge was selected.
Editing the existing second fillet temporarily rolled back later features and
successfully displayed its preview. Fit and a temporary radius change also
triggered rebuilding. No feature changes were applied during these trials.

Browser automation timings include transport overhead and are not precise paint
or interaction-to-next-paint measurements. The measured figures below are local
kernel wall-clock timings on the saved baseline coupe, without the user's three
additional features. Browser performance-entry access was unavailable.

| Work | Measurements |
| --- | --- |
| Complete document payload, three runs | 2.834 / 2.793 / 3.237 s |
| Feature-history build within those runs | 1.092 / 1.025 / 1.064 s |
| Remaining meshing, metadata and properties work | 1.742 / 1.768 / 2.173 s |
| JSON encoding | 0.053–0.055 s |
| Fillet an already-built right sill, radii 0.5 / 1 / 1.5 mm | 0.0116 / 0.0118 / 0.0115 s |

Baseline payload: 324 faces, 814 edges, 7,736 triangles, approximately 2.12 MB
as an uncompressed JSON string. The isolated fillet test used edge 1; it is not
claimed to be the exact edge selected in the user's original trial.

## Root causes in source

1. `CadViewport.tsx` combines renderer creation, data fetching, geometry creation,
   selection styling, navigation and disposal in one large effect. Selection IDs,
   Fit, grid visibility, pick modes and callback identities are dependencies.
   Each change tears down the renderer and requests `/api/document` again.
2. Cleanup synchronously captures a PNG using `toDataURL`, then destroys all GPU
   geometry and the renderer. The preserved model picture is not pickable live
   geometry. A failed request leaves an apparently visible but noninteractive
   model snapshot.
3. `server.py:document_payload` calls `build_document` from scratch and remeshes
   every body's faces and edges, even for a preview affecting only one sill.
   The plane cache lasts for one call; there is no cross-request solid/mesh cache.
4. Main document requests have a disposed-result check but no request abort.
   Chamfer dragging aborts client requests but can submit another full document
   request on subsequent animation frames. Browser abort alone does not cancel
   an already-running CAD kernel operation.
5. The viewport creates a mesh and outline per face plus a line per edge:
   roughly 1,462 render objects for the baseline solids alone, before overlays.
   It raycasts broad object lists and renders continuously even when idle.
   These are additional optimization candidates; GPU cost was not separately
   measured in this exercise.
6. Fillet/Chamfer parameter windows depend on having a draft, which is created
   after picking an edge. Tool activation should open the manager immediately
   with an empty edge collector, without waiting for geometric work.

## Implementation order

1. **Persistent viewport and immediate managers.** Create scene, renderer and
   controls once. Separate effects for model revision, material highlighting,
   visibility, camera and preview. Selection, hover, Fit and opening a panel
   must send zero geometry requests. Keep the last valid live scene on errors.
2. **Revisioned solid and mesh caches.** Retain evaluated feature/body snapshots;
   recompute only edited features and their dependents. Cache tessellation per
   body revision. Keep visibility/naming separate from geometry cache keys.
3. **Target-only preview jobs.** Submit a target body revision plus feature
   parameters; return only changed preview geometry. Keep final solid validity
   checks at commit. Do not silently substitute a visually plausible preview
   for a valid CAD operation.
4. **Bounded latest-wins scheduling.** One active preview plus the latest pending
   value per document/tool; reject stale revisions and coalesce rapid edits.
   Use isolated worker processes for heavy kernel work, with measured, bounded
   concurrency. FastAPI already runs normal `def` endpoints in a thread pool;
   changing everything to `async def` is not the solution.
5. **Batch rendering and picking.** Merge compatible face/edge buffers by body,
   retain face/edge ID lookup tables, share materials, spatially index picking,
   and use instancing for repeated parts. Limit hover processing to once per
   frame; redraw when needed rather than continuously when idle.
6. **Performance budgets and recovery safety.** Add interaction and request-count
   tests: panels/highlights under 100 ms, smooth navigation, no full rebuild for
   selection. Treat these as targets, not improvements already achieved. Add
   durable local crash recovery and a development-refresh checkpoint policy.

React documents that changing effect dependencies causes cleanup followed by
setup, which directly explains the current broad effect's behavior:
[useEffect](https://react.dev/reference/react/useEffect).
Three.js documents the cost of many meshes and scene nodes:
[Optimize Lots of Objects](https://threejs.org/manual/en/optimize-lots-of-objects.html).
FastAPI explains synchronous endpoint scheduling:
[Concurrency and async/await](https://fastapi.tiangolo.com/async/).

## Backout addition and verification

The rebuild-error overlay now offers Back out. Failed previews close without
changing committed history. Committed failures restore the exact last successful
document snapshot. If an imported failed file has no successful session snapshot,
recovery searches backward for a validated feature prefix. Transport errors stop
that search without changing the project. A guarded, one-level Undo restores the
backed-out document, until subsequent model edits invalidate that undo option.
This is not a general modeling undo stack or persistent crash recovery.

The production build and 109 automated tests passed. A real geometry-service test
rejected a 10,000 mm diagnostic sill fillet, recovered all 46 original features,
and confirmed equality with the saved project while preserving the failed input.

During implementation, development hot refresh reset the open in-memory model.
This was disclosed immediately. No newer saved coupe was found in the project's
examples directory, Desktop or Downloads. The saved baseline JSON remains intact;
the two user fillets and failed chamfer were not recovered. Chrome's native file
picker blocked automated re-import, so final browser testing of Back out awaits
manual reopening of the project. The architectural performance changes above
have deliberately not been implemented: they were requested as recommendations.
