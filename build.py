#!/usr/bin/env python3
"""Inline shared CSS/JS into each game -> dist/<game>/index.html (self-contained, Path B ready).
   --path-a : omit the SDK <script> tag (platform injects it for AI-Creator/S3 bundles)."""
import sys, pathlib, re
ROOT = pathlib.Path(__file__).parent
SRC, DIST = ROOT / 'src', ROOT / 'dist'
SDK_TAG = '<script src="https://usions.com/usion-sdk.js"></script>'
path_a = '--path-a' in sys.argv
css = (SRC / '_shared.css').read_text()
js = (SRC / '_shared.js').read_text()
for f in sorted(SRC.glob('*.html')):
    if f.name.startswith('_'): continue
    html = f.read_text()
    html = html.replace('/*SHARED_CSS*/', css, 1).replace('/*SHARED_JS*/', js, 1)
    html = html.replace('<!--SDK-->', '' if path_a else SDK_TAG, 1)
    assert 'SHARED_' not in html and '<!--SDK-->' not in html
    out = DIST / f.stem / 'index.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html)
    print(f'{out.relative_to(ROOT)}  {len(html)//1024} KB')
