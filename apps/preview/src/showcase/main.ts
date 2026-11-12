// The page the skin is shown on. The skin itself lives in the project's src/ folder.
import '@videojs/html/i18n';
import '@/skin.css';
import './showcase.css';
import { createPlayer } from '../frame/player';

// The i18n provider follows the page's `lang` and loads Video.js's built-in translations for it.
const i18n = document.createElement('media-i18n');

i18n.append(createPlayer());
document.getElementById('player')!.append(i18n);
