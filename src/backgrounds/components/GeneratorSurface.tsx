import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { BACKGROUND_BUNDLE } from '../generated/catalog';
import { GlEngine } from '../gl-engine';
import { normalizeParams } from '../params';
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

const POSTER_WIDTH = 320;
const POSTER_HEIGHT = 180;
const POSTER_CACHE_LIMIT = 64;
/** Feedback effects start empty, so they need a few passes to look like anything. */
const POSTER_FEEDBACK_FRAMES = 24;

const posterCache = new Map<string, string>();
const posterFailures = new Set<string>();
const pendingPosters = new Map<string, Promise<string | null>>();
const posterQueue: Array<{
  key: string;
  background: GeneratorBackground;
  resolve: (value: string | null) => void;
}> = [];
let posterDrainScheduled = false;

function posterKey(background: GeneratorBackground): string {
  return `${background.effect}|${background.seed}|${JSON.stringify(background.params)}`;
}

/** Draws one frame offscreen and returns it as a PNG data URL. */
function renderPosterFrame(background: GeneratorBackground): string | null {
  const effect = BACKGROUND_BUNDLE.effects.find((item) => item.id === background.effect);
  if (!effect) return null;

  const canvas = document.createElement('canvas');
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;

  let engine: GlEngine | null = null;
  try {
    engine = new GlEngine(canvas, effect, { preserveDrawingBuffer: true });
    const params = normalizeParams(effect, background.params);
    const frames = effect.tier > 0 ? POSTER_FEEDBACK_FRAMES : 1;
    const dt = 1 / 24;
    for (let frame = 0; frame < frames; frame += 1) {
      engine.render({
        time: 3 + frame * dt,
        dt,
        speed: 1,
        seed: background.seed,
        params,
      });
    }
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    engine?.dispose();
  }
}

/** Runs poster renders one at a time so thumbnails never hold several contexts. */
function schedulePosterDrain(): void {
  if (posterDrainScheduled) return;
  posterDrainScheduled = true;
  window.setTimeout(drainPosterQueue, 0);
}

function drainPosterQueue(): void {
  posterDrainScheduled = false;
  const job = posterQueue.shift();
  if (!job) return;

  const data = renderPosterFrame(job.background);
  if (data) {
    posterCache.set(job.key, data);
    if (posterCache.size > POSTER_CACHE_LIMIT) {
      const oldest = posterCache.keys().next().value;
      if (oldest !== undefined) posterCache.delete(oldest);
    }
  } else {
    posterFailures.add(job.key);
  }

  job.resolve(data);
  if (posterQueue.length > 0) schedulePosterDrain();
}

function posterFor(background: GeneratorBackground): Promise<string | null> {
  const key = posterKey(background);
  const cached = posterCache.get(key);
  if (cached) return Promise.resolve(cached);
  if (posterFailures.has(key)) return Promise.resolve(null);

  const pending = pendingPosters.get(key);
  if (pending) return pending;

  const promise = new Promise<string | null>((resolve) => {
    posterQueue.push({ key, background, resolve });
    schedulePosterDrain();
  }).then((data) => {
    pendingPosters.delete(key);
    return data;
  });
  pendingPosters.set(key, promise);
  return promise;
}

/** Cached one-frame poster, used where a live canvas is too expensive. */
export function GeneratorPoster({
  value,
  className,
}: {
  value: string | Background | null | undefined;
  className?: string;
}) {
  const background = generatorOf(value);
  const key = background ? posterKey(background) : '';
  const backgroundRef = useRef(background);
  backgroundRef.current = background;
  const [poster, setPoster] = useState<string | null>(() =>
    key ? (posterCache.get(key) ?? null) : null
  );

  useEffect(() => {
    const current = backgroundRef.current;
    if (!current) {
      setPoster(null);
      return;
    }

    const cached = posterCache.get(key);
    if (cached) {
      setPoster(cached);
      return;
    }

    let cancelled = false;
    void posterFor(current).then((data) => {
      if (!cancelled) setPoster(data);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!background) return null;

  const colorA = safeColor(background.params.colorA, '#0b1020');
  const colorB = safeColor(background.params.colorB, '#1a1030');

  return (
    <div
      aria-hidden
      className={cn('absolute inset-0 overflow-hidden', className)}
      style={{ background: `linear-gradient(135deg, ${colorA}, ${colorB})` }}
    >
      {poster && (
        <img src={poster} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
      )}
    </div>
  );
}
