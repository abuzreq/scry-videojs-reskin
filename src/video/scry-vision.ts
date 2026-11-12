import {
  PlayerController,
  type PropertyValues,
  playerContext,
  selectControls,
  selectTextTrack,
  selectTime,
  UIElement,
} from '@videojs/html';
import { LiquidEngine } from '../liquid/engine';
import { loadSprite, tilesFromCues } from '../liquid/storyboard';

/** How quickly the picture in the orb catches the pointer. Higher is tighter; this settles in about a third of a second. */
const SPRING = 13;
const BLOOM_SECONDS = 0.56;
const REVEAL_SECONDS = 0.3;
/** Longest the opened orb waits for the player to show the new frame before giving way anyway. */
const REVEAL_TIMEOUT = 1.6;
const MAX_PIXELS = 2_400_000;
/** How long the orb stays up after a keyboard seek. */
const KEY_LINGER = 1400;
const SEEK_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);
/** The pointer has to rest this long before the exact frame is fetched. */
const DWELL_SECONDS = 0.16;
const DETAIL_WIDTH = 512;

type Phase = 'idle' | 'scry' | 'bloom';

interface Circle {
  x: number;
  y: number;
  radius: number;
}

/**
 * The vision layer of the Scry skin.
 *
 * While the pointer is on the timeline it draws the orb: the storyboard picture for that moment, flowing between
 * tiles instead of flipping, inside a glass sphere placed over the `.scry-orb` anchor in the slider preview. On
 * release the orb opens over the frame and gives way to the video once the player has caught up.
 *
 * It is decoration over working controls. The time slider keeps doing the seeking, the labelling and the keyboard;
 * without WebGL2, without a storyboard, or with reduced motion, the anchor shows the still thumbnail instead.
 */
export class ScryVisionElement extends UIElement {
  /** Development aid: below 1 plays the orb's motion in slow motion, for inspecting it frame by frame. */
  static timeScale = 1;

  #time = new PlayerController(this, playerContext, selectTime);
  #tracks = new PlayerController(this, playerContext, selectTextTrack);
  #controls = new PlayerController(this, playerContext, selectControls);

  #disconnect: AbortController | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #engine: LiquidEngine | null = null;
  #engineFailed = false;
  #storyboardKey = '';
  #container: HTMLElement | null = null;
  #slider: HTMLElement | null = null;
  #anchor: HTMLElement | null = null;
  #delta: HTMLElement | null = null;
  #reducedMotion: MediaQueryList | null = null;

  #phase: Phase = 'idle';
  #frame = 0;
  #last = 0;
  #shown = 0;
  #velocity = 0;
  #target = 0;
  #presence = 0;
  #bloom = 0;
  #reveal = 0;
  #bloomAge = 0;
  #frameReady = false;
  #frameRequested = false;
  #latched: Circle | null = null;
  #quiet = false;
  #pressed = false;
  #releaseLock: (() => void) | null = null;
  #deltaText = '';
  #keysUntil = 0;
  #detailBase: string | null = null;
  #detailTime: number | null = null;
  #detailRequested: number | null = null;
  #detail = 0;
  #still = 0;
  #lastTarget = 0;

  connectedCallback(): void {
    super.connectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = new AbortController();

    const { signal } = this.#disconnect;

    this.#container = this.closest<HTMLElement>('media-container');
    this.#slider = this.#container?.querySelector<HTMLElement>('media-time-slider') ?? null;
    this.#anchor = this.#container?.querySelector<HTMLElement>('.scry-orb') ?? null;
    this.#delta = this.#container?.querySelector<HTMLElement>('.scry-delta') ?? null;

    if (!this.#container || !this.#slider) return;

    this.#reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.#reducedMotion.addEventListener('change', () => this.#syncMode(), { signal });

    // The slider reflects its pointer state as attributes; that is the cue to start drawing.
    const observer = new MutationObserver(() => this.#wake());

    observer.observe(this.#slider, { attributes: true, attributeFilter: ['data-pointing', 'data-dragging'] });
    signal.addEventListener('abort', () => observer.disconnect());

    // A press on the timeline is a seek, whether it is a click or the end of a drag; the slider's own drag events
    // skip plain clicks, so the pointer is watched directly. The slider captures it, so the release lands here too.
    this.#slider.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0) return;

        this.#pressed = true;
        this.#suppressedState = false;
        this.#wake();
      },
      { signal }
    );

    for (const type of ['pointerup', 'pointercancel'] as const) {
      this.#slider.addEventListener(
        type,
        () => {
          if (!this.#pressed) return;

          this.#pressed = false;

          if (type === 'pointerup') this.#commit();
        },
        { signal }
      );
    }

    this.#slider.addEventListener('pointerleave', () => (this.#suppressedState = false), { signal });

    // Seeking from the keyboard gets the same look ahead: the orb rises at the bead for a moment after each step.
    this.#slider.addEventListener(
      'keydown',
      (event) => {
        if (!SEEK_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;

        this.#keysUntil = performance.now() + KEY_LINGER;
        this.#container?.setAttribute('data-scry-keys', '');
        this.#wake();
      },
      { signal }
    );
    this.#slider.addEventListener('focusout', () => this.#endKeys(), { signal });

    const resize = new ResizeObserver(() => this.#resize());

    resize.observe(this);
    signal.addEventListener('abort', () => resize.disconnect());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = null;
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#unlock();
    this.#engine?.dispose();
    this.#engine = null;
    this.#canvas?.remove();
    this.#canvas = null;
    this.#storyboardKey = '';
    this.#container?.removeAttribute('data-scry-gl');
    this.#container?.removeAttribute('data-scry-bloom');
    this.#container?.removeAttribute('data-scry-quiet');
    this.#container?.removeAttribute('data-scry-keys');
  }

  update(changed: PropertyValues): void {
    super.update(changed);
    this.#loadStoryboard();
  }

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
        this.#wake();
      })
      .catch(() => {
        // No readable sprite: the still thumbnail stays.
      });
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
    this.append(canvas);
    this.#resize();

    return this.#engine;
  }

  /**
   * After the orb has opened, the pointer is usually still resting on the timeline. Stay out of the way, caption
   * included, until it moves off or presses again.
   */
  get #suppressedState(): boolean {
    return this.#quiet;
  }

  set #suppressedState(value: boolean) {
    if (value === this.#quiet) return;

    this.#quiet = value;
    this.#container?.toggleAttribute('data-scry-quiet', value);
    this.#wake();
  }

  /** True when the orb should be drawn by the engine rather than left to the still thumbnail. */
  get #live(): boolean {
    return Boolean(this.#engine?.ready && this.#engine.alive && !this.#reducedMotion?.matches);
  }

  #syncMode(): void {
    this.#container?.toggleAttribute('data-scry-gl', this.#live);

    if (!this.#live) this.#rest();
  }

  #resize(): void {
    const canvas = this.#canvas;

    if (!canvas) return;

    const { width, height } = this.getBoundingClientRect();

    if (width < 1 || height < 1) return;

    // Sharp on dense screens, but never more pixels than the effect is worth.
    const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (width * height)));

    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    this.#wake();
  }

  #wake(): void {
    if (this.#frame || !this.isConnected) return;

    this.#last = 0;
    this.#frame = requestAnimationFrame(this.#tick);
  }

  #tick = (now: number): void => {
    this.#frame = 0;

    const slider = this.#slider;
    const time = this.#time.value;

    if (!slider || !time) return;

    const dt = (this.#last ? Math.min(0.05, Math.max(0, (now - this.#last) / 1000)) : 1 / 60) * ScryVisionElement.timeScale;

    this.#last = now;

    const dragging = slider.hasAttribute('data-dragging');
    const pointing = slider.hasAttribute('data-pointing') || dragging;
    const duration = Number.isFinite(time.duration) ? time.duration : 0;
    const pointer = (Number.parseFloat(slider.style.getPropertyValue('--media-slider-pointer')) || 0) / 100;
    const byKeys = !pointing && this.#keysUntil > 0;

    if (byKeys && now > this.#keysUntil) this.#endKeys();

    const looking = duration > 0 && ((pointing && !this.#suppressedState) || this.#keysUntil > 0);

    if (this.#phase !== 'bloom') {
      if (looking) {
        // From the keyboard there is no pointer: the orb looks at wherever the seek has landed.
        this.#target = pointing ? pointer * duration : time.currentTime;

        if (this.#phase === 'idle') {
          // A fresh look starts where the pointer is, rather than sweeping in from the last one.
          if (this.#presence < 0.05) {
            this.#shown = this.#target;
            this.#velocity = 0;
          }

          this.#phase = 'scry';
          this.#releaseLock ??= this.#controls.value?.requestControlsLock() ?? null;
        }
      } else if (this.#phase === 'scry') {
        this.#phase = 'idle';
        this.#unlock();
      }
    }

    this.#writeDelta(looking && pointing ? this.#target - time.currentTime : null);

    const engine = this.#engine;

    if (!this.#live || !engine || !this.#canvas) {
      // Nothing to draw; keep ticking only while the offset readout needs it.
      if (looking) this.#frame = requestAnimationFrame(this.#tick);

      return;
    }

    // Critically damped spring: the picture glides to the pointer and never overshoots it.
    const acceleration = SPRING * SPRING * (this.#target - this.#shown) - 2 * SPRING * this.#velocity;

    this.#velocity += acceleration * dt;
    this.#shown += this.#velocity * dt;

    const visible = this.#phase !== 'idle';

    this.#presence += ((visible ? 1 : 0) - this.#presence) * (1 - Math.exp(-dt * (visible ? 16 : 22)));

    if (this.#phase === 'bloom') {
      this.#bloomAge += dt;
      this.#bloom = Math.min(1, this.#bloom + dt / BLOOM_SECONDS);
      this.#awaitFrame(time.seeking);

      if ((this.#frameReady && this.#bloom > 0.3) || this.#bloomAge > REVEAL_TIMEOUT) {
        this.#reveal = Math.min(1, this.#reveal + dt / REVEAL_SECONDS);
      }

      if (this.#reveal >= 1) {
        this.#suppressedState = pointing;
        this.#rest();
      }
    }

    // Resting on one moment brings it into focus: fetch the exact frame and let it replace the approximation.
    const steady = Math.abs(this.#target - this.#lastTarget) < 0.02;

    this.#lastTarget = this.#target;
    this.#still = steady && visible ? this.#still + dt : 0;

    if (this.#still > DWELL_SECONDS) this.#requestDetail(this.#target);

    const focused = this.#detailTime !== null && Math.abs(this.#target - this.#detailTime) < 0.06 && visible;

    this.#detail += ((focused ? 1 : 0) - this.#detail) * (1 - Math.exp(-dt * (focused ? 9 : 24)));

    if (this.dataset.phase !== this.#phase) this.dataset.phase = this.#phase;

    if (engine.pending > 0) engine.solve(2, this.#shown);

    const host = this.getBoundingClientRect();
    const scale = this.#canvas.width / Math.max(1, host.width);
    const circle = this.#latched ?? this.#measure(host);
    const tileSeconds = this.#tileSeconds(engine);
    const speed = tileSeconds > 0 ? this.#velocity / tileSeconds : 0;

    if (circle && this.#presence > 0.002) {
      engine.render({
        time: this.#shown,
        x: circle.x * scale,
        y: circle.y * scale,
        radius: circle.radius * scale,
        frame: this.#pictureRect(host, scale, engine),
        presence: this.#presence,
        bloom: this.#bloom,
        reveal: this.#reveal,
        detail: this.#detail,
        // Fast travel softens the picture a little and leans it into the direction of travel.
        smear: Math.min(1.4, Math.abs(speed) * 0.09),
        tilt: [Math.max(-1, Math.min(1, speed * 0.06)), 0],
        pixelRatio: scale,
      });
    } else {
      engine.render({ ...IDLE_VIEW, pixelRatio: scale });
    }

    if (this.#phase !== 'idle' || this.#presence > 0.002 || engine.pending > 0) {
      this.#frame = requestAnimationFrame(this.#tick);
    }
  };

  #endKeys(): void {
    if (this.#keysUntil === 0) return;

    this.#keysUntil = 0;
    this.#container?.removeAttribute('data-scry-keys');
    this.#wake();
  }

  /** Ask for the exact frame at `time`. Only Mux storyboards say where to find one. */
  #requestDetail(time: number): void {
    const base = this.#detailBase;
    const engine = this.#engine;
    const rounded = Math.round(time * 10) / 10;

    if (!base || !engine || this.#detailRequested === rounded) return;

    this.#detailRequested = rounded;

    const image = new Image();

    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      // Only if the pointer is still resting where it was when this was asked for.
      if (this.#detailRequested !== rounded || !this.#engine?.alive) return;

      this.#engine.setDetail(image);
      this.#detailTime = time;
      this.#wake();
    };
    image.src = `${base}?time=${rounded}&width=${DETAIL_WIDTH}`;
  }

  /** The slider let go: open the orb over the frame. */
  #commit(): void {
    const slider = this.#slider;
    const time = this.#time.value;

    if (!this.#live || !slider || !time || this.#phase === 'bloom' || this.#presence < 0.3) return;

    const duration = Number.isFinite(time.duration) ? time.duration : 0;
    const pointer = (Number.parseFloat(slider.style.getPropertyValue('--media-slider-pointer')) || 0) / 100;

    this.#latched = this.#measure(this.getBoundingClientRect());

    if (!this.#latched || duration <= 0) return;

    this.#target = pointer * duration;
    this.#phase = 'bloom';
    this.#bloom = 0;
    this.#reveal = 0;
    this.#bloomAge = 0;
    this.#frameReady = false;
    this.#frameRequested = false;
    this.#container?.setAttribute('data-scry-bloom', '');
    this.#releaseLock ??= this.#controls.value?.requestControlsLock() ?? null;
    this.#wake();
  }

  /** Wait for the player to finish seeking and put the new frame on screen. */
  #awaitFrame(seeking: boolean): void {
    if (this.#frameReady || this.#frameRequested || seeking || this.#bloomAge < 0.08) return;

    this.#frameRequested = true;

    const done = () => (this.#frameReady = true);
    const video = this.#video();

    // A paused player that was already on this frame presents nothing new, so the timer is the floor.
    video?.requestVideoFrameCallback?.(done);
    setTimeout(done, 180);
  }

  /** Back to nothing on screen. */
  #rest(): void {
    this.#phase = 'idle';
    this.#presence = 0;
    this.#bloom = 0;
    this.#reveal = 0;
    this.#latched = null;
    this.#detail = 0;
    this.#still = 0;
    this.#container?.removeAttribute('data-scry-bloom');
    this.#unlock();
    this.#wake();
  }

  #unlock(): void {
    this.#releaseLock?.();
    this.#releaseLock = null;
  }

  /** The anchor's circle, in CSS pixels relative to this element. */
  #measure(host: DOMRect): Circle | null {
    const rect = this.#anchor?.getBoundingClientRect();

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

  /** "+1:24" or "−0:30": how far ahead of, or behind, the present the orb is looking. */
  #writeDelta(seconds: number | null): void {
    let text = '';

    if (seconds !== null && Math.abs(seconds) >= 1) {
      const whole = Math.round(Math.abs(seconds));
      const hours = Math.floor(whole / 3600);
      const minutes = Math.floor((whole % 3600) / 60);
      const rest = String(whole % 60).padStart(2, '0');

      text = `${seconds > 0 ? '+' : '−'}${hours ? `${hours}:${String(minutes).padStart(2, '0')}` : minutes}:${rest}`;
    }

    if (text === this.#deltaText || !this.#delta) return;

    this.#deltaText = text;
    this.#delta.textContent = text;
  }
}

const IDLE_VIEW = {
  time: 0,
  x: 0,
  y: 0,
  radius: 1,
  frame: { x: 0, y: 0, width: 1, height: 1 },
  presence: 0,
  bloom: 0,
  reveal: 0,
  detail: 0,
  smear: 0,
  tilt: [0, 0] as [number, number],
};

/** Mux serves a still of any moment next to its storyboards; other hosts get no detail picture. */
function detailBase(spriteUrl: string): string | null {
  const match = /^https:\/\/image\.mux\.com\/([^/?#]+)\/storyboard\.\w+(\?.*)?$/.exec(spriteUrl);

  // Signed playback needs a separate token per image, which the skin does not have.
  if (!match || /[?&]token=/.test(match[2] ?? '')) return null;

  return `https://image.mux.com/${match[1]}/thumbnail.webp`;
}

if (!customElements.get('scry-vision')) customElements.define('scry-vision', ScryVisionElement);
