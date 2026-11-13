/**
 * Sets lines of the inscription alight.
 *
 * Each strip of script (a margin, or a divider between sections) is a small WebGL2 canvas. The letters are not
 * drawn as outlines but as a heat field: a texture that is 1 along the middle of every pen stroke and falls to 0 a
 * few pixels out. A fragment shader turns that field into fire:
 *
 * - A line catches from the inside out. First only the core of each stroke is hot enough to show; the heat then
 *   spreads to the stroke's edges. Stretches of the line catch one after another, unevenly.
 * - Perlin noise scrolling up the page, and a little sideways, drives how hard each point burns, so the fire
 *   flickers and pulses inside the letter shapes.
 * - Temperature maps to colour on a thermal ramp: dark crimson at the cool edges, orange through the middle, and a
 *   yellow-white core. The hot end of the ramp is brighter than the screen can show.
 * - That is on purpose. The fire is drawn into a floating-point buffer, the parts brighter than white are blurred
 *   into a bloom, and only then is the sum brought back into range, which gives the letters a soft halo.
 * - After burning for a while the line cools back down the ramp, through orange and crimson to nothing, and after
 *   a dark spell catches again.
 *
 * The strips are small and stop drawing while their lines are dark or off screen, so this stays out of the
 * player's way. With reduced motion a strip shows one still frame of cooling embers. Without WebGL2 the script is
 * drawn plainly in gold.
 */
import { BASELINE, HEIGHT, TOP } from './inscription';

export interface EmberRow {
  /** The line's letters, as path data in the script's own units, one period long. */
  d: string;
  /** Height of a letter's body in CSS pixels. */
  size: number;
  /** How fast the line drifts, in CSS pixels a second; negative runs it backwards. */
  speed: number;
  /** Seconds after the page loads at which this line first catches. */
  delay: number;
}

export interface EmberStrip {
  canvas: HTMLCanvasElement;
  /** Which way the writing runs: across the page, down its left edge, or up its right edge. */
  run: 'across' | 'down' | 'up';
  /** The strip's thickness in CSS pixels; the canvas is styled to match. */
  cross: number;
  /** The length of writing before it repeats, in CSS pixels. */
  period: number;
  /** One or two lines, stacked across the strip. */
  rows: EmberRow[];
}

/** Seconds: catching to burning, burning, cooling, and the whole cycle. The rest of the cycle is dark. */
const BURN = 6.5;
const COOL = 4.5;
const CYCLE = 19;
/** The longest any part of a line lags behind the start of its cycle; see `lag` in the shader. */
const MAX_LAG = 3.6;
/** The heat field is drawn at this many texels per CSS pixel. */
const FIELD_SCALE = 2;
/** Stroke widths (in the script's units) and how much heat each adds; drawn over one another they make a field
 *  that peaks along the middle of the stroke. */
const FIELD_STROKES: [number, number][] = [
  [5.4, 0.08],
  [4, 0.12],
  [2.8, 0.16],
  [1.8, 0.2],
  [1, 0.22],
  [0.5, 0.22],
];

const VERTEX = `#version 300 es
void main() {
  // One triangle that covers the canvas.
  gl_Position = vec4(vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0), 0.0, 1.0);
}`;

const FIRE = `#version 300 es
precision highp float;

uniform sampler2D uField;
uniform vec2 uSize;      // the canvas, in CSS pixels
uniform float uScale;    // device pixels per CSS pixel
uniform int uRun;        // 0 across, 1 down the left edge, 2 up the right edge
uniform float uCross;
uniform float uPeriod;
uniform float uSplit;    // where the second row begins, as a share of the strip's thickness
uniform vec2 uDrift;     // how far each row has drifted, in CSS pixels
uniform vec2 uClock;     // seconds since each row last caught
uniform float uTime;
uniform float uRange;    // what the buffer's 1.0 stands for; above 1 when the buffer cannot hold bright values

out vec4 outColor;

vec2 gradient(vec2 cell) {
  float angle = 6.2831853 * fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  return vec2(cos(angle), sin(angle));
}

// Perlin noise, roughly -0.7..0.7.
float perlin(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(gradient(i), f);
  float b = dot(gradient(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(gradient(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(gradient(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Four octaves, brought to about 0..1.
float fbm(vec2 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    sum += amplitude * perlin(p);
    p = p * 2.03 + 17.3;
    amplitude *= 0.5;
  }
  return clamp(0.5 + 0.85 * sum, 0.0, 1.0);
}

// Temperature to colour. Everything past orange is brighter than white: the bloom feeds on that.
vec3 thermal(float heat) {
  vec3 colour = vec3(0.0);
  colour = mix(colour, vec3(0.34, 0.012, 0.02), smoothstep(0.03, 0.24, heat));  // dark crimson
  colour = mix(colour, vec3(1.0, 0.3, 0.03), smoothstep(0.24, 0.56, heat));     // orange
  colour = mix(colour, vec3(2.1, 1.25, 0.32), smoothstep(0.56, 0.88, heat));    // yellow
  colour = mix(colour, vec3(4.2, 3.5, 2.2), smoothstep(0.88, 1.3, heat));       // white-hot
  return colour;
}

void main() {
  // The page, in CSS pixels from its top left.
  vec2 page = vec2(gl_FragCoord.x, uSize.y * uScale - gl_FragCoord.y) / uScale;

  // The strip: how far along the writing, and how far across it (down the letters).
  float along = uRun == 0 ? page.x : uRun == 1 ? page.y : uSize.y - page.y;
  float across = uRun == 0 ? page.y : uRun == 1 ? uSize.x - page.x : page.x;
  float visible = uRun == 0 ? uSize.x : uSize.y;

  float second = step(uSplit, across / uCross);
  float drift = mix(uDrift.x, uDrift.y, second);
  float clock = mix(uClock.x, uClock.y, second);

  // Fire rises: the noise scrolls up the page, and a little sideways.
  vec2 flow = page * 0.05 + vec2(uTime * 0.3, uTime * 1.35);
  float flames = fbm(flow);
  float licks = fbm(flow * 2.6 + 31.0);

  // Hot air bends what is seen through it, so the letters shimmer by a pixel or so.
  vec2 shimmer = (vec2(fbm(flow * 1.7 + 5.2), licks) - 0.5) * 1.8;
  float field = texture(uField, vec2((along + drift + shimmer.x) / uPeriod, (across + shimmer.y) / uCross)).a;

  // Each stretch of the line catches a little after the one before it, and never evenly.
  float lag = fbm(vec2((along + drift) * 0.007, second * 7.0 + 2.0)) * 2.2 + (along / visible) * 1.4;
  float age = clock - lag;

  // Catching: from the inside out. At first only the core of a stroke is hot enough; then the heat spreads.
  float reach = smoothstep(0.0, 1.5, age);
  float lit = smoothstep(1.0 - reach * 1.2, 1.3 - reach * 1.2, field);
  // The flare of the moment it catches.
  float flare = 1.0 + 0.55 * exp(-max(age - 0.6, 0.0) * 1.3) * step(0.0, age);
  // Cooling: the whole letter comes back down the ramp.
  float temperature = 1.0 - smoothstep(${BURN.toFixed(1)}, ${(BURN + COOL).toFixed(1)}, age);

  float flicker = (0.45 + 1.1 * flames) * (0.85 + 0.3 * licks);
  float pulse = 0.9 + 0.1 * sin(uTime * 2.3 + lag * 5.0);
  float heat = field * lit * flicker * pulse * flare * temperature * 1.2;

  outColor = vec4(thermal(heat) / uRange, 1.0);
}`;

/** Keep what is brighter than the screen can show, at half size, ready to be blurred. */
const BRIGHT = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uRange;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec3 colour = texture(uSource, uv).rgb * uRange;
  float brightness = max(colour.r, max(colour.g, colour.b));
  // A soft knee, so the halo fades in rather than switching on.
  colour *= smoothstep(0.7, 1.7, brightness);
  outColor = vec4(colour / uRange, 1.0);
}`;

const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uStep;
uniform vec2 uTexel;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  // Nine taps of a Gaussian, taken as five by sampling between texels.
  vec3 sum = texture(uSource, uv).rgb * 0.2270270;
  sum += (texture(uSource, uv + uStep * 1.3846154).rgb + texture(uSource, uv - uStep * 1.3846154).rgb) * 0.3162162;
  sum += (texture(uSource, uv + uStep * 3.2307692).rgb + texture(uSource, uv - uStep * 3.2307692).rgb) * 0.0702703;
  outColor = vec4(sum, 1.0);
}`;

/** The fire plus its bloom, brought back into what the screen can show. */
const COMPOSE = `#version 300 es
precision highp float;
uniform sampler2D uFire;
uniform sampler2D uBloom;
uniform vec2 uTexel;
uniform float uRange;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec3 colour = (texture(uFire, uv).rgb + texture(uBloom, uv).rgb * 1.1) * uRange;
  colour = 1.0 - exp(-colour * 1.15);
  // Fire only adds light: what is not burning leaves the page showing through.
  float alpha = clamp(max(colour.r, max(colour.g, colour.b)), 0.0, 1.0);
  outColor = vec4(colour, alpha);
}`;

type Pass = 'fire' | 'bright' | 'blur' | 'compose';

interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

/** Where each row sits across the strip, in CSS pixels: stacked and centred. */
function rowTops(strip: EmberStrip): number[] {
  const gap = 4;
  const heights = strip.rows.map((row) => (HEIGHT * row.size) / BASELINE);
  const total = heights.reduce((sum, height) => sum + height, 0) + gap * (heights.length - 1);
  let top = (strip.cross - total) / 2;

  return heights.map((height) => {
    const at = top;

    top += height + gap;

    return at;
  });
}

/** Draw the strip's rows into a 2D context whose units are CSS pixels, letters upright, writing left to right. */
function strokeRows(context: CanvasRenderingContext2D, strip: EmberStrip, strokes: [number, string][]): void {
  const tops = rowTops(strip);

  context.lineCap = 'round';
  context.lineJoin = 'round';

  strip.rows.forEach((row, index) => {
    const scale = row.size / BASELINE;
    const path = new Path2D(row.d);

    context.save();
    context.translate(0, tops[index]! - TOP * scale);
    context.scale(scale, scale);

    for (const [width, style] of strokes) {
      context.lineWidth = width;
      context.strokeStyle = style;
      context.stroke(path);
    }

    context.restore();
  });
}

/** The heat field: 1 along the middle of every stroke, falling to 0 a few pixels out. One period long. */
function heatField(strip: EmberStrip): HTMLCanvasElement {
  const field = document.createElement('canvas');

  field.width = Math.round(strip.period * FIELD_SCALE);
  field.height = Math.round(strip.cross * FIELD_SCALE);

  const context = field.getContext('2d')!;

  context.scale(FIELD_SCALE, FIELD_SCALE);
  context.globalCompositeOperation = 'lighter';
  strokeRows(
    context,
    strip,
    FIELD_STROKES.map(([width, heat]) => [width, `rgb(255 255 255 / ${heat})`])
  );

  return field;
}

/** No WebGL2: the writing, plain, in gold. */
function drawPlain(strip: EmberStrip): void {
  const { canvas } = strip;
  const context = canvas.getContext('2d');
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (!context || width < 1 || height < 1) return;

  const ratio = Math.min(devicePixelRatio || 1, 2);

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.scale(ratio, ratio);

  // Turn the page so the strip's own axes (along the writing, down the letters) are the context's.
  if (strip.run === 'down') context.transform(0, 1, -1, 0, width, 0);
  if (strip.run === 'up') context.transform(0, -1, 1, 0, 0, height);

  strokeRows(context, strip, [[0.5, 'rgb(200 162 90 / 0.5)']]);
}

class Fire {
  readonly strip: EmberStrip;
  #gl: WebGL2RenderingContext;
  #programs: Record<Pass, { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation> }>;
  #field: WebGLTexture;
  #targets: { fire: Target; a: Target; b: Target } | null = null;
  /** Whether bright values can be stored as they are, or have to be squeezed into 0..1. */
  #float: boolean;
  #split: number;
  #lost = false;
  #blank = true;

  constructor(strip: EmberStrip, gl: WebGL2RenderingContext) {
    this.strip = strip;
    this.#gl = gl;
    this.#float = Boolean(gl.getExtension('EXT_color_buffer_float') ?? gl.getExtension('EXT_color_buffer_half_float'));
    this.#programs = {
      fire: this.#compile(FIRE),
      bright: this.#compile(BRIGHT),
      blur: this.#compile(BLUR),
      compose: this.#compile(COMPOSE),
    };

    const tops = rowTops(strip);

    // The second row starts halfway through the gap after the first.
    this.#split = tops.length > 1 ? (tops[1]! - 2) / strip.cross : 2;

    this.#field = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.#field);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, heatField(strip));
    // No mipmaps: the two rows drift separately, and the jump between them would pick a blurred level along the seam.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    strip.canvas.addEventListener('webglcontextlost', () => (this.#lost = true));
  }

  /**
   * Draw the strip as it is `seconds` after the page loaded. `still` freezes it as cooling embers. Returns
   * whether anything was burning.
   */
  draw(seconds: number, still: boolean): boolean {
    const gl = this.#gl;
    const { canvas, rows } = this.strip;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (this.#lost || width < 1 || height < 1) return false;

    // How long since each row last caught; negative before its first time.
    const clocks = rows.map((row) => {
      if (still) return BURN + COOL * 0.45 + MAX_LAG / 2;

      const since = seconds - row.delay;

      return since < 0 ? -1 : since % CYCLE;
    });
    const burning = clocks.some((clock) => clock >= 0 && clock < BURN + COOL + MAX_LAG);

    if (!burning) {
      if (!this.#blank) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this.#blank = true;
      }

      return false;
    }

    const scale = Math.min(devicePixelRatio || 1, 2);
    const targets = this.#resize(Math.round(width * scale), Math.round(height * scale));
    const range = this.#float ? 1 : 4.5;
    const time = still ? 0 : seconds;

    // The fire itself, with its brightest parts well above 1.
    const fire = this.#use('fire', targets.fire);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#field);
    gl.uniform1i(fire.uField!, 0);
    gl.uniform2f(fire.uSize!, width, height);
    gl.uniform1f(fire.uScale!, scale);
    gl.uniform1i(fire.uRun!, this.strip.run === 'across' ? 0 : this.strip.run === 'down' ? 1 : 2);
    gl.uniform1f(fire.uCross!, this.strip.cross);
    gl.uniform1f(fire.uPeriod!, this.strip.period);
    gl.uniform1f(fire.uSplit!, this.#split);
    gl.uniform2f(fire.uDrift!, (rows[0]?.speed ?? 0) * time, (rows[1]?.speed ?? 0) * time);
    gl.uniform2f(fire.uClock!, clocks[0] ?? -1, clocks[1] ?? -1);
    gl.uniform1f(fire.uTime!, time);
    gl.uniform1f(fire.uRange!, range);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Bloom: keep what is too bright, at half size, and blur it twice, the second time wider.
    const bright = this.#use('bright', targets.a);

    this.#source(bright.uSource!, targets.fire);
    gl.uniform2f(bright.uTexel!, 1 / targets.a.width, 1 / targets.a.height);
    gl.uniform1f(bright.uRange!, range);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    for (const spread of [1, 2.2]) {
      for (const [from, to, x, y] of [
        [targets.a, targets.b, spread, 0],
        [targets.b, targets.a, 0, spread],
      ] as const) {
        const blur = this.#use('blur', to);

        this.#source(blur.uSource!, from);
        gl.uniform2f(blur.uTexel!, 1 / to.width, 1 / to.height);
        gl.uniform2f(blur.uStep!, x / from.width, y / from.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }

    // To the page.
    const compose = this.#use('compose', null);

    this.#source(compose.uFire!, targets.fire);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, targets.a.texture);
    gl.uniform1i(compose.uBloom!, 1);
    gl.uniform2f(compose.uTexel!, 1 / canvas.width, 1 / canvas.height);
    gl.uniform1f(compose.uRange!, range);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.#blank = false;

    return true;
  }

  #source(uniform: WebGLUniformLocation, target: Target): void {
    const gl = this.#gl;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.uniform1i(uniform, 0);
  }

  #use(name: Pass, target: Target | null): Record<string, WebGLUniformLocation> {
    const gl = this.#gl;
    const { program, uniforms } = this.#programs[name];

    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    gl.viewport(0, 0, target?.width ?? gl.drawingBufferWidth, target?.height ?? gl.drawingBufferHeight);
    gl.useProgram(program);

    return uniforms;
  }

  #resize(width: number, height: number): { fire: Target; a: Target; b: Target } {
    const { canvas } = this.strip;

    if (this.#targets && canvas.width === width && canvas.height === height) return this.#targets;

    const gl = this.#gl;

    for (const target of Object.values(this.#targets ?? {})) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }

    canvas.width = width;
    canvas.height = height;

    const half = [Math.max(1, width >> 1), Math.max(1, height >> 1)] as const;

    this.#targets = { fire: this.#target(width, height), a: this.#target(...half), b: this.#target(...half) };

    return this.#targets;
  }

  #target(width: number, height: number): Target {
    const gl = this.#gl;
    const texture = gl.createTexture()!;
    const framebuffer = gl.createFramebuffer()!;

    gl.bindTexture(gl.TEXTURE_2D, texture);

    if (this.#float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    return { framebuffer, texture, width, height };
  }

  #compile(fragment: string): { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation> } {
    const gl = this.#gl;
    const program = gl.createProgram()!;

    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = gl.createShader(type)!;

      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');

      gl.attachShader(program, shader);
    }

    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program');

    const uniforms: Record<string, WebGLUniformLocation> = {};

    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
      const name = gl.getActiveUniform(program, i)!.name;

      uniforms[name] = gl.getUniformLocation(program, name)!;
    }

    return { program, uniforms };
  }
}

/** Set these strips of writing alight, and keep them burning and cooling in turn. */
export function kindle(strips: EmberStrip[]): void {
  const fires: Fire[] = [];

  for (const strip of strips) {
    const gl = strip.canvas.getContext('webgl2', { alpha: true, antialias: false, powerPreference: 'low-power' });

    try {
      if (!gl) throw new Error('no WebGL2');

      fires.push(new Fire(strip, gl));
    } catch {
      // A canvas that has been asked for WebGL cannot then draw in 2D, so the plain writing goes on a fresh one.
      const plain = strip.canvas.cloneNode() as HTMLCanvasElement;

      strip.canvas.replaceWith(plain);
      drawPlain({ ...strip, canvas: plain });
      addEventListener('resize', () => drawPlain({ ...strip, canvas: plain }));
    }
  }

  if (fires.length === 0) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const start = performance.now();
  let frame = 0;

  const onScreen = (canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();

    return rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight;
  };

  const tick = (now: number) => {
    frame = 0;

    for (const fire of fires) if (onScreen(fire.strip.canvas)) fire.draw((now - start) / 1000, reduced.matches);

    // Still embers need drawing once, not sixty times a second.
    if (!reduced.matches) frame = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  wake();
  reduced.addEventListener('change', wake);
  // Still embers are redrawn when the page changes shape or a strip scrolls into view.
  addEventListener('resize', wake);
  addEventListener('scroll', wake, { passive: true });
}
