# LucasCad

A thoughtfully developed, local-first, browser-driven analog to popular sketch-based CAD software.

## License

Copyright (c) 2026 LucasCad contributors.

LucasCad's project-original source code is free software: you can redistribute
it and/or modify it under the terms of the GNU General Public License, version 3
only (`GPL-3.0-only`), as published by the Free Software Foundation.

It is distributed in the hope that it will be useful, but **WITHOUT ANY WARRANTY**;
without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
PURPOSE. See [LICENSE](LICENSE) for the complete terms.

This grant covers LucasCad-original application, backend, test and tooling code.
Third-party code, dependencies and notices retain their
upstream terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No rights in
third-party material or unapproved example models/images are granted by this notice.
The [release audit](docs/release-audit.md) still contains unresolved distribution checks.

## Release status

Experimental local-only software, not a production-ready network service or a
certified engineering tool. The [release audit](docs/release-audit.md) records
open security, licensing and provenance findings. Read [third-party notices](THIRD_PARTY_NOTICES.md)
and [security guidance](SECURITY.md) before redistributing or deploying it.
Public source availability is not a blanket license for bundled dependencies.
Source-archive exclusions preserve owner models locally while omitting selected
unapproved artifacts from `git archive`. They do not sanitize Git history or make
an installer cleared for redistribution. See [provenance and release decisions](docs/release/provenance.md).

The current vertical slice uses Open CASCADE through CadQuery for exact B-Rep
geometry and STEP export. Three.js displays a tessellated copy of each exact
face for interactive orbiting and face selection.

## Run locally

Install a security-patched **Node.js >=22.13** and **Python 3.11-3.14** (3.12 or
3.13 recommended). The launcher creates `.venv`, installs the Python dependencies,
and installs the pinned pnpm 11.19.0 locally if needed. First setup needs internet
and downloads several hundred MB. Subsequent runs reuse the environment.
Review the audit's dependency advisories before installation. Do not copy another
machine's `.venv` or `node_modules`.

**Windows:** double-click **Start LucasCad.bat**. It handles the normal Windows
script execution policy without changing your machine or user policy. Alternatively:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-cad.ps1
```

Install the [Microsoft Visual C++ x64 Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist)
if native DLLs fail to load (`winget install Microsoft.VCRedist.2015+.x64`).

**macOS/Linux:** run `bash ./start-cad.sh`. macOS also has **Start LucasCad.command**
for Finder. Linux minimal/container/WSL installations need loader libraries even
though rendering is in the browser, not on the server:

```bash
# Debian / Ubuntu
sudo apt-get install libgl1 libglx-mesa0 libxrender1 libxext6 libsm6 libice6
# Fedora / RHEL alternative
sudo dnf install mesa-libGL libXrender libXext libSM libICE
bash ./start-cad.sh
```

Both services bind only to IPv4 loopback: geometry on `127.0.0.1:4311`, UI on
`127.0.0.1:4310`. The launcher advertises `http://lucascad.localhost:4310` where
that name resolves correctly; otherwise it uses `http://127.0.0.1:4310`.
The browser opens only after **both** services respond. Ctrl+C stops the servers
and their child processes. Reopening an already running app does not start or
take ownership of another copy. Unrelated port conflicts are reported, not killed.

Options: PowerShell `-SetupOnly`, `-NoOpen`, `-Dev`; macOS/Linux `--setup-only`,
`--no-open`, `--dev`. `Dev` also installs backend test dependencies.
Set `LUCASCAD_PYTHON` to a full interpreter path to select Python explicitly.
Installation stamps live in ignored `.tooling`; setup does not change global
pnpm installations, install OS packages, or delete an existing virtualenv.

On affected Windows native-library combinations, a short-lived CadQuery process
can crash *after* completing its geometry calculation. The launcher recognizes a
flushed success marker, warns about teardown, and still requires live HTTP health.
This avoids falsely rejecting a working kernel; it does not fix the upstream crash.

## Validate

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-cad.ps1 -SetupOnly -Dev
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_launcher.py -v
.\.venv\Scripts\python.exe -m pytest backend -q
pnpm exec vinext build
pnpm run test:dependencies
pnpm run test:release
```

On macOS/Linux, use `bash ./start-cad.sh --setup-only --dev`, then the same Python
test commands with `.venv/bin/python` instead of `.venv\Scripts\python.exe`.
See [startup issue review and validation](docs/launcher-issues.md) for the
cross-platform checks and remaining native-library/macOS verification caveats.

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
