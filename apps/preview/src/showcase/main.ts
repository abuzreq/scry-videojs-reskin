// The page the skin is shown on. The skin itself lives in the project's src/ folder.
import '@videojs/html/i18n';
import '@/skin.css';
import './showcase.css';
import { createPlayer } from '../frame/player';

// The i18n provider follows the page's `lang` and loads Video.js's built-in translations for it.
const i18n = document.createElement('media-i18n');

i18n.append(createPlayer());
document.getElementById('player')!.append(i18n);

// The two hover behaviours, side by side: the buttons set the skin's `hover` attribute and keep it in the URL.
const buttons = [...document.querySelectorAll<HTMLButtonElement>('.choice button')];
const choose = (mode: string, write: boolean) => {
  document.querySelector('scry-vision')?.setAttribute('hover', mode);

  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.hover === mode));

  if (write) {
    const url = new URL(location.href);

    url.searchParams.set('hover', mode);
    history.replaceState(null, '', url);
  }
};

for (const button of buttons) button.addEventListener('click', () => choose(button.dataset.hover!, true));

choose(new URLSearchParams(location.search).get('hover') === 'peek' ? 'peek' : 'orb', false);
