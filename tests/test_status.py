import os
import tempfile
import unittest

from _load import load

status = load("tools", "status")

FEATS = [
    {"feature": "A", "area": "x", "priority": "must", "clone": "yes", "notes": "", "ceiling": "done", "milestone": "M1", "tag": "C", "effort": "3"},
    {"feature": "B", "area": "x", "priority": "must", "clone": "yes", "notes": "", "ceiling": "mock", "milestone": "M1", "tag": "E", "effort": "5"},
    {"feature": "C", "area": "y", "priority": "could", "clone": "partial", "notes": "", "ceiling": "stub", "milestone": "M2", "tag": "S", "effort": "2"},
    {"feature": "D", "area": "y", "priority": "could", "clone": "partial", "notes": "", "ceiling": "setting only", "milestone": "M2", "tag": "S", "effort": "1"},
    {"feature": "E", "area": "z", "priority": "must", "clone": "no", "notes": "", "ceiling": "done", "milestone": "M3", "tag": "C", "effort": "8"},
    {"feature": "F", "area": "z", "priority": "could", "clone": "skip", "notes": "why", "ceiling": "done", "milestone": "M3", "tag": "C", "effort": "0"},
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

    def test_demo_scope_totals(self):
        ms = [{"id": "M1", "name": "One", "size": "S", "planned_commits": "1"}]
        out = status.render(FEATS, ms, today="2026-01-01")
        # built = A 3 + B 5 + C 2 + D 1 = 11 of 19 demo points (E is 8; F is skipped at 0)
        self.assertIn("**11 of 19 points built (58%)**", out)
        self.assertNotIn("%%", out)

    def test_deferred_work_is_later_not_skipped_and_never_remaining(self):
        later = dict(FEATS[4], scope="later")
        self.assertEqual(status.state(later), "later (deferred)")
        self.assertEqual(status.remaining(later), 0)
        self.assertEqual(status.remaining(FEATS[4]), 8)               # demo, not started
        self.assertEqual(status.remaining(dict(FEATS[0], clone="partial")), 0)  # partial rest lives in later screens
        self.assertEqual(status.milestone_state([later]), "later")

    def test_milestone_with_a_partial_row_says_so(self):
        done = dict(FEATS[0]); part = dict(FEATS[0], clone="partial", ceiling="done")
        self.assertEqual(status.milestone_state([done, part]), "done, 1 partial")

    def test_stop_line_fit_uses_the_rate_in_order(self):
        feats = [dict(FEATS[4], milestone="M1", effort="10"), dict(FEATS[4], milestone="M2", effort="5"), dict(FEATS[4], milestone="M3", effort="3")]
        ms = [{"id": m, "name": m, "size": "S", "planned_commits": "1", "scope": "demo"} for m in ("M1", "M2", "M3")]
        out = status.render(feats, ms, today="d", budget={"used_percent": 20.0, "rate_percent_per_point": 1.0, "stop_line_percent": 36.0})
        self.assertIn("| M1 | M1 | demo | 10 | 10 | 0 | not started | 10.0% | 30.0% |", out)
        self.assertIn("| M2 | M2 | demo | 5 | 5 | 0 | not started | 5.0% | 35.0% |", out)
        self.assertIn("| M3 | M3 | demo | 3 | 3 | 0 | not started | 3.0% | 38.0% |", out)
        self.assertIn("Fits inside the 36% stop line at this rate: M1, M2.", out)   # M3 would end at 38%
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
