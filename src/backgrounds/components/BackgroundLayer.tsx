import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { BACKGROUND_BUNDLE } from '../generated/catalog';
import { GlEngine } from '../gl-engine';
import { isHexColor, normalizeParams } from '../params';
import type { ParamValue } from '../types';

export interface BackgroundLayerProps {
  /** Effect id from the generated catalog; unknown ids render the fallback poster. */
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
  const resizeRef = useRef<(() => void) | null>(null);
  const [failed, setFailed] = useState(false);

  const effect = useMemo(
    () => BACKGROUND_BUNDLE.effects.find((item) => item.id === effectId) ?? null,
    [effectId]
  );
  // Normalizing allocates; do it when the parameters change, not every frame.
  const normalizedParams = useMemo(
    () => (effect ? normalizeParams(effect, params) : {}),
    [effect, params]
  );
  const paramsRef = useRef(normalizedParams);
  paramsRef.current = normalizedParams;
  const resolutionScaleRef = useRef(resolutionScale);
  resolutionScaleRef.current = resolutionScale;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const seedRef = useRef(seed);
  seedRef.current = seed;
  // The phase survives pause/resume and prop changes; only a new effect or seed
  // restarts it, so toggling visibility never jumps the animation back to t=0.
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!effect) {
      setFailed(true);
      return;
    }

    setFailed(false);
    let engine: GlEngine;
    try {
      engine = new GlEngine(canvas, effect, {
        resolutionScale: resolutionScaleRef.current,
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
    resizeRef.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      resizeRef.current = null;
      engine.dispose();
      engineRef.current = null;
    };
  }, [effect, effectId]);

  // Resolution is a hint, not a different renderer: changing it must not throw
  // away the compiled programs and the feedback state.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setResolutionScale(resolutionScale);
    resizeRef.current?.();
  }, [resolutionScale]);

  useEffect(() => {
    phaseRef.current = 0;
  }, [effectId, seed]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || paused || !effect) return;

    const frameInterval = maxFps > 0 ? 1000 / maxFps : 0;
    let raf = 0;
    let last = performance.now();
    let lastDraw = 0;

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
      phaseRef.current += dt * speedRef.current;

      engine.render({
        time: phaseRef.current,
        dt,
        speed: speedRef.current,
        seed: seedRef.current,
        params: paramsRef.current,
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
  }, [effect, paused, maxFps]);

  const colorA = isHexColor(params?.colorA) ? params.colorA : '#0b1020';
  const colorB = isHexColor(params?.colorB) ? params.colorB : '#1a1030';

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
