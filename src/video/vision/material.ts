/** What the orb is made of. It themes the whole skin, so it lives on the container as `data-scry-stone`. */
export type Stone = 'obsidian' | 'glass';

/** Each material has its own cut of the icons (see ../icons). */
const ICON_FAMILY: Record<Stone, string> = { obsidian: 'scry', glass: 'scry-glass' };

/**
 * Dress the player in a material: the attribute the stylesheets select on, and the matching icon family on every
 * icon, including those still waiting in templates for menus to stamp out.
 */
export function dressMaterial(container: HTMLElement, stone: Stone): void {
  const family = ICON_FAMILY[stone];
  const icons = [
    ...container.querySelectorAll('media-icon'),
    ...[...container.querySelectorAll('template')].flatMap((template) => [
      ...template.content.querySelectorAll('media-icon'),
    ]),
  ];

  container.setAttribute('data-scry-stone', stone);

  for (const icon of icons) if (icon.getAttribute('family') !== family) icon.setAttribute('family', family);
}
