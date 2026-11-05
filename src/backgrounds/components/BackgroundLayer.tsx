import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { BACKGROUND_BUNDLE } from '../generated/catalog';
import { GlEngine } from '../gl-engine';
import { normalizeParams } from '../params';
import type { ParamValue } from '../types';

export interface BackgroundLayerProps {
  effectId: string;
  params?: Record<string, ParamValue>;
  seed?: number;
  speed?: number;
  paused?: boolean;
  maxFps?: number;
  resolutionScale?: number;
  className?: string;
}

/**
 * Renders a generator effect on a canvas. The layer never owns effect logic:
 * it feeds time, seed and parameters to the Rust-defined renderer.
 */
export function BackgroundLayer({
  effectId,
  params,
  seed = 42,
  speed = 1,
  paused = false,
  maxFps = 60,
  resolutionScale = 1,
  className,
}: BackgroundLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GlEngine | null>(null);
  const [failed, setFailed] = useState(false);

  const paramsRef = useRef(params);
  paramsRef.current = params;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const seedRef = useRef(seed);
  seedRef.current = seed;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const effect = BACKGROUND_BUNDLE.effects.find((item) => item.id === effectId);
    if (!effect) {
      setFailed(true);
      return;
    }

    setFailed(false);
    let engine: GlEngine;
    try {
      engine = new GlEngine(canvas, effect, {
        resolutionScale,
        onContextLost: () => setFailed(true),
        onContextRestored: () => setFailed(false),
      });
    } catch (error) {
      console.error('[backgrounds] renderer unavailable:', error);
      setFailed(true);
      return;
    }
    engineRef.current = engine;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        engine.resize(rect.width, rect.height, window.devicePixelRatio || 1);
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, [effectId, resolutionScale]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || paused) return;

    const effect = BACKGROUND_BUNDLE.effects.find((item) => item.id === effectId);
    if (!effect) return;

    const frameInterval = maxFps > 0 ? 1000 / maxFps : 0;
    let raf = 0;
    let last = performance.now();
    let lastDraw = 0;
    let phase = 0;

    const loop = (now: number) => {
      if (document.hidden) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(loop);
      if (frameInterval > 0 && now - lastDraw < frameInterval) return;

      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      lastDraw = now;
      phase += dt * speedRef.current;

      engine.render({
        time: phase,
        dt,
        speed: speedRef.current,
        seed: seedRef.current,
        params: normalizeParams(effect, paramsRef.current),
      });
    };

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (raf === 0) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    raf = requestAnimationFrame(loop);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      cancelAnimationFrame(raf);
    };
  }, [effectId, paused, maxFps]);

  const colorA = String(params?.colorA ?? '#0b1020');
  const colorB = String(params?.colorB ?? '#1a1030');

  return (
    <div
      className={cn('absolute inset-0 overflow-hidden', className)}
      style={{ background: `linear-gradient(135deg, ${colorA}, ${colorB})` }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        className={cn('block h-full w-full pointer-events-none', failed && 'invisible')}
      />
    </div>
  );
}
