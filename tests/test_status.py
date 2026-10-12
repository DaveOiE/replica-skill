import os
import tempfile
import unittest

from _load import load

status = load("tools", "status")

FEATS = [
    {"feature": "A", "area": "x", "priority": "must", "clone": "yes", "notes": "", "ceiling": "done", "milestone": "M1", "tag": "C"},
    {"feature": "B", "area": "x", "priority": "must", "clone": "yes", "notes": "", "ceiling": "mock", "milestone": "M1", "tag": "E"},
    {"feature": "C", "area": "y", "priority": "could", "clone": "partial", "notes": "", "ceiling": "stub", "milestone": "M2", "tag": "S"},
    {"feature": "D", "area": "y", "priority": "could", "clone": "partial", "notes": "", "ceiling": "setting only", "milestone": "M2", "tag": "S"},
    {"feature": "E", "area": "z", "priority": "must", "clone": "no", "notes": "", "ceiling": "done", "milestone": "M3", "tag": "C"},
    {"feature": "F", "area": "z", "priority": "could", "clone": "skip", "notes": "why", "ceiling": "done", "milestone": "M3", "tag": "C"},
]


class StatusTests(unittest.TestCase):
    def test_states(self):
        got = [status.state(f) for f in FEATS]
        self.assertEqual(got, ["done", "done (local mock)", "stubbed", "setting only", "not started", "skipped"])

    def test_milestone_states(self):
        by = lambda m: [f for f in FEATS if f["milestone"] == m]
        self.assertEqual(status.milestone_state(by("M1")), "done")
        self.assertEqual(status.milestone_state(by("M2")), "done")      # stubs finish a milestone
        self.assertEqual(status.milestone_state(by("M3")), "not started")  # skipped rows are not counted

    def test_render_has_every_feature_and_total(self):
        ms = [{"id": "M1", "name": "One", "size": "S", "planned_commits": "1"}]
        out = status.render(FEATS, ms, today="2026-01-01")
        for f in FEATS:
            self.assertIn("| %s |" % f["feature"], out)
        self.assertIn("**6**", out)

    def test_check_detects_stale_file(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "replica"))
            for name, text in (("features.csv", "feature,area,priority,original,clone,notes,tag,ceiling,milestone\nA,x,must,yes,yes,,C,done,M1\n"),
                               ("milestones.csv", "id,name,size,planned_commits\nM1,One,S,1\n")):
                open(os.path.join(d, "replica", name), "w").write(text)
            self.assertEqual(status.main(["--root", d]), 0)
            self.assertEqual(status.main(["--root", d, "--check"]), 0)
            open(os.path.join(d, "replica", "features.csv"), "a").write("B,x,must,yes,no,,C,done,M1\n")
            self.assertEqual(status.main(["--root", d, "--check"]), 1)



class TokensCssTests(unittest.TestCase):
    def test_css_has_every_color_and_no_hand_edits_note(self):
        tokens_css = load("tools", "tokens_css")
        tokens = {"color": {"bg": "#ffffff", "accent": "#0f766e"}, "font": {"sans": "x"},
                  "type": {"sm": {"size": 14, "line": 20, "weight": 400}}, "space": [0, 4],
                  "radius": {"sm": 6}, "shadow": {"card": "0 0 0 #000"}, "motion": {"fast": "1ms"}}
        out = tokens_css.css(tokens)
        for needle in ("--color-bg: #ffffff;", "--color-accent: #0f766e;", "--text-sm-size: 14px;",
                       "--space-1: 4px;", "--radius-sm: 6px;", "Do not edit by hand"):
            self.assertIn(needle, out)


if __name__ == "__main__":
    unittest.main()
