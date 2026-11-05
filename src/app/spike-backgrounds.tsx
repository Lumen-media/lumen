import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { BackgroundLayer } from '@/backgrounds/components/BackgroundLayer';
import { BACKGROUND_BUNDLE } from '@/backgrounds/generated/catalog';
import { defaultParams, paramSpecs } from '@/backgrounds/params';
import type { ParamValue } from '@/backgrounds/types';

export const Route = createFileRoute('/spike-backgrounds')({
  component: SpikeBackgrounds,
});

function SpikeBackgrounds() {
  if (!import.meta.env.DEV) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">Spike route is dev-only.</p>
      </main>
    );
  }
  return <SpikeHarness />;
}

function SpikeHarness() {
  const effects = BACKGROUND_BUNDLE.effects;
  const [effectId, setEffectId] = useState<string>(effects[0].id);
  const [params, setParams] = useState<Record<string, ParamValue>>(() =>
    defaultParams(effects[0])
  );
  const [seed, setSeed] = useState(42);
  const [speed, setSpeed] = useState(1);
  const [fps, setFps] = useState(0);

  const effect = effects.find((item) => item.id === effectId) ?? effects[0];

  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      frames += 1;
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const selectEffect = (id: string) => {
    const next = effects.find((item) => item.id === id);
    if (!next) return;
    setEffectId(next.id);
    setParams(defaultParams(next));
  };

  const update = (key: string, value: ParamValue) => {
    setParams((current) => ({ ...current, [key]: value }));
  };

  const numericParams = paramSpecs(effect).filter(
    (spec) => typeof spec.default === 'number' && spec.min !== undefined && spec.max !== undefined
  );
  const colorParams = paramSpecs(effect).filter((spec) => spec.kind === 'Color');

  return (
    <main className="flex h-dvh gap-4 bg-background p-4 text-foreground">
      <aside className="w-80 shrink-0 space-y-5 overflow-y-auto rounded-lg border border-border p-4">
        <header>
          <h1 className="text-sm font-semibold">Generator spike</h1>
          <p className="text-xs text-muted-foreground">{fps} fps · bundle v1 (Rust)</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase text-muted-foreground">Effect</h2>
          <div className="grid grid-cols-2 gap-1.5">
            {effects.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectEffect(item.id)}
                className={`rounded-md border px-2 py-1.5 text-left text-xs ${
                  item.id === effect.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-accent'
                }`}
              >
                <span className="block font-medium">{item.name}</span>
                <span className="block text-[10px] text-muted-foreground">
                  tier {item.tier} · {item.cost}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase text-muted-foreground">Time</h2>
          <label className="block text-xs">
            <span className="flex justify-between">
              <span>Speed</span>
              <span className="text-muted-foreground">{speed.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={4}
              step={0.01}
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              className="w-full"
            />
          </label>
          <label className="block text-xs">
            <span className="flex justify-between">
              <span>Seed</span>
              <span className="text-muted-foreground">{seed}</span>
            </span>
            <input
              type="range"
              min={0}
              max={9999}
              step={1}
              value={seed}
              onChange={(event) => setSeed(Number(event.target.value))}
              className="w-full"
            />
          </label>
          <button
            type="button"
            onClick={() => setSeed(Math.floor(Math.random() * 10000))}
            className="w-full rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
          >
            Randomize seed
          </button>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase text-muted-foreground">Parameters</h2>
          {numericParams.map((spec) => {
            const raw = params[spec.key];
            const value = typeof raw === 'number' ? raw : Number(spec.default);
            const min = spec.min ?? 0;
            const max = spec.max ?? 1;
            const step =
              spec.kind === 'Int' || spec.kind === 'Seed' ? 1 : Math.max((max - min) / 200, 0.001);

            return (
              <label key={spec.key} className="block text-xs">
                <span className="flex justify-between gap-2">
                  <span>{spec.key}</span>
                  <span className="text-muted-foreground">
                    {value.toFixed(spec.kind === 'Int' ? 0 : 2)}
                  </span>
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  onChange={(event) => update(spec.key, Number(event.target.value))}
                  className="w-full"
                />
              </label>
            );
          })}
          {colorParams.map((spec) => {
            const raw = params[spec.key];
            const value = typeof raw === 'string' ? raw : String(spec.default);
            return (
              <label key={spec.key} className="flex items-center justify-between text-xs">
                <span>{spec.key}</span>
                <input
                  type="color"
                  value={value}
                  onChange={(event) => update(spec.key, event.target.value)}
                  className="h-6 w-12 rounded border border-border bg-transparent"
                />
              </label>
            );
          })}
        </section>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
          <BackgroundLayer
            effectId={effect.id}
            params={params}
            seed={seed}
            speed={speed}
            maxFps={60}
          />
        </div>
        <div className="flex items-start gap-4">
          <div className="relative aspect-video w-80 overflow-hidden rounded-lg border border-border bg-black">
            <BackgroundLayer
              effectId={effect.id}
              params={params}
              seed={seed}
              speed={speed}
              maxFps={30}
              resolutionScale={0.5}
            />
          </div>
          <p className="max-w-md text-xs text-muted-foreground">
            Two surfaces rendering the same effect and seed. The small canvas is capped at 30 fps
            and half resolution, mirroring the preview budget from the spike plan.
          </p>
        </div>
      </section>
    </main>
  );
}
