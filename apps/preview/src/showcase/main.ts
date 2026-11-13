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

// Ornament. Two lines down each margin, moving at different speeds, and one across each divider.
let seed = 7;

for (const run of document.querySelectorAll<HTMLElement>('.edge-run')) {
  inscribe(run, { seed: seed++, size: 13, seconds: 190 });
  inscribe(run, { seed: seed++, size: 9, seconds: 260, reverse: true });
}

for (const band of document.querySelectorAll<HTMLElement>('.band')) {
  inscribe(band, { seed: seed++, size: 11, seconds: 240, reverse: seed % 2 === 0 });
}
