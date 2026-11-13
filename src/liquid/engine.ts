import { FLAT, FLOW_BLUR, FLOW_FINISH, FLOW_STEP, ORB, VERTEX } from './shaders';

/** One storyboard tile: where it sits in the sprite, and the moment of the video it shows. */
export interface Tile {
  x: number;
  y: number;
  width: number;
  height: number;
  time: number;
}

export interface OrbView {
  /** Moment of the video to show, in seconds. */
  time: number;
  /** Centre and radius of the resting orb, in canvas pixels, y down. */
  x: number;
  y: number;
  radius: number;
  /** Where the video picture sits in the canvas, in canvas pixels: the orb opens onto this. */
  frame: { x: number; y: number; width: number; height: number };
  /** 0 hidden, 1 fully there. */
  presence: number;
  /** 0 a flat rectangle lying exactly on `frame`, 1 the sphere. */
  wrap: number;
  /** 0..1: how dark everything outside the shape is. */
  stage: number;
  /** 0 the tight lens of the small orb, 1 the wide lens that takes in nearly the whole frame. */
  wide: number;
  /** 0..1: fog inside the glass. */
  mist: number;
  /** 0..1: embers rising inside the glass, without fog. */
  sparks: number;
  /** Seconds, for anything that moves on its own. */
  clock: number;
  /** 0 the orb's own picture, 1 fully given way to the video underneath. */
  reveal: number;
  /** 0 the picture; 1 the flow field, 2 crossfade against morph, 3 agreement. For studying the morph. */
  inspect: number;
  /** 0 clear glass, 1 the dark seeing-stone. */
  stone: number;
  /** 0..1: how hard time is being driven; stokes the fire in the dark stone. */
  heat: number;
  /** 0..1: how much of the detail picture (see `setDetail`) to show in place of the storyboard. */
  detail: number;
  /** Sideways move of the eye, in picture units; only shows where depth is known. */
  parallax: [number, number];
  /** Forward move of the eye, 0 for none; only shows where depth is known. */
  dolly: number;
  /** Extra defocus, in mip levels, for fast scrubbing. */
  smear: number;
  /** Small parallax offset, -1..1 on each axis. */
  tilt: [number, number];
  pixelRatio: number;
}

/** Flow is solved coarse to fine on these mips of the tile pyramid; the last one is the resolution it is kept at. */
const FLOW_LODS = [5, 4, 3, 2];
const STEPS_PER_LEVEL = 3;

interface Program {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

/**
 * Renders the picture between storyboard tiles, inside a glass orb.
 *
 * Everything runs in fragment shaders on plain RGBA8 textures, so it needs WebGL2 and nothing else: no extensions,
 * no model, no download. Optical flow between neighbouring tiles is solved once per pair, a few pairs per frame,
 * and cached in a texture array.
 */
export class LiquidEngine {
  readonly canvas: HTMLCanvasElement;
  #gl: WebGL2RenderingContext;
  #vao: WebGLVertexArrayObject;
  #step: Program;
  #blur: Program;
  #finish: Program;
  #orb: Program;
  #flat: Program;

  #tiles: Tile[] = [];
  #tileTexture: WebGLTexture | null = null;
  #tileSize: [number, number] = [1, 1];
  #flowTexture: WebGLTexture | null = null;
  #flowFramebuffer: WebGLFramebuffer | null = null;
  #levels: [Target, Target][] = [];
  #detailTexture: WebGLTexture | null = null;
  #depthTexture: WebGLTexture | null = null;
  #depthSize: [number, number] = [0, 0];
  #depthDone: Uint8Array = new Uint8Array(0);
  #flowDone: Uint8Array = new Uint8Array(0);
  #flowPending = 0;
  #focus = 0;
  #lost = false;

  /** Throws when WebGL2 is not available; callers fall back to the still thumbnail. */
  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });

    if (!gl) throw new Error('WebGL2 is not available');

    this.canvas = canvas;
    this.#gl = gl;

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.#lost = true;
    });

    this.#step = this.#compile(FLOW_STEP);
    this.#blur = this.#compile(FLOW_BLUR);
    this.#finish = this.#compile(FLOW_FINISH);
    this.#orb = this.#compile(ORB);
    this.#flat = this.#compile(FLAT);

    // One triangle that covers the viewport.
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.#vao = vao;

    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  /** False once the GPU context is gone; the owner should stop drawing and show the fallback. */
  get alive(): boolean {
    return !this.#lost;
  }

  get ready(): boolean {
    return this.#tileTexture !== null && this.#tiles.length > 0;
  }

  get tiles(): readonly Tile[] {
    return this.#tiles;
  }

  /** Flow pairs still to solve. */
  get pending(): number {
    return this.#flowPending;
  }

  /** Load a storyboard sprite. `image` must be readable (same origin or CORS-enabled). */
  setStoryboard(image: CanvasImageSource, tiles: Tile[]): void {
    const gl = this.#gl;

    this.#release();
    this.#tiles = tiles;

    if (tiles.length === 0) return;

    const width = Math.max(2, Math.round(tiles[0]!.width));
    const height = Math.max(2, Math.round(tiles[0]!.height));
    const count = tiles.length;
    const mips = Math.floor(Math.log2(Math.max(width, height))) + 1;

    this.#tileSize = [width, height];

    // Tiles go into an array texture, one layer each, so every tile has its own mip chain and blurring one never
    // bleeds into its neighbour on the sprite.
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const context = scratch.getContext('2d', { willReadFrequently: false })!;

    const tileTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tileTexture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, mips, gl.RGBA8, width, height, count);

    tiles.forEach((tile, layer) => {
      context.drawImage(image, tile.x, tile.y, tile.width, tile.height, 0, 0, width, height);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, width, height, 1, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
    });

    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    this.#tileTexture = tileTexture;

    // Pyramid of small ping-pong targets for the flow solve.
    this.#levels = FLOW_LODS.map((lod) => {
      const w = Math.max(2, Math.round(width / 2 ** lod));
      const h = Math.max(2, Math.round(height / 2 ** lod));
      return [this.#target(w, h), this.#target(w, h)];
    });

    // One layer of flow per neighbouring pair. Starts as "no displacement, no agreement".
    const pairs = Math.max(1, count - 1);
    const finest = this.#levels[this.#levels.length - 1]![0];
    const flowMips = Math.floor(Math.log2(Math.max(finest.width, finest.height))) + 1;
    const neutral = new Uint8Array(finest.width * finest.height * pairs * 4);

    for (let i = 0; i < neutral.length; i += 4) {
      neutral[i] = 128;
      neutral[i + 1] = 128;
      neutral[i + 3] = 255;
    }

    const flowTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, flowTexture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, flowMips, gl.RGBA8, finest.width, finest.height, pairs);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      0,
      finest.width,
      finest.height,
      pairs,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      neutral
    );
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.#flowTexture = flowTexture;
    this.#flowFramebuffer = gl.createFramebuffer();

    this.#flowDone = new Uint8Array(count - 1);
    this.#flowPending = count - 1;
    this.#depthDone = new Uint8Array(count);
  }

  /**
   * Give one tile its depth map (one byte per pixel from the top row, 0 far and 255 near). Every map must be the same
   * size. Tiles without one are drawn flat, as before.
   */
  setDepth(layer: number, data: Uint8Array, width: number, height: number): void {
    if (this.#lost || layer < 0 || layer >= this.#tiles.length || data.length !== width * height) return;

    const gl = this.#gl;

    if (!this.#depthTexture || this.#depthSize[0] !== width || this.#depthSize[1] !== height) {
      gl.deleteTexture(this.#depthTexture);
      this.#depthTexture = gl.createTexture();
      this.#depthSize = [width, height];
      this.#depthDone.fill(0);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#depthTexture);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8, width, height, this.#tiles.length);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#depthTexture);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, width, height, 1, gl.RED, gl.UNSIGNED_BYTE, data);
    this.#depthDone[layer] = 1;
  }

  /**
   * A sharper picture of one exact moment, framed like the tiles, to show while the pointer rests there. `image`
   * must be readable (same origin or CORS-enabled).
   */
  setDetail(image: TexImageSource): void {
    if (this.#lost) return;

    const gl = this.#gl;

    this.#detailTexture ??= gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.#detailTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** The tile at or before `time`, and how far `time` has moved toward the next one. */
  locate(time: number): { index: number; mix: number } {
    const tiles = this.#tiles;

    if (tiles.length === 0) return { index: 0, mix: 0 };

    let low = 0;
    let high = tiles.length - 1;

    while (low < high) {
      const middle = (low + high + 1) >> 1;

      if (tiles[middle]!.time <= time) low = middle;
      else high = middle - 1;
    }

    if (low >= tiles.length - 1) return { index: tiles.length - 1, mix: 0 };

    const start = tiles[low]!.time;
    const span = tiles[low + 1]!.time - start;

    return { index: low, mix: span > 0 ? Math.min(1, Math.max(0, (time - start) / span)) : 0 };
  }

  /**
   * Solve flow for up to `budget` pairs, nearest to `time` first. Call once per frame while `pending` is above zero.
   */
  solve(budget: number, time?: number): void {
    if (this.#lost || !this.ready || this.#flowPending === 0) return;

    if (time !== undefined) this.#focus = this.locate(time).index;

    let solved = 0;

    for (let distance = 0; distance < this.#flowDone.length && solved < budget; distance++) {
      for (const pair of distance === 0 ? [this.#focus] : [this.#focus + distance, this.#focus - distance]) {
        if (pair < 0 || pair >= this.#flowDone.length || this.#flowDone[pair] || solved >= budget) continue;

        this.#solvePair(pair);
        solved++;
      }
    }

    if (solved > 0) {
      const gl = this.#gl;

      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#flowTexture);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    }
  }

  /** Wipe the canvas, leaving whatever is underneath it in view. */
  clear(): void {
    const gl = this.#gl;

    if (this.#lost) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Draw the orb. Clears the canvas first; with `presence` 0 it only clears. */
  render(view: OrbView): void {
    const gl = this.#gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (this.#lost || !this.ready || view.presence <= 0.001) return;

    // A small orb with no stage touches a small part of the canvas; only shade that part.
    if (view.wrap >= 1 && view.stage <= 0) {
      const reach = view.radius * 1.9;
      const x = Math.floor(view.x - reach);
      const y = Math.floor(this.canvas.height - (view.y + reach));
      const size = Math.ceil(reach * 2);

      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x, y, size, size);
    }

    const { index, mix } = this.locate(view.time);
    const { uniforms } = this.#use(this.#orb);

    this.#bindMorph(uniforms, index, mix, view.smear, view.parallax, view.dolly);
    gl.uniform2f(uniforms.uResolution!, this.canvas.width, this.canvas.height);
    gl.uniform3f(uniforms.uOrb!, view.x, view.y, view.radius);
    gl.uniform4f(uniforms.uFrame!, view.frame.x, view.frame.y, view.frame.width, view.frame.height);
    gl.uniform1f(uniforms.uWrap!, view.wrap);
    gl.uniform1f(uniforms.uStage!, view.stage);
    gl.uniform1f(uniforms.uWide!, view.wide);
    gl.uniform1f(uniforms.uMist!, view.mist);
    gl.uniform1f(uniforms.uSparks!, view.sparks);
    gl.uniform1f(uniforms.uClock!, view.clock);
    gl.uniform1f(uniforms.uInspect!, view.inspect);
    gl.uniform1f(uniforms.uStone!, view.stone);
    gl.uniform1f(uniforms.uHeat!, view.heat);
    gl.uniform1f(uniforms.uPresence!, view.presence);
    gl.uniform1f(uniforms.uReveal!, view.reveal);
    gl.uniform1f(uniforms.uPixelRatio!, view.pixelRatio);
    gl.uniform2f(uniforms.uTilt!, view.tilt[0], view.tilt[1]);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.#detailTexture);
    gl.uniform1i(uniforms.uDetail!, 2);
    gl.uniform1f(uniforms.uDetailMix!, this.#detailTexture ? view.detail : 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
  }

  /** Development view: the bare morph at `time`, drawn into a rectangle of the canvas (pixels, y down). */
  renderFlat(time: number, x: number, y: number, width: number, height: number): void {
    if (this.#lost || !this.ready) return;

    const gl = this.#gl;
    const { index, mix } = this.locate(time);
    const { uniforms } = this.#use(this.#flat);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(x, this.canvas.height - y - height, width, height);
    this.#bindMorph(uniforms, index, mix, 0, [0, 0], 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    this.#release();
    this.#gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  #bindMorph(
    uniforms: Program['uniforms'],
    index: number,
    mix: number,
    smear: number,
    parallax: [number, number],
    dolly: number
  ): void {
    const gl = this.#gl;
    const last = this.#tiles.length - 1;
    const next = mix > 0 ? Math.min(index + 1, last) : index;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#tileTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#flowTexture);
    gl.uniform1i(uniforms.uTiles!, 0);
    gl.uniform1i(uniforms.uFlow!, 1);
    gl.uniform1f(uniforms.uA!, index);
    gl.uniform1f(uniforms.uB!, next);
    gl.uniform1f(uniforms.uMix!, next === index ? 0 : mix);
    gl.uniform1f(uniforms.uSmear!, smear);
    gl.uniform2f(uniforms.uTileSize!, this.#tileSize[0], this.#tileSize[1]);
    gl.uniform1f(uniforms.uFlowReady!, this.#flowDone[index] ? 1 : 0);

    // Unit 3 always holds an array texture, so the sampler is valid even before any depth exists.
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#depthTexture ?? this.#tileTexture);
    gl.uniform1i(uniforms.uDepth!, 3);
    gl.uniform2f(
      uniforms.uDepthReady!,
      this.#depthTexture && this.#depthDone[index] ? 1 : 0,
      this.#depthTexture && this.#depthDone[next] ? 1 : 0
    );
    gl.uniform2f(uniforms.uParallax!, parallax[0], parallax[1]);
    gl.uniform1f(uniforms.uDolly!, dolly);
  }

  #solvePair(pair: number): void {
    const gl = this.#gl;
    let previous: Target | null = null;

    gl.bindVertexArray(this.#vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#tileTexture);
    gl.activeTexture(gl.TEXTURE1);

    this.#levels.forEach(([front, back], level) => {
      const lod = FLOW_LODS[level]!;

      for (let iteration = 0; iteration < STEPS_PER_LEVEL; iteration++) {
        // Refine into `front`, reading the coarser level's result (bilinear upsampling for free) or our own last pass.
        const step = this.#use(this.#step).uniforms;

        gl.bindFramebuffer(gl.FRAMEBUFFER, front.framebuffer);
        gl.viewport(0, 0, front.width, front.height);
        gl.bindTexture(gl.TEXTURE_2D, previous?.texture ?? null);
        gl.uniform1i(step.uTiles!, 0);
        gl.uniform1i(step.uPrev!, 1);
        gl.uniform1f(step.uHasPrev!, previous ? 1 : 0);
        gl.uniform1f(step.uA!, pair);
        gl.uniform1f(step.uB!, pair + 1);
        gl.uniform1f(step.uLod!, lod);
        gl.uniform2f(step.uTexel!, 1 / front.width, 1 / front.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // Smooth into `back`.
        const blur = this.#use(this.#blur).uniforms;

        gl.bindFramebuffer(gl.FRAMEBUFFER, back.framebuffer);
        gl.bindTexture(gl.TEXTURE_2D, front.texture);
        gl.uniform1i(blur.uPrev!, 1);
        gl.uniform2f(blur.uTexel!, 1 / front.width, 1 / front.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        previous = back;
      }
    });

    // Keep the result, with the agreement measure, as this pair's layer.
    const finest = this.#levels[this.#levels.length - 1]![1];
    const finish = this.#use(this.#finish).uniforms;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#flowFramebuffer);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.#flowTexture, 0, pair);
    gl.viewport(0, 0, finest.width, finest.height);
    gl.bindTexture(gl.TEXTURE_2D, finest.texture);
    gl.uniform1i(finish.uTiles!, 0);
    gl.uniform1i(finish.uPrev!, 1);
    gl.uniform1f(finish.uA!, pair);
    gl.uniform1f(finish.uB!, pair + 1);
    gl.uniform1f(finish.uLod!, FLOW_LODS[FLOW_LODS.length - 1]! + 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.#flowDone[pair] = 1;
    this.#flowPending--;
  }

  #target(width: number, height: number): Target {
    const gl = this.#gl;
    const texture = gl.createTexture()!;
    const framebuffer = gl.createFramebuffer()!;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { texture, framebuffer, width, height };
  }

  #use(program: Program): Program {
    this.#gl.useProgram(program.program);
    this.#gl.bindVertexArray(this.#vao);

    return program;
  }

  #compile(fragment: string): Program {
    const gl = this.#gl;
    const program = gl.createProgram()!;

    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = gl.createShader(type)!;

      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`Shader failed to compile: ${gl.getShaderInfoLog(shader)}`);
      }

      gl.attachShader(program, shader);
    }

    gl.bindAttribLocation(program, 0, 'aPos');
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program failed to link: ${gl.getProgramInfoLog(program)}`);
    }

    const uniforms: Program['uniforms'] = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;

    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(program, i)!.name;

      uniforms[name] = gl.getUniformLocation(program, name);
    }

    // Uniforms the compiler dropped read back as null, which WebGL accepts and ignores.
    return { program, uniforms: new Proxy(uniforms, { get: (target, key: string) => target[key] ?? null }) };
  }

  #release(): void {
    const gl = this.#gl;

    gl.deleteTexture(this.#tileTexture);
    gl.deleteTexture(this.#flowTexture);
    gl.deleteTexture(this.#detailTexture);
    gl.deleteTexture(this.#depthTexture);
    gl.deleteFramebuffer(this.#flowFramebuffer);

    for (const pair of this.#levels) {
      for (const target of pair) {
        gl.deleteTexture(target.texture);
        gl.deleteFramebuffer(target.framebuffer);
      }
    }

    this.#tileTexture = null;
    this.#flowTexture = null;
    this.#detailTexture = null;
    this.#depthTexture = null;
    this.#depthDone = new Uint8Array(0);
    this.#flowFramebuffer = null;
    this.#levels = [];
    this.#tiles = [];
    this.#flowDone = new Uint8Array(0);
    this.#flowPending = 0;
  }
}
