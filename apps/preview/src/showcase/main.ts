// The page the skin is shown on. The skin itself lives in the project's src/ folder.
import '@videojs/html/i18n';
import '@/skin.css';
import './showcase.css';
import { createPlayer } from '../frame/player';

// The i18n provider follows the page's `lang` and loads Video.js's built-in translations for it.
const i18n = document.createElement('media-i18n');

i18n.append(createPlayer());
document.getElementById('player')!.append(i18n);

// Switches for the options under evaluation: each group sets one attribute on the skin and keeps it in the URL.
const query = new URLSearchParams(location.search);

for (const group of document.querySelectorAll<HTMLElement>('.choice')) {
  const option = group.dataset.option!;
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('button')];
  const choose = (value: string, write: boolean) => {
    document.querySelector('scry-vision')?.setAttribute(option, value);

    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.value === value));

    if (write) {
      const url = new URL(location.href);

      url.searchParams.set(option, value);
      history.replaceState(null, '', url);
    }
  };

  for (const button of buttons) button.addEventListener('click', () => choose(button.dataset.value!, true));

  const initial = query.get(option);

  choose(buttons.some((button) => button.dataset.value === initial) ? initial! : buttons[0]!.dataset.value!, false);
}
