# Arterial

A minimalist traffic-strategy game for the browser and Android. Draw roads that
connect each coloured house to a hub of the same colour, keep the traffic
flowing as the city grows, and pick infrastructure upgrades each week.

Plain HTML, CSS and JavaScript (ES modules). No build step, no dependencies.

## Play

- **Drag** to draw roads. Each road cell uses one tile.
- **Erase** (or right-drag on desktop) removes roads and returns their tiles.
- Drag straight across water or rock to build a **bridge** or **tunnel**.
- **Motorway**: drag from one road to another for a fast direct link.
- **Roundabout** / **Lights**: tap a busy junction. Tap again to remove.
- Pinch or scroll to zoom. You can build while paused.

A hub's dots are cars it is waiting for. When a hub holds too many, a red ring
starts closing; clear its traffic before it closes or the game ends.

**Modes**: Survival, Endless (no timers), Expert (tighter budget, faster growth,
erased tiles are lost), Creative (unlimited everything).
**Maps**: Meadowfield, Saltmarsh Delta (river), Ironback Ridge (mountains),
Glasswater (lakes and rock). Every game generates a fresh layout.

## Run locally

```
node tools/serve.mjs 8080
```

Then open http://localhost:8080. On a phone on the same network, use the
computer's IP address instead of localhost.

## Install on Android

Host the folder on any HTTPS static host (GitHub Pages works: Settings → Pages →
deploy from the main branch). Open the URL in Chrome on the phone, then menu →
**Add to Home screen** / **Install app**. It runs full screen and works offline.

When you change any file, bump `VERSION` in `sw.js` so installed copies update.

## Tests

```
node tests/sim.test.mjs        # headless simulation on every map
python3 tests/smoke.py --shots /tmp/arterial   # browser test with Playwright (Python)
```

## Layout

- `js/game.js`: the simulation (roads, routing, traffic, demand, spawning, upgrades). No DOM.
- `js/maps.js`: terrain generators. `js/render.js`: canvas drawing. `js/main.js`: UI and input.
- `sw.js`, `manifest.webmanifest`, `icons/`: installable web app.
