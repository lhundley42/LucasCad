# Security and supported use

LucasCad is experimental, locally hosted CAD software. It is not currently
cleared for public-network hosting or untrusted multi-user access.

- Bind both services to `127.0.0.1`; do not expose ports 4310/4311 to the Internet.
- The geometry API has no user authentication, request quotas or sandbox for
  expensive models. CORS is not authentication. Treat model JSON as untrusted input.
- The retained Sites authentication helper trusts gateway-provided headers; it
  must not be treated as standalone authentication behind an arbitrary proxy.
- Avoid untrusted projects and downloads. Keep your browser, Node and Python
  environment current. Back up models before testing development builds.
- Do not commit credentials, local environment files or startup logs. A source
  archive must omit `.git`, `.venv`, `node_modules` and local runtime output.
- The 2026-09-06 dependency scans reported zero known advisories after patching;
  rerun them before releases. Licensing and publication gates remain open: see
  [release audit](docs/release-audit.md) and [provenance decisions](docs/release/provenance.md).

## Reporting

Do not post credentials or exploitable details in a public issue. Contact the
repository owner privately to arrange a reporting channel. GitHub private
vulnerability reporting has not been enabled or verified by this local audit.

## Repeatable checks

Run the project test suite and dependency scans before each release:

```
pnpm test
pnpm run test:dependencies
pnpm run test:release
pnpm audit --json
python -m pytest backend -q
gitleaks git . --log-opts="--all --full-history" --redact --no-banner
```

Use an isolated installation of `pip-audit` to scan the project's Python
site-packages. Also scan a clean snapshot of all files intended for the release,
including untracked files, with `gitleaks dir <snapshot> --redact --no-banner`.
No scanner can prove the absence of secrets or vulnerabilities. Never suppress
findings just to obtain a passing release check.
