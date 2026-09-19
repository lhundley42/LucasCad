"""Opt-in live startup/restart test; requires installed dependencies and free CAD ports.

Run from the project root: .venv/Scripts/python.exe tests/launcher_smoke.py
Linux/macOS: .venv/bin/python tests/launcher_smoke.py
No browser or user's saved models are touched. Logs stay in ignored .tooling.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools import launch_cad as cad


def main():
    cad.assert_ports_free()
    (cad.ROOT / '.tooling').mkdir(exist_ok=True)
    for cycle in range(2):
        log_path = cad.ROOT / '.tooling' / f'launcher-smoke-{cycle}.log'
        with log_path.open('w') as log:
            # Bypass Windows' venv redirector so terminate() targets the actual launcher.
            interpreter = getattr(sys, '_base_executable', sys.executable) if os.name == 'nt' else sys.executable
            process = subprocess.Popen([interpreter, str(cad.ROOT / 'tools/launch_cad.py'), '--no-open'],
                                       cwd=cad.ROOT, stdout=log, stderr=subprocess.STDOUT)
            try:
                cad.wait_ready(cad.API_URL, 'api', [process], timeout=180)
                cad.wait_ready(cad.WEB_URL, 'web', [process], timeout=180)
                with urllib.request.urlopen('http://127.0.0.1:4311/api/box?length=10&width=20&height=30') as response:
                    box = json.load(response)
                assert box['properties']['valid'], box.keys()
                assert abs(box['properties']['volume'] - 6000) < .001
                # Reopening must leave this launcher's services alone.
                subprocess.run([interpreter, str(cad.ROOT / 'tools/launch_cad.py'), '--no-open'],
                               cwd=cad.ROOT, check=True, timeout=20)
            finally:
                process.terminate()  # SIGTERM on POSIX; abrupt termination/job cleanup on Windows.
                process.wait(timeout=20)
                for _ in range(40):
                    try:
                        cad.assert_ports_free()
                        break
                    except RuntimeError:
                        time.sleep(.25)
                else:
                    raise AssertionError(f'Ports survived launcher shutdown. Log: {log_path}')
        print(f'PASS cycle {cycle+1}: web/API ready, 6000 mm3 box, reuse, shutdown, ports released', flush=True)


if __name__ == '__main__':
    main()
