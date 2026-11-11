import { cn } from '@/lib/utils';
import type { Background, GeneratorBackground, ParamValue } from '../types';
import { parseBackground } from '../uri';
import { BackgroundLayer } from './BackgroundLayer';

/** Resolves any stored background value to a generator reference, if it is one. */
export function generatorOf(value: string | Background | null | undefined): GeneratorBackground | null {
  const background = parseBackground(value);
  return background?.type === 'generator' ? background : null;
}

function safeColor(value: ParamValue | undefined, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
}

interface GeneratorSurfaceProps {
  value: string | Background | null | undefined;
  paused?: boolean;
  maxFps?: number;
  resolutionScale?: number;
  className?: string;
}

/** Live generator background. Renders nothing for media backgrounds. */
export function GeneratorSurface({
  value,
  paused,
  maxFps = 30,
  resolutionScale = 1,
  className,
}: GeneratorSurfaceProps) {
  const background = generatorOf(value);
  if (!background) return null;

  return (
    <BackgroundLayer
      effectId={background.effect}
      params={background.params}
      seed={background.seed}
      paused={paused}
      maxFps={maxFps}
      resolutionScale={resolutionScale}
      className={className}
    />
  );
}

/** Static palette poster, used where a live canvas is too expensive (thumbnails). */
export function GeneratorPoster({
  value,
  className,
}: {
  value: string | Background | null | undefined;
  className?: string;
}) {
  const background = generatorOf(value);
  if (!background) return null;

  const colorA = safeColor(background.params.colorA, '#0b1020');
  const colorB = safeColor(background.params.colorB, '#1a1030');

  return (
    <div
      aria-hidden
      className={cn('absolute inset-0', className)}
      style={{ background: `linear-gradient(135deg, ${colorA}, ${colorB})` }}
    />
  );
}
