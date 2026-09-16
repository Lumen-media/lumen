/**
 * Builds an image URL that goes through the central Rust optimization protocol.
 *
 * - Local files become `http://lumen.localhost?src=...` (full) or
 *   `http://lumen-thumb.localhost?src=...&w=...` (downscaled, height derived
 *   from the source aspect ratio).
 * - Already-remote/pass-through sources (http, blob, data, #, existing lumen
 *   URLs) are returned unchanged.
 */
export function lumenUrl(src: string, opts: { w?: number; q?: number } = {}): string {
  const { w, q } = opts;
  if (
    !src ||
    src.startsWith('http') ||
    src.startsWith('blob:') ||
    src.startsWith('data:') ||
    src.startsWith('#')
  ) {
    return src;
  }
  if (src.startsWith('http://lumen') || src.startsWith('lumen://')) {
    return src;
  }
  const query = new URLSearchParams({ src });
  if (w) query.set('w', String(w));
  if (q) query.set('q', String(q));
  const base = w || q ? 'http://lumen-thumb.localhost' : 'http://lumen.localhost';
  return `${base}?${query.toString()}`;
}

/**
 * Like `lumenUrl`, but always routes through the `lumen-thumb` protocol so the
 * Rust backend downscales and caches the result — including remote (http/https)
 * sources, which `lumenUrl` passes through untouched. Use for backgrounds and
 * other spots that previously relied on the JS thumbnail service.
 */
export function lumenThumbUrl(src: string, opts: { w?: number; q?: number } = {}): string {
  const { w, q } = opts;
  if (!src || src.startsWith('#') || src.startsWith('blob:') || src.startsWith('data:')) {
    return src;
  }
  if (src.startsWith('http://lumen') || src.startsWith('lumen://')) {
    return src;
  }
  const query = new URLSearchParams({ src });
  if (w) query.set('w', String(w));
  if (q) query.set('q', String(q));
  return `http://lumen-thumb.localhost?${query.toString()}`;
}