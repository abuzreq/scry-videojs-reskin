/**
 * Recognises a sideways drag on the picture and reports it as a fraction of the picture's width. It knows nothing
 * about time or the player; whoever owns it decides what a drag means.
 *
 * A press only becomes a drag once it has clearly moved sideways. Up and down is left to the page (scrolling), and
 * a press that does not move is left to the player's own tap gestures.
 */

/** A press becomes a drag once it has moved this far sideways, in CSS pixels. */
const THRESHOLD = 8;
/** Presses that start on these belong to the controls, not the picture. */
const CONTROLS = '.video-controls-bottom, .video-controls-top, .video-controls-center, [popover], .scry-arc';

export interface PictureDragHandlers {
  /** Asked on press; return false to ignore presses for now. */
  enabled(): boolean;
  /** A press has become a drag. */
  start(): void;
  /** How far the drag has gone since it started, as a fraction of the picture's width (negative is leftward). */
  move(fraction: number): void;
  /** The drag ended. `commit` is false when the browser cancelled it. */
  end(commit: boolean): void;
}

interface Press {
  pointer: number;
  x: number;
  y: number;
  active: boolean;
}

export class PictureDrag {
  #press: Press | null = null;

  constructor(container: HTMLElement, handlers: PictureDragHandlers, signal: AbortSignal) {
    container.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0 || !event.isPrimary || this.#press || !handlers.enabled()) return;
        if ((event.target as Element | null)?.closest(CONTROLS)) return;

        this.#press = { pointer: event.pointerId, x: event.clientX, y: event.clientY, active: false };
      },
      { signal }
    );

    container.addEventListener(
      'pointermove',
      (event) => {
        const press = this.#press;

        if (!press || press.pointer !== event.pointerId) return;

        const dx = event.clientX - press.x;
        const dy = event.clientY - press.y;

        if (!press.active) {
          if (Math.abs(dy) > THRESHOLD * 1.5 && Math.abs(dy) > Math.abs(dx)) {
            this.#press = null;

            return;
          }

          if (Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.2) return;

          // Measure from where it became a drag, so the picture does not lurch by the threshold.
          press.active = true;
          press.x = event.clientX;
          container.setPointerCapture(event.pointerId);
          handlers.start();
        }

        event.preventDefault();
        handlers.move((event.clientX - press.x) / Math.max(1, container.getBoundingClientRect().width));
      },
      { signal }
    );

    for (const type of ['pointerup', 'pointercancel'] as const) {
      container.addEventListener(
        type,
        (event) => {
          const press = this.#press;

          if (!press || press.pointer !== event.pointerId) return;

          this.#press = null;

          if (press.active) handlers.end(type === 'pointerup');
        },
        { signal }
      );
    }
  }

  /** A drag is in progress. */
  get active(): boolean {
    return Boolean(this.#press?.active);
  }
}
