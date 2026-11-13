import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import '@/video/skin';
import skinTemplate from '@/video/skin.html?raw';

// What the preview plays: a public Mux playback ID, the moment its poster shows (in seconds), and a chapters
// track served from `apps/preview/public` (or null for none). To play something else, change these three.
// The title in the player's corner is the one the asset has in Mux.
//
// The film is the first 2:20 of "Eruption of Fagradalsfjall volcano, 2021-03-24, 2" by Mladen Stojanovic, from
// Wikimedia Commons under CC BY 3.0: one unbroken drone flight, which is what the stone shows off best.
// The film is silent; the music laid under it is "Transpire" by Hampus Naeselius, licensed from Epidemic Sound.
const PLAYBACK_ID = 'cG6Xmjnjk00mL00gtnEd025kxhn6jLi6j6ht016BbTh8qQw';
const POSTER_TIME = 59;
const CHAPTERS: string | null = './fagradalsfjall-chapters.vtt';

const SRC = `https://stream.mux.com/${PLAYBACK_ID}.m3u8`;
const POSTER = `https://image.mux.com/${PLAYBACK_ID}/thumbnail.webp?time=${POSTER_TIME}`;

const MEDIA_PLACEHOLDER = '<!-- Add a compatible media component here. -->';

export function createPlayer(): HTMLElement {
  const player = document.createElement('video-player');
  player.setAttribute('poster', POSTER);

  player.innerHTML = skinTemplate.replace(
    MEDIA_PLACEHOLDER,
    `<mux-video src="${SRC}" playsinline crossorigin>${
      CHAPTERS ? `<track kind="chapters" label="English" srclang="en" src="${CHAPTERS}" default>` : ''
    }</mux-video>`
  );

  // The skin's options can be set from the page URL: ?stone=glass, ?shape=flat (with ?inspect=flow, compare or
  // agreement) and ?depth=auto or wasm. The README describes them.
  const params = new URLSearchParams(location.search);
  const vision = player.querySelector('scry-vision');

  for (const name of ['stone', 'shape', 'inspect', 'depth']) {
    const value = params.get(name);

    if (value) vision?.setAttribute(name, value);
  }

  return player;
}
