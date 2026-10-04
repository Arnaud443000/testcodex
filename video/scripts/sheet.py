"""Planche contact des images clés : python3 scripts/sheet.py out/stills/a.png ... -o out/sheet.png"""
import sys
from PIL import Image, ImageDraw
args = sys.argv[1:]
out = args[args.index('-o') + 1] if '-o' in args else 'out/sheet.png'
files = [a for a in args if a.endswith('.png') and a != out]
cols = int(args[args.index('-c') + 1]) if '-c' in args else 2
ims = [Image.open(f).convert('RGB') for f in files]
iw, ih = ims[0].size
s = 960 / max(iw, ih) if iw > ih else 540 / ih
w, h = int(iw * s), int(ih * s)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, h * rows), (40, 40, 40))
d = ImageDraw.Draw(sheet)
for i, (f, im) in enumerate(zip(files, ims)):
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im.resize((w, h), Image.LANCZOS), (x, y))
    d.text((x + 8, y + 6), f.split('/')[-1], fill=(255, 255, 0))
sheet.save(out)
print(out)
