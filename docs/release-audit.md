# LucasCad pre-publication audit — 2026-09-06

## Decision

**Audit complete with unresolved findings; not cleared as a clean public release
or bundled installer.** The follow-up below fixes the identified dependency
advisories and current starter icons. No repository visibility change, push,
credential rotation or Git history rewrite was performed.

This is a bounded engineering/licensing review, not legal advice, a penetration
test, a complete supply-chain certification or a guarantee of originality.

## Scope and evidence

- Baseline: `main` at `f353ca4455f2421b1751df489a9dc8e387ddcdda`, plus the local
  approved appearance, pirate-model and workflow work intended for the next commit.
- Gitleaks 8.30.1 scanned all 11 locally reachable commits using
  `--log-opts="--all --full-history" --redact`: no findings. The downloaded Windows
  archive was verified against the upstream published SHA-256 checksum:
  `d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e`.
- A separate Gitleaks directory scan covered a snapshot of tracked and non-ignored
  candidate files, including the uncommitted work: no findings. See the final
  scan record in `release/secret-scan.json` for candidate scope/count.
- No tracked `.env`, PEM/key or log files were found by filename checks. This is
  not proof that all secret formats are detectable. Reflogs/unreachable objects,
  remote-only branches, third-party caches and GitHub settings were not audited.
- Git authors use GitHub noreply addresses. A local Windows user path exists in
  nine historical commits. The current launcher was cleaned up; history was not
  rewritten. The owner must accept that historical disclosure or authorize a
  separate sanitized-publication/history plan.
- Original installed Windows inventory: **505 unique npm package/version pairs and 68
  Python distributions**. Includes build/test/indirect packages, not just runtime.
  Generated notices preserve **385 distinct upstream license/notice texts**.
  31 package records lack installed notice files; this is explicitly not a
  statement that they lack licenses. Missing foreign-platform packages and embedded
  native libraries are not fully inventoried by package metadata alone.

## Findings and disposition

| Priority | Finding | Disposition |
| --- | --- | --- |
| High | Original npm audit: 26 advisories — 14 high, 9 moderate, 3 low | **Fixed in current lockfile.** Follow-up scan reports zero known advisories, with no audit exclusions. See `release/security-advisories.json`. |
| High | Local development dependencies include actual server components, not only offline build utilities | **Patched; exposure boundary remains.** Updated Vite, React Server DOM, Undici, ws, sharp, fast-uri and esbuild; Vinext upgrade removes image-size. `dev: true` does not make an advisory irrelevant. |
| Medium | Original Python scan: 7 entries (6 distinct IDs) for pip 25.0.1 | **Fixed in this environment.** Upgraded project-local pip to 26.2.1; fresh scan of all 68 distributions reports zero known advisories, none skipped. README documents pip >=26.2 for fresh installs. |
| Release gate | No LucasCad project-level license | **Resolved 2026-09-06:** owner selected GPLv3. Added the full GNU GPL version 3 text, a project-original source scope/warranty notice, and `GPL-3.0-only` package metadata. This does not clear third-party compatibility or provenance issues. |
| Release gate | CasADi wheel includes conflicting-looking EPL-1.0 and legacy METIS 4 restrictive license notices | **Unresolved binary provenance.** Ask upstream which terms govern the exact compiled component. Do not bundle `.venv`/solver DLLs until resolved. Not a finding of infringement. |
| Release gate | LGPL/MPL/copyleft dependencies and incomplete native source/notice inventory | **Open for binary release.** Collected notice texts do not alone satisfy all corresponding-source/relinking requirements. |
| Release gate | Starter template/assets not independently traced to an exact revision/license; user `chalis.json` needs publication approval | **Partially resolved.** Current uncertain starter SVGs replaced/removed. Exact starter-code provenance, historical assets and model publication approval still need review. |
| Privacy | Hard-coded personal Windows path in launcher | **Fixed in current source.** PATH lookup and a user-relative optional runtime fallback replace it. Historical copies remain. |
| Hygiene | Startup logs could be accidentally added | **Fixed.** Ignore startup logs and private audit working files. No logs were deleted. |
| Documentation | Missing third-party credit and security/release guidance | **Fixed.** Added inventory, collected upstream notices, this report and `SECURITY.md`. |

## Security cleanup follow-up — 2026-09-06

- React/React DOM/React Server DOM: 19.2.8; Vite: 8.0.16;
  Vinext: 1.0.0-beta.9; its RSC peer plugin: 0.5.34.
- `image-size` 2.0.3, although named as patched in advisory metadata, was not
  available from the registry during this pass. Vinext beta.9 removes that
  dependency, avoiding a private patch or advisory suppression.
- Narrow security overrides in `pnpm-workspace.yaml` select esbuild 0.28.2,
  ws 8.21.0, Undici 7.29.0, sharp 0.35.0 and fast-uri 3.1.6 while upstream parents
  lag behind. Revisit these overrides with future parent upgrades. pnpm 11 reads
  these settings from the workspace file, not `package.json`.
- Project-local pip is 26.2.1. Fresh npm and installed-Python advisory scans
  report **zero known vulnerabilities**, with no exclusions or skipped Python
  packages. This is a point-in-time result, not a security guarantee.
- Active inventory now contains **497 npm package/version pairs and 68 Python
  distributions**, with **397 distinct notice texts** and **28 package records
  lacking supplied notice files**. The generator now follows `pnpm list`'s active
  installed graph rather than counting obsolete packages retained in its store.
- Replaced the starter favicon with a new LC text monogram and removed three
  unused starter SVGs. They are recoverable in Git; history was not rewritten.
- COIN-OR's [INSTALL.Metis](https://github.com/coin-or-tools/ThirdParty-Metis/blob/stable/2.0/INSTALL.Metis)
  provides older author clarification about noncommercial use and reselling
  METIS. This narrows the question but does not establish redistribution terms
  for every exact bundled solver binary. Keep the installer gate open; seek
  version-specific terms, GPL compatibility and source/relinking instructions
  before bundling. No maintainer was contacted and no kernel was replaced.

Validation: the production build and **198 existing frontend tests**, **105
backend tests**, and **2 new dependency-compatibility tests** pass. The latter
exercise actual sharp PNG resizing through Miniflare and Drizzle's TypeScript
schema-to-SQL export through the upgraded esbuild, without writing a database.
`pnpm install --frozen-lockfile` succeeds and `pip check` reports no broken
requirements. An isolated loopback Vite server returned HTTP 200 for the CAD
page and replacement favicon; no user browser model was reloaded. Existing
chunk-size and test deprecation warnings remain. No public deployment occurred.
The temporary smoke-test server was stopped. Restart the normal LucasCad
launcher before relying on the patched server dependencies; existing user
servers were deliberately left running to avoid interrupting open models.
Gitleaks found no secrets in 13 reachable commits through `68dcb8d`, or in the
128-file release candidate. Personal paths and old starter assets in history
remain explicitly outside this cleanup's removal scope.

## Security boundaries

The intended application is loopback-only. The CAD API has no authentication,
resource quotas or hardened untrusted-model sandbox. The retained Sites auth helper
assumes a trusted gateway; it is not standalone authentication. An unauthenticated
CAD kernel or development server must not be exposed publicly. No externally
reachable deployment was created as part of this audit.

Source publication and binary distribution are different release decisions. This
repository does not track `node_modules`, `.venv` or dependency DLLs. Dependency
installation still pulls third-party code and must respect its licenses. Avoid
advertising a secure installer or universally permissive dependency stack.

## Provenance review limits

Reviewed dependency manifests/installed license metadata, available upstream
notices, import declarations, tracked-file inventory, Git author metadata, research
links, example construction/render scripts and starter SVG origins. No proprietary
SolidWorks/NX/Onshape SDK is declared. Workflow inspiration does not authorize
copying their code, artwork or tutorial text. No patent/trademark search, exhaustive
source-similarity analysis, training-data provenance analysis, or image-by-image
rights clearance was performed. Owner review of example models/images remains required.

## Reproduction

Original validation on the audited working tree: `pnpm test` passed **198 tests**, including
the production build; backend pytest passed **105 tests**, with one existing
Starlette/httpx deprecation warning. The revised PowerShell launcher parsed
without errors. Existing application servers and browser models were not restarted.
See the follow-up above for the patched dependency validation.

1. Install the locked project dependencies on the target platform; never copy a
   Windows environment to another OS. Record a fresh native-library inventory.
2. Run `node tools/release_audit.mjs` for installed metadata and retained texts.
3. Run Gitleaks against all reachable history and a clean release-file snapshot,
   with `--redact`; never publish an unredacted findings report.
4. Run `pnpm audit --json` and an isolated `pip-audit --path <project-site-packages>
   --format json --output <private-report>`.
5. Run `node tools/security_report.mjs <private-python-report>` to save package
   advisory evidence without embedding the local report path.
6. Run `pnpm test`, `pnpm run test:dependencies` and
   `.venv/Scripts/python.exe -m pytest backend -q` on Windows.
7. Resolve the remaining open release gates, preserve the selected GPLv3 license, then perform
   a new scan on the exact publication commit. Visibility change requires approval.

## References

- [Gitleaks](https://github.com/gitleaks/gitleaks)
- [GitHub dependency advisories](https://github.com/advisories)
- [pip-audit](https://github.com/pypa/pip-audit)
- [Open CASCADE license](https://dev.opencascade.org/doc/overview/html/occt_public_license.html)
- [CasADi documentation](https://web.casadi.org/docs/)
- [No license does not grant reuse rights](https://choosealicense.com/no-permission/)

See `THIRD_PARTY_NOTICES.md` for the precise redistribution cautions. Upstream
license text is preserved verbatim; the audit does not change upstream terms.
