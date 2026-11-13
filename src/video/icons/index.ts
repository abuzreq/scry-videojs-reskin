/**
 * The seeing-stone icon set: cut, not drawn. One grid (20) and one stroke (1.5) like the glass set, but every join
 * is mitred to a point and every line ends square, as a chisel leaves it. What a round pen would dot, this set
 * marks with a small diamond, and the two controls pressed most (play and pause) are solid, like inlay.
 *
 * States that must not rely on colour alone (captions on, AirPlay and Cast connected, picture-in-picture active)
 * add a filled part, as in the glass set.
 */
const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="butt" stroke-linejoin="miter" aria-hidden="true">${body}</svg>`;

const solid = (d: string) => `<path d="${d}" fill="currentColor" stroke="none"/>`;
const tint = (d: string) => `<path d="${d}" fill="currentColor" fill-opacity="0.3" stroke="none"/>`;

const TABLET = 'M2.75 4.75h14.5v10.5H2.75Z';
const HORN = 'M2.75 7.75h3L9.75 4.5v11l-4-3.25h-3Z';
const SCREEN = 'M5.75 13.75h-2.5v-9h13.5v9h-2.5';
const BEACON = 'M3.25 7.5V4.75h13.5v10.5H11.5';

export const scryIcons: Record<string, string> = {
  play: svg(solid('M6.5 4 16.25 10 6.5 16Z')),
  // Two obelisks.
  pause: svg(solid('M5.5 4h3.25v10.25L7.125 16.25 5.5 14.25ZM11.25 4h3.25v10.25L12.875 16.25 11.25 14.25Z')),
  restart: svg('<path d="M6.11 6.11A5.5 5.5 0 1 1 4.5 10"/><path d="M6.1 2.6v3.5H2.6"/>'),
  seek: svg('<path d="M13.89 6.11A5.5 5.5 0 1 0 15.5 10"/><path d="M13.9 2.6v3.5h3.5"/>'),
  'volume-high': svg(`<path d="${HORN}"/><path d="M12.25 7.5a3.5 3.5 0 0 1 0 5"/><path d="M14.5 5.25a6.7 6.7 0 0 1 0 9.5"/>`),
  'volume-low': svg(`<path d="${HORN}"/><path d="M12.25 7.5a3.5 3.5 0 0 1 0 5"/>`),
  'volume-off': svg(`<path d="${HORN}"/><path d="m12.5 7.75 4.5 4.5m0-4.5-4.5 4.5"/>`),
  'captions-off': svg(`<path d="${TABLET}"/><path d="M5.5 12.25H9M11 12.25h3.5"/>`),
  'captions-on': svg(`${tint(TABLET)}<path d="${TABLET}"/><path d="M5.5 12.25H9M11 12.25h3.5M5.5 9.25h1.75M9.25 9.25h5.25"/>`),
  // Two rails, each with a diamond set on it.
  gear: svg(
    `<path d="M2.5 6.5h5.75M14.75 6.5h2.75M2.5 13.5h2M11.25 13.5h6.25"/>${solid('M11.5 3.75 14.25 6.5 11.5 9.25 8.75 6.5ZM8 10.75 10.75 13.5 8 16.25 5.25 13.5Z')}`
  ),
  switches: svg('<path d="M4.75 15.25v-3M10 15.25V9M15.25 15.25V4.5" stroke-width="2"/>'),
  quality: svg('<path d="M4.75 15.25v-3M10 15.25V9M15.25 15.25V4.5" stroke-width="2"/>'),
  speech: svg('<path d="M4 8.75v2.5M7 6.5v7M10 4v12M13 7v6M16 8.75v2.5"/>'),
  speed: svg(`<path d="M3.75 14a6.25 6.25 0 1 1 12.5 0"/><path d="M10.6 12.9 13.25 8"/>${solid('M10 12.25 11.75 14 10 15.75 8.25 14Z')}`),
  check: svg('<path d="M4.5 10.5 8.25 14.25 15.5 5.75"/>'),
  chevron: svg('<path d="M7.5 4.75 12.75 10 7.5 15.25"/>'),
  'pip-enter': svg(`<path d="${TABLET}"/>${solid('M10.25 9.5h5v3.75h-5Z')}`),
  'pip-exit': svg(`<path d="${TABLET}"/>${tint('M10.25 9.5h5v3.75h-5Z')}<path d="M10.25 9.5h5v3.75h-5Z"/><path d="m5.25 7.25 3 3M8.25 7.5v2.75H5.5"/>`),
  'fullscreen-enter': svg('<path d="M3.5 7.75V3.5h4.25M12.25 3.5h4.25v4.25M16.5 12.25v4.25h-4.25M7.75 16.5H3.5v-4.25"/>'),
  'fullscreen-exit': svg('<path d="M7.75 3.5v4.25H3.5M16.5 7.75h-4.25V3.5M12.25 16.5v-4.25h4.25M3.5 12.25h4.25v4.25"/>'),
  'airplay-enter': svg(`<path d="${SCREEN}"/><path d="M10 11.5 13.5 16h-7Z"/>`),
  'airplay-exit': svg(`<path d="${SCREEN}"/>${solid('M10 11.25 14.25 16.5h-8.5Z')}`),
  'cast-enter': svg(`<path d="${BEACON}"/><path d="M3.25 10.25a5 5 0 0 1 5 5M3.25 13a2.25 2.25 0 0 1 2.25 2.25"/>`),
  'cast-exit': svg(`${tint(`${BEACON}H3.25Z`)}<path d="${BEACON}"/><path d="M3.25 10.25a5 5 0 0 1 5 5M3.25 13a2.25 2.25 0 0 1 2.25 2.25"/>`),
  spinner: svg(
    '<style>@keyframes scry-spinner-spin{to{transform:rotate(360deg)}}</style><circle cx="10" cy="10" r="7" stroke-opacity="0.22"/><path d="M10 3a7 7 0 0 1 7 7" style="transform-box:view-box;transform-origin:center;animation:var(--media-spinner-animation, scry-spinner-spin 0.9s linear infinite)"/>'
  ),
};
