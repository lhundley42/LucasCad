# LucasCad

A thoughtfully developed, local-first, browser-driven analog to popular sketch-based CAD software.

The current vertical slice uses Open CASCADE through CadQuery for exact B-Rep
geometry and STEP export. Three.js displays a tessellated copy of each exact
face for interactive orbiting and face selection.

## Run locally

From PowerShell in this directory:

```powershell
.\start-cad.ps1
```

The script starts the geometry service on `127.0.0.1:4311` and the browser UI
at `http://lucascad.localhost:4310`. The dedicated ports keep LucasCad from
competing with other local development applications.

## Validate

```powershell
.\.venv\Scripts\python.exe -m pytest backend\test_server.py -q
pnpm exec vinext build
```

The backend tests verify sketch diagnostics, document replay, Boolean cuts,
exact volume, solid validity, STEP generation, STEP re-import, and volume
preservation. The frontend contract tests run with `pnpm test`.

## Current feature slice

- Open CASCADE box feature generated from a rectangular sketch definition
- Feature tree and origin planes
- Freeform chained lines and construction centerlines
- Corner rectangles, circles, ellipses, exact three-point arcs, and connected splines
- Endpoint, midpoint, center, quadrant, grid, horizontal, and vertical snapping
- Automatic coincident, horizontal, vertical, and concentric relation markers
- Automatic entity dimensions with double-click numeric editing
- Connected-endpoint propagation when dimensions rebuild geometry
- Undo, redo, trim/remove, selection, and keyboard shortcuts
- Ribbon New Sketch always creates a new sketch after choosing XY, XZ, YZ, or a selected planar body face
- Finished sketches remain visible in amber in the 3D viewport and do not create a feature automatically
- Extrude and Revolve first prompt for a sketch and report empty, open, or degenerate geometry with endpoint diagnostics
- Closed sketch profiles drive exact Open CASCADE extrusions with new-body, union, and cut result modes
- Closed sketch profiles drive partial or full revolutions
- Revolve axes from a construction centerline, origin axis, or profile edge
- Constant-radius edge Fillet and symmetric edge Chamfer features with live previews
- Neutral-plane Draft features with selected taper faces and reversible pull direction
- Document-order feature replay after sketch, distance, angle, axis, or Boolean changes
- Selectable Solid Bodies folder and body nodes in the feature tree
- In-context sketch editing with surrounding bodies visible, a normal-to-support camera, and restoration of the previous 3D view on exit
- Intersection-aware trim for isolated line and circle segments, including circle/rectangle crossings
- Right-click feature-tree actions and dependency-aware deletion
- Orbit, pan, zoom, and face selection
- Editable JSON project download
- Exact STEP export

Next: add a formal geometric constraint solver and advanced variable-radius, asymmetric, and parting-line feature variants.
