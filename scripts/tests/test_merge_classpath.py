import importlib.util
from pathlib import Path
import tempfile
import struct
from urllib.parse import urlsplit
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('merge', Path(__file__).parents[1] / 'merge-classpath.py')
merge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(merge)


class ClasspathTest(unittest.TestCase):
    def test_prefix_data_attributes_folding_and_idempotence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            exe, registry = root / 'kestra', root / 'extensions.tsv'
            prefix = b'#!/bin/sh\n# selfrun\n'
            exe.write_bytes(prefix)
            manifest = (b'Manifest-Version: 1.0\r\nMain-Class: Demo\r\n'
                        b'X-Original: caf\xc3\xa9\r\nClass-Path: old.jar\r\n  more.jar\r\n\r\n'
                        b'Name: data\r\nX-Named: untouched\r\n\r\n')
            with zipfile.ZipFile(exe, 'a') as archive:
                archive.comment = b'original comment'
                archive.writestr(merge.MANIFEST, manifest)
                archive.writestr('data', b'\x00original data\xff', compress_type=zipfile.ZIP_DEFLATED)
            exe.chmod(0o751)
            before = exe.read_bytes()
            registry.write_text('alpha\tclasspath\tnote\n' + 'long-name-' * 12 + '\tclasspath\tnote\nalpha\tclasspath\tduplicate\nignored\tplugin\tnote\n')
            merge.inject(exe, registry)
            after = exe.read_bytes()
            self.assertTrue(after.startswith(prefix))
            self.assertEqual(exe.stat().st_mode & 0o777, 0o751)
            with zipfile.ZipFile(exe) as archive:
                self.assertEqual(archive.comment, b'original comment')
                self.assertEqual(archive.namelist().count(merge.MANIFEST), 1)
                self.assertEqual(archive.read('data'), b'\x00original data\xff')
                info = archive.getinfo('data')
                name_size, extra_size = struct.unpack_from('<HH', before, info.header_offset + 26)
                stop = info.header_offset + 30 + name_size + extra_size + info.compress_size
                self.assertEqual(before[info.header_offset:stop], after[info.header_offset:stop])
                updated = archive.read(merge.MANIFEST)
                self.assertIn(b'X-Original: caf\xc3\xa9\r\n', updated)
                self.assertIn(b'Name: data\r\nX-Named: untouched\r\n', updated)
                self.assertIn(b'Class-Path: old.jar more.jar libs/alpha.jar', updated)
                self.assertTrue(all(len(line) <= 72 for line in updated.splitlines()))
            merge.inject(exe, registry)
            self.assertEqual(exe.read_bytes(), after)

    def test_empty_registry_and_invalid_name(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / 'registry'
            registry.write_text('# empty\n')
            self.assertEqual(merge.registry_paths(registry), [])
            registry.write_text('../escape\tclasspath\tnote\n')
            with self.assertRaises(ValueError):
                merge.registry_paths(registry)

    def test_missing_final_blank_line(self):
        for original in (
            b'Manifest-Version: 1.0\r\nMain-Class: Demo',
            b'Manifest-Version: 1.0\r\nMain-Class: Demo\r\n',
            b'Manifest-Version: 1.0\r\nClass-Path: old.jar\r\nX-Last: kept',
            b'Manifest-Version: 1.0\r\nClass-Path: old.jar',
        ):
            with self.subTest(original=original):
                result = merge.merge_manifest(original, ['libs/alpha.jar'])
                self.assertTrue(result.endswith(b'\r\n\r\n'))
                self.assertIn(b'libs/alpha.jar', result)
                self.assertEqual(merge.merge_manifest(result, ['libs/alpha.jar']), result)
                if b'X-Last' in original:
                    self.assertIn(b'X-Last: kept\r\n\r\n', result)

    def test_uri_contract_and_long_ascii_lines(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / 'registry'
            registry.write_text('safe-name_1.2\tclasspath\tnote\n' + 'x' * 180 + '\tclasspath\tnote\n')
            entries = merge.registry_paths(registry)
            for entry in entries:
                uri = urlsplit(entry)
                self.assertEqual((uri.scheme, uri.netloc, uri.query, uri.fragment), ('', '', '', ''))
                self.assertTrue(uri.path.startswith('libs/'))
            result = merge.merge_manifest(b'Manifest-Version: 1.0\r\nClass-Path: https://example.test/original.jar\r\n\r\n', entries)
            self.assertTrue(all(len(line) <= 72 for line in result.splitlines()))
            unfolded = result.replace(b'\r\n ', b'')
            self.assertIn(('Class-Path: https://example.test/original.jar ' + ' '.join(entries)).encode(), unfolded)
            for bad in ('space name', 'percent%20name', 'hash#name', 'query?name', 'colon:name', '/absolute', '../relative'):
                registry.write_text(bad + '\tclasspath\tnote\n')
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    merge.registry_paths(registry)

    def test_utf8_byte_folding(self):
        data = merge.merge_manifest(b'Manifest-Version: 1.0\n\n', ['libs/' + '\u00e9' * 100 + '.jar'])
        for line in data.splitlines():
            self.assertLessEqual(len(line), 72)
            line.decode('utf-8')


if __name__ == '__main__':
    unittest.main()
