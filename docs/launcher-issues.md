# Startup issue review — September 18, 2026

Reviewed all nine open reports at <https://github.com/lhundley42/LucasCad/issues>,
including mvalancy's detailed reproductions and proposed `mac-linux-support`
branch linked from #1. The contributed branch was inspected, not blindly merged.
The fixes here use one shared standard-library Python supervisor with small
PowerShell/Bash entry points, preserving the existing Windows double-click route.

| Issue | Local change |
| --- | --- |
| [#1](https://github.com/lhundley42/LucasCad/issues/1) Setup / other operating systems | Create project-local venv and dependencies; exact pnpm pin with a local npm-installed fallback; Bash and Finder launchers; documented prerequisites. Installation stamps include dependency policy and requirements. |
| [#2](https://github.com/lhundley42/LucasCad/issues/2) Wrong web bind flag | Use `--hostname 127.0.0.1`; advertise the named URL only when it resolves to IPv4 loopback; Vite refuses silently switching ports. |
| [#3](https://github.com/lhundley42/LucasCad/issues/3) pnpm build approvals | Pin pnpm 11.19.0 and explicitly approve only esbuild, sharp, workerd install scripts. Retain all security overrides and frozen lockfile installs. |
| [#4](https://github.com/lhundley42/LucasCad/issues/4) Execution policy | Document the existing `.bat` as the primary Windows route and show the process-local bypass for PowerShell; no machine/user policy changes. |
| [#5](https://github.com/lhundley42/LucasCad/issues/5) Missing VC++ runtime | Explain the runtime prerequisite and diagnose native DLL import failures with install/repair guidance; never silently install OS packages. |
| [#6](https://github.com/lhundley42/LucasCad/issues/6) Missing Linux libGL | Detect native loader failures and print Debian/Ubuntu and Fedora/RHEL package commands. |
| [#7](https://github.com/lhundley42/LucasCad/issues/7) Readiness race | Poll identified API health, then web response; watch both processes for exit; open browser only after both are ready; fail with a bounded timeout. |
| [#8](https://github.com/lhundley42/LucasCad/issues/8) Leftover child processes | POSIX process-group cleanup and Windows kill-on-close job ownership; stop the sibling server if either exits. Reopening a healthy app does not take ownership or reinstall packages. Never kill unrelated port owners. |
| [#9](https://github.com/lhundley42/LucasCad/issues/9) Native teardown crash | Require a flushed marker after creating and validating a unit box; warn on nonzero teardown status, then require live HTTP readiness. **Mitigation only:** this does not repair CadQuery/OCP's native teardown bug. |

## Validation

- Windows: actual PowerShell setup and startup, IPv4 UI/API responses, safe reopen,
  two live start/stop/restart cycles, valid 10×20×30 box (6000 mm³), both ports
  released after abrupt launcher termination.
- Clean Debian Bookworm container, Node 24 / Python 3.11: reproduced the missing
  `libGL.so.1` error and checked the diagnostic; installed the documented packages;
  completed setup with no pre-existing venv, pnpm install, or node_modules.
  Two real start/stop/restart cycles then passed, including live box geometry,
  reuse and release of both ports. This caught and fixed a POSIX `TIME_WAIT`
  false-positive in port availability checks.
- Full frontend production build and 213 tests passed on Windows.
- All 108 backend tests passed on Windows and Linux. Existing upstream
  FastAPI/Starlette deprecation warnings remain.
- Dependency compatibility and source-release hygiene tests passed on Windows.
- Launcher unit tests cover delayed startup, timeouts, server failure, browser
  ordering, service identity, reuse, foreign port conflicts, install cache
  invalidation, native probe success/failure, and real descendant cleanup.
  Twenty tests are defined; nineteen pass per platform with one platform-specific
  test skipped (Windows job objects versus POSIX socket behavior).
- macOS entry points are provided, but **not validated on native macOS hardware**.
  Windows missing-DLL and native-teardown cases are simulated regression tests;
  no system runtime was uninstalled to reproduce them on this machine.

Run unit tests with `python -m unittest discover -s tests -p test_launcher.py -v`.
The optional `python tests/launcher_smoke.py` uses both CAD ports and starts real
services twice; stop any existing LucasCad session before running it. It opens no
browser and edits no saved model. Logs are in ignored `.tooling`.

No GitHub issues were commented on or closed by this local implementation.
