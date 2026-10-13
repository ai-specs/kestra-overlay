#!/usr/bin/env python3
"""Inject registry metadata into a selfrun ZIP; never read extension jar bodies."""
import argparse
import os
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

MANIFEST = 'META-INF/MANIFEST.MF'


def registry_paths(path):
    paths = []
    for number, line in enumerate(Path(path).read_text().splitlines(), 1):
        if not line.strip() or line.startswith('#'):
            continue
        columns = line.split('\t')
        if len(columns) < 2 or columns[1] not in ('classpath', 'plugin', 'standalone'):
            raise ValueError(f'invalid registry row {number}')
        name, slot = columns[:2]
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', name):
            raise ValueError(f'invalid extension name on row {number}')
        if slot == 'classpath':
            entry = f'libs/{name}.jar'
            if entry not in paths:
                paths.append(entry)
    return paths


def merge_manifest(data, entries):
    # Preserve all unrelated physical lines, including named sections.
    lines = data.splitlines(keepends=True)
    end = next((i for i, line in enumerate(lines) if not line.rstrip(b'\r\n')), len(lines))
    matches = [i for i in range(end) if lines[i].lower().startswith(b'class-path:')]
    if len(matches) > 1:
        raise ValueError('duplicate main Class-Path attributes')
    start = matches[0] if matches else end
    stop = start
    existing = []
    if matches:
        stop += 1
        value = lines[start].rstrip(b'\r\n').split(b':', 1)[1].lstrip(b' ')
        while stop < end and lines[stop].startswith(b' '):
            value += lines[stop].rstrip(b'\r\n')[1:]
            stop += 1
        existing = value.decode('utf-8').split()
    merged = list(dict.fromkeys(existing + entries))
    if not entries or merged == existing:
        return data
    value = ('Class-Path: ' + ' '.join(merged)).encode('utf-8')
    folded = []
    # Manifest limit is 72 bytes per physical line, excluding CRLF.
    while value:
        limit = 72 if not folded else 71
        cut = min(limit, len(value))
        while cut < len(value) and value[cut] & 0xC0 == 0x80:
            cut -= 1
        folded.append((b'' if not folded else b' ') + value[:cut] + b'\r\n')
        value = value[cut:]
    if start and not lines[start - 1].endswith(b'\n'):
        lines[start - 1] += b'\r\n'
    result = b''.join(lines[:start] + folded + lines[stop:])
    if end == len(lines):
        if not result.endswith(b'\n'):
            result += b'\r\n'
        result += b'\r\n'
    return result


def inject(executable, registry):
    executable = Path(executable)
    entries = registry_paths(registry)
    with zipfile.ZipFile(executable) as archive:
        infos = archive.infolist()
        manifests = [info for info in infos if info.filename == MANIFEST]
        if len(manifests) != 1:
            raise ValueError('expected exactly one manifest')
        info = manifests[0]
        original = archive.read(info)
        replacement = merge_manifest(original, entries)
    if replacement == original:
        return entries
    # Append mode keeps original local headers/compressed bytes/prefix untouched.
    # Remove the old manifest from the central directory before adding its replacement.
    fd, temporary = tempfile.mkstemp(prefix='.classpath-', dir=executable.parent)
    os.close(fd)
    try:
        shutil.copy2(executable, temporary)
        with zipfile.ZipFile(temporary, 'a') as archive:
            archive.filelist = [item for item in archive.filelist if item.filename != MANIFEST]
            del archive.NameToInfo[MANIFEST]
            archive.writestr(info, replacement)
        os.replace(temporary, executable)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return entries


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('executable')
    parser.add_argument('registry')
    args = parser.parse_args()
    paths = inject(args.executable, args.registry)
    print('Class-Path runtime mount contract: ' + (' '.join(paths) or '(none)'))
