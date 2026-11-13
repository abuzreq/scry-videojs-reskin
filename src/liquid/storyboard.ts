import type { Tile } from './engine';

export interface StoryboardCue {
  startTime: number;
  text: string;
}

/** A storyboard as its track describes it: one sprite image and where each moment's tile sits on it. */
export interface Storyboard {
  url: string;
  tiles: Tile[];
}

/**
 * Read storyboard cues (`sprite.jpg#xywh=x,y,w,h`, the format Mux and most packagers emit) into tiles. Only tiles on
 * the first sprite are kept: one sprite is the common case, and it keeps the engine to a single texture upload.
 */
export function tilesFromCues(cues: readonly StoryboardCue[], base: string): Storyboard | null {
  let url: string | null = null;
  const tiles: Tile[] = [];

  for (const cue of cues) {
    const match = /^(.*?)#xywh=(\d+),(\d+),(\d+),(\d+)\s*$/.exec(cue.text.trim());

    if (!match) continue;

    let resolved: string;

    try {
      resolved = new URL(match[1]!, base).href;
    } catch {
      continue;
    }

    url ??= resolved;

    if (resolved !== url) continue;

    tiles.push({
      x: Number(match[2]),
      y: Number(match[3]),
      width: Number(match[4]),
      height: Number(match[5]),
      time: cue.startTime,
    });
  }

  if (!url || tiles.length < 2) return null;

  tiles.sort((a, b) => a.time - b.time);

  return { url, tiles };
}

/** Load the sprite so its pixels can be read: cross-origin sprites need CORS headers, which Mux sends. */
export function loadSprite(url: string, crossOrigin: string | null, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    if (crossOrigin !== null || new URL(url, location.href).origin !== location.origin) {
      image.crossOrigin = crossOrigin ?? 'anonymous';
    }

    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Storyboard sprite failed to load: ${url}`));
    signal?.addEventListener('abort', () => {
      image.src = '';
      reject(new DOMException('Aborted', 'AbortError'));
    });
    image.src = url;
  });
}
