/**
 * The timeline as a line that can bend.
 *
 * At rest it lies exactly on the skin's straight bar. As the picture wraps into the orb it curls up onto the orb's
 * lower rim, carrying the same things the straight bar does: chapters as gaps, the buffered and played lengths, the
 * knob, and the times. It is drawn in SVG so it stays crisp, takes the skin's colours, and survives forced colours.
 *
 * It is a picture of the real `<media-time-slider>` plus a pointer surface. The slider itself stays in the document
 * and keeps the role, the label, the value text and the keys.
 */

export interface ArcChapter {
  start: number;
  end: number;
  title: string;
}

export interface ArcGeometry {
  /** Orb centre and radius, in CSS pixels relative to the host. */
  cx: number;
  cy: number;
  radius: number;
  /** The straight bar: its ends and its height on the page. */
  x0: number;
  x1: number;
  y: number;
  /** 0 straight, 1 fully on the orb. */
  wrap: number;
}

export interface ArcState {
  duration: number;
  currentTime: number;
  /** Where the knob is, in seconds: the pointer's moment while scrubbing, otherwise the current time. */
  knobTime: number;
  /** End of the buffered range, in seconds. */
  buffered: number;
  chapters: readonly ArcChapter[];
  /** Thicker line while the timeline is in use. */
  active: boolean;
  /** Show the keyboard focus ring on the knob. */
  focused: boolean;
}

export type ArcScrub = (phase: 'start' | 'move' | 'end' | 'cancel', time: number) => void;

const SVG = 'http://www.w3.org/2000/svg';
/** The arc runs from lower left to lower right of the orb: 160° to 20°, measured with y pointing down. */
const ARC_START = (160 * Math.PI) / 180;
const ARC_SWEEP = (140 * Math.PI) / 180;
const SAMPLES = 56;
/** Clearance between the glass and the line. */
const GAP = 13;
/** Pattern units along the line, whatever its real length (`pathLength`). */
const UNITS = 1000;

let instances = 0;

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');

  return `${hours ? `${hours}:${String(minutes).padStart(2, '0')}` : minutes}:${rest}`;
}

/** "+1:24" or "−0:30"; empty for less than a second. */
export function formatOffset(seconds: number): string {
  if (Math.abs(seconds) < 1) return '';

  return `${seconds > 0 ? '+' : '−'}${formatTime(Math.round(Math.abs(seconds)))}`;
}

function svg<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string> = {}) {
  const element = document.createElementNS(SVG, name);

  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);

  return element;
}

function html(className: string): HTMLDivElement {
  const element = document.createElement('div');

  element.className = className;

  return element;
}

export class ArcBar {
  readonly element = html('scry-arc');
  #svg = svg('svg', { class: 'scry-arc-svg', 'aria-hidden': 'true' });
  #chapterMask: SVGPathElement;
  #track: SVGPathElement;
  #buffer: SVGPathElement;
  #fill: SVGPathElement;
  #hit: SVGPathElement;
  #knob = svg('circle', { class: 'scry-arc-knob' });
  #ring = svg('circle', { class: 'scry-arc-ring' });
  #start = html('scry-arc-time scry-arc-time-start');
  #end = html('scry-arc-time scry-arc-time-end');
  #plate = html('scry-arc-plate');
  #plateTime = document.createElement('span');
  #plateOffset = document.createElement('span');
  #title = html('scry-arc-title');
  #geometry: ArcGeometry | null = null;
  #duration = 0;
  #text: Record<string, string> = {};

  constructor(onScrub: ArcScrub) {
    const id = `scry-arc-${++instances}`;
    const mask = svg('mask', { id: `${id}-chapters`, maskUnits: 'userSpaceOnUse' });
    const gradient = svg('radialGradient', { id: `${id}-bead`, cx: '34%', cy: '28%', r: '75%' });
    const defs = svg('defs');
    const line = svg('g', { mask: `url(#${id}-chapters)` });
    const path = (className: string) => svg('path', { class: className, pathLength: String(UNITS), fill: 'none' });

    for (const [offset, color] of [
      ['0%', '#ffffff'],
      ['45%', '#eef2ff'],
      ['85%', '#bfcdea'],
      ['100%', '#ffffff'],
    ]) {
      gradient.append(svg('stop', { offset: offset!, 'stop-color': color! }));
    }

    this.#chapterMask = path('scry-arc-mask');
    this.#track = path('scry-arc-track');
    this.#buffer = path('scry-arc-buffer');
    this.#fill = path('scry-arc-fill');
    this.#hit = path('scry-arc-hit');
    this.#knob.setAttribute('fill', `url(#${id}-bead)`);

    mask.append(this.#chapterMask);
    defs.append(mask, gradient);
    line.append(this.#track, this.#buffer, this.#fill);
    this.#svg.append(defs, line, this.#ring, this.#knob, this.#hit);

    this.#plateOffset.className = 'scry-arc-offset';
    this.#plate.append(this.#plateTime, this.#plateOffset);
    this.element.append(this.#svg, this.#start, this.#end, this.#plate, this.#title);
    this.element.setAttribute('aria-hidden', 'true');

    // Scrubbing on the arc goes by angle, so the knob stays under the pointer.
    this.#hit.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !this.#geometry) return;

      event.preventDefault();
      event.stopPropagation();
      this.#hit.setPointerCapture(event.pointerId);
      onScrub('start', this.#timeAt(event));

      const move = (next: PointerEvent) => onScrub('move', this.#timeAt(next));
      const finish = (last: PointerEvent) => {
        this.#hit.removeEventListener('pointermove', move);
        this.#hit.removeEventListener('pointerup', finish);
        this.#hit.removeEventListener('pointercancel', finish);
        onScrub(last.type === 'pointerup' ? 'end' : 'cancel', this.#timeAt(last));
      };

      this.#hit.addEventListener('pointermove', move);
      this.#hit.addEventListener('pointerup', finish);
      this.#hit.addEventListener('pointercancel', finish);
    });
  }

  /** The moment under a point given in client coordinates, or null when it is not on the arc. */
  timeUnder(clientX: number, clientY: number): number | null {
    const geometry = this.#geometry;

    if (!geometry || geometry.wrap < 0.9 || this.#duration <= 0) return null;

    const box = this.element.getBoundingClientRect();
    const dx = clientX - box.left - geometry.cx;
    const dy = clientY - box.top - geometry.cy;
    const distance = Math.hypot(dx, dy);
    const reach = geometry.radius + GAP;
    const fraction = (ARC_START - Math.atan2(dy, dx)) / ARC_SWEEP;

    if (Math.abs(distance - reach) > 16 || fraction < -0.04 || fraction > 1.04) return null;

    return Math.min(1, Math.max(0, fraction)) * this.#duration;
  }

  render(geometry: ArcGeometry, state: ArcState): void {
    this.#geometry = geometry;
    this.#duration = state.duration;

    const bend = geometry.wrap * geometry.wrap * (3 - 2 * geometry.wrap);
    const reach = geometry.radius + GAP;
    const point = (fraction: number): [number, number] => {
      const angle = ARC_START - ARC_SWEEP * fraction;
      const flatX = geometry.x0 + (geometry.x1 - geometry.x0) * fraction;

      return [
        flatX + (geometry.cx + reach * Math.cos(angle) - flatX) * bend,
        geometry.y + (geometry.cy + reach * Math.sin(angle) - geometry.y) * bend,
      ];
    };

    let d = '';
    let length = 0;
    let previous: [number, number] | null = null;

    for (let i = 0; i <= SAMPLES; i++) {
      const [x, y] = point(i / SAMPLES);

      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      if (previous) length += Math.hypot(x - previous[0], y - previous[1]);
      previous = [x, y];
    }

    for (const path of [this.#chapterMask, this.#track, this.#buffer, this.#fill, this.#hit]) path.setAttribute('d', d);

    const duration = state.duration > 0 ? state.duration : 1;
    const fraction = (time: number) => Math.min(1, Math.max(0, time / duration));
    const knob = fraction(state.knobTime);
    const weight = state.active || bend > 0.01 ? 4 : 2;

    // Chapters are gaps: the mask is the line itself with a short break at each chapter's end.
    const gap = (4 / Math.max(1, length)) * UNITS;
    const dashes: number[] = [];

    for (const chapter of state.chapters) {
      const span = (fraction(chapter.end) - fraction(chapter.start)) * UNITS;

      if (span > gap * 2) dashes.push(span - gap, gap);
      else dashes.push(span, 0);
    }

    this.#chapterMask.setAttribute('stroke-dasharray', dashes.length > 2 ? dashes.join(' ') : 'none');
    this.#chapterMask.setAttribute('stroke-width', String(weight + 12));
    this.#track.setAttribute('stroke-width', String(weight));
    this.#buffer.setAttribute('stroke-width', String(weight));
    this.#fill.setAttribute('stroke-width', String(weight));
    this.#buffer.setAttribute('stroke-dasharray', `${fraction(state.buffered) * UNITS} ${UNITS}`);
    this.#fill.setAttribute('stroke-dasharray', `${knob * UNITS} ${UNITS}`);
    // The arc only takes the pointer once it is an arc; before that the real slider underneath does.
    this.#hit.style.pointerEvents = bend > 0.9 ? 'stroke' : 'none';

    const [kx, ky] = point(knob);
    const size = state.active || bend > 0.01 ? 8.5 : 5.5;

    this.#knob.setAttribute('cx', kx.toFixed(2));
    this.#knob.setAttribute('cy', ky.toFixed(2));
    this.#knob.setAttribute('r', String(size));
    this.#ring.setAttribute('cx', kx.toFixed(2));
    this.#ring.setAttribute('cy', ky.toFixed(2));
    this.#ring.setAttribute('r', String(size + 4));
    this.#ring.style.display = state.focused ? '' : 'none';

    // Labels belong to the arc: they arrive as it finishes bending.
    const labels = Math.min(1, Math.max(0, (geometry.wrap - 0.65) / 0.35));
    const outward = (fraction: number, distance: number): [number, number] => {
      const angle = ARC_START - ARC_SWEEP * fraction;
      const [x, y] = point(fraction);

      return [x + Math.cos(angle) * distance, y + Math.sin(angle) * distance];
    };
    const place = (element: HTMLElement, [x, y]: [number, number]) => {
      element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      element.style.opacity = labels.toFixed(3);
    };

    place(this.#start, outward(0, 20));
    place(this.#end, outward(1, 20));
    place(this.#plate, outward(knob, 30));
    place(this.#title, [geometry.cx, geometry.cy + reach + 58]);

    const chapter = state.chapters.find((entry) => state.knobTime >= entry.start && state.knobTime < entry.end);

    this.#write('start', this.#start, formatTime(state.currentTime));
    this.#write('end', this.#end, formatTime(state.duration));
    this.#write('time', this.#plateTime, formatTime(state.knobTime));
    this.#write('offset', this.#plateOffset, formatOffset(state.knobTime - state.currentTime));
    this.#write('title', this.#title, chapter?.title ?? '');
  }

  #timeAt(event: PointerEvent): number {
    const geometry = this.#geometry!;
    const box = this.element.getBoundingClientRect();
    const angle = Math.atan2(event.clientY - box.top - geometry.cy, event.clientX - box.left - geometry.cx);
    // Above the centre the angle wraps around; read those as the nearer end.
    const unwrapped = angle < -Math.PI / 2 ? angle + Math.PI * 2 : angle;

    return Math.min(1, Math.max(0, (ARC_START - unwrapped) / ARC_SWEEP)) * this.#duration;
  }

  #write(key: string, element: HTMLElement, value: string): void {
    if (this.#text[key] === value) return;

    this.#text[key] = value;
    element.textContent = value;
  }
}
