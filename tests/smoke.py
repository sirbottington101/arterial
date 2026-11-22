"""Browser smoke test: python3 tests/smoke.py [--shots DIR]

Starts the local server, opens the game on a phone and a desktop viewport,
draws roads with real pointer drags from each house to its hub, fast-forwards
the simulation, and fails on any page error or if no journeys are made.
"""
import subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
shots = Path(sys.argv[sys.argv.index('--shots') + 1]) if '--shots' in sys.argv else None
PORT = 8765

GEOM = """() => {
  const g = arterial.game, R = arterial.R;
  const sc = (x, y) => [R.ox + x * R.s, R.oy + y * R.s];
  return {
    houses: g.houses.map(h => ({ color: h.color, p: sc(h.x + 0.5, h.y + 0.5), x: h.x, y: h.y })),
    dests: g.dests.map(d => ({ color: d.color, x: d.x, y: d.y, p: sc(d.x + 1, d.y + 1) })),
    s: R.s, ox: R.ox, oy: R.oy,
  };
}"""


def drag_path(page, pts, s):
    page.mouse.move(*pts[0])
    page.mouse.down()
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        n = max(2, int(max(abs(bx - ax), abs(by - ay)) / (s / 4)))
        for k in range(1, n + 1):
            page.mouse.move(ax + (bx - ax) * k / n, ay + (by - ay) * k / n)
    page.mouse.up()


def connect_all(page):
    geo = page.evaluate(GEOM)
    s, ox, oy = geo['s'], geo['ox'], geo['oy']
    cell = lambda x, y: (ox + (x + 0.5) * s, oy + (y + 0.5) * s)
    for h in geo['houses']:
        d = min((d for d in geo['dests'] if d['color'] == h['color']),
                key=lambda d: abs(d['x'] - h['x']) + abs(d['y'] - h['y']))
        tx = min(max(h['x'], d['x']), d['x'] + 1)
        ty = min(max(h['y'], d['y']), d['y'] + 1)
        # L-shaped drag: along x, then along y, ending inside the hub.
        drag_path(page, [cell(h['x'], h['y']), cell(tx, h['y']), cell(tx, ty)], s)


def run(p, name, viewport, mobile):
    errors = []
    b = p.chromium.launch()
    ctx = b.new_context(viewport=viewport, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    page.goto(f'http://localhost:{PORT}/')
    if shots: page.screenshot(path=str(shots / f'{name}-menu.png'))
    page.click('#btn-play')
    page.wait_for_timeout(1200)
    connect_all(page)
    roads = page.evaluate('arterial.game.roadCells')
    # Fast-forward 50 s of game time, reconnecting new houses as they appear.
    for k in range(5):
        if k == 4 and shots: page.screenshot(path=str(shots / f'{name}-mid.png'))
        page.evaluate('() => { const g = arterial.game; for (let i = 0; i < 600 && g.state === "running"; i++) g.step(1/60); }')
        page.wait_for_timeout(300)
        connect_all(page)
    page.wait_for_timeout(600)
    if shots: page.screenshot(path=str(shots / f'{name}-play.png'))
    state = page.evaluate('() => ({ score: arterial.game.score, state: arterial.game.state, roads: arterial.game.roadCells, week: arterial.game.week })')
    if state['state'] == 'upgrade':
        page.wait_for_selector('#upgrade:not(.hidden)')
        if shots: page.screenshot(path=str(shots / f'{name}-upgrade.png'))
        page.click('#up-cards .card >> nth=0')
    b.close()
    ok = not errors and state['score'] > 0 and roads > 0
    print(('ok  ' if ok else 'FAIL'), name, state, 'first-roads', roads, *errors)
    return ok


server = subprocess.Popen(['node', 'tools/serve.mjs', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL)
time.sleep(0.8)
try:
    if shots: shots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        results = [run(p, 'phone', {'width': 412, 'height': 860}, True),
                   run(p, 'desktop', {'width': 1366, 'height': 800}, False)]
finally:
    server.terminate()
sys.exit(0 if all(results) else 1)
