import {
  PlayerController,
  type PropertyValues,
  playerContext,
  selectBuffer,
  selectControls,
  selectError,
  selectPlayback,
  selectTextTrack,
  selectTime,
  UIElement,
} from '@videojs/html';
import { LiquidEngine, type Tile } from '../liquid/engine';
import { loadSprite, tilesFromCues } from '../liquid/storyboard';
import { ArcBar, type ArcChapter, type ArcScrub } from './scry-arc';
import { CaptionStyle } from './vision/captions';
import { DepthTier, depthDevice } from './vision/depth-tier';
import { ExactFrames, stillTime } from './vision/exact-frame';
import {
  bigShape,
  type Circle,
  centreCircle,
  circleOf,
  findVideo,
  pictureRect,
  type Shape,
  startShape,
} from './vision/geometry';
import { FrameWatch, Journey } from './vision/journey';
import { dressMaterial, type Stone } from './vision/material';
import { PictureDrag } from './vision/picture-drag';
import { Spring, smooth, toward } from './vision/spring';
import { formatOffset } from './vision/time-format';

/** How quickly the picture in the orb catches its target. Higher is tighter; this settles in about a third of a second. */
const SPRING = 13;
/** A jump's picture travels on a stiffer spring than a hand's, so a skip is over quickly. */
const JUMP_SPRING = 22;
/** A jump keeps the orb closed this long after the last one, so repeated presses read as one journey. */
const JUMP_LINGER = 0.12;
/** Seeks shorter than this cut as usual: a one-second nudge on the slider is not a journey. */
const JUMP_MIN_SECONDS = 2.5;
/** A press on the timeline that neither moves nor lets go becomes a scrub after this long. */
const PRESS_HOLD = 0.15;
/** After a hand lets go, a seek within this long is that hand's own, not a jump. */
const RELEASE_GRACE = 0.35;
/** After a hand lets go, the pointer has to move this far before it counts as looking again. */
const QUIET_RADIUS = 24;
/** Buffering has to last this long before fog appears. */
const MIST_DELAY = 0.35;
/** A full-width drag on the picture covers this share of the video, and never less than this many seconds. */
const DRAG_SHARE = 1 / 3;
const DRAG_MIN_SECONDS = 45;
/** Where hovering travels, how long the travelling goes on after the pointer leaves. */
const HOVER_LINGER = 0.22;
/** If the stone has not been drawn this long after the page loads, the poster is shown the ordinary way instead. */
const START_TIMEOUT = 5000;
/** The pointer has to rest this long before the exact frame is fetched. */
const DWELL_SECONDS = 0.16;

/** What the canvas is drawing. One thing at a time. */
type Figure = 'none' | 'start' | 'peek' | 'big' | 'mist' | 'end';

/** The timeline's pointer state, read once per frame from what the slider reflects. */
interface Bar {
  dragging: boolean;
  /** The pointer is on the timeline, pressed or not. */
  pointing: boolean;
  /** The moment under the pointer. */
  time: number;
}

/** The container attributes this element owns, all prefixed `data-scry-`. The stylesheets select on them. */
const CONTAINER_STATE = ['gl', 'start', 'wrapped', 'flat', 'mist', 'ended', 'quiet', 'depth', 'hover', 'stone'];

/**
 * The vision layer of the Scry skin: the crystal ball.
 *
 * The video is a rectangle until time is travelled. Scrubbing (dragging the timeline, or dragging sideways on the
 * picture) and jumping (keys, taps, anything that seeks) wrap the picture into a large glass orb in the middle of
 * the player. Inside it the storyboard flows from moment to moment instead of flipping; around its lower rim the
 * timeline curls into an arc. When the travelling ends the orb unwraps onto the new frame.
 *
 * Merely resting the pointer on the timeline peeks instead: a small orb at the pointer shows that moment and the
 * picture is left alone.
 *
 * Before the first play the player waits as the stone: the poster frame held in an orb with the play control at its
 * centre and embers rising through it. Pressing play opens it into the rectangle.
 *
 * The same glass shows up in the other places the player waits or rests: fog in a small orb while buffering, and
 * the opening frame held in an orb when the video has ended.
 *
 * Attributes:
 * - `stone="glass"`: clear crystal instead of the default dark seeing-stone, in which the picture surfaces out of
 *   black glass and a fire inside brightens the harder time is driven.
 * - `shape="flat"`: nothing wraps. Time travel plays the same flowing picture across the plain rectangle, with no
 *   lens, glass or stage, so the morph itself can be seen. `inspect="flow"`, `"compare"` or `"agreement"` then shows
 *   the flow field, a plain crossfade beside the morph, or where the two frames agree.
 * - `depth="auto"`: the optional depth tier, which gives the picture in the orb real parallax where WebGPU is
 *   available (`depth="wasm"` forces the slow WebAssembly backend). Off by default; it is the only part that
 *   downloads a model.
 *
 * It is decoration over working controls. The time slider keeps doing the seeking, the labelling and the keyboard.
 * Without WebGL2, or with reduced motion, nothing wraps: seeks cut and the slider preview shows a still thumbnail.
 *
 * How this file is laid out: this element is the conductor. It reads the player's state and the pointer, decides
 * each frame where the picture should be heading and which figure is on screen, and hands a description of that to
 * the engine. The parts that can be understood on their own live beside it in `./vision`: the wrap's state machine
 * (`journey`), the spring, layout arithmetic (`geometry`), the picture-drag recogniser, exact frames, the depth
 * run, the material and caption styling. Drawing is `../liquid`; the curved bar is `./scry-arc`.
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

  // The player's state.
  #time = new PlayerController(this, playerContext, selectTime);
  #playback = new PlayerController(this, playerContext, selectPlayback);
  #buffer = new PlayerController(this, playerContext, selectBuffer);
  #tracks = new PlayerController(this, playerContext, selectTextTrack);
  #controls = new PlayerController(this, playerContext, selectControls);
  #error = new PlayerController(this, playerContext, selectError);

  // The page around this element.
  #disconnect: AbortController | null = null;
  #container: HTMLElement | null = null;
  #slider: HTMLElement | null = null;
  #anchor: HTMLElement | null = null;
  #delta: HTMLElement | null = null;
  #deltaText = '';
  #centre: HTMLElement | null = null;
  #reducedMotion: MediaQueryList | null = null;

  // What draws.
  #canvas: HTMLCanvasElement | null = null;
  #engine: LiquidEngine | null = null;
  #engineFailed = false;
  #arc: ArcBar | null = null;
  #storyboardKey = '';
  #blankTimer = 0;
  #startTimer = 0;
  #startCentre: { key: string; circle: Circle } | null = null;
  #exact = new ExactFrames(() => this.#engine);
  #depth = new DepthTier();
  #captions = new CaptionStyle();

  // What is on screen.
  #figure: Figure = 'none';
  #shape: Shape = { x: 0, y: 0, radius: 1, wide: 0, stage: 0 };
  #presence = 0;
  #mist = 0;
  #sparks = 0;
  #heat = 0;
  #detail = 0;
  /** The moment the picture is heading for, and the picture itself on its way there. */
  #target = 0;
  #picture = new Spring();
  #journey = new Journey();
  #frames = new FrameWatch();
  #clock = 0;
  #frame = 0;
  #last = 0;
  #still = 0;
  #lastTarget = 0;
  #waitAge = 0;
  #releaseLock: (() => void) | null = null;

  // Hands: what is moving time, or just did.
  #barPressed = false;
  #pressClock = 0;
  #pressFrom = 0;
  #arcScrubbing = false;
  #arcResume = false;
  #pictureDrag: PictureDrag | null = null;
  #dragBase = 0;
  #dragResume = false;
  #pointer: { x: number; y: number; mouse: boolean } | null = null;
  #hoverUntil = 0;
  #hoverSession = false;
  /** After a release the pointer is ignored until it moves away from where it let go. */
  #quiet = false;
  #quietAt: { x: number; y: number } | null = null;

  // Telling jumps from the seeks that hands make.
  #jumpUntil = 0;
  #graceUntil = 0;
  #settledTime = 0;
  #wasSeeking = false;

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

    this.#watchMaterial(container, signal);
    this.#watchBar(slider, signal);
    this.#watchPicture(container, signal);

    this.#reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.#reducedMotion.addEventListener('change', () => this.#syncMode(), { signal });
    this.#expectStart(container);

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
    clearTimeout(this.#startTimer);
    this.#frame = 0;
    this.#blankTimer = 0;
    this.#startTimer = 0;
    this.#unlock();
    this.#depth.stop();
    this.#engine?.dispose();
    this.#engine = null;
    this.#canvas?.remove();
    this.#canvas = null;
    this.#arc?.element.remove();
    this.#arc = null;
    this.#captions.remove();
    this.#pictureDrag = null;
    this.#storyboardKey = '';
    this.#figure = 'none';
    this.#journey.reset();

    for (const name of CONTAINER_STATE) this.#container?.removeAttribute(`data-scry-${name}`);
  }

  update(changed: PropertyValues): void {
    super.update(changed);
    this.#loadStoryboard();

    if (!this.#captions.applied) this.#dressCaptions();

    const time = this.#time.value;

    if (!time) return;

    // When playback fails there is nothing to arrive at: put the orb away so the error dialog has the stage.
    if (this.#error.value?.error) {
      if (this.#figure !== 'none') this.#rest();

      return;
    }

    this.#noticeJump(time);

    if (this.#playback.value?.started) this.#container?.removeAttribute('data-scry-start');

    // No storyboard after a moment: carry on without one, on the frames the player itself shows.
    if (!this.#engine && !this.#engineFailed && !this.#blankTimer && time.duration > 0) {
      this.#blankTimer = window.setTimeout(() => this.#withoutStoryboard(), 1500);
    }

    const playback = this.#playback.value;

    if (playback?.waiting || playback?.ended || !playback?.started || this.#figure !== 'none') this.#wake();
  }

  // ---------------------------------------------------------------- setting up

  /** The material themes the whole skin, not only the orb, so the container carries it from the first paint. */
  #watchMaterial(container: HTMLElement, signal: AbortSignal): void {
    const dress = () => {
      dressMaterial(container, this.#stone);
      this.#dressCaptions();
    };
    const observer = new MutationObserver(dress);

    observer.observe(this, { attributes: true, attributeFilter: ['stone'] });
    signal.addEventListener('abort', () => observer.disconnect());
    dress();
  }

  /**
   * The player opens as the stone, so until the stone is drawn the flat poster is kept out of sight (the stylesheet
   * hides it while the container carries `data-scry-start`). Where the stone cannot be drawn, or does not turn up in
   * time, the poster comes back.
   */
  #expectStart(container: HTMLElement): void {
    const possible = typeof WebGL2RenderingContext !== 'undefined' && !this.#reducedMotion?.matches && !this.#flat;

    if (!possible || this.#playback.value?.started) return;

    container.setAttribute('data-scry-start', 'pending');
    this.#startTimer = window.setTimeout(() => {
      if (this.#figure !== 'start') container.removeAttribute('data-scry-start');
    }, START_TIMEOUT);
  }

  /** Captions follow the material; see `CaptionStyle` for why this cannot be left to the stylesheet. */
  #dressCaptions(): void {
    if (this.#container) this.#captions.apply(this.#video(), this.#container);
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
        this.#exact.setStoryboard(board.url);
        this.#syncMode();
        this.#startDepth(engine, image, board.tiles);
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
    } catch (error) {
      // The skin carries on without the orb; say why, once, for whoever is integrating it.
      console.warn('Scry: the orb is off because WebGL2 could not start.', error);
      this.#engineFailed = true;
      this.#container?.removeAttribute('data-scry-start');

      return null;
    }

    this.#canvas = canvas;
    this.#arc = new ArcBar(this.#arcScrub);
    this.append(canvas, this.#arc.element);
    this.#resize();

    return this.#engine;
  }

  /** The optional depth pass over a freshly loaded storyboard. */
  #startDepth(engine: LiquidEngine, image: HTMLImageElement, tiles: Tile[]): void {
    const device = depthDevice(this.getAttribute('depth'), Boolean(this.#reducedMotion?.matches));

    if (!device) {
      this.#depth.stop();

      return;
    }

    void this.#depth.start(
      engine,
      image,
      tiles,
      device,
      () => engine.locate(this.#time.value?.currentTime ?? 0).index,
      () => {
        this.#container?.setAttribute('data-scry-depth', '');
        this.#wake();
      }
    );
  }

  #syncMode(): void {
    // The small orb needs storyboard tiles; without them the slider preview keeps its own fallback.
    this.#container?.toggleAttribute('data-scry-gl', this.#live && this.#storied);

    // The opening stone shows the poster's moment from the storyboard; without one the poster itself stays.
    if (!this.#live || !this.#storied) this.#container?.removeAttribute('data-scry-start');

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

  // ---------------------------------------------------------------- what mode it is in

  /** True when the engine may draw. Otherwise the skin's plain fallbacks stand. */
  get #live(): boolean {
    return Boolean(this.#engine?.ready && this.#engine.alive && !this.#reducedMotion?.matches);
  }

  /** True when there are real storyboard tiles to flow between, rather than only captured frames. */
  get #storied(): boolean {
    return (this.#engine?.tiles.length ?? 0) > 1;
  }

  /** `shape="flat"`: the picture stays a rectangle. */
  get #flat(): boolean {
    return this.getAttribute('shape') === 'flat';
  }

  /**
   * What resting the pointer on the timeline does. Normally it peeks: a small orb at the pointer, the picture left
   * alone. Flat, it travels: the whole frame follows the pointer, which is what that mode is for.
   */
  get #hoverMode(): 'travel' | 'peek' {
    return this.#flat ? 'travel' : 'peek';
  }

  /** The orb's material: the dark seeing-stone unless `stone="glass"` asks for clear crystal. */
  get #stone(): Stone {
    return this.getAttribute('stone') === 'glass' ? 'glass' : 'obsidian';
  }

  /** Which study view `inspect` asks for; 0 is none. */
  get #inspect(): number {
    return ['flow', 'compare', 'agreement'].indexOf(this.getAttribute('inspect') ?? '') + 1;
  }

  #video(): HTMLVideoElement | null {
    return findVideo(this.#container);
  }

  // ---------------------------------------------------------------- hands on the timeline, the arc and the picture

  /** A pointer is on the timeline, the arc or the picture, moving time by hand. */
  get #scrubbing(): boolean {
    return (
      this.#barPressed ||
      this.#arcScrubbing ||
      Boolean(this.#pictureDrag?.active) ||
      Boolean(this.#slider?.hasAttribute('data-dragging'))
    );
  }

  /**
   * The straight timeline. The slider does the seeking itself; this only needs to know when it is pressed, so the
   * orb can close, and whether the press turned out to be a click.
   */
  #watchBar(slider: HTMLElement, signal: AbortSignal): void {
    // The slider reflects its pointer state as attributes; that is the cue to look at it again.
    const observer = new MutationObserver(() => this.#wake());

    observer.observe(slider, { attributes: true, attributeFilter: ['data-pointing', 'data-dragging'] });
    signal.addEventListener('abort', () => observer.disconnect());

    slider.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0) return;

        this.#barPressed = true;
        this.#pressClock = this.#clock;
        this.#pressFrom = this.#time.value?.currentTime ?? 0;
        this.#quiet = false;
        this.#wake();
      },
      { signal }
    );

    // The slider captures the pointer, so the release lands here too.
    for (const type of ['pointerup', 'pointercancel'] as const) {
      slider.addEventListener(
        type,
        () => {
          if (!this.#barPressed) return;

          // A press that never became a scrub was a click: one clean jump, or for a small step no orb at all.
          const clicked = type === 'pointerup' && !this.#journey.closed;

          this.#barPressed = false;

          if (clicked) this.#clickJump();

          this.#release();
        },
        { signal }
      );
    }

    slider.addEventListener('pointerleave', () => (this.#quiet = false), { signal });
  }

  /** The picture: where the pointer is over it, and sideways drags on it. */
  #watchPicture(container: HTMLElement, signal: AbortSignal): void {
    const track = (event: PointerEvent) => {
      this.#pointer = { x: event.clientX, y: event.clientY, mouse: event.pointerType === 'mouse' };
    };

    // These go on before the drag recogniser's, so the pointer is already known when a drag reports.
    container.addEventListener('pointerdown', track, { signal });
    container.addEventListener(
      'pointermove',
      (event) => {
        track(event);

        const from = this.#quietAt;

        if (this.#quiet && (!from || Math.hypot(event.clientX - from.x, event.clientY - from.y) > QUIET_RADIUS)) {
          this.#quiet = false;
          this.#wake();
        }

        if (this.#hoverMode === 'travel' && this.#journey.closed) this.#wake();
      },
      { signal }
    );
    container.addEventListener(
      'pointerleave',
      () => {
        this.#pointer = null;
        this.#wake();
      },
      { signal }
    );

    this.#pictureDrag = new PictureDrag(
      container,
      {
        enabled: () => this.#live,
        start: () => {
          this.#dragBase = this.#time.value?.currentTime ?? 0;
          this.#dragResume = this.#pauseForScrub();
          this.#target = this.#dragBase;
          this.#close('scrub', this.#dragBase);
        },
        move: (fraction) => {
          // Relative to where the drag began: right is forward, left is back.
          const duration = this.#duration;
          const span = Math.min(duration, Math.max(DRAG_MIN_SECONDS, duration * DRAG_SHARE));

          this.#target = Math.min(duration, Math.max(0, this.#dragBase + fraction * span));
          this.#wake();
        },
        end: (commit) => {
          if (commit) this.#time.value?.seek(this.#target);
          else this.#target = this.#dragBase;

          if (this.#dragResume) void this.#playback.value?.play();

          this.#release();
        },
      },
      signal
    );
  }

  /** The curved bar reports scrubs along it. */
  #arcScrub: ArcScrub = (phase, time) => {
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
  };

  /** Scrubbing by hand holds the video still; returns whether it was playing. */
  #pauseForScrub(): boolean {
    const playback = this.#playback.value;

    if (!playback || playback.paused || playback.ended) return false;

    playback.pause();

    return true;
  }

  /** A hand let go of the timeline, the arc or the picture. */
  #release(): void {
    // The seek that follows a release is ours, not a jump.
    this.#graceUntil = this.#clock + RELEASE_GRACE;
    // The seek belonging to this release may not have started yet; give it a beat before asking for its frame.
    this.#frames.expect(this.#clock + 0.06);
    // The pointer is usually still where it was; do not treat that as a new look until it moves away.
    this.#quiet = true;
    this.#quietAt = this.#pointer ? { x: this.#pointer.x, y: this.#pointer.y } : null;
    this.#wake();
  }

  // ---------------------------------------------------------------- jumps

  /** Anything that seeks without a pointer on the timeline is a jump: keys, taps, a replay, another script. */
  #noticeJump(time: { currentTime: number; seeking: boolean }): void {
    if (time.seeking && !this.#wasSeeking && this.#live && !this.#scrubbing && this.#clock > this.#graceUntil) {
      if (Math.abs(time.currentTime - this.#settledTime) >= JUMP_MIN_SECONDS) this.#jump(this.#settledTime);
    }

    if (!time.seeking) this.#settledTime = time.currentTime;

    this.#wasSeeking = time.seeking;
  }

  /** The timeline was clicked rather than dragged: travel there as a jump, if it is far enough to be one. */
  #clickJump(): void {
    const slider = this.#slider;

    if (!this.#live || !slider || !Number.isFinite(this.#time.value?.duration)) return;

    if (Math.abs(this.#readBar(slider).time - this.#pressFrom) >= JUMP_MIN_SECONDS) this.#jump(this.#pressFrom);
  }

  /** Something seeked on its own. `from` is the moment it left. */
  #jump(from: number): void {
    this.#jumpUntil = this.#clock + JUMP_LINGER;
    this.#frames.expect(this.#clock);
    this.#close('jump', from);
  }

  // ---------------------------------------------------------------- closing and resting

  /** Wrap the picture into the orb. `from` is the moment the picture is showing as it starts. */
  #close(kind: 'scrub' | 'jump', from: number): void {
    if (!this.#engine || !this.#live) return;

    // The opening stone and the ending are already orbs: they only have to change size.
    const alreadyOrb = this.#figure === 'end' || this.#figure === 'start';

    if (!this.#journey.close(kind, alreadyOrb)) return;

    this.#presence = 1;
    this.#mist = 0;

    if (!alreadyOrb) {
      // Start from the very frame on screen, so the first instant of the wrap changes nothing.
      this.#picture.snap(from);
      this.#capture(from);
    }

    this.#figure = 'big';
    this.#container?.setAttribute(this.#flat ? 'data-scry-flat' : 'data-scry-wrapped', '');
    this.#releaseLock ??= this.#controls.value?.requestControlsLock() ?? null;
    this.#wake();
  }

  /** Back to the plain rectangle, or to nothing on screen. */
  #rest(): void {
    this.#journey.reset();
    this.#hoverSession = false;
    this.#figure = 'none';
    this.#presence = 0;
    this.#mist = 0;
    this.#sparks = 0;
    this.#detail = 0;
    this.#still = 0;
    // Nothing may be drawing after this (a failed source has no duration to tick on), so wipe the canvas now.
    this.#engine?.clear();
    this.#container?.removeAttribute('data-scry-wrapped');
    this.#container?.removeAttribute('data-scry-flat');
    this.#arc?.element.removeAttribute('data-visible');
    this.#unlock();
    this.#wake();
  }

  /** While the orb is closed the controls are kept from auto-hiding; this lets them go. */
  #unlock(): void {
    this.#releaseLock?.();
    this.#releaseLock = null;
  }

  /** Take the frame the player is showing as the exact picture for `time`. Study views keep the storyboard's. */
  #capture(time: number): void {
    this.#detail = this.#exact.capture(this.#inspect > 0 ? null : this.#video(), time) ? 1 : 0;
  }

  // ---------------------------------------------------------------- each frame

  #wake(): void {
    if (this.#frame || !this.isConnected) return;

    this.#last = 0;
    this.#frame = requestAnimationFrame(this.#tick);
  }

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

  /**
   * One frame. In order: see what hands are doing and aim the picture; pick the figure and move it into place;
   * move the picture; advance the wrap; settle the finish (sharpness, fog, fire); draw.
   */
  #step(dt: number): void {
    const slider = this.#slider;
    const time = this.#time.value;
    const engine = this.#engine;

    if (!slider || !time) return;

    this.#clock += dt;

    const bar = this.#readBar(slider);

    if (!this.#live || !engine || !this.#canvas || this.#duration <= 0) {
      // Nothing to draw. The slider preview's caption still shows how far ahead the pointer is.
      this.#writeDelta(bar.pointing ? bar.time - time.currentTime : null);
      if (bar.pointing) this.#frame = requestAnimationFrame(this.#tick);

      return;
    }

    const host = this.getBoundingClientRect();
    const big = bigShape(host);

    // ---- the first play: the opening stone becomes the big orb, which then opens onto the video
    if (this.#figure === 'start' && this.#playback.value?.started) {
      this.#frames.expect(this.#clock);
      // Briskly: the video is already running underneath.
      this.#close('jump', this.#picture.value);
    }

    // ---- hands: what holds the orb closed, and where the picture should head
    const hovering = this.#followHover(bar, time.currentTime, host, big);
    const jumping = this.#clock < this.#jumpUntil;

    this.#followBar(bar, time.currentTime, jumping);

    const held = this.#scrubbing || hovering || jumping;

    this.#journey.hold(held);

    // ---- the figure: which one, where, and how present
    const goal = this.#chooseFigure(bar, time.currentTime, host, big, dt);
    const peeking = this.#figure === 'peek' && goal !== null;

    this.#container?.toggleAttribute('data-scry-quiet', this.#quiet);
    this.#container?.setAttribute('data-scry-hover', this.#hoverMode);
    this.#container?.toggleAttribute('data-scry-mist', this.#figure === 'mist' && goal !== null);
    this.#container?.toggleAttribute('data-scry-ended', this.#figure === 'end' && goal !== null);

    if (this.#figure === 'start' && goal) this.#container?.setAttribute('data-scry-start', 'orb');
    this.#writeDelta(peeking ? this.#target - time.currentTime : null);
    this.#placeFigure(goal, dt);

    // ---- the picture: it glides to its target and never overshoots
    this.#picture.step(this.#target, this.#journey.brisk ? JUMP_SPRING : SPRING, dt);

    const tileSeconds = engine.tiles.length > 1 ? (engine.tiles.at(-1)!.time - engine.tiles[0]!.time) / (engine.tiles.length - 1) : 0;
    /** How fast the picture is travelling, in storyboard tiles per second. */
    const speed = tileSeconds > 0 ? this.#picture.velocity / tileSeconds : 0;

    // ---- the wrap, then the finish
    this.#travel(dt, time, hovering, tileSeconds);
    this.#finish(dt, speed);

    if (this.dataset.phase !== this.#figure) this.dataset.phase = this.#figure;
    if (engine.pending > 0) engine.solve(2, this.#picture.value);

    this.#draw(engine, this.#canvas, host, speed);
    this.#drawArc(host, big, bar);

    const visible = this.#figure !== 'none';

    if (visible || held || this.#barPressed || engine.pending > 0 || this.#playback.value?.waiting) {
      this.#frame = requestAnimationFrame(this.#tick);
    }
  }

  get #duration(): number {
    const duration = this.#time.value?.duration ?? 0;

    return Number.isFinite(duration) ? duration : 0;
  }

  #readBar(slider: HTMLElement): Bar {
    const dragging = slider.hasAttribute('data-dragging');
    const percent = Number.parseFloat(slider.style.getPropertyValue('--media-slider-pointer')) || 0;

    return {
      dragging,
      pointing: dragging || slider.hasAttribute('data-pointing'),
      time: (percent / 100) * this.#duration,
    };
  }

  /**
   * Where hovering travels (flat), resting on the timeline closes the picture and aims it at the pointer. Returns
   * whether hovering is holding the picture this frame.
   */
  #followHover(bar: Bar, now: number, host: DOMRect, big: Shape): boolean {
    if (this.#hoverMode !== 'travel' || this.#pointer?.mouse === false || this.#quiet) return false;

    const pointer = this.#pointer;
    // Once hovering has closed the picture, the pointer may wander over it (to reach the arc) without it opening.
    const onOrb =
      this.#journey.closed &&
      this.#hoverSession &&
      pointer !== null &&
      Math.hypot(pointer.x - host.left - big.x, pointer.y - host.top - big.y) < big.radius + 36;

    if (bar.pointing || onOrb) this.#hoverUntil = this.#clock + HOVER_LINGER;
    if (bar.pointing) this.#hoverSession = true;

    const hovering = this.#clock < this.#hoverUntil;

    if (hovering && !this.#scrubbing) {
      if (!this.#journey.closed) this.#close('scrub', now);

      const arcTime = pointer ? (this.#arc?.timeUnder(pointer.x, pointer.y) ?? null) : null;

      this.#target = bar.pointing ? bar.time : (arcTime ?? now);
    }

    return hovering;
  }

  /** A hand on the straight timeline closes the picture and aims it; a jump aims it at wherever the player now is. */
  #followBar(bar: Bar, now: number, jumping: boolean): void {
    // Pressing is not yet scrubbing: the orb waits for the pointer to move, or for the press to be held.
    const onBar = bar.dragging || (this.#barPressed && this.#clock - this.#pressClock > PRESS_HOLD);

    if (onBar) {
      if (!this.#journey.closed) this.#close('scrub', now);

      this.#target = bar.time;
    } else if (jumping && !this.#scrubbing) {
      this.#target = now;
    }
  }

  /**
   * Decide what the canvas shows this frame and return where it belongs, or null for nothing. The big orb wins;
   * then a peek while the pointer rests on the timeline; then the ending; then fog while buffering.
   */
  #chooseFigure(bar: Bar, now: number, host: DOMRect, big: Shape, dt: number): Shape | null {
    const playback = this.#playback.value;

    if (!playback?.waiting) this.#waitAge = 0;

    if (this.#journey.closed) return big;

    if (playback && !playback.started && !playback.ended && this.#storied && !this.#flat) {
      const moment = this.#posterTime();

      if (this.#figure !== 'start') {
        this.#become('start', moment);
        this.#exact.drop();
      }

      // Resting on the timeline looks ahead in the stone itself.
      this.#target = bar.pointing && !this.#quiet ? bar.time : moment;

      // The play control moves a little as it is hovered and hidden; the stone stays where it was first put.
      const key = `${Math.round(host.width)}x${Math.round(host.height)}`;

      if (this.#startCentre?.key !== key) {
        this.#startCentre = { key, circle: circleOf(this.#centre, host) ?? centreCircle(host) };
      }

      return startShape(host, this.#startCentre.circle);
    }

    if (this.#hoverMode === 'peek' && bar.pointing && !this.#quiet && this.#storied) {
      const circle = circleOf(this.#anchor, host);

      if (!circle) return null;

      if (this.#figure !== 'peek') {
        this.#become('peek', bar.time);
        this.#exact.drop();
      }

      this.#target = bar.time;

      return { ...circle, wide: 0, stage: 0 };
    }

    if (playback?.ended && !this.#flat) {
      const circle = circleOf(this.#centre, host);

      if (!circle || !this.#storied) return null;

      if (this.#figure !== 'end') {
        // The opening frame, a little way in so it is not a fade from black.
        this.#become('end', Math.min(2, this.#duration * 0.05));
        this.#exact.drop();
      }

      return { x: circle.x, y: circle.y, radius: circle.radius * 2, wide: 0.7, stage: 0.55 };
    }

    if (playback?.waiting && !playback.paused && !this.#flat) {
      this.#waitAge += dt;

      if (this.#waitAge <= MIST_DELAY) return null;

      // The skin hides its centre button while buffering, so the fog takes that button's usual place and size.
      const circle = circleOf(this.#centre, host) ?? centreCircle(host);

      if (this.#figure !== 'mist') {
        this.#become('mist', now);
        this.#capture(now);
      }

      return { x: circle.x, y: circle.y, radius: circle.radius * 1.5, wide: 0.5, stage: 0.3 };
    }

    return null;
  }

  /** The moment the poster shows, where its address says; otherwise a little way in, past any fade from black. */
  #posterTime(): number {
    const poster = this.#container?.querySelector<HTMLImageElement>('.media-poster-image');

    return stillTime(poster?.currentSrc || poster?.src || '') ?? Math.min(2, this.#duration * 0.05);
  }

  /** Switch to a figure, with its picture starting at `time` and carrying no motion over. */
  #become(figure: Figure, time: number): void {
    this.#figure = figure;
    this.#target = time;
    this.#picture.snap(time);
  }

  /** Fade the figure in or out and move it to where it belongs. */
  #placeFigure(goal: Shape | null, dt: number): void {
    if (this.#figure !== 'big') {
      this.#presence = toward(this.#presence, goal ? 1 : 0, goal ? 14 : 22, dt);

      if (!goal && this.#presence < 0.004) this.#figure = 'none';
    }

    if (!goal) return;

    // Small figures sit exactly on their anchors. Only an orb that is already wrapped (the ending, growing into
    // the big orb) glides to its new place.
    const settle = this.#journey.wrap < 0.02 ? 1 : 1 - Math.exp(-dt * 14);

    for (const key of ['x', 'y', 'radius', 'wide', 'stage'] as const) {
      this.#shape[key] += (goal[key] - this.#shape[key]) * settle;
    }
  }

  /** Advance the wrap: closing, waiting for the player's new frame, opening onto it. */
  #travel(dt: number, time: { currentTime: number; seeking: boolean }, hovering: boolean, tileSeconds: number): void {
    const journey = this.#journey;

    if (!journey.closed) return;

    const video = this.#video();
    // A player with no picture yet (the first play, still loading) is as far from ready as one that is seeking.
    const seeking = time.seeking || Boolean(video && video.readyState < 2);

    // The new frame is watched for from the moment hands are off, so a quick seek is ready by the time the orb is.
    if (!this.#scrubbing && !hovering) this.#frames.poll(this.#clock, seeking, video);

    // With nothing holding it, the picture heads for wherever the player actually is.
    if (journey.opening) this.#target = time.currentTime;

    const near = Math.max(0.2, tileSeconds * (journey.brisk ? 0.5 : 0.3));
    const event = journey.step(dt, {
      frameReady: this.#frames.ready,
      arrived: Math.abs(this.#picture.value - this.#target) < near,
      seeking,
    });

    if (event === 'unwrap') {
      // The frame is on screen underneath: take it as the exact picture and lay it back down.
      this.#capture(time.currentTime);
      this.#picture.snap(this.#target);
    } else if (event === 'rest') {
      this.#rest();
    }
  }

  /**
   * The finish on the picture: the exact frame fades in when the picture rests on one moment and out when it moves
   * off; fog covers waiting; the fire answers to speed.
   */
  #finish(dt: number, speed: number): void {
    const journey = this.#journey;
    const visible = this.#figure !== 'none';
    const steady = Math.abs(this.#target - this.#lastTarget) < 0.02;

    this.#lastTarget = this.#target;
    this.#still = steady && visible && !journey.unwrapping ? this.#still + dt : 0;

    // Flat, the storyboard's own picture stays on screen: fetching the true frame would cover what is being studied.
    if (this.#still > DWELL_SECONDS && this.#figure !== 'mist' && !this.#flat) {
      this.#exact.request(
        this.#target,
        () => !this.#journey.unwrapping,
        () => this.#wake()
      );
    }

    const away = this.#exact.time === null ? Infinity : Math.abs(this.#picture.value - this.#exact.time);
    // Without a storyboard the captured frame is all there is: hold it, and let fog say how far away the target is.
    const focused = visible && (this.#storied ? away < 0.12 : this.#exact.time !== null);
    const fog = this.#figure === 'mist' ? 1 : journey.waiting ? 0.75 : this.#storied ? 0 : smooth(away / 4) * 0.8;
    // The fire answers to how fast the picture is travelling, and smoulders while the orb is held closed.
    const waitingToStart = this.#figure === 'start';
    const fire = Math.min(
      1,
      Math.abs(speed) * 0.22 + (journey.closed && !journey.unwrapping ? 0.22 : 0) + (waitingToStart ? 0.3 : 0)
    );

    this.#detail = toward(this.#detail, focused ? 1 : 0, focused ? 10 : 22, dt);
    this.#mist = toward(this.#mist, fog, 6, dt);
    this.#sparks = toward(this.#sparks, waitingToStart ? 1 : 0, 3, dt);
    this.#heat = toward(this.#heat, fire, 5, dt);
  }

  /** Describe this frame to the engine. */
  #draw(engine: LiquidEngine, canvas: HTMLCanvasElement, host: DOMRect, speed: number): void {
    const scale = canvas.width / Math.max(1, host.width);
    const isBig = this.#figure === 'big';
    const flat = this.#flat;
    // Flat, the big figure keeps its timing but never leaves the rectangle.
    const wrap = isBig ? (flat ? 0 : this.#journey.wrap) : 1;

    engine.render({
      time: this.#picture.value,
      x: this.#shape.x * scale,
      y: this.#shape.y * scale,
      radius: this.#shape.radius * scale,
      frame: this.#pictureRect(host, scale, engine),
      presence: this.#figure !== 'none' ? this.#presence : 0,
      wrap,
      stage: flat && isBig ? 0 : this.#shape.stage * (isBig ? smooth(wrap * 1.3) : 1),
      wide: this.#shape.wide,
      mist: this.#mist,
      sparks: this.#sparks,
      clock: this.#clock,
      reveal: isBig ? this.#journey.reveal : 0,
      inspect: this.#inspect,
      stone: this.#stone === 'obsidian' ? 1 : 0,
      heat: this.#heat,
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
  }

  /** Where the video picture sits inside this element, in canvas pixels, honouring `object-fit`. */
  #pictureRect(host: DOMRect, scale: number, engine: LiquidEngine) {
    const video = this.#video();
    const tile = engine.tiles[0];
    const aspect =
      video && video.videoWidth > 0 ? video.videoWidth / video.videoHeight : tile ? tile.width / tile.height : 16 / 9;
    const cover = video ? getComputedStyle(video).objectFit === 'cover' : false;

    return pictureRect(host, aspect, cover, scale);
  }

  /** The curved bar exists while the big orb does; at wrap 0 it lies exactly on the straight one. */
  #drawArc(host: DOMRect, big: Shape, bar: Bar): void {
    const arc = this.#arc;
    const slider = this.#slider;
    const time = this.#time.value;

    if (!arc || !slider || !time) return;

    const showing = this.#figure === 'big' && !this.#flat;

    arc.element.toggleAttribute('data-visible', showing);

    if (!showing) return;

    const journey = this.#journey;
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
        wrap: journey.wrap,
      },
      {
        duration: time.duration,
        currentTime: time.currentTime,
        knobTime: journey.opening ? time.currentTime : bar.dragging && !journey.closed ? bar.time : this.#target,
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

  /** "+1:24" or "−0:30" in the slider preview: how far ahead of, or behind, the present the pointer is. */
  #writeDelta(seconds: number | null): void {
    const text = seconds === null ? '' : formatOffset(seconds);

    if (text === this.#deltaText || !this.#delta) return;

    this.#deltaText = text;
    this.#delta.textContent = text;
  }
}

if (!customElements.get('scry-vision')) customElements.define('scry-vision', ScryVisionElement);
