import { getBlueNoiseTexture64 } from "./dither";
import {
  resolveBackgroundArgs,
  type PreparedLayer,
  type ResolvedBackgroundArgs,
} from "./engine";
import type {
  BackgroundArgs,
  BackgroundBlendMode,
  BackgroundColorSpace,
} from "./types";

const EPSILON = 1e-6;
const MAX_LAYERS = 6;
const MAX_STOPS = 4;

export const BACKGROUND_WEBGL_LIMITS = {
  maxLayers: MAX_LAYERS,
  maxStopsPerLayer: MAX_STOPS,
} as const;

export interface BackgroundWebGLSupportResult {
  supported: boolean;
  reason?: string;
}

const VERTEX_SHADER_SOURCE = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision highp float;

varying vec2 vUv;

#define MAX_LAYERS ${MAX_LAYERS}
#define MAX_STOPS ${MAX_STOPS}
const float EPS = 0.000001;

uniform vec2 uDesignSize;
uniform vec2 uPhysicalSize;
uniform vec4 uBaseColor;
uniform float uOpaque;
uniform int uLayerCount;
uniform float uDitherMode;
uniform float uDitherAmplitude;
uniform float uGlobalGrainAmount;
uniform float uGlobalGrainScale;
uniform float uGlobalGrainSeed;
uniform float uGlobalGrainMono;
uniform sampler2D uBlueNoise;
uniform float uHasBlueNoise;

uniform vec4 uLayerMeta1[MAX_LAYERS];
uniform vec4 uLayerMeta2[MAX_LAYERS];
uniform vec4 uLayerLinear1[MAX_LAYERS];
uniform vec4 uLayerLinear2[MAX_LAYERS];
uniform vec4 uLayerLinear3[MAX_LAYERS];
uniform vec4 uLayerRadial1[MAX_LAYERS];
uniform vec4 uLayerRadial2[MAX_LAYERS];
uniform vec4 uLayerBox1[MAX_LAYERS];
uniform vec4 uLayerBox2[MAX_LAYERS];
uniform vec4 uLayerGrain[MAX_LAYERS];

uniform vec4 uStopPos[MAX_LAYERS];
uniform vec4 uStopColor0[MAX_LAYERS];
uniform vec4 uStopColor1[MAX_LAYERS];
uniform vec4 uStopColor2[MAX_LAYERS];
uniform vec4 uStopColor3[MAX_LAYERS];
uniform vec4 uStopLab0[MAX_LAYERS];
uniform vec4 uStopLab1[MAX_LAYERS];
uniform vec4 uStopLab2[MAX_LAYERS];
uniform vec4 uStopLab3[MAX_LAYERS];

float clamp01(float value) {
  return clamp(value, 0.0, 1.0);
}

// Abramowitz & Stegun approximation 7.1.26 — max error < 1.5e-7.
float erfApprox(float x) {
  float ax = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * ax);
  float y = 1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
                     - 0.284496736) * t + 0.254829592) * t * exp(-ax * ax);
  return sign(x) * y;
}

// Gaussian CDF shadow matching CSS box-shadow spec (sigma = blur / 2).
float gaussianShadow(float sdf, float blur) {
  float sigma = blur / 2.0;
  return 0.5 * (1.0 + erfApprox(sdf / (sigma * 1.41421356)));
}

float ign(vec2 p) {
  float dotv = p.x * 0.06711056 + p.y * 0.00583715;
  return fract(52.9829189 * fract(dotv));
}

float triangularNoise(vec2 p, float seed) {
  float base = seed * 17.71;
  float u1 = ign(p + vec2(11.2 + base, 37.9 + base * 0.5));
  float u2 = ign(p + vec2(59.4 + base * 1.3, 7.3 + base * 0.9));
  return u1 + u2 - 1.0;
}

vec4 clampLinearColor(vec4 color) {
  return vec4(
    clamp(color.r, 0.0, 1.0),
    clamp(color.g, 0.0, 1.0),
    clamp(color.b, 0.0, 1.0),
    clamp(color.a, 0.0, 1.0)
  );
}

float layerStopPosition(int layerIndex, int stopIndex) {
  vec4 positions = uStopPos[layerIndex];
  if (stopIndex == 0) return positions.x;
  if (stopIndex == 1) return positions.y;
  if (stopIndex == 2) return positions.z;
  return positions.w;
}

vec4 layerStopColorLinear(int layerIndex, int stopIndex) {
  if (stopIndex == 0) return uStopColor0[layerIndex];
  if (stopIndex == 1) return uStopColor1[layerIndex];
  if (stopIndex == 2) return uStopColor2[layerIndex];
  return uStopColor3[layerIndex];
}

vec4 layerStopColorLab(int layerIndex, int stopIndex) {
  if (stopIndex == 0) return uStopLab0[layerIndex];
  if (stopIndex == 1) return uStopLab1[layerIndex];
  if (stopIndex == 2) return uStopLab2[layerIndex];
  return uStopLab3[layerIndex];
}

vec4 oklabToLinear(vec4 labAlpha) {
  float lPrime = labAlpha.x + 0.3963377774 * labAlpha.y + 0.2158037573 * labAlpha.z;
  float mPrime = labAlpha.x - 0.1055613458 * labAlpha.y - 0.0638541728 * labAlpha.z;
  float sPrime = labAlpha.x - 0.0894841775 * labAlpha.y - 1.2914855480 * labAlpha.z;

  float l3 = lPrime * lPrime * lPrime;
  float m3 = mPrime * mPrime * mPrime;
  float s3 = sPrime * sPrime * sPrime;

  vec4 linear = vec4(
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3,
    labAlpha.w
  );
  return clampLinearColor(linear);
}

vec4 sampleStops(int layerIndex, float t, int colorSpaceCode) {
  int stopCount = int(uLayerMeta2[layerIndex].w + 0.5);
  if (stopCount <= 0) {
    return vec4(0.0);
  }

  if (stopCount == 1) {
    vec4 color = layerStopColorLinear(layerIndex, 0);
    if (colorSpaceCode == 1) {
      color = oklabToLinear(layerStopColorLab(layerIndex, 0));
    }
    return color;
  }

  float tt = clamp01(t);
  float firstPosition = layerStopPosition(layerIndex, 0);
  if (tt <= firstPosition) {
    vec4 color = layerStopColorLinear(layerIndex, 0);
    if (colorSpaceCode == 1) {
      color = oklabToLinear(layerStopColorLab(layerIndex, 0));
    }
    return color;
  }

  int lastIndex = stopCount - 1;
  float lastPosition = layerStopPosition(layerIndex, lastIndex);
  if (tt >= lastPosition) {
    vec4 color = layerStopColorLinear(layerIndex, lastIndex);
    if (colorSpaceCode == 1) {
      color = oklabToLinear(layerStopColorLab(layerIndex, lastIndex));
    }
    return color;
  }

  for (int stopIndex = 0; stopIndex < MAX_STOPS - 1; stopIndex++) {
    if (stopIndex >= stopCount - 1) {
      break;
    }

    float startPosition = layerStopPosition(layerIndex, stopIndex);
    float endPosition = layerStopPosition(layerIndex, stopIndex + 1);
    if (tt > endPosition) {
      continue;
    }

    float span = max(EPS, endPosition - startPosition);
    float segT = (tt - startPosition) / span;

    if (colorSpaceCode == 0) {
      vec4 startColor = layerStopColorLinear(layerIndex, stopIndex);
      vec4 endColor = layerStopColorLinear(layerIndex, stopIndex + 1);
      return mix(startColor, endColor, segT);
    }

    vec4 startLab = layerStopColorLab(layerIndex, stopIndex);
    vec4 endLab = layerStopColorLab(layerIndex, stopIndex + 1);
    return oklabToLinear(mix(startLab, endLab, segT));
  }

  vec4 fallback = layerStopColorLinear(layerIndex, lastIndex);
  if (colorSpaceCode == 1) {
    fallback = oklabToLinear(layerStopColorLab(layerIndex, lastIndex));
  }
  return fallback;
}

float signedDistanceRoundedRect(vec2 p, vec4 rect, float radius) {
  vec2 center = rect.xy + rect.zw * 0.5;
  vec2 halfSize = rect.zw * 0.5;
  float r = clamp(radius, 0.0, min(halfSize.x, halfSize.y));
  vec2 q = abs(p - center) - (halfSize - vec2(r));
  float outside = length(max(q, vec2(0.0)));
  float inside = min(max(q.x, q.y), 0.0);
  return outside + inside - r;
}

vec2 sampleLayerProgress(int layerIndex, vec2 designPx) {
  float layerType = uLayerMeta1[layerIndex].x;

  if (layerType < 0.5) {
    vec4 linear1 = uLayerLinear1[layerIndex];
    vec4 linear2 = uLayerLinear2[layerIndex];
    vec4 linear3 = uLayerLinear3[layerIndex];

    float rawT = 0.0;
    float mode = linear1.x;

    if (mode > 0.5) {
      vec2 start = vec2(linear1.y, linear1.z);
      vec2 dir = vec2(linear2.x, linear2.y);
      float lenSq = max(EPS, linear1.w);
      rawT = dot(designPx - start, dir) / lenSq;
    } else {
      vec2 dir = vec2(linear2.x, linear2.y);
      vec2 center = vec2(linear2.z, linear2.w);
      float safeLength = max(EPS, linear1.w);
      float halfLength = linear3.x;
      rawT = (dot(designPx - center, dir) + halfLength) / safeLength;
    }

    float easing = max(EPS, linear3.y);
    float t = pow(clamp01(rawT), easing);
    return vec2(t, 1.0);
  }

  if (layerType < 1.5) {
    vec4 radial1 = uLayerRadial1[layerIndex];
    vec4 radial2 = uLayerRadial2[layerIndex];

    vec2 center = radial1.xy;
    vec2 radius = vec2(max(EPS, radial1.z), max(EPS, radial1.w));
    vec2 delta = (designPx - center) / radius;

    // Lp norm: p=2 is standard ellipse, p>2 gives squircle shapes.
    float p = radial2.w;
    float distanceValue;
    if (p <= 2.01 && p >= 1.99) {
      distanceValue = length(delta);
    } else {
      distanceValue = pow(pow(abs(delta.x), p) + pow(abs(delta.y), p), 1.0 / p);
    }

    float innerRadius = radial2.x;
    float outerRadius = radial2.y;
    float span = max(EPS, outerRadius - innerRadius);
    float rawT = clamp01((distanceValue - innerRadius) / span);
    float falloff = max(EPS, radial2.z);

    return vec2(pow(rawT, falloff), 1.0);
  }

  vec4 box1 = uLayerBox1[layerIndex];
  vec4 box2 = uLayerBox2[layerIndex];

  float outerRadius = box2.x;
  float spread = box2.y;
  float blur = max(0.0, box2.z);
  bool inset = box2.w > 0.5;

  if (inset) {
    // Outer clip
    float outerSdf = signedDistanceRoundedRect(designPx, box1, outerRadius);
    if (outerSdf > 0.0) {
      return vec2(0.0, 0.0);
    }

    // Inner contracted "hole" (CSS convention: positive spread shrinks hole)
    float innerW = max(0.0, box1.z - 2.0 * spread);
    float innerH = max(0.0, box1.w - 2.0 * spread);
    if (innerW <= 0.0 || innerH <= 0.0) {
      return vec2(0.0, 1.0);
    }
    float innerR = max(0.0, outerRadius - spread);
    vec4 innerRect = vec4(box1.x + spread, box1.y + spread, innerW, innerH);
    float innerSdf = signedDistanceRoundedRect(designPx, innerRect, innerR);

    if (blur <= EPS) {
      return vec2(innerSdf < 0.0 ? 1.0 : 0.0, 1.0);
    }

    float rawShadow = gaussianShadow(innerSdf, blur);
    return vec2(1.0 - rawShadow, 1.0);
  }

  // Outer shadow
  float sdf = signedDistanceRoundedRect(designPx, box1, outerRadius);
  if (sdf <= 0.0) {
    return vec2(0.0, 0.0);
  }
  if (blur <= EPS) {
    return vec2(sdf <= spread ? 0.0 : 0.0, sdf <= spread ? 1.0 : 0.0);
  }
  float d = sdf - spread;
  float rawAlpha = 1.0 - gaussianShadow(d, blur);
  if (rawAlpha < 0.001) {
    return vec2(0.0, 0.0);
  }
  return vec2(1.0 - rawAlpha, 1.0);
}

vec4 applyShadow(vec4 color, int layerIndex, float t) {
  vec4 meta2 = uLayerMeta2[layerIndex];
  float startIntensity = meta2.x;
  float endIntensity = meta2.y;
  float curve = max(EPS, meta2.z);
  float shaped = pow(clamp01(t), curve);
  float intensity = clamp(mix(startIntensity, endIntensity, shaped), 0.0, 1.0);
  float multiplier = 1.0 - intensity;
  return vec4(color.rgb * multiplier, color.a);
}

float perceptualGrainScale(vec4 color) {
  float luminance = max(0.0001, 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b);
  return min(1.0, sqrt(luminance / 0.18));
}

vec4 applyGrain(vec4 color, vec2 designPx, vec4 grain) {
  float amount = grain.x;
  if (amount <= 0.0) {
    return color;
  }

  float scale = grain.y;
  float seed = grain.z;
  float monochrome = grain.w;
  vec2 scaled = designPx * scale;
  float pScale = perceptualGrainScale(color);

  if (monochrome > 0.5) {
    float n = triangularNoise(scaled, seed) * amount * pScale;
    return clampLinearColor(vec4(color.r + n, color.g + n, color.b + n, color.a));
  }

  float nr = triangularNoise(scaled + vec2(13.1, 7.7), seed) * amount * pScale;
  float ng = triangularNoise(scaled + vec2(29.3, 19.1), seed + 1.0) * amount * pScale;
  float nb = triangularNoise(scaled + vec2(47.9, 31.3), seed + 2.0) * amount * pScale;

  return clampLinearColor(vec4(color.r + nr, color.g + ng, color.b + nb, color.a));
}

float blendChannel(float destination, float source, float blendModeCode) {
  if (blendModeCode < 0.5) {
    return source;
  }

  if (blendModeCode < 1.5) {
    return min(1.0, destination + source);
  }

  if (blendModeCode < 2.5) {
    return destination * source;
  }

  return 1.0 - (1.0 - destination) * (1.0 - source);
}

vec4 compositeLinear(vec4 destination, vec4 source, float blendModeCode) {
  float alpha = clamp01(source.a);
  if (alpha <= 0.0) {
    return destination;
  }

  float blendedR = blendChannel(destination.r, source.r, blendModeCode);
  float blendedG = blendChannel(destination.g, source.g, blendModeCode);
  float blendedB = blendChannel(destination.b, source.b, blendModeCode);

  vec4 outColor = vec4(
    destination.r * (1.0 - alpha) + blendedR * alpha,
    destination.g * (1.0 - alpha) + blendedG * alpha,
    destination.b * (1.0 - alpha) + blendedB * alpha,
    alpha + destination.a * (1.0 - alpha)
  );

  return clampLinearColor(outColor);
}

float linearToSrgb8(float linearChannel) {
  float c = clamp01(linearChannel);
  float s = c <= 0.0031308
    ? 12.92 * c
    : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
  return s * 255.0;
}

float sampleBlueNoise(vec2 physicalPx) {
  vec2 uv = (mod(physicalPx, 64.0) + 0.5) / 64.0;
  return texture2D(uBlueNoise, uv).r;
}

float computeDitherNoise(vec2 physicalPx) {
  if (uDitherMode < 0.5) {
    return 0.0;
  }

  if (uDitherMode < 1.5) {
    float u1 = ign(physicalPx);
    float u2 = ign(physicalPx + vec2(5.3, 3.7));
    return (u1 + u2 - 1.0) * uDitherAmplitude;
  }

  if (uHasBlueNoise < 0.5) {
    float u1 = ign(physicalPx);
    float u2 = ign(physicalPx + vec2(5.3, 3.7));
    return (u1 + u2 - 1.0) * uDitherAmplitude;
  }

  float n1 = sampleBlueNoise(physicalPx);
  float n2 = sampleBlueNoise(physicalPx + vec2(37.0, 17.0));
  return (n1 + n2 - 1.0) * uDitherAmplitude;
}

void main() {
  vec2 physicalPx = floor(gl_FragCoord.xy);
  vec2 scale = vec2(
    uDesignSize.x / max(1.0, uPhysicalSize.x),
    uDesignSize.y / max(1.0, uPhysicalSize.y)
  );
  vec2 designPx = physicalPx * scale;

  vec4 accumulated = uBaseColor;

  for (int layerIndex = 0; layerIndex < MAX_LAYERS; layerIndex++) {
    if (layerIndex >= uLayerCount) {
      break;
    }

    vec2 progress = sampleLayerProgress(layerIndex, designPx);
    float t = progress.x;
    float mask = progress.y;
    if (mask <= 0.0) {
      continue;
    }

    int colorSpaceCode = int(uLayerMeta1[layerIndex].z + 0.5);
    vec4 sampled = sampleStops(layerIndex, t, colorSpaceCode);
    sampled = applyShadow(sampled, layerIndex, t);
    sampled = applyGrain(sampled, designPx, uLayerGrain[layerIndex]);

    float opacity = clamp01(uLayerMeta1[layerIndex].w);
    float alpha = sampled.a * opacity * mask;
    if (alpha <= 0.0) {
      continue;
    }

    vec4 source = vec4(sampled.rgb, alpha);
    accumulated = compositeLinear(accumulated, source, uLayerMeta1[layerIndex].y);
  }

  accumulated = clampLinearColor(accumulated);

  float ditherNoise = computeDitherNoise(physicalPx);

  // Convert to sRGB float first, then apply global grain in sRGB space
  // (perceptually uniform — avoids massive banding in dark regions).
  float sR = linearToSrgb8(accumulated.r);
  float sG = linearToSrgb8(accumulated.g);
  float sB = linearToSrgb8(accumulated.b);

  if (uGlobalGrainAmount > 0.0) {
    vec2 gScaled = designPx * uGlobalGrainScale;
    float gAmp = uGlobalGrainAmount * 255.0;
    if (uGlobalGrainMono > 0.5) {
      float gn = triangularNoise(gScaled, uGlobalGrainSeed) * gAmp;
      sR += gn;
      sG += gn;
      sB += gn;
    } else {
      sR += triangularNoise(gScaled + vec2(13.1, 7.7), uGlobalGrainSeed) * gAmp;
      sG += triangularNoise(gScaled + vec2(29.3, 19.1), uGlobalGrainSeed + 1.0) * gAmp;
      sB += triangularNoise(gScaled + vec2(47.9, 31.3), uGlobalGrainSeed + 2.0) * gAmp;
    }
  }

  float outR = clamp(floor(sR + ditherNoise + 0.5), 0.0, 255.0) / 255.0;
  float outG = clamp(floor(sG + ditherNoise + 0.5), 0.0, 255.0) / 255.0;
  float outB = clamp(floor(sB + ditherNoise + 0.5), 0.0, 255.0) / 255.0;
  float outA = uOpaque > 0.5
    ? 1.0
    : clamp(floor(accumulated.a * 255.0 + 0.5), 0.0, 255.0) / 255.0;

  gl_FragColor = vec4(outR, outG, outB, outA);
}
`;

interface PackedLayerUniforms {
  layerMeta1: Float32Array;
  layerMeta2: Float32Array;
  layerLinear1: Float32Array;
  layerLinear2: Float32Array;
  layerLinear3: Float32Array;
  layerRadial1: Float32Array;
  layerRadial2: Float32Array;
  layerBox1: Float32Array;
  layerBox2: Float32Array;
  layerGrain: Float32Array;
  stopPos: Float32Array;
  stopColor0: Float32Array;
  stopColor1: Float32Array;
  stopColor2: Float32Array;
  stopColor3: Float32Array;
  stopLab0: Float32Array;
  stopLab1: Float32Array;
  stopLab2: Float32Array;
  stopLab3: Float32Array;
}

function getLayerTypeCode(layer: PreparedLayer): number {
  if (layer.layer.type === "linear") {
    return 0;
  }
  if (layer.layer.type === "radial") {
    return 1;
  }
  return 2;
}

function getBlendModeCode(blendMode: BackgroundBlendMode): number {
  if (blendMode === "add") {
    return 1;
  }
  if (blendMode === "multiply") {
    return 2;
  }
  if (blendMode === "screen") {
    return 3;
  }
  return 0;
}

function getColorSpaceCode(colorSpace: BackgroundColorSpace): number {
  return colorSpace === "oklab" ? 1 : 0;
}

function setVec4(
  target: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  w: number,
): void {
  const offset = index * 4;
  target[offset] = x;
  target[offset + 1] = y;
  target[offset + 2] = z;
  target[offset + 3] = w;
}

function setRgba(
  target: Float32Array,
  index: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  setVec4(target, index, r, g, b, a);
}

function canRenderResolvedWithWebGL(
  resolved: ResolvedBackgroundArgs,
): BackgroundWebGLSupportResult {
  if (resolved.layers.length > MAX_LAYERS) {
    return {
      supported: false,
      reason: `WebGL renderer supports up to ${MAX_LAYERS} layers, received ${resolved.layers.length}.`,
    };
  }

  for (let i = 0; i < resolved.layers.length; i++) {
    const stopCount = resolved.layers[i].stops.length;
    if (stopCount > MAX_STOPS) {
      return {
        supported: false,
        reason: `WebGL renderer supports up to ${MAX_STOPS} stops per layer, layer ${i} has ${stopCount}.`,
      };
    }
  }

  return { supported: true };
}

export function canRenderBackgroundWithWebGL(
  args: BackgroundArgs,
): BackgroundWebGLSupportResult {
  const resolved = resolveBackgroundArgs(args);
  return canRenderResolvedWithWebGL(resolved);
}

function packLayerUniforms(
  resolved: ResolvedBackgroundArgs,
  designWidth: number,
  designHeight: number,
): PackedLayerUniforms {
  const layerMeta1 = new Float32Array(MAX_LAYERS * 4);
  const layerMeta2 = new Float32Array(MAX_LAYERS * 4);
  const layerLinear1 = new Float32Array(MAX_LAYERS * 4);
  const layerLinear2 = new Float32Array(MAX_LAYERS * 4);
  const layerLinear3 = new Float32Array(MAX_LAYERS * 4);
  const layerRadial1 = new Float32Array(MAX_LAYERS * 4);
  const layerRadial2 = new Float32Array(MAX_LAYERS * 4);
  const layerBox1 = new Float32Array(MAX_LAYERS * 4);
  const layerBox2 = new Float32Array(MAX_LAYERS * 4);
  const layerGrain = new Float32Array(MAX_LAYERS * 4);
  const stopPos = new Float32Array(MAX_LAYERS * 4);
  const stopColor0 = new Float32Array(MAX_LAYERS * 4);
  const stopColor1 = new Float32Array(MAX_LAYERS * 4);
  const stopColor2 = new Float32Array(MAX_LAYERS * 4);
  const stopColor3 = new Float32Array(MAX_LAYERS * 4);
  const stopLab0 = new Float32Array(MAX_LAYERS * 4);
  const stopLab1 = new Float32Array(MAX_LAYERS * 4);
  const stopLab2 = new Float32Array(MAX_LAYERS * 4);
  const stopLab3 = new Float32Array(MAX_LAYERS * 4);

  const stopColorTargets = [stopColor0, stopColor1, stopColor2, stopColor3];
  const stopLabTargets = [stopLab0, stopLab1, stopLab2, stopLab3];

  for (let layerIndex = 0; layerIndex < resolved.layers.length; layerIndex++) {
    const layer = resolved.layers[layerIndex];

    const layerTypeCode = getLayerTypeCode(layer);
    const blendCode = getBlendModeCode(layer.blendMode);
    const colorSpaceCode = getColorSpaceCode(layer.colorSpace);
    setVec4(
      layerMeta1,
      layerIndex,
      layerTypeCode,
      blendCode,
      colorSpaceCode,
      layer.opacity,
    );

    setVec4(
      layerMeta2,
      layerIndex,
      layer.shadow.startIntensity,
      layer.shadow.endIntensity,
      layer.shadow.curve,
      Math.min(MAX_STOPS, layer.stops.length),
    );

    if (layer.grain) {
      setVec4(
        layerGrain,
        layerIndex,
        layer.grain.amount,
        layer.grain.scale,
        layer.grain.seed,
        layer.grain.monochrome ? 1 : 0,
      );
    }

    if (layer.layer.type === "linear") {
      const linear = layer.layer;
      const easing = Math.max(EPSILON, linear.easing ?? 1);
      const hasExplicitPoints =
        Number.isFinite(linear.startX) &&
        Number.isFinite(linear.startY) &&
        Number.isFinite(linear.endX) &&
        Number.isFinite(linear.endY);

      if (hasExplicitPoints) {
        const startX = linear.startX as number;
        const startY = linear.startY as number;
        const endX = linear.endX as number;
        const endY = linear.endY as number;
        const dirX = endX - startX;
        const dirY = endY - startY;
        const lenSq = Math.max(EPSILON, dirX * dirX + dirY * dirY);

        setVec4(layerLinear1, layerIndex, 1, startX, startY, lenSq);
        setVec4(layerLinear2, layerIndex, dirX, dirY, 0, 0);
        setVec4(layerLinear3, layerIndex, 0, easing, 0, 0);
      } else {
        const angle = linear.angle ?? 180;
        const rad = (angle * Math.PI) / 180;
        const dirX = Math.sin(rad);
        const dirY = -Math.cos(rad);
        const gradientLength =
          Math.abs(designWidth * Math.sin(rad)) +
          Math.abs(designHeight * Math.cos(rad));
        const safeLength = Math.max(EPSILON, gradientLength);
        const halfLength = safeLength / 2;

        setVec4(layerLinear1, layerIndex, 0, 0, 0, safeLength);
        setVec4(
          layerLinear2,
          layerIndex,
          dirX,
          dirY,
          designWidth / 2,
          designHeight / 2,
        );
        setVec4(layerLinear3, layerIndex, halfLength, easing, 0, 0);
      }
    } else if (layer.layer.type === "radial") {
      const radial = layer.layer;
      setVec4(
        layerRadial1,
        layerIndex,
        radial.centerX ?? designWidth / 2,
        radial.centerY ?? designHeight / 2,
        Math.max(EPSILON, radial.radiusX ?? designWidth / 2),
        Math.max(EPSILON, radial.radiusY ?? designHeight / 2),
      );
      setVec4(
        layerRadial2,
        layerIndex,
        radial.innerRadius ?? 0,
        radial.outerRadius ?? 1,
        Math.max(EPSILON, radial.falloff ?? 1),
        radial.power ?? 2,
      );
    } else {
      const box = layer.layer;
      setVec4(
        layerBox1,
        layerIndex,
        (box.x ?? 0) + (box.offsetX ?? 0),
        (box.y ?? 0) + (box.offsetY ?? 0),
        Math.max(1, box.width ?? designWidth),
        Math.max(1, box.height ?? designHeight),
      );
      setVec4(
        layerBox2,
        layerIndex,
        box.radius ?? 0,
        box.spread ?? 0,
        Math.max(0, box.blur ?? 0),
        (box.inset ?? true) ? 1 : 0,
      );
    }

    if (layer.stops.length === 0) {
      continue;
    }

    const stopCount = Math.min(MAX_STOPS, layer.stops.length);
    const stopPositions = [0, 0, 0, 0];

    for (let stopSlot = 0; stopSlot < MAX_STOPS; stopSlot++) {
      const sourceIndex = Math.min(stopSlot, stopCount - 1);
      const stop = layer.stops[sourceIndex];
      stopPositions[stopSlot] = stop.position;

      setRgba(
        stopColorTargets[stopSlot],
        layerIndex,
        stop.color.r,
        stop.color.g,
        stop.color.b,
        stop.color.a,
      );

      setRgba(
        stopLabTargets[stopSlot],
        layerIndex,
        stop.lab[0],
        stop.lab[1],
        stop.lab[2],
        stop.color.a,
      );
    }

    setVec4(
      stopPos,
      layerIndex,
      stopPositions[0],
      stopPositions[1],
      stopPositions[2],
      stopPositions[3],
    );
  }

  return {
    layerMeta1,
    layerMeta2,
    layerLinear1,
    layerLinear2,
    layerLinear3,
    layerRadial1,
    layerRadial2,
    layerBox1,
    layerBox2,
    layerGrain,
    stopPos,
    stopColor0,
    stopColor1,
    stopColor2,
    stopColor3,
    stopLab0,
    stopLab1,
    stopLab2,
    stopLab3,
  };
}

function getArrayUniformLocation(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation | null {
  return gl.getUniformLocation(program, `${name}[0]`) ??
    gl.getUniformLocation(program, name);
}

function compileShader(
  gl: WebGLRenderingContext,
  shaderType: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(shaderType);
  if (!shader) {
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }

  const infoLog = gl.getShaderInfoLog(shader);
  console.warn("Background WebGL shader compilation failed:", infoLog);
  gl.deleteShader(shader);
  return null;
}

function createShaderProgram(
  gl: WebGLRenderingContext,
): {
  program: WebGLProgram;
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;
} | null {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  if (!vertexShader) {
    return null;
  }

  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
  if (!fragmentShader) {
    gl.deleteShader(vertexShader);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return { program, vertexShader, fragmentShader };
  }

  const infoLog = gl.getProgramInfoLog(program);
  console.warn("Background WebGL program link failed:", infoLog);
  gl.deleteProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return null;
}

function createScratchCanvas(
  width: number,
  height: number,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  return scratch;
}

function ditherModeToCode(mode: ResolvedBackgroundArgs["ditherMode"]): number {
  if (mode === "none") {
    return 0;
  }
  if (mode === "ign") {
    return 1;
  }
  return 2;
}

export function renderBackgroundToCanvasWebGL(
  targetCanvas: HTMLCanvasElement,
  designWidth: number,
  designHeight: number,
  args: BackgroundArgs,
): boolean {
  const resolved = resolveBackgroundArgs(args);
  const support = canRenderResolvedWithWebGL(resolved);
  if (!support.supported) {
    return false;
  }

  const targetContext = targetCanvas.getContext("2d");
  if (!targetContext) {
    return false;
  }

  const scratchCanvas = createScratchCanvas(targetCanvas.width, targetCanvas.height);
  if (!scratchCanvas) {
    return false;
  }

  const gl = scratchCanvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });

  if (!gl) {
    return false;
  }

  const shaderProgram = createShaderProgram(gl);
  if (!shaderProgram) {
    return false;
  }

  const { program, vertexShader, fragmentShader } = shaderProgram;
  const packed = packLayerUniforms(resolved, designWidth, designHeight);

  gl.useProgram(program);
  gl.viewport(0, 0, scratchCanvas.width, scratchCanvas.height);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const positionBuffer = gl.createBuffer();
  if (!positionBuffer) {
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return false;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );

  const positionLocation = gl.getAttribLocation(program, "aPosition");
  if (positionLocation < 0) {
    gl.deleteBuffer(positionBuffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return false;
  }

  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  const setUniform1f = (name: string, value: number): void => {
    const location = gl.getUniformLocation(program, name);
    if (location !== null) {
      gl.uniform1f(location, value);
    }
  };

  const setUniform1i = (name: string, value: number): void => {
    const location = gl.getUniformLocation(program, name);
    if (location !== null) {
      gl.uniform1i(location, value);
    }
  };

  const setUniform2f = (name: string, x: number, y: number): void => {
    const location = gl.getUniformLocation(program, name);
    if (location !== null) {
      gl.uniform2f(location, x, y);
    }
  };

  const setUniform4f = (
    name: string,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void => {
    const location = gl.getUniformLocation(program, name);
    if (location !== null) {
      gl.uniform4f(location, x, y, z, w);
    }
  };

  const setUniformVec4Array = (name: string, values: Float32Array): void => {
    const location = getArrayUniformLocation(gl, program, name);
    if (location !== null) {
      gl.uniform4fv(location, values);
    }
  };

  setUniform2f("uDesignSize", designWidth, designHeight);
  setUniform2f("uPhysicalSize", scratchCanvas.width, scratchCanvas.height);
  setUniform4f(
    "uBaseColor",
    resolved.baseColor.r,
    resolved.baseColor.g,
    resolved.baseColor.b,
    resolved.baseColor.a,
  );
  setUniform1f("uOpaque", resolved.opaque ? 1 : 0);
  setUniform1i("uLayerCount", resolved.layers.length);
  setUniform1f("uDitherMode", ditherModeToCode(resolved.ditherMode));
  setUniform1f("uDitherAmplitude", resolved.ditherAmplitude);
  setUniform1f("uGlobalGrainAmount", resolved.grain?.amount ?? 0);
  setUniform1f("uGlobalGrainScale", resolved.grain?.scale ?? 1);
  setUniform1f("uGlobalGrainSeed", resolved.grain?.seed ?? 0);
  setUniform1f(
    "uGlobalGrainMono",
    (resolved.grain?.monochrome ?? true) ? 1 : 0,
  );

  setUniformVec4Array("uLayerMeta1", packed.layerMeta1);
  setUniformVec4Array("uLayerMeta2", packed.layerMeta2);
  setUniformVec4Array("uLayerLinear1", packed.layerLinear1);
  setUniformVec4Array("uLayerLinear2", packed.layerLinear2);
  setUniformVec4Array("uLayerLinear3", packed.layerLinear3);
  setUniformVec4Array("uLayerRadial1", packed.layerRadial1);
  setUniformVec4Array("uLayerRadial2", packed.layerRadial2);
  setUniformVec4Array("uLayerBox1", packed.layerBox1);
  setUniformVec4Array("uLayerBox2", packed.layerBox2);
  setUniformVec4Array("uLayerGrain", packed.layerGrain);
  setUniformVec4Array("uStopPos", packed.stopPos);
  setUniformVec4Array("uStopColor0", packed.stopColor0);
  setUniformVec4Array("uStopColor1", packed.stopColor1);
  setUniformVec4Array("uStopColor2", packed.stopColor2);
  setUniformVec4Array("uStopColor3", packed.stopColor3);
  setUniformVec4Array("uStopLab0", packed.stopLab0);
  setUniformVec4Array("uStopLab1", packed.stopLab1);
  setUniformVec4Array("uStopLab2", packed.stopLab2);
  setUniformVec4Array("uStopLab3", packed.stopLab3);

  const blueNoiseTexture = gl.createTexture();
  if (!blueNoiseTexture) {
    gl.deleteBuffer(positionBuffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return false;
  }

  const useBlueNoise = resolved.ditherMode === "blue-noise";
  const blueNoiseData = useBlueNoise ? getBlueNoiseTexture64() : null;
  const fallbackTexture = new Uint8Array([128]);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, blueNoiseTexture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  if (blueNoiseData) {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.LUMINANCE,
      64,
      64,
      0,
      gl.LUMINANCE,
      gl.UNSIGNED_BYTE,
      blueNoiseData,
    );
  } else {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.LUMINANCE,
      1,
      1,
      0,
      gl.LUMINANCE,
      gl.UNSIGNED_BYTE,
      fallbackTexture,
    );
  }

  setUniform1i("uBlueNoise", 0);
  setUniform1f("uHasBlueNoise", blueNoiseData ? 1 : 0);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  targetContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  targetContext.drawImage(scratchCanvas, 0, 0, targetCanvas.width, targetCanvas.height);

  gl.deleteTexture(blueNoiseTexture);
  gl.deleteBuffer(positionBuffer);
  gl.deleteProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  return true;
}
