#!/usr/bin/env python3
"""Run only the host-owned probe against an already extracted published executable jar."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
work = root / '.work/evaluation-probe'
jar = work / 'host.jar'
work.mkdir(parents=True, exist_ok=True)
if not jar.is_file():
    sys.exit('Extract the documented released /app/kestra into .work/evaluation-probe/host.jar first')
classes = work / 'classes'
classes.mkdir(exist_ok=True)
with jar.open('rb') as source:
    results = {'host_sha256': hashlib.file_digest(source, 'sha256').hexdigest()}
if results['host_sha256'] != 'bc4c8645de85a2fe2fa395af5d7b13067c236ef276a33476662f68da49732ec7':
    sys.exit('Host jar does not match the documented released input; investigate before reuse')
commands = [
    ('compile', ['javac', '-proc:none', '-cp', str(jar), '-d', str(classes), *[str(Path(__file__).with_name(name)) for name in ('EvaluationProbe.java', 'LifecycleModel.java', 'LifecycleFaultProbe.java')]]),
    ('reproduction', ['java', '-cp', os.pathsep.join((str(classes), str(jar))), 'EvaluationProbe']),
    ('coherence-expectation', ['java', '-cp', os.pathsep.join((str(classes), str(jar))), 'EvaluationProbe', '--require-coherent']),
    ('lifecycle-model', ['java', '-cp', os.pathsep.join((str(classes), str(jar))), 'LifecycleModel']),
    ('lifecycle-faults', ['java', '-cp', os.pathsep.join((str(classes), str(jar))), 'LifecycleFaultProbe']),
]
outputs = {}
for name, command in commands:
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    (work / f'{name}.log').write_text(result.stdout)
    results[name] = {'command': command, 'exit_code': result.returncode}
    outputs[name] = result.stdout
    print(f'{name}: exit={result.returncode}, log={work / (name + ".log")}')
    if name == 'compile' and result.returncode:
        break
(work / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
failure_verified = 'SECURITY EXPECTATION FAILED: complete evaluation combined incompatible policy revisions' in outputs.get('coherence-expectation', '')
faults_verified = 'FAULT MODEL PASS cases=12' in outputs.get('lifecycle-faults', '')
sys.exit(0 if results.get('compile', {}).get('exit_code') == 0 and results.get('reproduction', {}).get('exit_code') == 0 and results.get('coherence-expectation', {}).get('exit_code') == 1 and failure_verified and results.get('lifecycle-model', {}).get('exit_code') == 0 and results.get('lifecycle-faults', {}).get('exit_code') == 0 and faults_verified else 1)
