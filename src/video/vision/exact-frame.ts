import type { LiquidEngine } from '../../liquid/engine';

const WIDTH = 512;

/**
 * The exact picture for one moment, as opposed to the storyboard's approximation of it. It comes from two places:
 * the frame the player itself is showing (captured at the start and end of a journey, so neither end jumps), and,
 * for Mux sources, a still fetched for wherever the picture comes to rest.
 *
 * The engine holds one such picture at a time; `time` says which moment it is.
 */
export class ExactFrames {
  /** The moment the engine's detail picture shows, or null when it holds none worth showing. */
  time: number | null = null;
  #engine: () => LiquidEngine | null;
  #stills: string | null = null;
  #requested: number | null = null;

  constructor(engine: () => LiquidEngine | null) {
    this.#engine = engine;
  }

  /**
   * Tell it where the storyboard came from. Mux serves a still of any moment next to its storyboards; other hosts
   * get captured frames only. Signed playback needs a token per image, which the skin does not have.
   */
  setStoryboard(spriteUrl: string | null): void {
    const match = spriteUrl ? /^https:\/\/image\.mux\.com\/([^/?#]+)\/storyboard\.\w+(\?.*)?$/.exec(spriteUrl) : null;

    this.#stills = match && !/[?&]token=/.test(match[2] ?? '') ? `https://image.mux.com/${match[1]}/thumbnail.webp` : null;
    this.time = null;
    this.#requested = null;
  }

  /** The picture has become something else; whatever frame is held no longer belongs to it. */
  drop(): void {
    this.time = null;
  }

  /** Take the frame the player is showing as the exact picture for `time`. Returns whether it could. */
  capture(video: HTMLVideoElement | null, time: number): boolean {
    const engine = this.#engine();

    this.time = null;

    if (!video || video.readyState < 2 || !engine) return false;

    // Where the browser plays the stream itself (HLS on iPhones) rather than through Media Source, frames read from
    // a cross-origin video can come back black without any error. The storyboard picture is the safer start there.
    if (/\.m3u8(\?|#|$)/.test(video.currentSrc)) return false;

    try {
      engine.setDetail(video);
    } catch {
      // A frame that cannot be read (no CORS) leaves the storyboard picture in place.
      return false;
    }

    this.time = time;
    this.#requested = Math.round(time * 10) / 10;

    return true;
  }

  /**
   * Fetch the still for `time`, if this source has stills. `wanted` is asked when it arrives, in case the picture
   * has moved on; `arrived` is called once it is in the engine.
   */
  request(time: number, wanted: () => boolean, arrived: () => void): void {
    const rounded = Math.round(time * 10) / 10;

    if (!this.#stills || !this.#engine() || this.#requested === rounded) return;

    this.#requested = rounded;

    const image = new Image();

    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      const engine = this.#engine();

      if (this.#requested !== rounded || !engine?.alive || !wanted()) return;

      engine.setDetail(image);
      this.time = time;
      arrived();
    };
    image.src = `${this.#stills}?time=${rounded}&width=${WIDTH}`;
  }
}
