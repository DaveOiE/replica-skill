import json
import os
import subprocess
import sys
import tempfile
import unittest

from _load import ROOT

SWEEP = os.path.join(ROOT, "replica-brand", "sweep.py")
CONFIG = os.path.join(ROOT, "replica", "brand.json")


def sweep(path):
    return subprocess.run([sys.executable, SWEEP, path, "--config", CONFIG],
                          capture_output=True, text=True)


class BrandGate(unittest.TestCase):
    def test_config_blocks_the_original_name_and_domain(self):
        cfg = json.load(open(CONFIG, encoding="utf-8"))
        self.assertTrue(cfg["avoid"], "avoid list must name the original product")
        self.assertTrue(cfg["domains"], "domains list must name the original's domain")
        self.assertTrue(cfg.get("name"), "chosen product name must be recorded")

    def test_repo_is_clean(self):
        r = sweep(ROOT)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_sweep_really_blocks_a_planted_name_and_identifier(self):
        cfg = json.load(open(CONFIG, encoding="utf-8"))
        name, domain = cfg["avoid"][0], cfg["domains"][0]
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "a.js"), "w").write("export const %sEmbed = 1;\n" % name)
            open(os.path.join(d, "b.html"), "w").write('<a href="https://%s/">x</a>\n' % domain)
            r = sweep(d)
            self.assertEqual(r.returncode, 1, r.stdout)
            self.assertIn("a.js", r.stdout)
            self.assertIn("b.html", r.stdout)


if __name__ == "__main__":
    unittest.main()
