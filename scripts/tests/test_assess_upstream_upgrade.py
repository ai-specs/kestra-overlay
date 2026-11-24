"""Real local Git fixtures; no network, containers or external projects."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('assessment', Path(__file__).parents[1] / 'assess-upstream-upgrade.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class AssessmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'source'; self.source.mkdir()
        self.overlay = self.root / 'overlay'
        (self.overlay / 'patches/webserver').mkdir(parents=True)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        (self.source / 'original name.txt').write_text('old\n')
        (self.source / 'deleted.txt').write_text('delete\n')
        self.commit('base')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.git('tag', '-a', 'v1', '-m', 'annotated base')
        (self.overlay / 'patches/BASE').write_text('v1\n' + self.base + '\n')
        (self.overlay / 'patches/manifest.tsv').write_text('')
        self.output = self.root / 'report'

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.source), *args], stderr=subprocess.PIPE).decode()

    def commit(self, message):
        self.git('add', '-A'); self.git('commit', '-qm', message)

    def patch(self, name, content):
        (self.overlay / 'patches/webserver' / name).write_text(content)
        with (self.overlay / 'patches/manifest.tsv').open('a') as out:
            out.write(name[:4] + '\t' + name + '\tcore\n')

    def add_patch(self, name, path='new.txt', value='new'):
        self.patch(name, f'diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1 @@\n+{value}\n')

    def run_assessment(self, target='HEAD', expected=None):
        return MODULE.assess(self.overlay, self.source, target, self.output, expected)

    def test_annotated_target_rename_delete_and_complete_inventory(self):
        self.git('mv', 'original name.txt', 'renamed\tname.txt')
        (self.source / 'deleted.txt').unlink()
        for i in range(522):
            (self.source / f'added-{i}.txt').write_text(str(i))
        self.commit('target'); self.git('tag', '-a', 'arbitrary-release', '-m', 'target')
        report = self.run_assessment('refs/tags/arbitrary-release', self.git('rev-parse', 'HEAD').strip())
        self.assertEqual(report['upstream_change_count'], 524)
        rename = next(c for c in report['upstream_changes'] if c['status'].startswith('R'))
        self.assertEqual(rename['new_path'], 'renamed\tname.txt')
        self.assertTrue(any(c['status'] == 'D' for c in report['upstream_changes']))
        self.assertEqual(report['semantic_validation'], 'NOT_VERIFIED')
        self.assertEqual(json.loads((self.output / 'assessment.json').read_text()), report)

    def test_collision_stops_successors(self):
        self.add_patch('0001-add.patch', 'deleted.txt')
        self.add_patch('0002-independent.patch')
        report = self.run_assessment()
        self.assertEqual([p['replay'] for p in report['patches']], ['failed', 'blocked'])
        self.assertIn('already exists', report['patches'][0]['diagnostics'])
        self.assertFalse((self.source / 'new.txt').exists())
        self.assertEqual(self.git('status', '--porcelain'), '')

    def test_ordered_dependency_and_hash(self):
        self.add_patch('0001-add.patch')
        self.patch('0002-change.patch', 'diff --git a/new.txt b/new.txt\n--- a/new.txt\n+++ b/new.txt\n@@ -1 +1 @@\n-new\n+changed\n')
        report = self.run_assessment()
        self.assertTrue(report['replay_complete'])
        self.assertTrue(report['patches'][1]['dependency_risk'])
        self.assertEqual(len(report['patches'][0]['sha256']), 64)
        self.assertEqual(report['patches'][1]['semantic_validation'], 'NOT_VERIFIED')

    def test_dirty_source(self):
        (self.source / 'untracked').write_text('keep')
        with self.assertRaisesRegex(MODULE.AssessmentError, 'dirty'):
            self.run_assessment()
        self.assertFalse(self.output.exists())
        self.assertEqual((self.source / 'untracked').read_text(), 'keep')

    def test_tracked_dirty_source_preserved(self):
        path = self.source / 'deleted.txt'
        path.write_text('local change\n')
        with self.assertRaisesRegex(MODULE.AssessmentError, 'dirty'):
            self.run_assessment()
        self.assertEqual(path.read_text(), 'local change\n')

    def test_successful_prefix_then_failure_blocks_independent_patch(self):
        self.add_patch('0001-success.patch')
        self.add_patch('0002-collision.patch', 'deleted.txt')
        self.add_patch('0003-independent.patch', 'other.txt')
        report = self.run_assessment()
        self.assertEqual([p['replay'] for p in report['patches']], ['applied', 'failed', 'blocked'])
        self.assertEqual(report['patches'][2]['blocked_by'], 'patches/webserver/0002-collision.patch')

    def test_real_shallow_bare_source(self):
        (self.source / 'next').write_text('next'); self.commit('next')
        self.git('tag', '-a', 'v-next', '-m', 'next')
        shallow = self.root / 'shallow.git'
        subprocess.run(['git', 'clone', '--bare', '--depth=1', '--branch', 'v-next',
                        self.source.as_uri(), str(shallow)], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(shallow), 'fetch', '--depth=1',
                        self.source.as_uri(), 'refs/tags/v1:refs/tags/v1'], check=True, capture_output=True)
        self.assertEqual(subprocess.check_output(['git', '-C', str(shallow),
                         'rev-parse', '--is-shallow-repository']).strip(), b'true')
        self.add_patch('0001-add.patch')
        report = MODULE.assess(self.overlay, shallow, 'refs/tags/v-next', self.output)
        self.assertTrue(report['replay_complete'])
        self.assertNotEqual(report['target_object'], report['target_commit'])

    def test_missing_object(self):
        with self.assertRaises(MODULE.AssessmentError):
            self.run_assessment('f' * 40)
        self.assertFalse(self.output.exists())

    def test_base_tag_mismatch(self):
        (self.overlay / 'patches/BASE').write_text('v1\n' + 'f' * 40 + '\n')
        with self.assertRaisesRegex(MODULE.AssessmentError, 'mismatch'):
            self.run_assessment()

    def test_target_commit_mismatch(self):
        (self.source / 'next').write_text('next'); self.commit('next')
        with self.assertRaisesRegex(MODULE.AssessmentError, 'mismatch'):
            self.run_assessment('HEAD', self.base)

    def test_exclusive_output_preserved(self):
        self.output.mkdir(); (self.output / 'keep').write_text('keep')
        with self.assertRaisesRegex(MODULE.AssessmentError, 'must not exist'):
            self.run_assessment()
        self.assertEqual((self.output / 'keep').read_text(), 'keep')

    def test_manifest_mismatch(self):
        self.add_patch('0001-add.patch')
        (self.overlay / 'patches/manifest.tsv').write_text('')
        with self.assertRaisesRegex(MODULE.AssessmentError, 'manifest'):
            self.run_assessment()

    def test_overlap_delete_and_risk_categories(self):
        self.patch('0001-delete.patch', 'diff --git a/deleted.txt b/deleted.txt\n--- a/deleted.txt\n+++ b/deleted.txt\n@@ -1 +1 @@\n-delete\n+changed\n')
        (self.source / 'deleted.txt').unlink(); self.commit('delete')
        report = self.run_assessment()
        self.assertEqual(report['patches'][0]['upstream_overlap'], ['deleted.txt'])
        self.assertEqual(report['patches'][0]['replay'], 'failed')
        r = MODULE.risks(['db/migrations/V1.sql', 'webserver/build.gradle', 'core/models/Foo.java', 'ui/tests/a.js'])
        self.assertTrue(all(r.values()))

    def test_output_inside_source_rejected(self):
        self.output = self.source / 'report'
        with self.assertRaisesRegex(MODULE.AssessmentError, 'outside'):
            self.run_assessment()


if __name__ == '__main__':
    unittest.main()
