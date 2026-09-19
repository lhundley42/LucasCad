"""Shared, local-only bootstrap and supervised server lifecycle (stdlib only)."""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
API_URL = 'http://127.0.0.1:4311/api/health'
WEB_URL = 'http://127.0.0.1:4310/'
KERNEL_MARKER = 'LUCASCAD_KERNEL_OK'


def say(message):
    print(f'==> {message}', flush=True)


def run(command, **kwargs):
    # npm/pnpm are .cmd shims on Windows, not native executables.
    return subprocess.run([str(x) for x in command], cwd=ROOT,
                          shell=os.name == 'nt' and str(command[0]).endswith(('.cmd', '.bat')),
                          check=True, **kwargs)


def fingerprint(paths):
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def kernel_failure(output, platform=sys.platform):
    if platform == 'win32' and 'DLL load failed' in output:
        return ('CadQuery cannot load a native DLL. Install the Microsoft Visual C++ '
                'x64 Redistributable: winget install Microsoft.VCRedist.2015+.x64\n'
                'https://aka.ms/vc14/vc_redist.x64.exe\nIf already installed, repair it '
                'and check that Python and native packages have matching architectures.')
    if platform.startswith('linux') and any(x in output for x in ('libGL', 'libX', 'libSM', 'libICE')):
        return ('CadQuery requires native graphics loader libraries even without a display/GPU.\n'
                'Debian/Ubuntu: sudo apt-get install libgl1 libglx-mesa0 libxrender1 libxext6 libsm6 libice6\n'
                'Fedora/RHEL: sudo dnf install mesa-libGL libXrender libXext libSM libICE')
    return 'CadQuery could not load. Check the traceback above and backend/requirements.txt.'


def check_kernel(python):
    # Exercise the kernel, not just import it; flush before native DLL teardown.
    result = subprocess.run([str(python), '-c',
        "import cadquery as cq; s=cq.Workplane('XY').box(1,1,1).val(); "
        "assert s.isValid() and abs(s.Volume()-1)<1e-6; "
        f"print('{KERNEL_MARKER}', flush=True)"],
        capture_output=True, text=True, timeout=90)
    output = result.stdout + result.stderr
    if KERNEL_MARKER not in result.stdout.splitlines():
        raise RuntimeError(output + '\n' + kernel_failure(output))
    if result.returncode:
        say('Kernel geometry probe passed, but native interpreter teardown failed '
            f'({result.returncode}). The live HTTP readiness check remains required.')


def bootstrap(dev=False):
    if not (3, 11) <= sys.version_info < (3, 15):
        raise RuntimeError('Python 3.11-3.14 is required.')
    tooling = ROOT / '.tooling'
    tooling.mkdir(exist_ok=True)
    runtime = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies'
    if not shutil.which('node') and (runtime / 'node/bin').is_dir():
        os.environ['PATH'] = str(runtime / 'node/bin') + os.pathsep + os.environ.get('PATH', '')
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Install a security-patched Node.js >=22.13 from https://nodejs.org/.')
    version = run([node, '--version'], capture_output=True, text=True).stdout.strip().lstrip('v')
    if tuple(map(int, version.split('.')[:2])) < (22, 13):
        raise RuntimeError(f'Node {version} is too old; install Node >=22.13.')

    python = ROOT / ('.venv/Scripts/python.exe' if os.name == 'nt' else '.venv/bin/python')
    if not python.exists():
        say('Creating project-local Python environment')
        run([sys.executable, '-m', 'venv', ROOT / '.venv'])
    # Never destroy/recreate a user's existing virtualenv on a failed probe.
    run([python, '-c', 'import sys; assert (3,11) <= sys.version_info < (3,15), "Unsupported venv Python"'])
    requirements = ROOT / 'backend' / ('requirements-dev.txt' if dev else 'requirements.txt')
    inputs = [ROOT / 'backend/requirements.txt', python, ROOT / '.venv/pyvenv.cfg']
    if dev:
        inputs.append(requirements)
    stamp = tooling / ('python-dev.stamp' if dev else 'python.stamp')
    digest = fingerprint(inputs)
    if not stamp.exists() or stamp.read_text() != digest:
        say('Installing Python dependencies (first run downloads the geometry kernel)')
        run([python, '-m', 'pip', 'install', '--upgrade', 'pip>=26.2'])
        run([python, '-m', 'pip', 'install', '-r', requirements])
        check_kernel(python)
        stamp.write_text(digest)
        if dev:
            # requirements-dev includes requirements.txt; normal startup is ready too.
            (tooling / 'python.stamp').write_text(fingerprint(inputs[:3]))

    pin = json.loads((ROOT / 'package.json').read_text())['packageManager']
    wanted = pin.split('@', 1)[1]
    pnpm = shutil.which('pnpm')
    if pnpm:
        actual = run([pnpm, '--version'], capture_output=True, text=True).stdout.strip()
        if actual != wanted:
            pnpm = None
    if not pnpm:
        # Install locally, never change the user's global npm/corepack installation.
        private = tooling / f'pnpm-{wanted}'
        entry = private / 'node_modules/pnpm/bin/pnpm.cjs'
        if not entry.exists():
            npm = shutil.which('npm')
            if not npm:
                raise RuntimeError('npm was not found beside Node.js; reinstall Node or install pinned pnpm.')
            say(f'Installing {pin} locally')
            run([npm, 'install', '--prefix', private, '--no-audit', '--no-fund', pin])
        pnpm_command = [node, str(entry)]
        os.environ['PATH'] = str(private / 'node_modules/.bin') + os.pathsep + os.environ['PATH']
    else:
        pnpm_command = [pnpm]
    stamp = tooling / 'node.stamp'
    digest = fingerprint([ROOT / p for p in ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml')])
    if not (ROOT / 'node_modules/vinext/dist/cli.js').exists() or not stamp.exists() or stamp.read_text() != digest:
        say(f'Installing Node dependencies with {pin}')
        run([*pnpm_command, 'install', '--frozen-lockfile'], env={**os.environ, 'CI': 'true'})
        stamp.write_text(digest)
    return python, node


def ready(url, kind):
    try:
        # Loopback services must not be sent through a configured HTTP proxy.
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url, timeout=2) as response:
            body = response.read().decode('utf-8', errors='replace')
            if response.status != 200:
                return False
            if kind == 'api':
                payload = json.loads(body)
                return isinstance(payload, dict) and payload.get('status') == 'ok' and payload.get('kernel') == 'Open CASCADE via CadQuery'
            return 'LucasCad' in body
    except (OSError, ValueError):
        return False


def wait_ready(url, kind, processes, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for process in processes:
            if process.poll() is not None:
                raise RuntimeError(f'{kind} startup failed: server exited with code {process.returncode}. See output above.')
        if ready(url, kind):
            return
        time.sleep(.25)
    raise RuntimeError(f'Timed out waiting for {url}. See server output above.')


def ui_url():
    try:
        addresses = socket.getaddrinfo('lucascad.localhost', 4310, socket.AF_INET)
        if addresses and all(item[4][0] == '127.0.0.1' for item in addresses):
            return 'http://lucascad.localhost:4310/'
    except OSError:
        pass
    return WEB_URL


def assert_ports_free():
    for port in (4310, 4311):
        with socket.socket() as listener:
            if os.name == 'nt':
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            else:
                # Match uvicorn/Node: completed connections in TIME_WAIT do not
                # occupy a listening port and must not block an immediate restart.
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                listener.bind(('127.0.0.1', port))
            except OSError as error:
                raise RuntimeError(f'Port {port} is occupied, but a complete LucasCad instance is not ready. '
                                   'Stop the other launcher/application, then retry. No process was killed.') from error


class WindowsJob:
    """Kill descendants if this launcher dies, including console closure.

    The non-inheritable handle lives until process exit. Assigning the launcher
    before spawning avoids the child-spawn race of assigning children afterward.
    """
    def __init__(self):
        from ctypes import wintypes as w
        class Basic(ctypes.Structure):
            _fields_ = [('processTime', ctypes.c_int64), ('jobTime', ctypes.c_int64),
                        ('flags', w.DWORD), ('minWorking', ctypes.c_size_t), ('maxWorking', ctypes.c_size_t),
                        ('active', w.DWORD), ('affinity', ctypes.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ('readOps','writeOps','otherOps','readBytes','writeBytes','otherBytes')]
        class Extended(ctypes.Structure):
            _fields_ = [('basic', Basic), ('io', IO), ('processMemory', ctypes.c_size_t),
                        ('jobMemory', ctypes.c_size_t), ('peakProcess', ctypes.c_size_t), ('peakJob', ctypes.c_size_t)]
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
        kernel.CreateJobObjectW.restype = w.HANDLE
        kernel.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
        kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        kernel.GetCurrentProcess.restype = w.HANDLE
        self.handle = kernel.CreateJobObjectW(None, None)
        info = Extended()
        info.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.handle or not kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(info), ctypes.sizeof(info)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not kernel.AssignProcessToJobObject(self.handle, kernel.GetCurrentProcess()):
            raise ctypes.WinError(ctypes.get_last_error())


def start(command):
    return subprocess.Popen([str(x) for x in command], cwd=ROOT,
                            start_new_session=os.name != 'nt',
                            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)


def stop_tree(process):
    if os.name == 'nt':
        if process.poll() is None:
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
        # Orphaned descendants are also covered by WindowsJob when we exit.
    else:
        # A group can outlive its parent; do not skip cleanup if parent exited.
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(process.pid, sig)
            except ProcessLookupError:
                break
            if sig == signal.SIGTERM:
                time.sleep(.5)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def serve(python, node, no_open=False):
    assert_ports_free()
    processes = []
    try:
        say('Starting geometry service; waiting for Open CASCADE')
        processes.append(start([python, '-m', 'uvicorn', 'backend.server:app', '--host', '127.0.0.1',
                                '--port', '4311', '--reload', '--reload-dir', 'backend']))
        wait_ready(API_URL, 'api', processes)
        say('Geometry service ready; starting browser UI')
        processes.append(start([node, ROOT / 'node_modules/vinext/dist/cli.js', 'dev',
                                '--hostname', '127.0.0.1', '--port', '4310']))
        wait_ready(WEB_URL, 'web', processes)
        url = ui_url()
        say(f'LucasCad is ready at {url} - Ctrl+C stops both services')
        if not no_open:
            webbrowser.open(url)
        while all(process.poll() is None for process in processes):
            time.sleep(.4)
        raise RuntimeError('A LucasCad service stopped. Shutting down the other service; see output above.')
    finally:
        for process in reversed(processes):
            stop_tree(process)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--setup-only', action='store_true')
    parser.add_argument('--no-open', action='store_true')
    parser.add_argument('--dev', action='store_true', help='Also install backend test dependencies')
    args = parser.parse_args()
    def interrupt(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupt)
    if hasattr(signal, 'SIGBREAK'):
        signal.signal(signal.SIGBREAK, interrupt)
    try:
        # Never install dependencies or take ownership when reopening a live app.
        if not args.setup_only and ready(API_URL, 'api') and ready(WEB_URL, 'web'):
            say(f'LucasCad is already running at {ui_url()}')
            if not args.no_open:
                webbrowser.open(ui_url())
            return 0
        if not args.setup_only:
            assert_ports_free()
        job = WindowsJob() if os.name == 'nt' else None  # Keep handle until process exit.
        python, node = bootstrap(args.dev)
        if args.setup_only:
            say('Setup complete.')
        else:
            serve(python, node, args.no_open)
        return 0
    except KeyboardInterrupt:
        say('LucasCad stopped.')
        return 130
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'LucasCad: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
