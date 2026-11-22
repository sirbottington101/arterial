// Builds dist/arterial.html: the whole game in one file that opens straight
// from disk (no server, no install). Run: node tools/bundle.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const modules = ['js/rng.js', 'js/maps.js', 'js/game.js', 'js/render.js', 'js/main.js'];
const js = modules.map((p) => `// ---- ${p} ----\n` + read(p)
  .replace(/^import [^;]+;\s*$/gm, '')
  .replace(/^export (?=(const|function|class|let) )/gm, '')).join('\n');

const icon = 'data:image/svg+xml,' + encodeURIComponent(read('icons/icon.svg').trim());
let html = read('index.html')
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${icon}" />`)
  .replace('<link rel="stylesheet" href="style.css" />', () => `<style>\n${read('style.css')}</style>`)
  .replace('<script type="module" src="js/main.js"></script>', () => `<script>\n(() => {\n${js}\n})();\n</script>`);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/arterial.html'), html);
console.log(`dist/arterial.html (${(html.length / 1024).toFixed(0)} KB)`);
