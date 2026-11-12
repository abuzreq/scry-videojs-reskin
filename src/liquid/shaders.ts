/**
 * GLSL for the liquid engine (WebGL2 / GLSL ES 3.00).
 *
 * Conventions shared by every shader:
 * - Tile space is `uv` in 0..1 with v = 0 at the top of the picture.
 * - Flow is stored in RGBA8 so no float-texture extension is needed: `rg` holds the displacement from tile A to
 *   tile B in tile-space units, packed from ±FLOW_RANGE; `b` holds how well A and B agree after that displacement.
 */

/** Largest displacement the flow can express, as a fraction of the picture. */
export const FLOW_RANGE = 0.2;

const HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
const float FLOW_RANGE = ${FLOW_RANGE.toFixed(4)};
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 unpackFlow(vec4 t) { return (t.rg - 0.5) * 2.0 * FLOW_RANGE; }
vec2 packFlow(vec2 f) { return clamp(f / (2.0 * FLOW_RANGE) + 0.5, 0.0, 1.0); }
`;

export const VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/**
 * One Lucas–Kanade refinement step at one pyramid level. Run a few times per level, coarse to fine, with a blur
 * between steps: the blur is what keeps the field smooth where the two pictures share nothing.
 */
export const FLOW_STEP = /* glsl */ `${HEADER}
uniform sampler2DArray uTiles;
uniform sampler2D uPrev;
uniform float uHasPrev;
uniform float uA;
uniform float uB;
uniform float uLod;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;

float la(vec2 p) { return luma(textureLod(uTiles, vec3(p, uA), uLod).rgb); }
float lb(vec2 p) { return luma(textureLod(uTiles, vec3(p, uB), uLod).rgb); }

void main() {
  vec2 flow = uHasPrev > 0.5 ? unpackFlow(texture(uPrev, vUv)) : vec2(0.0);
  vec2 dx = vec2(uTexel.x, 0.0);
  vec2 dy = vec2(0.0, uTexel.y);
  float sxx = 0.0, sxy = 0.0, syy = 0.0, sxt = 0.0, syt = 0.0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 pa = vUv + vec2(float(i), float(j)) * uTexel * 1.5;
      vec2 pb = pa + flow;
      float gx = (lb(pb + dx) - lb(pb - dx) + la(pa + dx) - la(pa - dx)) * 0.25;
      float gy = (lb(pb + dy) - lb(pb - dy) + la(pa + dy) - la(pa - dy)) * 0.25;
      float gt = lb(pb) - la(pa);
      sxx += gx * gx; sxy += gx * gy; syy += gy * gy;
      sxt += gx * gt; syt += gy * gt;
    }
  }

  // Damped least squares: where the window has no texture the update shrinks to nothing instead of exploding.
  const float damping = 0.0015;
  float a = sxx + damping;
  float c = syy + damping;
  float det = a * c - sxy * sxy;
  vec2 stepTexels = vec2(-(c * sxt - sxy * syt), -(a * syt - sxy * sxt)) / det;
  float len = length(stepTexels);
  if (len > 1.5) stepTexels *= 1.5 / len;

  flow += stepTexels * uTexel;
  outColor = vec4(packFlow(flow), 0.0, 1.0);
}`;

/** 3×3 binomial blur of a packed flow field. */
export const FLOW_BLUR = /* glsl */ `${HEADER}
uniform sampler2D uPrev;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 sum = vec4(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      float w = (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0);
      sum += texture(uPrev, vUv + vec2(float(i), float(j)) * uTexel) * w;
    }
  }
  outColor = sum / 16.0;
}`;

/** Final pass per pair: keep the flow and measure how well the two pictures agree under it. */
export const FLOW_FINISH = /* glsl */ `${HEADER}
uniform sampler2DArray uTiles;
uniform sampler2D uPrev;
uniform float uA;
uniform float uB;
uniform float uLod;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 packed = texture(uPrev, vUv);
  vec2 flow = unpackFlow(packed);
  vec3 a = textureLod(uTiles, vec3(vUv, uA), uLod).rgb;
  vec3 b = textureLod(uTiles, vec3(vUv + flow, uB), uLod).rgb;
  vec3 d = a - b;
  float agreement = exp(-dot(d, d) * 28.0);
  outColor = vec4(packed.rg, agreement, 1.0);
}`;

/**
 * The picture between two tiles. Shared by the orb and by the flat debug view.
 *
 * Where the tiles agree (same shot), it is a motion-compensated blend: both tiles are pulled along the flow toward
 * the moment in between. Where they do not (a cut), the same machinery turns into a dissolve that reads as liquid:
 * the smooth flow field becomes a slow swirl, the outgoing picture defocuses and pushes in, the incoming one arrives
 * from behind it, and brighter regions of the incoming picture come through first.
 */
const MORPH = /* glsl */ `
uniform sampler2DArray uTiles;
uniform sampler2DArray uFlow;
uniform float uA;
uniform float uB;
uniform float uMix;
uniform float uSmear;
uniform vec2 uTileSize;
uniform float uFlowReady;
// Optional depth per tile (0 far, 1 near), present once the depth tier has looked at a tile.
uniform sampler2DArray uDepth;
uniform vec2 uDepthReady;
uniform vec2 uParallax;
uniform float uDolly;

vec3 tile(float layer, vec2 uv, float lod) {
  if (lod < 0.05) return textureLod(uTiles, vec3(uv, layer), 0.0).rgb;
  // A mip on its own magnifies into blocks; four diagonal taps around it make the defocus round.
  vec2 r = exp2(lod) / uTileSize * 0.7;
  vec3 c = textureLod(uTiles, vec3(uv, layer), lod).rgb * 0.32;
  c += textureLod(uTiles, vec3(uv + vec2(r.x, r.y), layer), lod).rgb * 0.17;
  c += textureLod(uTiles, vec3(uv + vec2(-r.x, r.y), layer), lod).rgb * 0.17;
  c += textureLod(uTiles, vec3(uv + vec2(r.x, -r.y), layer), lod).rgb * 0.17;
  c += textureLod(uTiles, vec3(uv + vec2(-r.x, -r.y), layer), lod).rgb * 0.17;
  return c;
}

/**
 * With depth, the picture stops being a flat card: a small sideways move of the eye shifts near things further than
 * far ones, and moving forward makes near things grow faster.
 */
vec2 inDepth(vec2 uv, float layer, float ready, out float depth) {
  depth = 0.5;
  if (ready < 0.5) return uv;
  depth = textureLod(uDepth, vec3(uv, layer), 0.0).r;
  float near = depth - 0.5;
  return vec2(0.5) + (uv - vec2(0.5)) * (1.0 - uDolly * near) - uParallax * near;
}

/** The same move of the eye for a picture that is not a tile: borrow the depth of whichever tile is closer in time. */
vec2 inNearestDepth(vec2 uv) {
  float depth;
  return uMix < 0.5 ? inDepth(uv, uA, uDepthReady.x, depth) : inDepth(uv, uB, uDepthReady.y, depth);
}

vec3 morph(vec2 p) {
  float depthA, depthB;
  if (uA == uB) return tile(uA, inDepth(p, uA, uDepthReady.x, depthA), uSmear);

  // The top mip of the flow layer is the pair's average agreement: one number for "same shot or not".
  float related = smoothstep(0.3, 0.62, textureLod(uFlow, vec3(0.5, 0.5, uA), 16.0).b) * uFlowReady;
  float cut = 1.0 - related;
  // Across a cut the fine detail of the flow is noise; a coarser mip keeps the broad currents and drops the wrinkles.
  vec2 flow = unpackFlow(textureLod(uFlow, vec3(p, uA), 2.2 * cut)) * uFlowReady;

  // Pictures get most of the time, the passage between them the rest.
  float s = mix(uMix, uMix * uMix * (3.0 - 2.0 * uMix), 0.65);

  float gain = mix(1.0, 1.7, cut);
  vec2 ua = p - flow * gain * s;
  vec2 ub = p + flow * gain * (1.0 - s);

  // Across a cut, travel forward: the old picture grows past the viewer, the new one arrives from the distance.
  vec2 centre = vec2(0.5);
  float push = 0.26 * cut;
  ua = centre + (ua - centre) / (1.0 + push * s);
  ub = centre + (ub - centre) * (1.0 + push * (1.0 - s));

  ua = inDepth(ua, uA, uDepthReady.x, depthA);
  ub = inDepth(ub, uB, uDepthReady.y, depthB);

  float lodA = uSmear + 3.6 * cut * smoothstep(0.0, 0.7, s);
  float lodB = uSmear + 3.6 * cut * smoothstep(0.0, 0.7, 1.0 - s);
  vec3 a = tile(uA, ua, lodA);
  vec3 b = tile(uB, ub, lodB);

  // Light leads: bright parts of the incoming picture surface first.
  float glow = luma(textureLod(uTiles, vec3(ub, uB), 4.5).rgb);
  // With depth, distance leads as well: the far of the new picture settles first and its foreground steps in last.
  float order = mix(0.72 - 0.44 * glow, 0.3 + 0.42 * depthB, 0.6 * uDepthReady.y);
  float threshold = mix(0.5, order, cut);
  float liquid = smoothstep(threshold - 0.27, threshold + 0.27, s);
  float w = mix(s, liquid, cut);

  return mix(a, b, w);
}
`;

/** Debug view: the morph with no lens, filling the viewport. */
export const FLAT = /* glsl */ `${HEADER}
${MORPH}
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = vec4(morph(vec2(vUv.x, 1.0 - vUv.y)), 1.0);
}`;

/**
 * The orb. Draws a glass sphere at uOrb (centre and radius in canvas pixels, y down) holding the morphed picture.
 * uBloom takes it from a sphere on the timeline (0) to the whole frame (1): the radius opens up, the lens relaxes
 * to flat, and the picture settles exactly onto uFrame, where the real video sits underneath.
 */
export const ORB = /* glsl */ `${HEADER}
${MORPH}
uniform vec2 uResolution;
uniform vec3 uOrb;
uniform vec4 uFrame;
uniform float uBloom;
uniform float uPresence;
uniform float uReveal;
uniform float uPixelRatio;
uniform vec2 uTilt;
uniform sampler2D uDetail;
uniform float uDetailMix;
out vec4 outColor;

/** Where a point of the sphere (p in -1..1, r = |p|) looks in the picture: tight in the middle, wide at the rim. */
vec2 lensUv(vec2 p, float r, float scale) {
  float aspect = uTileSize.x / uTileSize.y;
  float edge = pow(r, 2.4);
  vec2 extent = vec2(mix(0.6 / aspect, 0.9, edge), mix(0.6, 0.96, edge));
  return 0.5 + (p + uTilt * (1.0 - r * r) * 0.12) * extent * 0.5 * scale;
}

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  float open = uBloom * uBloom * (3.0 - 2.0 * uBloom);
  float lens = 1.0 - open;

  // As it opens, the sphere grows from its place on the timeline until it reaches past the farthest corner.
  vec2 corner = max(uOrb.xy, uResolution - uOrb.xy);
  float radius = mix(uOrb.z, length(corner) + 2.0, open);
  vec2 centre = mix(uOrb.xy, uFrame.xy + uFrame.zw * 0.5, open * open);

  vec2 p = (pixel - centre) / radius;
  float r = length(p);
  float dist = (r - 1.0) * radius;
  float aa = uPixelRatio * 0.75;

  // Shadow on the picture behind the sphere, falling slightly downward. Gone once it opens.
  vec2 ps = (pixel - centre - vec2(0.0, radius * 0.1)) / radius;
  float shadow = 0.42 * lens * exp(-pow(max(length(ps) - 0.9, 0.0) * 4.2, 2.0)) * smoothstep(1.7, 0.9, length(ps));

  // uReveal lets the real picture underneath take over once the player has caught up.
  float keep = uPresence * (1.0 - uReveal);

  if (dist > aa) {
    outColor = vec4(0.0, 0.0, 0.0, shadow * keep);
    return;
  }

  float z = sqrt(max(1.0 - r * r, 0.0));
  vec2 frameUv = (pixel - uFrame.xy) / uFrame.zw;
  float settle = smoothstep(0.35, 1.0, open);

  // A little dispersion toward the rim: red and blue see slightly different pictures.
  float fringe = 0.022 * lens * pow(r, 3.0);
  vec2 uvG = mix(lensUv(p, r, 1.0), frameUv, settle);
  vec3 col;
  if (fringe > 0.0008) {
    vec2 uvR = mix(lensUv(p, r, 1.0 - fringe), frameUv, settle);
    vec2 uvB = mix(lensUv(p, r, 1.0 + fringe), frameUv, settle);
    col = vec3(morph(uvR).r, morph(uvG).g, morph(uvB).b);
  } else {
    col = morph(uvG);
  }

  // When the pointer rests, the exact frame for that moment replaces the storyboard's approximation.
  if (uDetailMix > 0.001) col = mix(col, texture(uDetail, inNearestDepth(uvG)).rgb, uDetailMix);

  // Glass: darker where it is thick toward the rim, a bright edge where light grazes it, a window reflection.
  float body = mix(1.0, 0.58, smoothstep(0.5, 1.0, r) * lens);
  col *= body;
  float graze = pow(1.0 - z, 4.0);
  col += vec3(0.92, 0.96, 1.0) * graze * 0.5 * lens;

  vec2 h = (p - vec2(-0.36, -0.5)) / vec2(0.46, 0.24);
  float sheen = exp(-dot(h, h) * 1.6) * 0.34;
  vec2 g = (p - vec2(-0.47, -0.55)) / vec2(0.1, 0.055);
  float glint = exp(-dot(g, g) * 1.4) * 0.5;
  vec2 k = (p - vec2(0.34, 0.66)) / vec2(0.36, 0.16);
  float bounce = exp(-dot(k, k) * 1.8) * 0.16;
  col += vec3(1.0) * (sheen + glint + bounce) * lens;

  float alpha = smoothstep(aa, -aa, dist) * keep;
  // Premultiplied, over whatever shadow would have shown through the antialiased edge.
  outColor = vec4(col * alpha, alpha + shadow * keep * (1.0 - alpha));
}`;
