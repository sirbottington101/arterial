"""Render icons/icon.svg to the PNG sizes the manifest needs: python3 tools/icons.py"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
svg = (root / 'icons/icon.svg').read_text()
with sync_playwright() as p:
    b = p.chromium.launch()
    for size in (192, 512):
        page = b.new_page(viewport={'width': size, 'height': size})
        page.set_content(f'<style>*{{margin:0}}svg{{width:{size}px;height:{size}px;display:block}}</style>{svg}')
        page.screenshot(path=str(root / f'icons/icon-{size}.png'), omit_background=True)
    b.close()
