# Third-party software and release scope

LucasCad's project-original source code is GPL-3.0-only; see [LICENSE](LICENSE)
and the scope notice in [README.md](README.md). LucasCad uses independently licensed
third-party software. The project license does not replace these licenses or grant rights in third-party code,
trademarks, fonts, images, or optional binary components.

## Principal components

| Component | Installed version | Declared license |
| --- | --- | --- |
| React / React DOM / React Server DOM | 19.2.6 | MIT |
| Three.js | 0.185.1 | MIT |
| CadQuery | 2.8.0 | Apache-2.0 |
| CadQuery OCP bindings / proxy | 7.9.3.1.1 | Apache-2.0 |
| Open CASCADE Technology, underlying OCP kernel | 7.9.3 family | LGPL-2.1 with Open CASCADE exception; not covered by the bindings' Apache license |
| FastAPI | 0.141.1 | MIT |
| Uvicorn | 0.52.4 | BSD-3-Clause |
| VTK, including optional presentation rendering | 9.6.2 | BSD; bundled components have additional notices |
| CasADi, a CadQuery dependency | 3.7.2 | LGPL-3.0-or-later; bundled solvers have separate terms |
| Vinext / Vite | 1.0.0-beta.2 / 8.0.13 | MIT |
| OpenAI Sites Vite plugin | 0.1.0 | MIT, copyright OpenAI |
| Drizzle ORM | 0.45.2 | Apache-2.0 |

The installed dependency inventory is in [docs/release/dependencies.json](docs/release/dependencies.json).
It covers installed packages, including development/test and indirect dependencies;
it is **not** a complete list of embedded native libraries or absent platform-specific packages.
License metadata is evidence, not a substitute for reading the applicable terms.

[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) preserves license/notice texts
found in those installed packages, deduplicated with SHA-256 references from the
inventory. Some packages omit notice files. Their absence is recorded, not treated
as permission. Regenerate with `node tools/release_audit.mjs` after installation
and whenever dependencies or platform change. This script performs no network
access and does not modify dependencies.

## Redistribution requirements and unresolved checks

- Retain applicable copyright, license and NOTICE texts when copying or bundling
  MIT, BSD, Apache or other third-party code. Do not claim third-party authorship.
- Open CASCADE and CasADi are not simply MIT/Apache libraries. For an installer,
  wheel bundle or executable distribution, verify applicable LGPL source access,
  library replacement/relinking and notice requirements. The Open CASCADE exception
  concerns qualifying header-derived object code; it is not a general waiver.
- The web/build tree also includes MPL-2.0 components (Lightning CSS, resvg,
  satori, Vercel OG, axe-core) and sharp's LGPL-covered native libvips. Check
  distributed covered files/binaries and provide required corresponding sources.
- caniuse-lite's data is CC-BY-4.0. Preserve attribution when distributing it.
- **CasADi packaging needs clarification before bundling:** the installed wheel
  contains both `casadi/include/licenses/metis-external/LICENSE` (EPL-1.0)
  and `casadi/include/licenses/metis-external/metis-4.0/LICENSE` (legacy restrictive
  research/evaluation terms). These files alone do not establish which grant
  governs the shipped library. Obtain upstream version-specific clarification;
  do not assume every bundled solver is permissively licensed or declare an
  infringement from these files alone.
- Do not publish `.venv`, `node_modules`, native DLLs or a prebuilt installer as
  part of this source release. Package-specific native attribution/source
  obligations have **not** been cleared by this audit.

## Provenance and branding

LucasCad contains project-specific CAD code and adapted web starter scaffolding.
Installed React/Vinext/Sites licenses are collected above. The original starter
template's precise source revision and separate asset licensing have not been
independently established. `public/favicon.svg`, `file.svg`, `globe.svg` and
`window.svg` remain starter-derived assets pending provenance confirmation.

SolidWorks, NX and Onshape references in documentation describe workflow research,
not affiliation or endorsement. No proprietary CAD SDK is declared in the
dependency manifests. That observation is not a line-by-line source originality,
trademark or patent clearance. Tutorials linked in docs are not licensed for
verbatim redistribution merely because they are publicly readable.

Example model construction and rendering scripts are project artifacts. The
coupe/ship preview images are diagnostic renders, not proof of native lighting
features, engineering accuracy, manufacturability or safety. Imported user model
`examples/chalis.json` requires the owner's approval for public distribution.

## Primary references

- [CadQuery license](https://github.com/CadQuery/cadquery/blob/master/LICENSE)
- [Open CASCADE license and exception](https://dev.opencascade.org/doc/overview/html/occt_public_license.html)
- [CasADi licensing](https://web.casadi.org/docs/)
- [MIT conditions](https://choosealicense.com/licenses/mit/)

See [the release audit](docs/release-audit.md) for unresolved security and provenance
findings. This is an engineering inventory, not legal advice or a compliance certification.
