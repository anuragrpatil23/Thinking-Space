#!/usr/bin/env python3
"""Compare the engine's screenshots with the reference page's, image by image.

  python3 scripts/model-diagram-diff.py [dir]

Reads engine-<theme>-<nn>.png and ref-<theme>-<nn>.png written by
model-diagram-check.mjs, prints for each pair the share of pixels that differ,
and writes pair-<theme>-<nn>.png: reference on the left, engine on the right,
and the differing pixels marked underneath. Needs Pillow.
"""
import glob, os, sys
from PIL import Image, ImageChops

d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'assets', 'generated', 'model-diagram-check', 'gpt-2')
rows = []
for ref in sorted(glob.glob(os.path.join(d, 'ref-*.png'))):
    eng = ref.replace('ref-', 'engine-')
    if not os.path.exists(eng):
        continue
    a, b = Image.open(ref).convert('RGB'), Image.open(eng).convert('RGB')
    w, h = min(a.width, b.width), min(a.height, b.height)
    a, b = a.crop((0, 0, w, h)), b.crop((0, 0, w, h))
    diff = ImageChops.difference(a, b).convert('L').point(lambda v: 255 if v > 40 else 0)
    share = sum(1 for v in diff.getdata() if v) / (w * h)
    out = Image.new('RGB', (w * 2 + 8, h + h // 2 + 8), (128, 128, 128))
    out.paste(a, (0, 0)); out.paste(b, (w + 8, 0))
    out.paste(diff.resize((w // 2, h // 2)).convert('RGB'), (0, h + 8))
    out.resize((out.width // 2, out.height // 2)).save(ref.replace('ref-', 'pair-'))
    rows.append((os.path.basename(ref)[4:-4], a.size, Image.open(eng).size, share))
for name, sa, sb, share in rows:
    print(f'{name}  ref {sa[0]}x{sa[1]}  engine {sb[0]}x{sb[1]}  differing pixels {share * 100:.2f}%')
