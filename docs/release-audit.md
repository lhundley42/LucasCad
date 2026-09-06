# LucasCad pre-publication audit — 2026-09-06

## Decision

**Audit complete with unresolved findings; not cleared as a clean public release
or bundled installer.** No repository visibility change, push, dependency upgrade,
credential rotation or Git history rewrite was performed by this audit.

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
- Installed Windows inventory: **505 unique npm package/version pairs and 68
  Python distributions**. Includes build/test/indirect packages, not just runtime.
  Generated notices preserve **385 distinct upstream license/notice texts**.
  31 package records lack installed notice files; this is explicitly not a
  statement that they lack licenses. Missing foreign-platform packages and embedded
  native libraries are not fully inventoried by package metadata alone.

## Findings and disposition

| Priority | Finding | Disposition |
| --- | --- | --- |
| High | npm audit: 26 advisories — 14 high, 9 moderate, 3 low; zero critical reported | **Open.** See `release/security-advisories.json`. Requires dependency compatibility/security update pass. |
| High | Local development dependencies include actual server components, not only offline build utilities | **Open.** Vite, React Server DOM, Undici, ws, sharp, image-size, fast-uri and esbuild need path-specific triage. `dev: true` does not make an advisory irrelevant. |
| Medium | Python advisory scan reports 7 entries (6 distinct IDs) for installed pip 25.0.1 | **Open.** Audit recommends supported patched pip, at least 26.2 for the listed fixes, before installing packages. No other installed Python distribution was flagged in this scan. |
| Release gate | No LucasCad project-level license | **Owner choice pending.** MIT recommended; GPLv3 offered as an alternative. No license grant will be inferred from public visibility. |
| Release gate | CasADi wheel includes conflicting-looking EPL-1.0 and legacy METIS 4 restrictive license notices | **Unresolved binary provenance.** Ask upstream which terms govern the exact compiled component. Do not bundle `.venv`/solver DLLs until resolved. Not a finding of infringement. |
| Release gate | LGPL/MPL/copyleft dependencies and incomplete native source/notice inventory | **Open for binary release.** Collected notice texts do not alone satisfy all corresponding-source/relinking requirements. |
| Release gate | Starter template/assets not independently traced to an exact revision/license; user `chalis.json` needs publication approval | **Owner/upstream review needed.** No claim that all repository content is independently authored or automatically MIT. |
| Privacy | Hard-coded personal Windows path in launcher | **Fixed in current source.** PATH lookup and a user-relative optional runtime fallback replace it. Historical copies remain. |
| Hygiene | Startup logs could be accidentally added | **Fixed.** Ignore startup logs and private audit working files. No logs were deleted. |
| Documentation | Missing third-party credit and security/release guidance | **Fixed.** Added inventory, collected upstream notices, this report and `SECURITY.md`. |

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

Validation on the audited working tree: `pnpm test` passed **198 tests**, including
the production build; backend pytest passed **105 tests**, with one existing
Starlette/httpx deprecation warning. The revised PowerShell launcher parsed
without errors. Existing application servers and browser models were not restarted.
These correctness tests do not resolve the dependency advisories.

1. Install the locked project dependencies on the target platform; never copy a
   Windows environment to another OS. Record a fresh native-library inventory.
2. Run `node tools/release_audit.mjs` for installed metadata and retained texts.
3. Run Gitleaks against all reachable history and a clean release-file snapshot,
   with `--redact`; never publish an unredacted findings report.
4. Run `pnpm audit --json` and an isolated `pip-audit --path <project-site-packages>
   --format json --output <private-report>`.
5. Run `node tools/security_report.mjs <private-python-report>` to save package
   advisory evidence without embedding the local report path.
6. Run `pnpm test` and `.venv/Scripts/python.exe -m pytest backend -q` on Windows.
7. Resolve the open release gates, obtain the owner's license choice, then perform
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
