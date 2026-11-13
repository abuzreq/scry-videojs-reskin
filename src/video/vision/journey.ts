/**
 * The wrap, as a state machine with no knowledge of the page.
 *
 * A journey starts when the picture closes into the orb and ends when it has opened onto the new frame:
 *
 *   open ──close()──▶ closing ──(wrap reaches 1)──▶ closed ──(nothing holds it)──▶ opening
 *        ◀──────────────── 'rest' ◀── unwrapping ◀──(the new frame is on screen)──┘
 *
 * Anything that holds it (a hand scrubbing, a jump in progress) sends it back toward closed from wherever it is,
 * and a journey that is let go before the orb has fully closed finishes closing first, so the gesture is never left
 * half made.
 */

/** Rectangle to orb and back, in seconds: while scrubbing, and for a jump. */
export const WRAP_SECONDS = { scrub: 0.34, jump: 0.18 };
export const UNWRAP_SECONDS = { scrub: 0.4, jump: 0.24 };
/** Longest the closed orb waits for the new frame before opening anyway; five times that while a seek is running. */
export const READY_TIMEOUT = 1.6;
/** How long the closed orb has been waiting before the wait is worth showing (as fog). */
export const WAIT_SHOWS_AFTER = 0.35;
/** The handover to the video underneath happens over the last part of the unwrap. */
const REVEAL_BELOW = 0.4;

export type JourneyKind = 'scrub' | 'jump';

export interface JourneyInput {
  /** The player has put the frame it was asked for on screen. */
  frameReady: boolean;
  /** The picture in the orb has caught up with where it is going. */
  arrived: boolean;
  /** The player is still seeking. */
  seeking: boolean;
}

export class Journey {
  /** True from the moment the picture starts to close until it has fully opened again. */
  closed = false;
  /** 0 the plain rectangle, 1 the orb. */
  wrap = 0;
  /** 0 the orb's own picture, 1 fully handed over to the video underneath. */
  reveal = 0;
  #brisk = false;
  #opening = false;
  #unwrapping = false;
  #openAge = 0;

  /** A jump's journey, which moves faster than a hand's. */
  get brisk(): boolean {
    return this.#brisk;
  }

  /** Nothing holds it any more: it is waiting for the new frame, or already laying it back down. */
  get opening(): boolean {
    return this.#opening;
  }

  /** The new frame is on screen underneath and the orb is laying the picture back down onto it. */
  get unwrapping(): boolean {
    return this.#unwrapping;
  }

  /** Closed and waiting on the player for long enough that the wait should be shown. */
  get waiting(): boolean {
    return this.#opening && !this.#unwrapping && this.#openAge > WAIT_SHOWS_AFTER;
  }

  /**
   * Begin, or take over, a journey. Returns true when this call is what closed the picture; false when it was
   * already closed and only the pace changed. `alreadyOrb` starts fully wrapped, for when an orb is on screen as
   * something else (the ending) and only has to grow.
   */
  close(kind: JourneyKind, alreadyOrb = false): boolean {
    this.#opening = false;
    this.#unwrapping = false;
    this.#brisk = kind === 'jump';

    if (this.closed) return false;

    this.closed = true;
    this.reveal = 0;
    this.wrap = alreadyOrb ? 1 : 0;

    return true;
  }

  /**
   * Say whether something is keeping the orb closed: a hand on the timeline or the picture, or a jump still in
   * progress. Call once per step, before `step()`.
   */
  hold(held: boolean): void {
    if (!this.closed) return;

    if (held) {
      this.#opening = false;
      this.#unwrapping = false;
    } else if (!this.#opening) {
      // Let go before the orb had closed: finish the gesture, briskly, rather than leave it half curled.
      if (this.wrap < 1) this.#brisk = true;
      else {
        this.#opening = true;
        this.#openAge = 0;
      }
    }
  }

  /**
   * Advance by `dt` seconds. Returns 'unwrap' on the step the orb starts to open (the moment to take the real
   * frame as the picture), 'rest' on the step it has fully opened, and null otherwise.
   */
  step(dt: number, input: JourneyInput): 'unwrap' | 'rest' | null {
    if (!this.closed) return null;

    const pace = this.#brisk ? 'jump' : 'scrub';

    if (!this.#opening) {
      this.wrap = Math.min(1, this.wrap + dt / WRAP_SECONDS[pace]);

      return null;
    }

    this.#openAge += dt;

    let event: 'unwrap' | 'rest' | null = null;

    // Normally the new frame arrives within a few frames. A slow seek keeps the orb closed rather than opening
    // onto a picture that is not there yet; a very long one opens anyway.
    const overdue = this.#openAge > (input.seeking ? READY_TIMEOUT * 5 : READY_TIMEOUT);

    if (!this.#unwrapping && ((input.frameReady && input.arrived) || overdue)) {
      this.#unwrapping = true;
      event = 'unwrap';
    }

    if (this.#unwrapping) {
      this.wrap = Math.max(0, this.wrap - dt / UNWRAP_SECONDS[pace]);

      const t = Math.min(1, Math.max(0, this.wrap / REVEAL_BELOW));

      this.reveal = 1 - t * t * (3 - 2 * t);

      if (this.wrap <= 0) event = 'rest';
    }

    return event;
  }

  /** Back to the plain rectangle, at once. */
  reset(): void {
    this.closed = false;
    this.wrap = 0;
    this.reveal = 0;
    this.#brisk = false;
    this.#opening = false;
    this.#unwrapping = false;
    this.#openAge = 0;
  }
}

/**
 * Knows whether the frame the player was last asked for is on screen yet. Asking starts when the player stops
 * seeking; a short timer is the floor, because a paused player that was already on that frame presents nothing new.
 */
export class FrameWatch {
  ready = false;
  #requested = false;
  #guardUntil = 0;

  /** A new frame is on its way. Nothing is asked of the player until the clock passes `notBefore`. */
  expect(notBefore: number): void {
    this.ready = false;
    this.#requested = false;
    this.#guardUntil = notBefore;
  }

  poll(clock: number, seeking: boolean, video: HTMLVideoElement | null): void {
    if (this.ready || this.#requested || seeking || clock < this.#guardUntil) return;

    this.#requested = true;

    const done = () => (this.ready = true);

    video?.requestVideoFrameCallback?.(done);
    setTimeout(done, 120);
  }
}
