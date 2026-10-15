#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
import subprocess

overlay = Path(__file__).resolve().parents[2]
work = overlay / '.work/evaluation-probe/repartition'
production = overlay / '.work/evaluation-probe/production'
replay = work / 'replay'
bundle = work / 'bundle'
target = 'fc8795285a3da8a05d0d740e7111425cd35a1dbb'
test_path = 'webserver/src/test/java/io/kestra/webserver/rbac/RbacExecutionActivationTest.java'

def git(directory, *arguments):
    return subprocess.check_output(['git', '-C', str(directory), *arguments])

expected = {}
for entry in git(production, 'ls-tree', '-r', '-z', target).split(b'\0'):
    if entry:
        metadata, filename = entry.split(b'\t', 1)
        expected[filename.decode()] = metadata.split()[2].decode()
actual = {}
for entry in git(replay, 'ls-tree', '-r', '-z', 'HEAD').split(b'\0'):
    if entry:
        metadata, filename = entry.split(b'\t', 1)
        actual[filename.decode()] = metadata.split()[2].decode()
proof = []
for filename in sorted(set(expected) | set(actual)):
    status = 'identical' if expected.get(filename) == actual.get(filename) else 'different'
    if filename == test_path:
        status = 'authorized-test-update'
        assert (replay / filename).read_bytes() == (production / filename).read_bytes()
    else:
        assert status == 'identical', filename
    proof.append({'path': filename, 'expected_blob': expected.get(filename), 'replay_blob': actual.get(filename), 'status': status})
(work / 'file-equivalence.json').write_text(json.dumps(proof, indent=2) + '\n')
assert (bundle / 'scripts/check-patches.sh').read_bytes() == (overlay / 'scripts/check-patches.sh').read_bytes()
verify = work / 'verify'
assert not verify.exists(), 'Do not reset an existing verification tree'
subprocess.run(['git', 'clone', '--no-hardlinks', str(replay), str(verify)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
subprocess.run(['git', '-C', str(verify), 'checkout', '--detach', '172dd0f3760fb1255d3b22bd1fd07ce31b173fa3'], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
result = subprocess.run(['bash', str(bundle / 'scripts/check-patches.sh'), '--apply-check', str(verify)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
(work / 'apply-check.log').write_text(result.stdout)
assert result.returncode == 0, result.stdout
files = git(replay, 'ls-files').decode().splitlines()
assert all((replay / filename).read_bytes() == (verify / filename).read_bytes() for filename in files)
counts = []
for patch in sorted((bundle / 'patches/webserver').glob('*.patch')):
    counts.append({'patch': patch.name, 'sha256': hashlib.sha256(patch.read_bytes()).hexdigest(),
                   'files': patch.read_text().count('diff --git ')})
(work / 'hashes.json').write_text(json.dumps(counts, indent=2) + '\n')
summary = {'target': target, 'replay_commit': git(replay, 'rev-parse', 'HEAD').decode().strip(),
           'files_compared': len(proof), 'identical_files': len(proof) - 1, 'authorized_test_update': test_path,
           'structure_and_apply_exit': result.returncode, 'checker_unchanged': True, 'verify_bytes_equal': True}
(work / 'verification-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
