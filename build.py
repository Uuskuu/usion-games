#!/usr/bin/env python3
"""Inline shared CSS/JS into each game -> dist/<game>/index.html (self-contained, Path B ready).
   --path-a : omit the SDK <script> tag (platform injects it for AI-Creator/S3 bundles)."""
import sys, pathlib, re
ROOT = pathlib.Path(__file__).parent
SRC, DIST = ROOT / 'src', ROOT / 'dist'
SDK_TAG = '<script src="https://usions.com/usion-sdk.js"></script>'
LF = chr(10)   # keep LF endings on Windows too, so dist/ doesn't churn
path_a = '--path-a' in sys.argv
css = (SRC / '_shared.css').read_text(encoding='utf-8')
js = (SRC / '_shared.js').read_text(encoding='utf-8')
built = []
# Hand illustrations for the practice course: drop 8 files in assets/ and they are inlined
# as data URIs, so the built page stays a single self-contained file. Missing files simply
# leave the drawn SVG fallback in place.
HAND_KEYS = ['l-index', 'l-middle', 'l-ring', 'l-pinky', 'r-index', 'r-middle', 'r-ring', 'r-pinky']
MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'}


def hand_images():
    import base64, json
    out, total = {}, 0
    for key in HAND_KEYS:
        for ext in ('.webp', '.png', '.jpg', '.jpeg', '.svg'):
            f = ROOT / 'assets' / ('hand-' + key + ext)
            if not f.exists():
                continue
            raw = f.read_bytes()
            total += len(raw)
            out[key] = 'data:' + MIME[ext] + ';base64,' + base64.b64encode(raw).decode()
            break
    if out:
        print(f'  hands: {len(out)}/8 inlined  {total // 1024} KB')
        if total > 900 * 1024:
            print('  WARNING: hand images are large - export them smaller (~300px wide, webp)')
    return json.dumps(out, ensure_ascii=False)


HANDS = hand_images()

for f in sorted(SRC.glob('*.html')):
    if f.name.startswith('_'): continue
    html = f.read_text(encoding='utf-8')
    html = html.replace('/*SHARED_CSS*/', css, 1).replace('/*SHARED_JS*/', js, 1)
    html = html.replace('/*HAND_IMAGES*/{}', HANDS, 1)   # placeholder keeps the source valid on its own
    html = html.replace('<!--SDK-->', '' if path_a else SDK_TAG, 1)
    assert 'SHARED_' not in html and '<!--SDK-->' not in html
    out = DIST / f.stem / 'index.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding='utf-8', newline=LF)
    built.append(html)
    print(f'{out.relative_to(ROOT)}  {len(html)//1024} KB')

# Single game -> the host root IS the game: no landing page, no extra tap before play.
root = DIST / 'index.html'
if len(built) == 1:
    root.write_text(built[0], encoding='utf-8', newline=LF)
    print(f'dist/index.html  {len(built[0])//1024} KB  (root = the game)')
elif root.exists() and '/*SHARED_' not in root.read_text(encoding='utf-8'):
    print('dist/index.html left as is (multiple games — write your own landing page)')
