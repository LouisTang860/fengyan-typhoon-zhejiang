#!/usr/bin/env python3
"""Assemble the static GitHub Pages artifact."""

from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "_site"
STATIC_FILES = ("index.html", "styles.css", "app.js", "favicon.svg")


def main() -> None:
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True)

    for filename in STATIC_FILES:
        shutil.copy2(ROOT / filename, OUTPUT / filename)

    data_source = ROOT / "data"
    if not data_source.is_dir():
        raise SystemExit("data/ is missing. Run scripts/fetch_typhoons.py first.")
    shutil.copytree(data_source, OUTPUT / "data")

    (OUTPUT / ".nojekyll").write_text("", encoding="utf-8")
    print(f"Built static site at {OUTPUT}")


if __name__ == "__main__":
    main()
