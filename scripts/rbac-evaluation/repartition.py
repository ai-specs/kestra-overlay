#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

overlay = Path(__file__).resolve().parents[2]
work = overlay / '.work/evaluation-probe/repartition'
bundle = work / 'bundle'
production = overlay / '.work/evaluation-probe/production'
work.mkdir(parents=True, exist_ok=True)
for directory in ('scripts', 'patches/webserver'):
    (bundle / directory).mkdir(parents=True, exist_ok=True)
for filename in ('BASE', 'IMAGE_BASE'):
    (bundle / 'patches' / filename).write_bytes((overlay / 'patches' / filename).read_bytes())
(bundle / 'scripts/check-patches.sh').write_bytes((overlay / 'scripts/check-patches.sh').read_bytes())
patches = sorted(path for path in (overlay / 'patches/webserver').glob('*.patch') if path.name[:4] < '0330')
candidate = production / 'patches/0330-authorization-evaluation-lifecycle.patch'
for path in [*patches, candidate]:
    (bundle / 'patches/webserver' / path.name).write_bytes(path.read_bytes())
rows = (overlay / 'patches/manifest.tsv').read_text().splitlines()
rows = [row for row in rows if row.startswith('#') or not row or row.split('\t')[0] not in ('0340', '0350')]
(bundle / 'patches/manifest.tsv').write_text('\n'.join(rows) + '\n')
result = subprocess.run(['bash', str(bundle / 'scripts/check-patches.sh')], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
(work / 'initial-structure.log').write_text(result.stdout)
print(result.stdout)

if '--replay' not in sys.argv:
    sys.exit(0)

baseline = '172dd0f3760fb1255d3b22bd1fd07ce31b173fa3'
target = 'fc8795285a3da8a05d0d740e7111425cd35a1dbb'
original = work / 'original-history'
replay = work / 'replay'

def command(directory, *arguments, content=None):
    completed = subprocess.run(['git', '-C', str(directory), *arguments], input=content, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if completed.returncode:
        raise RuntimeError(completed.stderr.decode())
    return completed.stdout

def commit(directory, message):
    command(directory, 'add', '.')
    command(directory, '-c', 'user.name=Evaluation Probe', '-c', 'user.email=evaluation-probe@localhost', 'commit', '-m', message)
    return command(directory, 'rev-parse', 'HEAD').decode().strip()

resume = '--resume' in sys.argv
resume_id = next((argument.split('=', 1)[1] for argument in sys.argv if argument.startswith('--from=')), '0270')
if not resume and (original.exists() or replay.exists()):
    raise RuntimeError('Replay trees already exist; inspect before reuse, never reset automatically')
if not resume:
    command(work, 'clone', '--no-hardlinks', str(production), str(original))
    command(original, 'checkout', '--detach', baseline)
original_commits = {}
for path in patches:
    if resume:
        original_commits[path.name] = command(original, 'log', '--format=%H', '-1', '--grep=^' + path.name + '$').decode().strip()
    else:
        command(original, 'apply', '--check', str(path))
        command(original, 'apply', str(path))
        original_commits[path.name] = commit(original, path.name)
if not resume:
    command(work, 'clone', '--no-hardlinks', str(original), str(replay))
    command(replay, 'checkout', '--detach', baseline)

ownership = {
    '0170': ['webserver/src/main/java/io/kestra/mcp/McpToolService.java',
             'webserver/src/main/java/io/kestra/webserver/mcp/McpCapabilityGate.java'],
    '0230': ['webserver/src/main/java/io/kestra/webserver/controllers/api/ExecutionController.java',
             'webserver/src/main/java/io/kestra/webserver/rbac/RbacExecutionGate.java'],
    '0270': ['core/src/main/java/io/kestra/core/services/ChartDataService.java',
             'core/src/main/java/io/kestra/core/services/DashboardQueryAccessControl.java',
             'webserver/src/main/java/io/kestra/webserver/rbac/TypedDashboardGate.java'],
    '0280': ['core/src/main/java/io/kestra/core/repositories/AuthorizationInvocationContext.java',
             'webserver/src/main/java/io/kestra/webserver/rbac/TypedNamespaceAccessControl.java'],
}
test_path = 'webserver/src/test/java/io/kestra/webserver/rbac/RbacExecutionActivationTest.java'
changed = command(production, 'diff', '--name-only', target + '^', target).decode().splitlines()
allocated = {filename for filenames in ownership.values() for filename in filenames}
ownership['0330'] = [filename for filename in changed if filename not in allocated]
records = []
for path in patches:
    if resume and path.name[:4] < resume_id:
        current = command(replay, 'log', '--format=%H', '-1', '--grep=^' + path.name).decode().strip()
        count = len(command(replay, 'diff', '--name-only', current + '^', current).decode().splitlines())
        output = bundle / 'patches/webserver' / path.name
        header = path.read_bytes().split(b'diff --git ', 1)[0]
        if path.name[:4] in ownership:
            header += '# 演进理由: REQ-0330 沿用原需求授权激活点；避免后续补丁重复改写同一来源行。\n'.encode()
        output.write_bytes(header + command(replay, 'diff', '--full-index', current + '^', current))
        records.append({'patch': path.name, 'files': count, 'commit': current, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'evolved': path.name[:4] in ownership})
        continue
    previous = command(replay, 'rev-parse', 'HEAD').decode().strip()
    original_commit = original_commits[path.name]
    patch = command(original, 'diff', '--full-index', original_commit + '^', original_commit)
    if not (resume and path.name.startswith(resume_id)):
        command(replay, 'apply', '--3way', '-', content=patch)
    evolved = ownership.get(path.name[:4], [])
    if evolved and not (resume and path.name.startswith(resume_id) and '--evolution-applied' in sys.argv):
        evolution = command(production, 'diff', '--full-index', target + '^', target, '--', *evolved)
        command(replay, 'apply', '--3way', '-', content=evolution)
    if path.name.startswith('0230'):
        test_delta = command(production, 'diff', target, '--', test_path)
        command(replay, 'apply', '-', content=test_delta)
    current = commit(replay, path.name + (' lifecycle activation evolution' if evolved else ''))
    diff = command(replay, 'diff', '--full-index', previous, current)
    header = path.read_bytes().split(b'diff --git ', 1)[0]
    if evolved:
        header += '# 演进理由: REQ-0330 沿用本需求原授权激活点，加入完整评估边界或查询释放；避免后续补丁重复改写同一来源行。\n'.encode()
    count = len(command(replay, 'diff', '--name-only', previous, current).decode().splitlines())
    if evolved:
        header = re.sub(rb'(# \xe8\xa7\xa6\xe8\xbe\xbe\xe4\xb8\x8a\xe6\xb8\xb8\xe6\x96\x87\xe4\xbb\xb6: )\d+', lambda match: match[1] + str(count).encode(), header)
    output = bundle / 'patches/webserver' / path.name
    output.write_bytes(header + diff)
    records.append({'patch': path.name, 'files': count, 'commit': current, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'evolved': bool(evolved)})

previous = command(replay, 'rev-parse', 'HEAD').decode().strip()
delta = command(production, 'diff', '--full-index', target + '^', target, '--', *ownership['0330'])
command(replay, 'apply', '--3way', '-', content=delta)
current = commit(replay, 'REQ-0330 generic evaluation lifecycle and independent tests')
diff = command(replay, 'diff', '--full-index', previous, current)
header = candidate.read_bytes().split(b'diff --git ', 1)[0]
count = len(command(replay, 'diff', '--name-only', previous, current).decode().splitlines())
header = re.sub(rb'# \xe8\xa7\xa6\xe8\xbe\xbe\xe4\xb8\x8a\xe6\xb8\xb8\xe6\x96\x87\xe4\xbb\xb6: [^\n]*', '# 触达上游文件: {} 个（通用生命周期、typed gate、引用桥接与独立探针）'.format(count).encode(), header)
output = bundle / 'patches/webserver' / candidate.name
output.write_bytes(header + diff)
records.append({'patch': candidate.name, 'files': count, 'commit': current, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'evolved': True})
rows_by_name = {record['patch']: record for record in records}
updated = []
for row in rows:
    fields = row.split('\t')
    if len(fields) == 8 and fields[1] in rows_by_name:
        fields[5] = str(rows_by_name[fields[1]]['files'])
        row = '\t'.join(fields)
    updated.append(row)
(bundle / 'patches/manifest.tsv').write_text('\n'.join(updated) + '\n')
(work / 'patch-results.json').write_text(json.dumps(records, indent=2) + '\n')
result = subprocess.run(['bash', str(bundle / 'scripts/check-patches.sh')], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
(work / 'repartition-structure.log').write_text(result.stdout)
print(result.stdout)
