#!/usr/bin/env python3
"""Generate tokens.css (CSS custom properties) from replica/design/tokens.json.

    python3 tools/tokens_css.py [tokens.json] [out.css]

Components use var(--color-text) and friends, never raw hex. Standard library only.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def css(tokens):
    lines = [":root {"]
    for name, value in tokens["color"].items():
        lines.append("  --color-%s: %s;" % (name, value))
    for name, value in tokens["font"].items():
        lines.append("  --font-%s: %s;" % (name, value))
    for name, t in tokens["type"].items():
        lines.append("  --text-%s-size: %dpx;" % (name, t["size"]))
        lines.append("  --text-%s-line: %dpx;" % (name, t["line"]))
        lines.append("  --text-%s-weight: %d;" % (name, t["weight"]))
    for i, value in enumerate(tokens["space"]):
        lines.append("  --space-%d: %dpx;" % (i, value))
    for name, value in tokens["radius"].items():
        lines.append("  --radius-%s: %dpx;" % (name, value))
    for name, value in tokens["shadow"].items():
        lines.append("  --shadow-%s: %s;" % (name, value))
    for name, value in tokens["motion"].items():
        lines.append("  --motion-%s: %s;" % (name, value))
    for name, value in tokens.get("layout", {}).items():
        lines.append("  --layout-%s: %dpx;" % (name, value))
    lines.append("}")
    return "/* Generated from tokens.json by tools/tokens_css.py. Do not edit by hand. */\n" + "\n".join(lines) + "\n"


def main(argv):
    src = argv[1] if len(argv) > 1 else os.path.join(ROOT, "replica", "design", "tokens.json")
    out = argv[2] if len(argv) > 2 else os.path.join(os.path.dirname(src), "tokens.css")
    with open(src, encoding="utf-8") as fh:
        text = css(json.load(fh))
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
