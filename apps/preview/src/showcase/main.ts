// The page the skin is shown on. The skin itself lives in the project's src/ folder.
import '@videojs/html/i18n';
import '@/skin.css';
import './showcase.css';
import { createPlayer } from '../frame/player';
import { inscribe } from './inscription';

// The i18n provider follows the page's `lang` and loads Video.js's built-in translations for it.
const i18n = document.createElement('media-i18n');

i18n.append(createPlayer());
document.getElementById('player')!.append(i18n);

// Ornament: two lines of script down each margin and one across each divider. They kindle one after another.
const [left, right] = document.querySelectorAll<HTMLElement>('.edge-run');
const [upper, lower] = document.querySelectorAll<HTMLElement>('.band');

if (left && right) {
  inscribe(left, { seed: 7, size: 13, drift: 150, delay: 0.4, length: 1800 });
  inscribe(left, { seed: 8, size: 9, drift: 210, reverse: true, delay: 8.5, length: 1800 });
  inscribe(right, { seed: 9, size: 13, drift: 150, delay: 3.2, length: 1800 });
  inscribe(right, { seed: 10, size: 9, drift: 210, reverse: true, delay: 11.5, length: 1800 });
}

if (upper) inscribe(upper, { seed: 11, size: 11, drift: 120, delay: 1.6, length: 900 });
if (lower) inscribe(lower, { seed: 12, size: 11, drift: 120, reverse: true, delay: 6, length: 900 });
