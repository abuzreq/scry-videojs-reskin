/**
 * Scry icon set. One grid (20), one stroke (1.5, round caps and joins), outlines only. States that must not rely on
 * colour alone (captions on, AirPlay and Cast connected, picture-in-picture active) add a filled part.
 */
const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const FRAME = 'M3.75 4.75h12.5a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H3.75a1 1 0 0 1-1-1v-8.5a1 1 0 0 1 1-1Z';
const SPEAKER = 'M2.75 8.25v3.5h2.5L9 14.75V5.25l-3.75 3Z';
const tint = (d: string) => `<path d="${d}" fill="currentColor" fill-opacity="0.28" stroke="none"/>`;

export const scryIcons: Record<string, string> = {
  play: svg('<path d="M7 4.75 15.25 10 7 15.25Z"/>'),
  pause: svg('<path d="M6 4.75h2.25v10.5H6ZM11.75 4.75H14v10.5h-2.25Z"/>'),
  restart: svg('<path d="M6.11 6.11A5.5 5.5 0 1 1 4.5 10"/><path d="M6.1 3.1v3h-3"/>'),
  seek: svg('<path d="M13.89 6.11A5.5 5.5 0 1 0 15.5 10"/><path d="M13.9 3.1v3h3"/>'),
  'volume-high': svg(`<path d="${SPEAKER}"/><path d="M12 7.75a3.2 3.2 0 0 1 0 4.5"/><path d="M14.25 5.5a6.4 6.4 0 0 1 0 9"/>`),
  'volume-low': svg(`<path d="${SPEAKER}"/><path d="M12 7.75a3.2 3.2 0 0 1 0 4.5"/>`),
  'volume-off': svg(`<path d="${SPEAKER}"/><path d="m12.5 8 4 4m0-4-4 4"/>`),
  'captions-off': svg(`<path d="${FRAME}"/><path d="M5.75 12h3M11.25 12h3"/>`),
  'captions-on': svg(`${tint(FRAME)}<path d="${FRAME}"/><path d="M5.75 12h3M11.25 12h3M5.75 9h1.5M9.75 9h4.5"/>`),
  gear: svg('<path d="M2.75 6.5h6.5M13.25 6.5h4M2.75 13.5h2M9.25 13.5h8"/><circle cx="11.25" cy="6.5" r="2"/><circle cx="7.25" cy="13.5" r="2"/>'),
  switches: svg('<path d="M5 14.5v-2M10 14.5v-5.5M15 14.5v-9"/>'),
  quality: svg('<path d="M5 14.5v-2M10 14.5v-5.5M15 14.5v-9"/>'),
  speech: svg('<path d="M4 9v2M7 6.75v6.5M10 4.5v11M13 7.25v5.5M16 9v2"/>'),
  speed: svg('<path d="M3.75 13.75a6.25 6.25 0 1 1 12.5 0"/><path d="m10 13.25 2.75-4.5"/>'),
  check: svg('<path d="m4.75 10.5 3.5 3.5 7-8"/>'),
  chevron: svg('<path d="M7.75 5 12.5 10l-4.75 5"/>'),
  'pip-enter': svg(`<path d="${FRAME}"/><path d="M10.5 10h4v2.75h-4Z"/>`),
  'pip-exit': svg(`<path d="${FRAME}"/>${tint('M10.5 10h4v2.75h-4Z')}<path d="M10.5 10h4v2.75h-4Z"/><path d="m5.5 7.25 2.75 2.75M8.25 7.75V10H6"/>`),
  'fullscreen-enter': svg('<path d="M3.5 7.25v-2.5a1 1 0 0 1 1-1H7M13 3.75h2.5a1 1 0 0 1 1 1v2.5M16.5 12.75v2.5a1 1 0 0 1-1 1H13M7 16.25H4.5a1 1 0 0 1-1-1v-2.5"/>'),
  'fullscreen-exit': svg('<path d="M7 3.75v2.5a1 1 0 0 1-1 1H3.5M16.5 7.25H14a1 1 0 0 1-1-1v-2.5M13 16.25v-2.5a1 1 0 0 1 1-1h2.5M3.5 12.75H6a1 1 0 0 1 1 1v2.5"/>'),
  'airplay-enter': svg('<path d="M5.75 13.75h-1.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h11.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1.5"/><path d="m10 11.75 3.25 4h-6.5Z"/>'),
  'airplay-exit': svg(`<path d="M5.75 13.75h-1.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h11.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1.5"/><path d="m10 11.75 3.25 4h-6.5Z" fill="currentColor"/>`),
  'cast-enter': svg('<path d="M3.25 7.5V5.75a1 1 0 0 1 1-1h11.5a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H11.5"/><path d="M3.25 10.25a5 5 0 0 1 5 5M3.25 13a2.25 2.25 0 0 1 2.25 2.25"/>'),
  'cast-exit': svg(`${tint('M3.25 7.5V5.75a1 1 0 0 1 1-1h11.5a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H11.5Z')}<path d="M3.25 7.5V5.75a1 1 0 0 1 1-1h11.5a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H11.5"/><path d="M3.25 10.25a5 5 0 0 1 5 5M3.25 13a2.25 2.25 0 0 1 2.25 2.25"/>`),
  spinner: svg(
    '<style>@keyframes scry-spinner-spin{to{transform:rotate(360deg)}}</style><circle cx="10" cy="10" r="7" stroke-opacity="0.22"/><path d="M10 3a7 7 0 0 1 7 7" style="transform-box:view-box;transform-origin:center;animation:var(--media-spinner-animation, scry-spinner-spin 0.9s linear infinite)"/>'
  ),
};
