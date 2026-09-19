"""Run with: python -m unittest discover -s tests -p test_launcher.py -v."""
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from tools import launch_cad as cad


class LauncherTests(unittest.TestCase):
    def test_kernel_success_marker_survives_native_teardown_crash(self):
        result = subprocess.CompletedProcess([], -1073740940, cad.KERNEL_MARKER + '\n', '')
        with patch.object(cad.subprocess, 'run', return_value=result), patch('sys.stdout', new_callable=io.StringIO):
            cad.check_kernel('python')

    def test_import_failure_is_not_misclassified_as_teardown(self):
        result = subprocess.CompletedProcess([], 1, '', 'DLL load failed')
        with patch.object(cad.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(RuntimeError, 'DLL load failed'):
                cad.check_kernel('python')

    def test_marker_must_be_its_own_stdout_line(self):
        result = subprocess.CompletedProcess([], 1, '', 'failed to print LUCASCAD_KERNEL_OK')
        with patch.object(cad.subprocess, 'run', return_value=result):
            with self.assertRaises(RuntimeError):
                cad.check_kernel('python')

    def test_actionable_platform_errors(self):
        self.assertIn('VCRedist', cad.kernel_failure('DLL load failed', 'win32'))
        self.assertIn('apt-get install', cad.kernel_failure('libGL.so.1', 'linux'))
        self.assertIn('dnf install', cad.kernel_failure('libXrender.so', 'linux'))
        self.assertIn('traceback', cad.kernel_failure('Something else', 'darwin'))

    def test_waits_for_delayed_readiness(self):
        process = Mock(returncode=None)
        process.poll.return_value = None
        with patch.object(cad, 'ready', side_effect=[False, False, True]) as ready, patch.object(cad.time, 'sleep'):
            cad.wait_ready('url', 'api', [process])
        self.assertEqual(ready.call_count, 3)

    def test_dead_process_fails_immediately(self):
        process = Mock(returncode=12)
        process.poll.return_value = 12
        with patch.object(cad, 'ready') as ready:
            with self.assertRaisesRegex(RuntimeError, 'code 12'):
                cad.wait_ready('url', 'api', [process])
        ready.assert_not_called()

    def test_readiness_timeout(self):
        with self.assertRaisesRegex(RuntimeError, 'Timed out'):
            cad.wait_ready('url', 'web', [], timeout=0)

    def test_health_identity_not_just_http_200(self):
        response = Mock(status=200)
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        opener = Mock()
        opener.open.return_value = response
        with patch.object(cad.urllib.request, 'build_opener', return_value=opener):
            for payload, expected in [([], False), ({'status':'ok'}, False),
                                      ({'status':'ok','kernel':'Open CASCADE via CadQuery'}, True)]:
                response.read.return_value = json.dumps(payload).encode()
                self.assertEqual(cad.ready('url','api'), expected)
            response.read.return_value = b'<html>Another app</html>'
            self.assertFalse(cad.ready('url', 'web'))

    def test_hostname_falls_back_without_ipv4_loopback(self):
        with patch.object(cad.socket, 'getaddrinfo', side_effect=socket.gaierror):
            self.assertEqual(cad.ui_url(), cad.WEB_URL)
        with patch.object(cad.socket, 'getaddrinfo', return_value=[(0,0,0,'',('10.0.0.1',4310))]):
            self.assertEqual(cad.ui_url(), cad.WEB_URL)

    def test_browser_waits_for_both_services_and_cleanup_runs(self):
        events = []
        api, web = Mock(), Mock()
        api.poll.return_value = 1
        with patch.object(cad, 'assert_ports_free'), patch.object(cad, 'start', side_effect=[api,web]) as start, \
             patch.object(cad, 'wait_ready', side_effect=lambda url,kind,ps: events.append(kind)), \
             patch.object(cad.webbrowser, 'open', side_effect=lambda url: events.append('browser')), \
             patch.object(cad, 'stop_tree') as stop:
            with self.assertRaisesRegex(RuntimeError, 'service stopped'):
                cad.serve('python','node')
        self.assertEqual(events, ['api','web','browser'])
        self.assertIn('--hostname', start.call_args_list[1].args[0])
        self.assertNotIn('--host', start.call_args_list[1].args[0])
        self.assertEqual([c.args[0] for c in stop.call_args_list], [web,api])

    def test_backend_failure_never_starts_web_or_browser(self):
        process = Mock()
        with patch.object(cad, 'assert_ports_free'), patch.object(cad, 'start', return_value=process) as start, \
             patch.object(cad, 'wait_ready', side_effect=RuntimeError('kernel failed')), \
             patch.object(cad.webbrowser, 'open') as browser, patch.object(cad, 'stop_tree') as stop:
            with self.assertRaises(RuntimeError):
                cad.serve('python','node')
        self.assertEqual(start.call_count, 1)
        browser.assert_not_called()
        stop.assert_called_once_with(process)

    def test_web_failure_cleans_both_and_never_opens_browser(self):
        with patch.object(cad, 'assert_ports_free'), patch.object(cad, 'start', side_effect=[Mock(),Mock()]), \
             patch.object(cad, 'wait_ready', side_effect=[None,RuntimeError('web failed')]), \
             patch.object(cad.webbrowser, 'open') as browser, patch.object(cad, 'stop_tree') as stop:
            with self.assertRaises(RuntimeError):
                cad.serve('python','node')
        self.assertEqual(stop.call_count, 2)
        browser.assert_not_called()

    def test_reopen_does_not_install_or_own_running_servers(self):
        with patch.object(sys, 'argv', ['launch_cad']), patch.object(cad, 'ready', return_value=True), \
             patch.object(cad, 'bootstrap') as setup, patch.object(cad, 'serve') as serve, \
             patch.object(cad.webbrowser, 'open') as browser:
            self.assertEqual(cad.main(), 0)
        setup.assert_not_called()
        serve.assert_not_called()
        browser.assert_called_once()

    def test_no_open_reopening(self):
        with patch.object(sys, 'argv', ['launch_cad','--no-open']), patch.object(cad, 'ready', return_value=True), \
             patch.object(cad.webbrowser, 'open') as browser:
            self.assertEqual(cad.main(), 0)
        browser.assert_not_called()

    def test_stamp_tracks_install_policy_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / 'pnpm-workspace.yaml'
            file.write_text('allowBuilds: {}')
            first = cad.fingerprint([file])
            file.write_text('allowBuilds: {esbuild: true}')
            self.assertNotEqual(first, cad.fingerprint([file]))

    def test_existing_port_is_not_killed(self):
        listener = Mock()
        listener.__enter__ = Mock(return_value=listener)
        listener.__exit__ = Mock(return_value=False)
        listener.bind.side_effect = OSError('in use')
        with patch.object(cad.socket, 'socket', return_value=listener), patch.object(cad, 'stop_tree') as stop:
            with self.assertRaisesRegex(RuntimeError, 'No process was killed'):
                cad.assert_ports_free()
        stop.assert_not_called()

    @unittest.skipIf(os.name == 'nt', 'POSIX TIME_WAIT semantics')
    def test_port_probe_allows_time_wait_but_not_live_listeners(self):
        listener = Mock()
        listener.__enter__ = Mock(return_value=listener)
        listener.__exit__ = Mock(return_value=False)
        with patch.object(cad.socket, 'socket', return_value=listener):
            cad.assert_ports_free()
        listener.setsockopt.assert_called_with(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    def test_bootstrap_caches_success_and_reinstalls_changed_policy(self):
        with tempfile.TemporaryDirectory(prefix='LucasCad path with spaces ') as temp:
            root = Path(temp)
            python = root / ('.venv/Scripts/python.exe' if os.name == 'nt' else '.venv/bin/python')
            python.parent.mkdir(parents=True)
            python.write_bytes(b'interpreter')
            (root / '.venv/pyvenv.cfg').write_text('version = 3.12')
            (root / 'backend').mkdir()
            (root / 'backend/requirements.txt').write_text('cadquery==2.8.0')
            (root / 'package.json').write_text('{"packageManager":"pnpm@11.19.0"}')
            (root / 'pnpm-lock.yaml').write_text('lockfileVersion: 9.0')
            (root / 'pnpm-workspace.yaml').write_text('allowBuilds: {}')
            cli = root / 'node_modules/vinext/dist/cli.js'
            cli.parent.mkdir(parents=True)
            cli.touch()
            def run(command, **kwargs):
                return subprocess.CompletedProcess(command, 0, 'v24.19.0' if command[0] == 'node' else '11.19.0', '')
            with patch.object(cad, 'ROOT', root), patch.object(cad.shutil, 'which', side_effect=lambda name:name), \
                 patch.object(cad, 'run', side_effect=run) as execute, patch.object(cad, 'check_kernel') as probe:
                cad.bootstrap()
                probe.assert_called_once()
                execute.reset_mock()
                cad.bootstrap()
                self.assertFalse(any('install' in c.args[0] for c in execute.call_args_list))
                (root / 'pnpm-workspace.yaml').write_text('allowBuilds: {esbuild: true}')
                cad.bootstrap()
                installs = [c.args[0] for c in execute.call_args_list if 'install' in c.args[0]]
                self.assertEqual(installs, [['pnpm','install','--frozen-lockfile']])


class ProcessTreeTests(unittest.TestCase):
    def test_real_descendant_listener_stops_with_tree(self):
        # A child opening an ephemeral socket stands in for uvicorn/workerd.
        child = "import socket,time; s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(); print(s.getsockname()[1],flush=True); time.sleep(60)"
        root = f"import subprocess,sys,time; subprocess.Popen([sys.executable,'-u','-c',{child!r}]); time.sleep(60)"
        process = subprocess.Popen([sys.executable, '-u', '-c', root], stdout=subprocess.PIPE, text=True,
                                   start_new_session=os.name != 'nt')
        try:
            port = int(process.stdout.readline())
            cad.stop_tree(process)
            with socket.socket() as sock:
                self.assertNotEqual(sock.connect_ex(('127.0.0.1',port)), 0)
        finally:
            if process.poll() is None:
                cad.stop_tree(process)
            process.stdout.close()

    @unittest.skipUnless(os.name == 'nt', 'Windows job-object regression')
    def test_abrupt_windows_launcher_death_closes_descendants(self):
        child = "import socket,time; s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(); print(s.getsockname()[1],flush=True); time.sleep(60)"
        root = f"from tools.launch_cad import WindowsJob; import subprocess,sys,time; job=WindowsJob(); subprocess.Popen([sys.executable,'-u','-c',{child!r}]); time.sleep(60)"
        process = subprocess.Popen([sys.executable, '-u', '-c', root], cwd=cad.ROOT, stdout=subprocess.PIPE, text=True)
        try:
            port = int(process.stdout.readline())
            process.kill()  # Simulates closing the launcher without running finally.
            process.wait(timeout=5)
            for _ in range(30):
                with socket.socket() as sock:
                    if sock.connect_ex(('127.0.0.1',port)) != 0:
                        break
                time.sleep(.1)
            else:
                self.fail('Descendant listener survived launcher termination')
        finally:
            if process.poll() is None:
                cad.stop_tree(process)
            process.stdout.close()


if __name__ == '__main__':
    unittest.main()
