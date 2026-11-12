import type { Background, GeneratorBackground, ParamValue } from './types';

const PREFIX = 'lumen-bg://generator/';

/** True when a string boundary carries a generator reference. */
export function isGeneratorUri(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Encodes a generator for string-only boundaries (lyric metadata, `<!-- bg: -->`
 * and stream payloads).
 */
export function encodeBackgroundUri(background: GeneratorBackground): string {
  const params = encodeBase64Url(JSON.stringify(background.params ?? {}));
  const seed = Math.max(0, Math.trunc(background.seed));
  const search = new URLSearchParams({ v: '1', seed: String(seed), p: params });
  // The display name and the preset it came from survive the round trip, so a
  // stored background keeps reading as "Calm aurora" instead of "aurora".
  if (background.name) search.set('n', background.name);
  if (background.preset) search.set('pr', background.preset);
  return `${PREFIX}${encodeURIComponent(background.effect)}?${search.toString()}`;
}

/** Tolerant decoder: malformed input yields `null`, never an exception. */
export function decodeBackgroundUri(uri: string): GeneratorBackground | null {
  if (!isGeneratorUri(uri)) return null;

  const [rawEffect, query = ''] = uri.slice(PREFIX.length).split('?');
  let effect: string;
  try {
    effect = decodeURIComponent(rawEffect);
  } catch {
    return null;
  }
  if (!effect) return null;

  const search = new URLSearchParams(query);
  const seed = Number(search.get('seed'));

  let params: Record<string, ParamValue> = {};
  const encoded = search.get('p');
  if (encoded) {
    try {
      const parsed = JSON.parse(decodeBase64Url(encoded)) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        params = parsed as Record<string, ParamValue>;
      }
    } catch {
      params = {};
    }
  }

  const name = search.get('n')?.trim();
  const preset = search.get('pr')?.trim();

  return {
    type: 'generator',
    effect,
    params,
    seed: Number.isFinite(seed) ? Math.max(0, Math.trunc(seed)) : 0,
    name: name || effect,
    ...(preset ? { preset } : {}),
  };
}

/**
 * `src` of a media background, `undefined` for generators. Use this instead of
 * reaching for `.src` so the union is narrowed once, in one place.
 */
export function mediaSrcOf(
  value: string | Background | null | undefined
): string | undefined {
  const background = parseBackground(value);
  return background && background.type !== 'generator' ? background.src : undefined;
}

/** Normalizes a stored string or structured value into a renderable background. */
export function parseBackground(value: string | Background | null | undefined): Background | null {
  if (!value) return null;
  if (typeof value !== 'string') return value;

  const generator = decodeBackgroundUri(value);
  if (generator) return generator;

  const name = value.split(/[\\/]/).pop() ?? value;
  return { type: 'image', src: value, name };
}
