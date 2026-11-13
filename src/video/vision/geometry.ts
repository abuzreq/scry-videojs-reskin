/** Where things go: layout arithmetic for the orb, kept free of player state. */

export interface Circle {
  x: number;
  y: number;
  radius: number;
}

/** A figure on the canvas: a circle plus which lens it uses and how dark the frame around it goes. */
export interface Shape extends Circle {
  /** 0 the tight lens, 1 the wide one. */
  wide: number;
  /** 0..1: how dark everything outside it is. */
  stage: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Box {
  width: number;
  height: number;
}

/**
 * The big orb: in the middle, a little above centre so the curved bar has room beneath it. Short players give the
 * orb what is left after the curved bar and its time plate have their room.
 */
export function bigShape(host: Box): Shape {
  const radius = Math.max(36, Math.min(host.height * 0.36, host.width * 0.3, (host.height - 68) / 2));
  const y = Math.min(Math.max(host.height * 0.45, radius + 10), host.height - radius - 58);

  return { x: host.width / 2, y, radius, wide: 1, stage: 1 };
}

/** An element's inscribed circle, in CSS pixels relative to `host`; null when the element is not laid out. */
export function circleOf(element: Element | null, host: DOMRect): Circle | null {
  const rect = element?.getBoundingClientRect();

  if (!rect || rect.width < 1) return null;

  return {
    x: rect.left - host.left + rect.width / 2,
    y: rect.top - host.top + rect.height / 2,
    radius: Math.min(rect.width, rect.height) / 2,
  };
}

/** Where the skin's centre button sits when it is showing, for when it is hidden but its place is wanted. */
export function centreCircle(host: Box): Circle {
  return {
    x: host.width / 2,
    y: host.height * (host.width < 448 ? 0.4 : 0.5),
    radius: Math.min(44, Math.max(30, host.width * 0.065)),
  };
}

/** Where a picture of the given aspect sits inside `host` under `object-fit: contain` or `cover`, times `scale`. */
export function pictureRect(host: Box, aspect: number, cover: boolean, scale: number): Rect {
  const wide = host.width / host.height > aspect;
  const fitHeight = cover ? !wide : wide;
  const width = fitHeight ? host.height * aspect : host.width;
  const height = fitHeight ? host.height : host.width / aspect;

  return {
    x: ((host.width - width) / 2) * scale,
    y: ((host.height - height) / 2) * scale,
    width: width * scale,
    height: height * scale,
  };
}

/**
 * The element that actually plays, inside a player container: a plain <video>, or the one a media component such
 * as <mux-video> wraps.
 */
export function findVideo(container: Element | null): HTMLVideoElement | null {
  if (!container) return null;

  for (const element of container.children) {
    if (element instanceof HTMLVideoElement) return element;

    const inner = (element as { target?: unknown }).target ?? element.shadowRoot?.querySelector('video');

    if (inner instanceof HTMLVideoElement) return inner;
  }

  return null;
}
