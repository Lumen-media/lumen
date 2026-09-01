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