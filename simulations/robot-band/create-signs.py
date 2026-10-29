"""Render the original stage typography; requires Pillow only when regenerating."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

assets = Path(__file__).parent / 'assets'
assets.mkdir(exist_ok=True)
font_root = Path('C:/Windows/Fonts')
bold = str(font_root / 'arialbd.ttf')
regular = str(font_root / 'arial.ttf')

image = Image.new('RGB', (1850, 400), '#080d14')
d = ImageDraw.Draw(image)
d.rounded_rectangle((40, 40, 260, 260), radius=42, outline='#54e5c0', width=5)
for i, h in enumerate([40, 80, 135, 190, 135, 80, 40]):
    x = 74 + i*23
    d.rounded_rectangle((x, 150-h/2, x+10, 150+h/2), radius=5, fill='#54e5c0')
d.text((310, 45), 'ROBOT BAND', font=ImageFont.truetype(bold, 172), fill='#edf5fa')
d.text((320, 258), 'K1 LIVE LAB    /    THREE ROBOTS. ONE GROOVE.', font=ImageFont.truetype(regular, 37), fill='#a3b4c9')
d.line((320, 338, 1765, 338), fill='#354454', width=2)
image.save(assets / 'backdrop.png')
for filename, title, color in [('drums', '01   /   DRUMS', '#ffbe5c'), ('guitar', '02   /   GUITAR', '#54e5c0'), ('keyboard', '03   /   KEYS', '#b89aff')]:
    image = Image.new('RGB', (1200, 180), '#121923')
    d = ImageDraw.Draw(image)
    d.rectangle((0, 0, 14, 180), fill=color)
    d.text((65, 37), title, font=ImageFont.truetype(bold, 100), fill=color)
    image.save(assets / f'{filename}.png')
