/**
 * The inscription that drifts along the page's edges.
 *
 * It is an invented script, drawn here from scratch: every letter is a stem with one or two bows, sometimes with a
 * mark above, which is enough for lines of it to read as writing. It says nothing, and it is not any existing
 * alphabet or typeface.
 *
 * Each line is a single SVG path, laid out twice end to end so it can scroll forever by half its own width. The
 * scrolling is a CSS transform on the whole line, so the browser draws the letters once and only moves them.
 *
 * The letters are not always there. Each line kindles from one end to the other, white-hot, cools to gold, fades
 * to nothing and after a while kindles again: writing that only shows when the metal is hot. Every line is drawn
 * twice, once hot (pale, with an ember glow drawn into it) and once cooled to gold, and the stylesheet fades between
 * the two. A wipe uncovers the line from its start, with a small flame riding its front.
 *
 * Nothing here is animated except position and opacity, which browsers can do without redrawing anything. That
 * keeps the ornament from competing with the player for the graphics card.
 */

const SVG = 'http://www.w3.org/2000/svg';

/** Letters sit on a baseline at y = 10 with their bodies reaching up to y = 0. */
const BASELINE = 10;
const ASCENT = -9;
const DESCENT = 19;
/** A line's box: room above for marks and tall stems, below for deep ones. */
const TOP = -13;
const HEIGHT = 35;
/** The pen is a broad nib held at 45°: each stroke is drawn three times a little apart, which thickens every
 *  direction but the one the nib points along. */
const NIB = [0, 0.32, 0.64];

type Point = [number, number];
/** One pen stroke: where it starts, then cubic segments as [control, control, end] triples, or a straight line. */
type Stroke = { from: Point; to: (readonly [Point, Point, Point] | Point)[] };

interface Glyph {
  strokes: Stroke[];
  advance: number;
}

const line = (from: Point, to: Point): Stroke => ({ from, to: [to] });
const curve = (from: Point, ...to: [Point, Point, Point][]): Stroke => ({ from, to });

/** A small deterministic generator, so the page shows the same inscription on every visit. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;

    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stem, entered with a small flick of the pen. */
function stem(x: number, top: number, bottom: number): Stroke {
  return {
    from: [x - 0.9, top + 0.7],
    to: [
      [
        [x - 0.3, top],
        [x, top + 0.2],
        [x, top + 1.3],
      ],
      [x, bottom],
    ],
  };
}

/** A bow on the right of a stem at `x`: closed back onto the stem, or left open with a tail. */
function bowRight(x: number, width: number, closed: boolean): Stroke {
  const right = x + width;

  return closed
    ? curve(
        [x, 1.3],
        [
          [x + width * 0.22, -1],
          [right + 0.3, -1.1],
          [right, 4.4],
        ],
        [
          [right, 8.4],
          [x + width * 0.55, 10.4],
          [x, 9.5],
        ]
      )
    : curve(
        [x, 1.3],
        [
          [x + width * 0.22, -1],
          [right + 0.3, -1.1],
          [right, 4.2],
        ],
        [
          [right, 7.8],
          [right + 0.2, 10.4],
          [right + 2.3, 8.7],
        ]
      );
}

/** The same bow on the left of a stem at `x`. */
function bowLeft(x: number, width: number, closed: boolean): Stroke {
  const left = x - width;

  return closed
    ? curve(
        [x, 9.2],
        [
          [x - width * 0.45, 10.6],
          [left, 8.6],
          [left, 5],
        ],
        [
          [left, 0.2],
          [x - width * 0.4, -0.8],
          [x, 1.4],
        ]
      )
    : curve(
        [left - 1.6, 0.6],
        [
          [left - 0.2, 0.2],
          [left, 1.6],
          [left, 4.8],
        ],
        [
          [left, 9],
          [x - width * 0.4, 10.6],
          [x, 8.8],
        ]
      );
}

/** Marks written above a letter, centred on `x`. */
const MARKS: ((x: number) => Stroke[])[] = [
  (x) => [line([x - 0.9, -3.2], [x + 1.1, -5.4])],
  (x) => [line([x - 2.2, -4], [x - 2, -4.2]), line([x, -4.9], [x + 0.2, -5.1]), line([x + 2.2, -4], [x + 2.4, -4.2])],
  (x) => [line([x, -4.2], [x + 0.2, -4.4])],
  (x) => [
    curve(
      [x - 2.6, -3.4],
      [
        [x - 1.6, -5.4],
        [x - 0.6, -5.2],
        [x, -4],
      ],
      [
        [x + 0.6, -2.8],
        [x + 1.6, -2.8],
        [x + 2.6, -4.6],
      ]
    ),
  ],
  (x) => [
    curve(
      [x - 1.7, -3],
      [
        [x - 1.7, -5.6],
        [x + 1.7, -5.6],
        [x + 1.7, -3],
      ]
    ),
  ],
];

/** Letters that do not follow the stem-and-bow pattern: a curl, a hook, a ring, a long bowl. */
const ODD: Glyph[] = [
  // A deep stem that ends in a hook, with a dot riding above it.
  {
    advance: 6.5,
    strokes: [
      curve(
        [2.1, 0.7],
        [
          [2.7, 0],
          [3, 0.2],
          [3, 1.3],
        ],
        [
          [3, 8],
          [3, 13],
          [3, 15],
        ],
        [
          [3, 18.6],
          [0.4, 19.4],
          [-0.6, 16.6],
        ]
      ),
      line([3, -4.2], [3.2, -4.4]),
    ],
  },
  // A wave that runs into a short stem.
  {
    advance: 12.5,
    strokes: [
      curve(
        [0, 5.4],
        [
          [1.4, -0.6],
          [3.6, -0.6],
          [4.8, 5],
        ],
        [
          [5.8, 10.4],
          [8.2, 10.6],
          [9.6, 5.2],
        ]
      ),
      stem(9.6, 0, BASELINE),
    ],
  },
  // A spiral.
  {
    advance: 10.5,
    strokes: [
      curve(
        [4.5, 5.6],
        [
          [3.5, 3.5],
          [1.5, 5],
          [2.6, 7.2],
        ],
        [
          [4, 9.6],
          [8, 8],
          [7.4, 3.6],
        ],
        [
          [6.8, -0.6],
          [0.6, -0.8],
          [0, 5],
        ],
        [
          [-0.4, 8.8],
          [2, 10.8],
          [5.4, 9.9],
        ]
      ),
    ],
  },
  {
    advance: 9,
    strokes: [
      curve(
        [6.2, 2],
        [
          [4.2, -1],
          [0, 0.4],
          [0, 5],
        ],
        [
          [0, 9],
          [3, 10.6],
          [5, 9.4],
        ],
        [
          [6.8, 8.2],
          [6.6, 4.2],
          [6.2, 2],
        ]
      ),
      line([6.2, 2], [6.2, DESCENT - 3]),
    ],
  },
  {
    advance: 10.5,
    strokes: [
      curve(
        [0.4, ASCENT],
        [
          [0, -2],
          [0.2, 6],
          [2, 8.6],
        ],
        [
          [4, 11.2],
          [8, 10.4],
          [8, 6.2],
        ],
        [
          [8, 3.2],
          [5.6, 2.4],
          [4.2, 4.2],
        ]
      ),
    ],
  },
  // A short carrier: a mark needs something to sit on.
  { advance: 4, strokes: [stem(1, 0, BASELINE), ...MARKS[1]!(1)] },
];

/** Make one letter of the regular kind: a stem of some height, bows on one side, perhaps a mark. */
function letter(random: () => number): Glyph {
  if (random() < 0.2) return ODD[Math.floor(random() * ODD.length)]!;

  const height = random();
  const top = height < 0.3 ? ASCENT : 0;
  const bottom = height > 0.72 ? DESCENT : BASELINE;
  const double = random() < 0.38;
  const closed = random() < 0.5;
  const width = 5.2;
  const strokes: Stroke[] = [];
  let advance: number;
  let centre: number;

  if (random() < 0.62) {
    const x = 0.9;

    strokes.push(stem(x, top, bottom), bowRight(x, width, closed && !double));

    if (double) strokes.push(bowRight(x + width, width, closed));
    // A bar along the baseline closes an open bow.
    if (!closed && random() < 0.4) strokes.push(line([x, 9.9], [x + width * (double ? 2 : 1), 9.9]));

    advance = x + width * (double ? 2 : 1) + (closed ? 2.4 : 3.8);
    centre = x + (width * (double ? 2 : 1)) / 2;
  } else {
    const x = width * (double ? 2 : 1) + (closed ? 0.2 : 1.8);

    strokes.push(bowLeft(x, width, closed), stem(x, top, bottom));

    if (double) strokes.push(bowLeft(x - width, width, true));

    advance = x + 2.6;
    centre = x - (width * (double ? 2 : 1)) / 2;
  }

  // Marks stay off tall stems, which already fill the space above.
  if (top === 0 && random() < 0.5) strokes.push(...MARKS[Math.floor(random() * MARKS.length)]!(centre));

  return { strokes, advance };
}

/** Two dots, one above the other: the pause between phrases. */
function pause(): Glyph {
  return { advance: 5, strokes: [line([1.5, 2.6], [1.7, 2.4]), line([1.5, 7.6], [1.7, 7.4])] };
}

const n = (value: number) => Math.round(value * 100) / 100;

function trace(stroke: Stroke, dx: number, dy: number): string {
  let d = `M${n(stroke.from[0] + dx)} ${n(stroke.from[1] + dy)}`;

  for (const segment of stroke.to) {
    if (typeof segment[0] === 'number') {
      const [x, y] = segment as Point;

      d += `L${n(x + dx)} ${n(y + dy)}`;
    } else {
      const [a, b, c] = segment as readonly [Point, Point, Point];

      d += `C${n(a[0] + dx)} ${n(a[1] + dy)} ${n(b[0] + dx)} ${n(b[1] + dy)} ${n(c[0] + dx)} ${n(c[1] + dy)}`;
    }
  }

  return d;
}

/** Write words until the line is at least `length` units long. Returns the path and how long it came out. */
function write(length: number, random: () => number): { d: string; length: number } {
  const glyphs: { glyph: Glyph; x: number }[] = [];
  let x = 0;

  while (x < length) {
    const letters = 2 + Math.floor(random() * 5);

    for (let i = 0; i < letters; i++) {
      const glyph = letter(random);

      glyphs.push({ glyph, x });
      x += glyph.advance;
    }

    if (random() < 0.22) {
      x += 3;
      glyphs.push({ glyph: pause(), x });
      x += 5;
    }

    x += 7;
  }

  let d = '';

  // Twice over, so the line can wrap around.
  for (const offset of [0, x]) {
    for (const { glyph, x: at } of glyphs) {
      for (const stroke of glyph.strokes) {
        for (const nib of NIB) d += trace(stroke, at + offset + nib, -nib);
      }
    }
  }

  return { d, length: x };
}

export interface InscriptionOptions {
  /** Picks the text: the same seed always writes the same line. */
  seed: number;
  /** The height of a letter's body, in CSS pixels. */
  size: number;
  /** How long the line takes to drift past once, in seconds. */
  drift: number;
  /** Send it the other way. */
  reverse?: boolean;
  /** How long after the page loads this line first kindles, in seconds. */
  delay: number;
  /** The longest stretch of the line that can be on screen at once, in CSS pixels. */
  length: number;
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, name);

  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);

  return element;
}

/** One drawing of a line: the same letters, stroked however `strokes` says, widest first. */
function drawing(d: string, length: number, scale: number, strokes: Record<string, string>[]): SVGSVGElement {
  const svg = svgElement('svg', {
    viewBox: `0 ${TOP} ${n(length * 2)} ${HEIGHT}`,
    width: String(Math.round(length * 2 * scale)),
    height: String(Math.round(HEIGHT * scale)),
    'aria-hidden': 'true',
    focusable: 'false',
  });

  for (const stroke of strokes) {
    svg.append(svgElement('path', { d, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...stroke }));
  }

  svg.classList.add('inscription-line');

  return svg;
}

const element = (className: string, ...children: Node[]): HTMLDivElement => {
  const div = document.createElement('div');

  div.className = className;
  div.append(...children);

  return div;
};

/** Add one line of the script to `host`. */
export function inscribe(host: HTMLElement, options: InscriptionOptions): void {
  const scale = options.size / BASELINE;
  // Longer than what can be seen of it, so the join never shows.
  const { d, length } = write(options.length / scale, seeded(options.seed));

  // Hot: a pale core over two soft ember strokes that stand in for a glow.
  const hot = drawing(d, length, scale, [
    { class: 'inscription-glow', 'stroke-width': '3.2', 'stroke-opacity': '0.16' },
    { class: 'inscription-glow', 'stroke-width': '1.7', 'stroke-opacity': '0.3' },
    { class: 'inscription-core', 'stroke-width': '0.55' },
  ]);
  const gold = drawing(d, length, scale, [{ class: 'inscription-gold', 'stroke-width': '0.5' }]);

  hot.classList.add('inscription-hot');
  gold.classList.add('inscription-cooled');

  const line = element(
    'inscription',
    element('inscription-wipe', element('inscription-hold', hot, gold)),
    element('inscription-flame')
  );

  line.style.setProperty('--inscription-delay', `${options.delay}s`);
  line.style.setProperty('--inscription-drift', `${options.drift}s`);

  if (options.reverse) line.dataset.reverse = '';

  host.append(line);
}
