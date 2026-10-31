"""Exercise the actual shell readiness block offline, without Docker or sleeping."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).parents[1] / "blackbox-dependency503.sh"


class Dependency503ReadinessTest(unittest.TestCase):
    def run_gate(self, scenario):
        source = SCRIPT.read_text()
        block = source[source.index("PG_READY=0\n"):source.index('docker exec "$PG" psql -U kestra')]
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            docker = base / "docker"
            docker.write_text('''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
p=Path(os.environ['GATE_TMP']);args=sys.argv[1:]
with (p/'commands').open('a')as f:f.write(json.dumps(args)+'\\n')
assert args[:2]==['exec','owned-test-pg']
assert '-h' in args and args[args.index('-h')+1]=='127.0.0.1'
assert '-d' in args and args[args.index('-d')+1]=='kestra'
scenario=os.environ['GATE_SCENARIO']
if args[2]=='pg_isready':
 sys.exit(1 if scenario=='tcp-never-ready' else 0)
assert args[2]=='psql' and args[-2:]==['-c','SELECT 1']
assert '-X' in args and 'ON_ERROR_STOP=1' in args
count=int((p/'queries').read_text())+1 if (p/'queries').exists() else 1
(p/'queries').write_text(str(count))
if scenario=='query-fails' or (scenario=='query-recovers' and count==1):sys.exit(2)
print('2' if scenario=='wrong-query-result' else '1')
''')
            docker.chmod(0o755)
            sleep = base / "sleep"
            sleep.write_text("#!/bin/sh\nexit 0\n")
            sleep.chmod(0o755)
            env = {**os.environ, "PATH": str(base) + os.pathsep + os.environ["PATH"],
                   "GATE_TMP": str(base), "GATE_SCENARIO": scenario}
            result = subprocess.run(["bash", "-c", 'set -euo pipefail\nPG=owned-test-pg\n' + block + '\nprintf "BUSINESS-SETUP-REACHED\\n"\n'],
                                    env=env, capture_output=True, text=True, timeout=10)
            import json
            commands = [json.loads(row) for row in (base / "commands").read_text().splitlines()]
            return result, commands

    def test_tcp_and_real_query_required_before_continuation(self):
        result, commands = self.run_gate("ready")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("BUSINESS-SETUP-REACHED", result.stdout)
        self.assertEqual([row[2] for row in commands], ["pg_isready", "psql"])

    def test_failed_query_is_retried_before_continuation(self):
        result, commands = self.run_gate("query-recovers")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sum(row[2] == "psql" for row in commands), 2)

    def test_socket_only_readiness_cannot_pass(self):
        result, commands = self.run_gate("tcp-never-ready")
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("BUSINESS-SETUP-REACHED", result.stdout)
        self.assertIn("timed out after 60 attempts", result.stderr)
        self.assertEqual(len(commands), 60)
        self.assertTrue(all(row[2] == "pg_isready" for row in commands))

    def test_query_failure_and_wrong_result_fail_closed_after_bound(self):
        for scenario in ["query-fails", "wrong-query-result"]:
            with self.subTest(scenario=scenario):
                result, commands = self.run_gate(scenario)
                self.assertEqual(result.returncode, 1)
                self.assertNotIn("BUSINESS-SETUP-REACHED", result.stdout)
                self.assertIn("timed out after 60 attempts", result.stderr)
                self.assertEqual(sum(row[2] == "psql" for row in commands), 60)
