import {
  PlayerController,
  type PropertyValues,
  playerContext,
  selectBuffer,
  selectControls,
  selectPlayback,
  selectTextTrack,
  selectTime,
  UIElement,
} from '@videojs/html';
import type { DepthDevice, DepthEstimator } from '../liquid/depth';
import { LiquidEngine, type Tile } from '../liquid/engine';
import { loadSprite, tilesFromCues } from '../liquid/storyboard';
import { ArcBar, type ArcChapter, formatOffset } from './scry-arc';

/** How quickly the picture in the orb catches its target. Higher is tighter; this settles in about a third of a second. */
const SPRING = 13;
/** Rectangle to orb and back, in seconds: while scrubbing, and for a jump. */
const WRAP = { scrub: 0.34, jump: 0.18 };
const UNWRAP = { scrub: 0.4, jump: 0.28 };
/** A jump keeps the orb closed this long after the last one, so repeated presses read as one journey. */
const JUMP_LINGER = 0.3;
/** Seeks shorter than this cut as usual: a one-second nudge on the slider is not a journey. */
const JUMP_MIN_SECONDS = 2.5;
/** Longest the closed orb waits for the player to show the new frame before opening anyway. */
const READY_TIMEOUT = 1.6;
/** Waiting has to last this long before fog appears. */
const MIST_DELAY = 0.35;
/** A press on the picture becomes a scrub once it has moved this far sideways. */
const DRAG_THRESHOLD = 8;
/** A full-width drag on the picture covers this share of the video, and never less than this many seconds. */
const DRAG_SHARE = 1 / 3;
const DRAG_MIN_SECONDS = 45;
/** With `hover="orb"`, how long the orb stays closed after the pointer leaves it. */
const HOVER_LINGER = 0.22;
/** The pointer has to rest this long before the exact frame is fetched. */
const DWELL_SECONDS = 0.16;
const DETAIL_WIDTH = 512;

/** What the canvas is drawing. One thing at a time. */
type Figure = 'none' | 'peek' | 'big' | 'mist' | 'end';

interface Shape {
  x: number;
  y: number;
  radius: number;
  /** 0 the tight lens, 1 the wide one. */
  wide: number;
  /** How dark the frame around it goes. */
  stage: number;
}

interface PictureDrag {
  pointer: number;
  x: number;
  y: number;
  base: number;
  active: boolean;
  resume: boolean;
}

const smooth = (value: number) => {
  const t = Math.min(1, Math.max(0, value));

  return t * t * (3 - 2 * t);
};
const toward = (value: number, goal: number, rate: number, dt: number) => value + (goal - value) * (1 - Math.exp(-dt * rate));

/**
 * The vision layer of the Scry skin: the crystal ball.
 *
 * The video is a rectangle until time is travelled. Scrubbing (dragging the timeline, or dragging sideways on the
 * picture) and jumping (keys, taps, anything that seeks) wrap the picture into a large glass orb in the middle of
 * the player. Inside it the storyboard flows from moment to moment instead of flipping; around its lower rim the
 * timeline curls into an arc. When the travelling ends the orb unwraps onto the new frame.
 *
 * The same glass shows up in the other places the player waits or rests: fog in a small orb while buffering, and
 * the opening frame held in an orb when the video has ended.
 *
 * Attributes:
 * - `hover="orb"` (default): resting the pointer on the timeline wraps the picture too, so you can look around
 *   before committing. `hover="peek"`: hovering shows a small orb at the pointer and leaves the picture alone.
 * - `depth="auto"`: the optional depth tier, which gives the picture in the orb real parallax where WebGPU is
 *   available (`depth="wasm"` forces the slow WebAssembly backend). Off by default; it is the only part that
 *   downloads a model.
 *
 * It is decoration over working controls. The time slider keeps doing the seeking, the labelling and the keyboard.
 * Without WebGL2, or with reduced motion, nothing wraps: seeks cut and the slider preview shows a still thumbnail.
 */
export class ScryVisionElement extends UIElement {
  /** Development aid: below 1 plays the orb's motion in slow motion, for inspecting it frame by frame. */
  static timeScale = 1;

  /**
   * Development aid: when true the orb stops following the clock and moves only when `advance()` is called, so its
   * motion can be captured one exact frame at a time.
   */
  static manual = false;

  /**
   * Most canvas pixels the orb is drawn with, whatever the screen's density. Closed, the orb covers a large share
   * of the player, so this is the knob to turn down if a device struggles.
   */
  static maxPixels = 2_400_000;

  #time = new PlayerController(this, playerContext, selectTime);
  #playback = new PlayerController(this, playerContext, selectPlayback);
  #buffer = new PlayerController(this, playerContext, selectBuffer);
  #tracks = new PlayerController(this, playerContext, selectTextTrack);
  #controls = new PlayerController(this, playerContext, selectControls);

  #disconnect: AbortController | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #engine: LiquidEngine | null = null;
  #engineFailed = false;
  #arc: ArcBar | null = null;
  #storyboardKey = '';
  #blankTimer = 0;
  #container: HTMLElement | null = null;
  #slider: HTMLElement | null = null;
  #anchor: HTMLElement | null = null;
  #delta: HTMLElement | null = null;
  #centre: HTMLElement | null = null;
  #reducedMotion: MediaQueryList | null = null;

  // What is on screen.
  #figure: Figure = 'none';
  #shape: Shape = { x: 0, y: 0, radius: 1, wide: 0, stage: 0 };
  #presence = 0;
  #wrap = 0;
  #reveal = 0;
  #mist = 0;
  #detail = 0;
  #shown = 0;
  #velocity = 0;
  #target = 0;
  #clock = 0;
  #frame = 0;
  #last = 0;

  // Why the big orb is closed, and how it is opening.
  #closed = false;
  #brisk = false;
  #opening = false;
  #unwrapping = false;
  #openAge = 0;
  #frameReady = false;
  #frameRequested = false;
  #barPressed = false;
  #arcScrubbing = false;
  #arcResume = false;
  #drag: PictureDrag | null = null;
  #jumpUntil = 0;
  #hoverUntil = 0;
  #hoverSession = false;
  #quietAt: { x: number; y: number } | null = null;
  #graceUntil = 0;
  #quiet = false;
  #pointer: { x: number; y: number; mouse: boolean } | null = null;
  #settledTime = 0;
  #wasSeeking = false;
  #waitAge = 0;
  #releaseLock: (() => void) | null = null;

  // The exact-frame picture and the depth tier.
  #detailBase: string | null = null;
  #detailTime: number | null = null;
  #detailRequested: number | null = null;
  #still = 0;
  #lastTarget = 0;
  #depth: DepthEstimator | null = null;
  #depthRun = 0;
  #deltaText = '';

  connectedCallback(): void {
    super.connectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = new AbortController();

    const { signal } = this.#disconnect;
    const container = this.closest<HTMLElement>('media-container');
    const slider = container?.querySelector<HTMLElement>('media-time-slider') ?? null;

    this.#container = container;
    this.#slider = slider;
    this.#anchor = container?.querySelector<HTMLElement>('.scry-orb') ?? null;
    this.#delta = container?.querySelector<HTMLElement>('.scry-delta') ?? null;
    this.#centre = container?.querySelector<HTMLElement>('.video-controls-center-play') ?? null;

    if (!container || !slider) return;

    this.#reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.#reducedMotion.addEventListener('change', () => this.#syncMode(), { signal });

    // The slider reflects its pointer state as attributes; that is the cue to look at it again.
    const observer = new MutationObserver(() => this.#wake());

    observer.observe(slider, { attributes: true, attributeFilter: ['data-pointing', 'data-dragging'] });
    signal.addEventListener('abort', () => observer.disconnect());

    // A press on the timeline is a scrub, whether it turns out to be a click or a drag. The slider captures the
    // pointer, so the release lands here too.
    slider.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0) return;

        this.#barPressed = true;
        this.#quiet = false;
        this.#wake();
      },
      { signal }
    );

    for (const type of ['pointerup', 'pointercancel'] as const) {
      slider.addEventListener(
        type,
        () => {
          if (!this.#barPressed) return;

          this.#barPressed = false;
          this.#release();
        },
        { signal }
      );
    }

    slider.addEventListener('pointerleave', () => (this.#quiet = false), { signal });

    // Dragging sideways on the picture itself.
    container.addEventListener('pointerdown', (event) => this.#picturePress(event), { signal });
    container.addEventListener('pointermove', (event) => this.#pictureMove(event), { signal });
    container.addEventListener('pointerup', (event) => this.#pictureRelease(event, true), { signal });
    container.addEventListener('pointercancel', (event) => this.#pictureRelease(event, false), { signal });
    container.addEventListener(
      'pointerleave',
      () => {
        this.#pointer = null;
        this.#wake();
      },
      { signal }
    );

    const resize = new ResizeObserver(() => this.#resize());

    resize.observe(this);
    signal.addEventListener('abort', () => resize.disconnect());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = null;
    cancelAnimationFrame(this.#frame);
    clearTimeout(this.#blankTimer);
    this.#frame = 0;
    this.#blankTimer = 0;
    this.#unlock();
    this.#stopDepth();
    this.#engine?.dispose();
    this.#engine = null;
    this.#canvas?.remove();
    this.#canvas = null;
    this.#arc?.element.remove();
    this.#arc = null;
    this.#storyboardKey = '';
    this.#figure = 'none';
    this.#closed = false;

    for (const name of ['gl', 'wrapped', 'mist', 'ended', 'quiet', 'depth', 'hover']) {
      this.#container?.removeAttribute(`data-scry-${name}`);
    }
  }

  update(changed: PropertyValues): void {
    super.update(changed);
    this.#loadStoryboard();

    const time = this.#time.value;

    if (!time) return;

    // Anything that seeks without a pointer on the timeline is a jump: keys, taps, a replay, another script.
    if (time.seeking && !this.#wasSeeking && this.#live && !this.#scrubbing && this.#clock > this.#graceUntil) {
      if (Math.abs(time.currentTime - this.#settledTime) >= JUMP_MIN_SECONDS) this.#jump(this.#settledTime);
    }

    if (!time.seeking) this.#settledTime = time.currentTime;

    this.#wasSeeking = time.seeking;

    // No storyboard after a moment: carry on without one, on the frames the player itself shows.
    if (!this.#engine && !this.#engineFailed && !this.#blankTimer && time.duration > 0) {
      this.#blankTimer = window.setTimeout(() => this.#withoutStoryboard(), 1500);
    }

    if (this.#playback.value?.waiting || this.#playback.value?.ended || this.#figure !== 'none') this.#wake();
  }

  // ---------------------------------------------------------------- setting up

  /** Start the engine once the media has a storyboard track, and again whenever the track changes. */
  #loadStoryboard(): void {
    const track = this.#tracks.value?.thumbnailsTrack;

    if (!track || track.cues.length < 2 || this.#engineFailed) return;

    const board = tilesFromCues(track.cues, track.src ?? location.href);
    const key = board ? `${board.url}#${board.tiles.length}` : '';

    if (!board || key === this.#storyboardKey) return;

    this.#storyboardKey = key;

    loadSprite(board.url, track.crossOrigin, this.#disconnect?.signal)
      .then((image) => {
        if (key !== this.#storyboardKey || !this.isConnected) return;

        const engine = this.#ensureEngine();

        if (!engine) return;

        engine.setStoryboard(image, board.tiles);
        this.#detailBase = detailBase(board.url);
        this.#detailTime = null;
        this.#detailRequested = null;
        this.#syncMode();
        this.#startDepth(image, board.tiles);
        this.#wake();
      })
      .catch(() => {
        // No readable sprite: carry on as if there were no storyboard.
        this.#withoutStoryboard();
      });
  }

  /** One black tile stands in for the storyboard; the orb then shows only frames captured from the player. */
  #withoutStoryboard(): void {
    const engine = this.#ensureEngine();

    if (!engine || engine.ready) return;

    const blank = document.createElement('canvas');

    blank.width = 16;
    blank.height = 9;
    blank.getContext('2d')!.fillRect(0, 0, 16, 9);
    engine.setStoryboard(blank, [{ x: 0, y: 0, width: 16, height: 9, time: 0 }]);
    this.#syncMode();
  }

  #ensureEngine(): LiquidEngine | null {
    if (this.#engine || this.#engineFailed) return this.#engine;

    const canvas = document.createElement('canvas');

    try {
      this.#engine = new LiquidEngine(canvas);
    } catch {
      this.#engineFailed = true;

      return null;
    }

    this.#canvas = canvas;
    this.#arc = new ArcBar((phase, time) => this.#arcScrub(phase, time));
    this.append(canvas, this.#arc.element);
    this.#resize();

    return this.#engine;
  }

  /** True when the engine may draw. Otherwise the skin's plain fallbacks stand. */
  get #live(): boolean {
    return Boolean(this.#engine?.ready && this.#engine.alive && !this.#reducedMotion?.matches);
  }

  /** True when there are real storyboard tiles to flow between, rather than only captured frames. */
  get #storied(): boolean {
    return (this.#engine?.tiles.length ?? 0) > 1;
  }

  get #hoverMode(): 'orb' | 'peek' {
    return this.getAttribute('hover') === 'peek' ? 'peek' : 'orb';
  }

  #syncMode(): void {
    // The small orb needs storyboard tiles; without them the slider preview keeps its own fallback.
    this.#container?.toggleAttribute('data-scry-gl', this.#live && this.#storied);

    if (!this.#live) {
      this.#container?.removeAttribute('data-scry-hover');
      this.#rest();
    }
  }

  #resize(): void {
    const canvas = this.#canvas;

    if (!canvas) return;

    const { width, height } = this.getBoundingClientRect();

    if (width < 1 || height < 1) return;

    // Sharp on dense screens, but never more pixels than the effect is worth.
    const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(ScryVisionElement.maxPixels / (width * height)));

    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    this.#wake();
  }

  #wake(): void {
    if (this.#frame || !this.isConnected) return;

    this.#last = 0;
    this.#frame = requestAnimationFrame(this.#tick);
  }

  // ---------------------------------------------------------------- travelling

  /** A pointer is on the timeline, the arc or the picture, moving time by hand. */
  get #scrubbing(): boolean {
    return (
      this.#barPressed ||
      this.#arcScrubbing ||
      Boolean(this.#drag?.active) ||
      Boolean(this.#slider?.hasAttribute('data-dragging'))
    );
  }

  /** Wrap the picture into the orb. `from` is the moment the picture is showing as it starts. */
  #close(kind: 'scrub' | 'jump', from: number): void {
    const engine = this.#engine;

    if (!engine || !this.#live) return;

    this.#opening = false;
    this.#unwrapping = false;
    this.#brisk = kind === 'jump';

    if (this.#closed) return;

    this.#closed = true;
    this.#presence = 1;
    this.#reveal = 0;
    this.#mist = 0;

    if (this.#figure === 'end') {
      // Already an orb, holding the opening frame: it only has to grow.
      this.#wrap = 1;
    } else {
      // Start from the very frame on screen, so the first instant of the wrap changes nothing.
      this.#wrap = 0;
      this.#shown = from;
      this.#velocity = 0;
      this.#capture(from);
    }

    this.#figure = 'big';
    this.#container?.setAttribute('data-scry-wrapped', '');
    this.#releaseLock ??= this.#controls.value?.requestControlsLock() ?? null;
    this.#wake();
  }

  /** Something seeked on its own. */
  #jump(from: number): void {
    this.#jumpUntil = this.#clock + JUMP_LINGER;
    this.#close('jump', from);
  }

  /** A hand let go of the timeline, the arc or the picture. */
  #release(): void {
    // The seek that follows a release is ours, not a jump.
    this.#graceUntil = this.#clock + 0.35;
    // The pointer is usually still where it was; do not treat that as a new look until it moves away.
    this.#quiet = true;
    this.#quietAt = this.#pointer ? { x: this.#pointer.x, y: this.#pointer.y } : null;
    this.#wake();
  }

  /** Put the frame the player is showing into the detail picture, as the exact picture for `time`. */
  #capture(time: number): void {
    const video = this.#video();

    this.#detailTime = null;
    this.#detail = 0;

    if (!video || video.readyState < 2 || !this.#engine) return;

    try {
      this.#engine.setDetail(video);
      this.#detailTime = time;
      this.#detailRequested = Math.round(time * 10) / 10;
      this.#detail = 1;
    } catch {
      // A frame that cannot be read (no CORS) leaves the storyboard picture in place.
    }
  }

  #picturePress(event: PointerEvent): void {
    this.#pointer = { x: event.clientX, y: event.clientY, mouse: event.pointerType === 'mouse' };

    if (event.button !== 0 || !event.isPrimary || !this.#live || this.#drag) return;

    // Presses on controls belong to the controls.
    const target = event.target as Element | null;

    if (target?.closest('.video-controls-bottom, .video-controls-top, .video-controls-center, [popover], .scry-arc')) {
      return;
    }

    this.#drag = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      base: this.#time.value?.currentTime ?? 0,
      active: false,
      resume: false,
    };
  }

  #pictureMove(event: PointerEvent): void {
    this.#pointer = { x: event.clientX, y: event.clientY, mouse: event.pointerType === 'mouse' };

    const drag = this.#drag;
    const time = this.#time.value;
    const container = this.#container;

    if (this.#quiet && (!this.#quietAt || Math.hypot(event.clientX - this.#quietAt.x, event.clientY - this.#quietAt.y) > 24)) {
      this.#quiet = false;
      this.#wake();
    }

    if (this.#hoverMode === 'orb' && this.#closed) this.#wake();
    if (!drag || drag.pointer !== event.pointerId || !time || !container) return;

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;

    if (!drag.active) {
      // Up and down is the page scrolling, or nothing at all.
      if (Math.abs(dy) > DRAG_THRESHOLD * 1.5 && Math.abs(dy) > Math.abs(dx)) {
        this.#drag = null;

        return;
      }

      if (Math.abs(dx) < DRAG_THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.2) return;

      drag.active = true;
      drag.x = event.clientX;
      drag.base = time.currentTime;
      drag.resume = this.#pauseForScrub();
      container.setPointerCapture(event.pointerId);
      this.#target = drag.base;
      this.#close('scrub', drag.base);
    }

    const duration = Number.isFinite(time.duration) ? time.duration : 0;
    const span = Math.min(duration, Math.max(DRAG_MIN_SECONDS, duration * DRAG_SHARE));
    const width = Math.max(1, container.getBoundingClientRect().width);

    event.preventDefault();
    this.#target = Math.min(duration, Math.max(0, drag.base + ((event.clientX - drag.x) / width) * span));
    this.#wake();
  }

  #pictureRelease(event: PointerEvent, commit: boolean): void {
    const drag = this.#drag;

    if (!drag || drag.pointer !== event.pointerId) return;

    this.#drag = null;

    if (!drag.active) return;

    if (commit) this.#time.value?.seek(this.#target);
    else this.#target = drag.base;

    if (drag.resume) void this.#playback.value?.play();

    this.#release();
  }

  #arcScrub(phase: 'start' | 'move' | 'end' | 'cancel', time: number): void {
    if (phase === 'start') {
      this.#arcScrubbing = true;
      this.#arcResume = this.#pauseForScrub();
      this.#quiet = false;
    }

    if (phase === 'cancel') this.#target = this.#time.value?.currentTime ?? this.#target;
    else this.#target = time;

    if (phase === 'end' || phase === 'cancel') {
      this.#arcScrubbing = false;

      if (phase === 'end') this.#time.value?.seek(this.#target);
      if (this.#arcResume) void this.#playback.value?.play();

      this.#release();
    }

    this.#wake();
  }

  /** Scrubbing by hand holds the video still; returns whether it was playing. */
  #pauseForScrub(): boolean {
    const playback = this.#playback.value;

    if (!playback || playback.paused || playback.ended) return false;

    playback.pause();

    return true;
  }

  // ---------------------------------------------------------------- each frame

  #tick = (now: number): void => {
    this.#frame = 0;

    if (ScryVisionElement.manual) return;

    const dt =
      (this.#last ? Math.min(0.05, Math.max(0, (now - this.#last) / 1000)) : 1 / 60) * ScryVisionElement.timeScale;

    this.#last = now;
    this.#step(dt);
  };

  /** Move the orb's motion forward by `seconds` and draw. Only meant for use with `manual`. */
  advance(seconds: number): void {
    this.#step(seconds);
  }

  #step(dt: number): void {
    const slider = this.#slider;
    const time = this.#time.value;
    const playback = this.#playback.value;

    if (!slider || !time) return;

    this.#clock += dt;

    const engine = this.#engine;
    const dragging = slider.hasAttribute('data-dragging');
    const pointing = slider.hasAttribute('data-pointing') || dragging;
    const duration = Number.isFinite(time.duration) ? time.duration : 0;
    const pointerTime =
      ((Number.parseFloat(slider.style.getPropertyValue('--media-slider-pointer')) || 0) / 100) * duration;

    if (!this.#live || !engine || !this.#canvas || duration <= 0) {
      // Nothing to draw. The slider preview's caption still shows how far ahead the pointer is.
      this.#writeDelta(pointing ? pointerTime - time.currentTime : null);
      if (pointing) this.#frame = requestAnimationFrame(this.#tick);

      return;
    }

    const host = this.getBoundingClientRect();
    const big = this.#bigShape(host);
    const onBar = this.#barPressed || dragging;
    const hoverable = this.#pointer?.mouse !== false && !this.#quiet;

    // With hover="orb", resting on the timeline (or, once closed, anywhere on the orb) keeps it closed.
    if (this.#hoverMode === 'orb' && hoverable) {
      const arcTime = this.#pointer ? (this.#arc?.timeUnder(this.#pointer.x, this.#pointer.y) ?? null) : null;
      // Once hovering has closed the orb, the pointer may wander over it (to reach the arc) without it opening.
      const onOrb =
        this.#closed &&
        this.#hoverSession &&
        this.#pointer !== null &&
        Math.hypot(this.#pointer.x - host.left - big.x, this.#pointer.y - host.top - big.y) < big.radius + 36;

      if (pointing || onOrb) this.#hoverUntil = this.#clock + HOVER_LINGER;
      if (pointing) this.#hoverSession = true;

      if (this.#clock < this.#hoverUntil && !this.#scrubbing) {
        if (!this.#closed) this.#close('scrub', time.currentTime);

        this.#opening = false;
        this.#unwrapping = false;
        this.#target = pointing ? pointerTime : (arcTime ?? time.currentTime);
      }
    }

    const hovering = this.#hoverMode === 'orb' && hoverable && this.#clock < this.#hoverUntil;
    const jumping = this.#clock < this.#jumpUntil;

    if (onBar) {
      if (!this.#closed) this.#close('scrub', time.currentTime);

      this.#opening = false;
      this.#unwrapping = false;
      this.#target = pointerTime;
    } else if (jumping && !this.#scrubbing) {
      this.#target = time.currentTime;
    }

    const held = this.#scrubbing || hovering || jumping;

    if (this.#closed) {
      if (held) {
        this.#opening = false;
        this.#unwrapping = false;
      } else if (!this.#opening) {
        this.#opening = true;
        this.#openAge = 0;
        this.#frameReady = false;
        this.#frameRequested = false;
      }
    }

    // ---- which figure, and where
    let goal: Shape | null = null;
    let looking = false;

    if (this.#closed) {
      goal = big;
    } else if (this.#hoverMode === 'peek' && pointing && !this.#quiet && this.#storied) {
      const circle = this.#measure(this.#anchor, host);

      if (circle) {
        if (this.#figure !== 'peek') {
          this.#figure = 'peek';
          this.#shown = pointerTime;
          this.#velocity = 0;
          this.#detailTime = null;
        }

        goal = { ...circle, wide: 0, stage: 0 };
        looking = true;
        this.#target = pointerTime;
      }
    } else if (playback?.ended) {
      const circle = this.#measure(this.#centre, host);

      if (circle && this.#storied) {
        if (this.#figure !== 'end') {
          this.#figure = 'end';
          // The opening frame, a little way in so it is not a fade from black.
          this.#target = this.#shown = Math.min(2, duration * 0.05);
          this.#velocity = 0;
          this.#detailTime = null;
        }

        goal = { x: circle.x, y: circle.y, radius: circle.radius * 2, wide: 0.7, stage: 0.55 };
      }
    } else if (playback?.waiting && !playback.paused) {
      this.#waitAge += dt;

      const circle = this.#measure(this.#centre, host);

      if (circle && this.#waitAge > MIST_DELAY) {
        if (this.#figure !== 'mist') {
          this.#figure = 'mist';
          this.#target = this.#shown = time.currentTime;
          this.#velocity = 0;
          this.#capture(time.currentTime);
        }

        goal = { x: circle.x, y: circle.y, radius: circle.radius * 1.5, wide: 0.5, stage: 0.3 };
      }
    }

    if (!playback?.waiting) this.#waitAge = 0;

    this.#container?.toggleAttribute('data-scry-quiet', this.#quiet);
    this.#container?.setAttribute('data-scry-hover', this.#hoverMode);
    this.#container?.toggleAttribute('data-scry-mist', this.#figure === 'mist' && goal !== null);
    this.#container?.toggleAttribute('data-scry-ended', this.#figure === 'end' && goal !== null);
    this.#writeDelta(looking ? this.#target - time.currentTime : null);

    if (this.#figure !== 'big') {
      this.#presence = toward(this.#presence, goal ? 1 : 0, goal ? 14 : 22, dt);

      if (!goal && this.#presence < 0.004) this.#figure = 'none';
    }

    if (goal) {
      // A figure that has just appeared starts in place; one that is already there glides to where it should be.
      const settle = this.#presence < 0.05 || this.#wrap < 0.02 ? 1 : 1 - Math.exp(-dt * 14);

      for (const key of ['x', 'y', 'radius', 'wide', 'stage'] as const) {
        this.#shape[key] += (goal[key] - this.#shape[key]) * settle;
      }
    }

    // ---- the picture: a critically damped spring toward the target, so it glides and never overshoots
    const acceleration = SPRING * SPRING * (this.#target - this.#shown) - 2 * SPRING * this.#velocity;

    this.#velocity += acceleration * dt;
    this.#shown += this.#velocity * dt;

    const tileSeconds = this.#tileSeconds(engine);
    const speed = tileSeconds > 0 ? this.#velocity / tileSeconds : 0;

    // ---- the big orb: closing, waiting for the player, opening
    let waiting = false;

    if (this.#closed) {
      if (!this.#opening) {
        this.#wrap = Math.min(1, this.#wrap + dt / WRAP[this.#brisk ? 'jump' : 'scrub']);
      } else {
        this.#openAge += dt;
        this.#target = time.currentTime;
        this.#awaitFrame(time.seeking);

        const arrived = Math.abs(this.#shown - this.#target) < Math.max(0.2, tileSeconds * 0.3);

        // Normally the new frame arrives within a few frames. A slow seek keeps the orb closed, under fog, rather
        // than opening onto a picture that is not there yet; a very long one opens anyway.
        const overdue = this.#openAge > (time.seeking ? READY_TIMEOUT * 5 : READY_TIMEOUT);

        if (!this.#unwrapping && ((this.#frameReady && arrived) || overdue)) {
          // The frame is on screen underneath: take it as the exact picture and lay it back down.
          this.#unwrapping = true;
          this.#capture(time.currentTime);
          this.#shown = this.#target;
          this.#velocity = 0;
        }

        waiting = !this.#unwrapping && this.#openAge > MIST_DELAY;

        if (this.#unwrapping) {
          this.#wrap = Math.max(0, this.#wrap - dt / UNWRAP[this.#brisk ? 'jump' : 'scrub']);
          this.#reveal = 1 - smooth(this.#wrap / 0.4);

          if (this.#wrap <= 0) this.#rest();
        }
      }
    }

    // ---- the exact frame: fetched when the picture rests on one moment, dropped when it moves off
    const visible = this.#figure !== 'none';
    const steady = Math.abs(this.#target - this.#lastTarget) < 0.02;

    this.#lastTarget = this.#target;
    this.#still = steady && visible && !this.#unwrapping ? this.#still + dt : 0;

    if (this.#still > DWELL_SECONDS && this.#figure !== 'mist') this.#requestDetail(this.#target);

    const away = this.#detailTime === null ? Infinity : Math.abs(this.#shown - this.#detailTime);
    // Without a storyboard the captured frame is all there is: hold it, and let fog say how far away the target is.
    const focused = visible && (this.#storied ? away < 0.12 : this.#detailTime !== null);
    const fog = this.#figure === 'mist' ? 1 : waiting ? 0.75 : this.#storied ? 0 : smooth(away / 4) * 0.8;

    this.#detail = toward(this.#detail, focused ? 1 : 0, focused ? 10 : 22, dt);
    this.#mist = toward(this.#mist, fog, 6, dt);

    if (this.dataset.phase !== this.#figure) this.dataset.phase = this.#figure;
    if (engine.pending > 0) engine.solve(2, this.#shown);

    // ---- draw
    const scale = this.#canvas.width / Math.max(1, host.width);
    const isBig = this.#figure === 'big';
    const wrap = isBig ? this.#wrap : 1;

    engine.render({
      time: this.#shown,
      x: this.#shape.x * scale,
      y: this.#shape.y * scale,
      radius: this.#shape.radius * scale,
      frame: this.#pictureRect(host, scale, engine),
      presence: visible ? this.#presence : 0,
      wrap,
      stage: this.#shape.stage * (isBig ? smooth(wrap * 1.3) : 1),
      wide: this.#shape.wide,
      mist: this.#mist,
      clock: this.#clock,
      reveal: isBig ? this.#reveal : 0,
      detail: this.#detail,
      // Fast travel softens the picture a little and leans it into the direction of travel.
      smear: Math.min(1.4, Math.abs(speed) * 0.09),
      tilt: [Math.max(-1, Math.min(1, speed * 0.06)), 0],
      // Where depth is known the eye drifts in a slow orbit, leans with the travel, and pushes in mid-wrap.
      parallax: [
        0.03 * Math.sin(this.#clock * 0.9) + Math.max(-0.05, Math.min(0.05, speed * 0.012)),
        0.018 * Math.cos(this.#clock * 0.7),
      ],
      dolly: isBig ? 0.5 * Math.sin(Math.PI * wrap) : 0,
      pixelRatio: scale,
    });

    this.#drawArc(host, big, pointerTime, dragging);

    if (visible || held || engine.pending > 0 || playback?.waiting) this.#frame = requestAnimationFrame(this.#tick);
  }

  /** The curved bar exists while the big orb does; at wrap 0 it lies exactly on the straight one. */
  #drawArc(host: DOMRect, big: Shape, pointerTime: number, dragging: boolean): void {
    const arc = this.#arc;
    const slider = this.#slider;
    const time = this.#time.value;

    if (!arc || !slider || !time) return;

    const showing = this.#figure === 'big';

    arc.element.toggleAttribute('data-visible', showing);

    if (!showing) return;

    const track = slider.getBoundingClientRect();
    const buffered = this.#buffer.value?.buffered ?? [];
    const range = buffered.find(([start, end]) => time.currentTime >= start - 0.5 && time.currentTime <= end + 0.5);
    const thumb = slider.querySelector('media-slider-thumb');

    arc.render(
      {
        cx: big.x,
        cy: big.y,
        radius: big.radius,
        x0: track.left - host.left,
        x1: track.right - host.left,
        y: track.top - host.top + track.height / 2,
        wrap: this.#wrap,
      },
      {
        duration: time.duration,
        currentTime: time.currentTime,
        knobTime: this.#opening ? time.currentTime : dragging && !this.#closed ? pointerTime : this.#target,
        buffered: range?.[1] ?? 0,
        chapters: this.#chapters(time.duration),
        active: true,
        focused: Boolean(thumb?.matches(':focus-visible')),
      }
    );
  }

  #chapters(duration: number): ArcChapter[] {
    const cues = this.#tracks.value?.chaptersCues ?? [];

    return cues.map((cue) => ({
      start: cue.startTime,
      end: Math.min(cue.endTime, duration),
      title: cue.text,
    }));
  }

  /** Wait for the player to finish seeking and put the new frame on screen. */
  #awaitFrame(seeking: boolean): void {
    if (this.#frameReady || this.#frameRequested || seeking || this.#openAge < 0.06) return;

    this.#frameRequested = true;

    const done = () => (this.#frameReady = true);
    const video = this.#video();

    // A paused player that was already on this frame presents nothing new, so the timer is the floor.
    video?.requestVideoFrameCallback?.(done);
    setTimeout(done, 160);
  }

  /** Back to the plain rectangle, or to nothing on screen. */
  #rest(): void {
    this.#closed = false;
    this.#opening = false;
    this.#unwrapping = false;
    this.#brisk = false;
    this.#hoverSession = false;
    this.#figure = 'none';
    this.#presence = 0;
    this.#wrap = 0;
    this.#reveal = 0;
    this.#mist = 0;
    this.#detail = 0;
    this.#still = 0;
    this.#container?.removeAttribute('data-scry-wrapped');
    this.#arc?.element.removeAttribute('data-visible');
    this.#unlock();
    this.#wake();
  }

  #unlock(): void {
    this.#releaseLock?.();
    this.#releaseLock = null;
  }

  // ---------------------------------------------------------------- measuring

  /** The big orb: in the middle, a little above centre so the curved bar has room beneath it. */
  #bigShape(host: DOMRect): Shape {
    const radius = Math.max(36, Math.min(host.height * 0.38, host.width * 0.3, (host.height - 64) / 2));

    return { x: host.width / 2, y: Math.max(host.height * 0.45, radius + 10), radius, wide: 1, stage: 1 };
  }

  /** An element's circle, in CSS pixels relative to this element. */
  #measure(element: HTMLElement | null, host: DOMRect): { x: number; y: number; radius: number } | null {
    const rect = element?.getBoundingClientRect();

    if (!rect || rect.width < 1) return null;

    return {
      x: rect.left - host.left + rect.width / 2,
      y: rect.top - host.top + rect.height / 2,
      radius: Math.min(rect.width, rect.height) / 2,
    };
  }

  /** Where the video picture sits inside this element, in canvas pixels, honouring `object-fit`. */
  #pictureRect(host: DOMRect, scale: number, engine: LiquidEngine) {
    const video = this.#video();
    const tile = engine.tiles[0];
    const aspect =
      video && video.videoWidth > 0 ? video.videoWidth / video.videoHeight : tile ? tile.width / tile.height : 16 / 9;
    const cover = video ? getComputedStyle(video).objectFit === 'cover' : false;
    const wide = host.width / host.height > aspect;
    const fitWidth = cover ? !wide : wide;
    const width = fitWidth ? host.height * aspect : host.width;
    const height = fitWidth ? host.height : host.width / aspect;

    return {
      x: ((host.width - width) / 2) * scale,
      y: ((host.height - height) / 2) * scale,
      width: width * scale,
      height: height * scale,
    };
  }

  #video(): HTMLVideoElement | null {
    const container = this.#container;

    if (!container) return null;

    for (const element of container.children) {
      if (element instanceof HTMLVideoElement) return element;

      // Media components such as <mux-video> wrap the element that actually plays.
      const inner = (element as { target?: unknown }).target ?? element.shadowRoot?.querySelector('video');

      if (inner instanceof HTMLVideoElement) return inner;
    }

    return null;
  }

  #tileSeconds(engine: LiquidEngine): number {
    const tiles = engine.tiles;

    return tiles.length > 1 ? (tiles[tiles.length - 1]!.time - tiles[0]!.time) / (tiles.length - 1) : 0;
  }

  /** "+1:24" or "−0:30" in the slider preview: how far ahead of, or behind, the present the pointer is. */
  #writeDelta(seconds: number | null): void {
    const text = seconds === null ? '' : formatOffset(seconds);

    if (text === this.#deltaText || !this.#delta) return;

    this.#deltaText = text;
    this.#delta.textContent = text;
  }

  // ---------------------------------------------------------------- exact frames and depth

  /** Ask for the exact frame at `time`. Only Mux storyboards say where to find one. */
  #requestDetail(time: number): void {
    const base = this.#detailBase;
    const rounded = Math.round(time * 10) / 10;

    if (!base || !this.#engine || this.#detailRequested === rounded) return;

    this.#detailRequested = rounded;

    const image = new Image();

    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      // Only if the picture is still resting where it was when this was asked for.
      if (this.#detailRequested !== rounded || !this.#engine?.alive || this.#unwrapping) return;

      this.#engine.setDetail(image);
      this.#detailTime = time;
      this.#wake();
    };
    image.src = `${base}?time=${rounded}&width=${DETAIL_WIDTH}`;
  }

  /** Which backend the depth tier may use here, or null when it stays off. */
  #depthDevice(): DepthDevice | null {
    const mode = this.getAttribute('depth');

    if (mode === 'wasm') return 'wasm';
    if (mode !== 'auto' || this.#reducedMotion?.matches) return null;

    const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;

    return 'gpu' in navigator && !saveData ? 'webgpu' : null;
  }

  /**
   * Work through the storyboard in the background, nearest the playhead first, handing each tile's depth to the
   * engine as it arrives. Any failure (no network, an unsupported GPU, a model that will not load) just leaves the
   * orb as it was.
   */
  async #startDepth(image: HTMLImageElement, tiles: Tile[]): Promise<void> {
    this.#stopDepth();

    const device = this.#depthDevice();
    const run = ++this.#depthRun;

    if (!device || tiles.length === 0) return;

    try {
      const { DepthEstimator, depthInputSize } = await import('../liquid/depth');

      if (run !== this.#depthRun) return;

      const estimator = new DepthEstimator(device);

      this.#depth = estimator;
      await estimator.ready;

      const size = depthInputSize(tiles[0]!.width, tiles[0]!.height);
      const start = this.#engine?.locate(this.#time.value?.currentTime ?? 0).index ?? 0;
      const order = tiles.map((_, index) => index).sort((a, b) => Math.abs(a - start) - Math.abs(b - start));

      for (const index of order) {
        if (run !== this.#depthRun || !this.#engine?.alive) return;

        const tile = tiles[index]!;
        const bitmap = await createImageBitmap(image, tile.x, tile.y, tile.width, tile.height, {
          resizeWidth: size.width,
          resizeHeight: size.height,
          resizeQuality: 'medium',
        });
        const map = await estimator.estimate(bitmap);

        if (run !== this.#depthRun) return;

        this.#engine?.setDepth(index, map.data, map.width, map.height);
        this.#container?.setAttribute('data-scry-depth', '');
        this.#wake();
      }
    } catch {
      // Stay flat.
    } finally {
      // The model is only needed while there are tiles left to look at.
      if (run === this.#depthRun) this.#stopDepth();
    }
  }

  #stopDepth(): void {
    this.#depthRun++;
    this.#depth?.dispose();
    this.#depth = null;
  }
}

/** Mux serves a still of any moment next to its storyboards; other hosts get no fetched detail picture. */
function detailBase(spriteUrl: string): string | null {
  const match = /^https:\/\/image\.mux\.com\/([^/?#]+)\/storyboard\.\w+(\?.*)?$/.exec(spriteUrl);

  // Signed playback needs a separate token per image, which the skin does not have.
  if (!match || /[?&]token=/.test(match[2] ?? '')) return null;

  return `https://image.mux.com/${match[1]}/thumbnail.webp`;
}

if (!customElements.get('scry-vision')) customElements.define('scry-vision', ScryVisionElement);
