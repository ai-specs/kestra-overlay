#!/usr/bin/env python3
"""Real executable smoke; copies input and never modifies development artifacts."""
import hashlib
import importlib.util
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import shutil
import zipfile

spec = importlib.util.spec_from_file_location('merge', Path(__file__).parents[1] / 'merge-classpath.py')
merge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(merge)


def snapshot(path, prefix_size=None):
    result = {}
    with zipfile.ZipFile(path) as archive, open(path, 'rb') as stream:
        first = min(info.header_offset for info in archive.infolist())
        prefix = stream.read(first if prefix_size is None else prefix_size)
        for info in archive.infolist():
            if info.filename == merge.MANIFEST:
                continue
            stream.seek(info.header_offset)
            header = stream.read(30)
            name_size, extra_size = struct.unpack_from('<HH', header, 26)
            raw = header + stream.read(name_size + extra_size + info.compress_size)
            result[info.filename] = hashlib.sha256(raw).hexdigest()
        return prefix, result, archive.comment


source, registry = map(Path, sys.argv[1:3])
with tempfile.TemporaryDirectory(prefix='kestra-classpath-smoke-') as directory:
    executable = Path(directory) / 'kestra'
    shutil.copy2(source, executable)
    executable.chmod(executable.stat().st_mode | 0o111)
    before = snapshot(executable)
    paths = merge.inject(executable, registry)
    assert snapshot(executable, len(before[0])) == before, 'prefix/local ZIP data/comment changed'
    digest = hashlib.sha256(executable.read_bytes()).hexdigest()
    merge.inject(executable, registry)
    assert hashlib.sha256(executable.read_bytes()).hexdigest() == digest
    with zipfile.ZipFile(executable) as archive:
        print(archive.read(merge.MANIFEST).decode(), flush=True)
    assert paths and all(not (executable.parent / entry).exists() for entry in paths)
    # Invoke selfrun itself, not java -jar: prefix and executable mode are exercised.
    run = subprocess.run(['bash', '-c', 'exec "$1" --help', 'smoke', str(executable)], capture_output=True, text=True, timeout=90)
    print(run.stdout)
    print(run.stderr, file=sys.stderr)
    assert run.returncode == 0, f'selfrun exit {run.returncode}'
    assert 'Usage:' in run.stdout
    assert 'ClassNotFoundException' not in run.stderr and 'NoClassDefFoundError' not in run.stderr
    print(f'PASS: real selfrun --help, {len(before[1])} unchanged raw ZIP entries; absent {paths}; idempotent')
