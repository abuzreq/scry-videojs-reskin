import { describe, expect, it } from 'vitest';
import { Journey, READY_TIMEOUT, UNWRAP_SECONDS, WRAP_SECONDS } from './journey';

const FRAME = 1 / 60;
const ready = { frameReady: true, arrived: true, seeking: false };
const notReady = { frameReady: false, arrived: true, seeking: false };

/** Run frames until `until` says stop, returning every event that came out. */
function run(journey: Journey, held: boolean, input: typeof ready, until: () => boolean, limit = 2000) {
  const events: string[] = [];

  for (let i = 0; i < limit && !until(); i++) {
    journey.hold(held);

    const event = journey.step(FRAME, input);

    if (event) events.push(event);
    if (event === 'rest') journey.reset();
  }

  return events;
}

describe('Journey', () => {
  it('does nothing until it is closed', () => {
    const journey = new Journey();

    journey.hold(false);

    expect(journey.step(FRAME, ready)).toBeNull();
    expect(journey.wrap).toBe(0);
  });

  it('reports only the first close', () => {
    const journey = new Journey();

    expect(journey.close('scrub')).toBe(true);
    expect(journey.close('jump')).toBe(false);
    expect(journey.brisk).toBe(true);
  });

  it('wraps while held and stays wrapped', () => {
    const journey = new Journey();

    journey.close('scrub');
    run(journey, true, ready, () => false, Math.ceil(WRAP_SECONDS.scrub / FRAME) + 5);

    expect(journey.wrap).toBe(1);
    expect(journey.opening).toBe(false);
  });

  it('opens onto the new frame and comes to rest', () => {
    const journey = new Journey();

    journey.close('scrub');
    run(journey, true, ready, () => journey.wrap === 1);

    const events = run(journey, false, ready, () => !journey.closed);

    expect(events).toEqual(['unwrap', 'rest']);
    expect(journey.wrap).toBe(0);
  });

  it('hands over to the video only at the end of the unwrap', () => {
    const journey = new Journey();

    journey.close('scrub');
    run(journey, true, ready, () => journey.wrap === 1);
    run(journey, false, ready, () => journey.wrap < 0.7);

    expect(journey.reveal).toBe(0);

    run(journey, false, ready, () => journey.wrap < 0.05);

    expect(journey.reveal).toBeGreaterThan(0.9);
  });

  it('finishes closing when let go early, then opens, at a jump\'s pace', () => {
    const journey = new Journey();

    journey.close('scrub');
    run(journey, true, ready, () => journey.wrap > 0.3);

    journey.hold(false);
    journey.step(FRAME, ready);

    expect(journey.brisk).toBe(true);
    expect(journey.opening).toBe(false);

    const events = run(journey, false, ready, () => !journey.closed);

    expect(events).toEqual(['unwrap', 'rest']);
  });

  it('stays closed while the frame is not on screen, and says it is waiting', () => {
    const journey = new Journey();

    journey.close('jump');
    run(journey, true, notReady, () => journey.wrap === 1);
    run(journey, false, notReady, () => false, 30);

    expect(journey.wrap).toBe(1);
    expect(journey.unwrapping).toBe(false);
    expect(journey.waiting).toBe(true);
  });

  it('opens anyway when the frame is overdue, and waits five times longer for a running seek', () => {
    const settle = (seeking: boolean) => {
      const journey = new Journey();
      let seconds = 0;

      journey.close('jump');
      run(journey, true, notReady, () => journey.wrap === 1);
      run(journey, false, { ...notReady, seeking }, () => {
        seconds += FRAME;

        return journey.unwrapping;
      });

      return seconds;
    };

    expect(settle(false)).toBeCloseTo(READY_TIMEOUT, 0);
    expect(settle(true)).toBeCloseTo(READY_TIMEOUT * 5, 0);
  });

  it('closes again from the middle of an unwrap when something takes hold', () => {
    const journey = new Journey();

    journey.close('scrub');
    run(journey, true, ready, () => journey.wrap === 1);
    run(journey, false, ready, () => journey.wrap < 0.5);

    expect(journey.unwrapping).toBe(true);

    run(journey, true, ready, () => journey.wrap === 1);

    expect(journey.unwrapping).toBe(false);
    expect(journey.closed).toBe(true);
  });

  it('a jump is quicker than a scrub both ways', () => {
    expect(WRAP_SECONDS.jump).toBeLessThan(WRAP_SECONDS.scrub);
    expect(UNWRAP_SECONDS.jump).toBeLessThan(UNWRAP_SECONDS.scrub);
  });

  it('starts fully wrapped when it takes over an orb that is already there', () => {
    const journey = new Journey();

    journey.close('jump', true);

    expect(journey.wrap).toBe(1);
  });
});
