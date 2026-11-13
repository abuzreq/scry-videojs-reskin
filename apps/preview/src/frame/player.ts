import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import '@/video/skin';
import skinTemplate from '@/video/skin.html?raw';

// What the preview plays: a public Mux playback ID, the moment its poster shows (in seconds), and a chapters
// track served from `apps/preview/public` (or null for none). To play something else, change these three.
// The title in the player's corner is the one the asset has in Mux.
const PLAYBACK_ID = '83EzHOvVzVN01AsrD01BCpiH02Pj3S8mfzBOu101w2nHC5s';
const POSTER_TIME = 69;
const CHAPTERS: string | null = './cosmic-dawn-chapters.vtt';

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
