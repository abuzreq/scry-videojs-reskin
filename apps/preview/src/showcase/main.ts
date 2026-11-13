// The page the skin is shown on. The skin itself lives in the project's src/ folder.
import '@videojs/html/i18n';
import '@/skin.css';
import './showcase.css';
import { createPlayer } from '../frame/player';
import { type EmberStrip, kindle } from './embers';
import { BASELINE, writeLine } from './inscription';

// The i18n provider follows the page's `lang` and loads Video.js's built-in translations for it.
const i18n = document.createElement('media-i18n');

i18n.append(createPlayer());
document.getElementById('player')!.append(i18n);

// Ornament: lines of script that catch fire, burn and cool, one after another. Two run along each margin and one
// across each divider. The thicknesses here match the canvases' sizes in showcase.css.
const line = (seed: number, size: number, period: number, seconds: number, delay: number) => ({
  d: writeLine((period * BASELINE) / size, seed),
  size,
  // Drifting past once takes `seconds`; a negative time runs it the other way.
  speed: period / seconds,
  delay,
});
const strips: EmberStrip[] = [];
const [left, right] = document.querySelectorAll<HTMLCanvasElement>('.edge canvas');
const [upper, lower] = document.querySelectorAll<HTMLCanvasElement>('.band canvas');

if (left) {
  strips.push({ canvas: left, run: 'down', cross: 100, period: 1800, rows: [line(7, 13, 1800, 150, 0.4), line(8, 9, 1800, -210, 9.5)] });
}

if (right) {
  strips.push({ canvas: right, run: 'up', cross: 100, period: 1800, rows: [line(9, 13, 1800, 150, 4.5), line(10, 9, 1800, -210, 13)] });
}

if (upper) strips.push({ canvas: upper, run: 'across', cross: 72, period: 1100, rows: [line(11, 11, 1100, 110, 2)] });
if (lower) strips.push({ canvas: lower, run: 'across', cross: 72, period: 1100, rows: [line(12, 11, 1100, -110, 7)] });

kindle(strips);
