import type { EffectRuntime, ParamValue } from './types';

/** Structural view of a generated parameter spec (safe: it comes from Rust). */
export type ParamShape = {
  key: string;
  kind: string;
  label?: string;
  group?: string;
  scale?: string;
  step?: number;
  default: ParamValue;
  min?: number;
  max?: number;
  /** Float index inside the packed uniform buffer. */
  uniformIndex: number;
};

/** Parameters of an effect in declaration order. */
export function paramSpecs(effect: EffectRuntime): readonly ParamShape[] {
  return effect.params as readonly ParamShape[];
}

/** Defaults for every parameter of an effect. */
export function defaultParams(effect: EffectRuntime): Record<string, ParamValue> {
  const values: Record<string, ParamValue> = {};
  for (const spec of paramSpecs(effect)) {
    values[spec.key] = spec.default;
  }
  return values;
}

/**
 * Applies defaults, drops unknown keys and clamps values to the Rust schema.
 * The engine never uploads an out-of-range parameter.
 */
export function normalizeParams(
  effect: EffectRuntime,
  values?: Record<string, ParamValue>
): Record<string, ParamValue> {
  const normalized: Record<string, ParamValue> = {};
  for (const spec of paramSpecs(effect)) {
    const value = values?.[spec.key] ?? spec.default;
    normalized[spec.key] = normalizeValue(spec, value);
  }
  return normalized;
}

function normalizeValue(spec: ParamShape, value: ParamValue): ParamValue {
  if (spec.kind === 'color') {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
      ? value
      : String(spec.default);
  }

  if (spec.kind === 'bool') {
    return typeof value === 'boolean' ? value : Boolean(spec.default);
  }

  const numeric = typeof value === 'number' ? value : Number(spec.default);
  const min = spec.min ?? Number.NEGATIVE_INFINITY;
  const max = spec.max ?? Number.POSITIVE_INFINITY;
  let clamped = Math.min(max, Math.max(min, numeric));

  if (spec.kind === 'int' || spec.kind === 'seed') {
    clamped = Math.round(clamped);
  }

  return Number.isFinite(clamped) ? clamped : Number(spec.default);
}

/** Parses `#rrggbb` into normalized RGBA; falls back to a neutral color. */
export function hexToRgba(hex: string): [number, number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return [0.5, 0.5, 0.5, 1];
  const value = Number.parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, 1];
}
