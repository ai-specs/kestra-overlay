import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("browser_apt", Path(__file__).parents[1] / "prepare-browser-apt.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BrowserAptTest(unittest.TestCase):
    def test_preserves_suites_components_and_signature(self):
        for uri in ("mirror+file:/etc/apt/apt-mirrors.txt", "http://azure.archive.ubuntu.com/ubuntu/"):
            original = f"Types: deb\nURIs: {uri}\nSuites: noble noble-updates noble-backports\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n"
            actual = module.official_sources(original)
            self.assertEqual(actual, original.replace(uri, "https://archive.ubuntu.com/ubuntu"))

    def test_security_uses_security_archive_and_is_idempotent(self):
        original = "Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble-security\nSigned-By: /keyring\n"
        actual = module.official_sources(original)
        self.assertIn("URIs: https://security.ubuntu.com/ubuntu", actual)
        self.assertEqual(actual, module.official_sources(actual))

    def test_other_sources_remain_unchanged(self):
        for uri in ("https://packages.microsoft.com/ubuntu/24.04/prod", "https://archive.ubuntu.com/ubuntu", "https://custom.example/ubuntu"):
            original = f"URIs: {uri}\nSuites: noble\nSigned-By: /keyring\n"
            self.assertEqual(original, module.official_sources(original))

    def test_separate_security_mirror_list(self):
        original = "URIs: mirror+file:/etc/apt/apt-mirrors-security.txt\nSuites: noble-security\nSigned-By: /keyring\n"
        self.assertEqual(module.official_sources(original), original.replace("mirror+file:/etc/apt/apt-mirrors-security.txt", "https://security.ubuntu.com/ubuntu"))

    def test_unrecognized_mirror_format_fails_closed(self):
        for uri in ("mirror+file:/etc/apt/another-list.txt", "http://azure.archive.ubuntu.com/ubuntu https://archive.ubuntu.com/ubuntu"):
            with self.assertRaises(ValueError):
                module.official_sources(f"URIs: {uri}\nSuites: noble\nSigned-By: /keyring\n")
