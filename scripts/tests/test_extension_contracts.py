"""Ensure overlay delivery cannot consume another project's jar bytes."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile
import unittest

class ExtensionContractsTest(unittest.TestCase):
    def test_external_artifacts_are_never_staged_and_leftovers_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, work = root / 'overlay', root / 'work'
            (repo / 'scripts').mkdir(parents=True)
            work.mkdir()
            script = repo / 'scripts/build-extensions.sh'
            shutil.copy2(Path(__file__).parents[1] / 'build-extensions.sh', script)
            (repo / 'extensions.tsv').write_text('fixture\tplugin\tfixture\nauth\tclasspath\tfixture\n')
            artifact = repo / 'extensions/fixture/build/libs/fixture.jar'
            artifact.parent.mkdir(parents=True)
            artifact.write_bytes(b'not an image build input')
            env = dict(os.environ, EXT_JAR_FIXTURE=str(artifact))
            subprocess.run(['bash', str(script), str(work)], env=env, check=True, capture_output=True)
            self.assertEqual([], list((work / 'plugins').glob('*.jar')))
            entries = json.loads((work / '.overlay-extensions.json').read_text())['injected']
            self.assertEqual({'plugin-runtime-mount', 'classpath-runtime-mount'}, {entry['role'] for entry in entries})
            (work / 'plugins/leftover.jar').write_bytes(b'leftover')
            result = subprocess.run(['bash', str(script), str(work)], capture_output=True, text=True)
            self.assertNotEqual(0, result.returncode)
            self.assertIn('must not be present', result.stderr)
