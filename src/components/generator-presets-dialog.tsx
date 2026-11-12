import { Dices, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { toast } from 'sonner';
import { BackgroundLayer } from '@/backgrounds/components/BackgroundLayer';
import { BACKGROUND_BUNDLE } from '@/backgrounds/generated/catalog';
import { defaultParams, normalizeParams, type ParamShape, paramSpecs } from '@/backgrounds/params';
import type { GeneratorPreset } from '@/backgrounds/presets';
import { useGeneratorPresetsStore } from '@/backgrounds/presets-store';
import type { ParamValue } from '@/backgrounds/types';
import { useTranslation } from '@/lib/i18n';
import { useGeneratorPresetsDialogStore } from '@/stores/generator-presets-dialog-store';
import { Button } from './ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from './ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { ScrollArea } from './ui/scroll-area';
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from './ui/tabs';

type Tab = 'presets' | 'editor';

type Draft = {
  effectId: string;
  params: Record<string, ParamValue>;
  seed: number;
};

const EFFECTS = BACKGROUND_BUNDLE.effects;
const CURRENT_VERSION = 1;
const CATEGORY_LABELS: Record<string, string> = {
  gradients: 'Gradients',
  waves: 'Waves',
  particles: 'Particles',
  geometry: 'Geometry',
  stylized: 'Stylized',
  feedback: 'Feedback',
};
const EFFECT_GROUPS = EFFECTS.reduce<{ category: string; items: (typeof EFFECTS)[number][] }[]>(
  (groups, effect) => {
    const last = groups[groups.length - 1];
    if (last && last.category === effect.category) {
      last.items.push(effect);
    } else {
      groups.push({ category: effect.category, items: [effect] });
    }
    return groups;
  },
  []
);
const PARAM_GROUPS = [
  { id: 'motion', label: 'Motion' },
  { id: 'shape', label: 'Shape' },
  { id: 'color', label: 'Color' },
  { id: 'advanced', label: 'Advanced' },
] as const;

function effectName(id: string): string {
  return EFFECTS.find((effect) => effect.id === id)?.name ?? id;
}

function makeDraft(effectId: string, seed = 42): Draft {
  const effect = EFFECTS.find((item) => item.id === effectId) ?? EFFECTS[0];
  return { effectId: effect.id, params: defaultParams(effect), seed };
}

function sliderPosition(spec: ParamShape, value: number): number {
  const min = spec.min ?? 0;
  const max = spec.max ?? 1;
  if (max <= min) return 0;
  if (spec.scale === 'log' && min > 0) {
    const clamped = Math.min(max, Math.max(min, value));
    return Math.log(clamped / min) / Math.log(max / min);
  }
  return (value - min) / (max - min);
}

function sliderValue(spec: ParamShape, position: number): number {
  const min = spec.min ?? 0;
  const max = spec.max ?? 1;
  const value =
    spec.scale === 'log' && min > 0 ? min * (max / min) ** position : min + position * (max - min);
  return spec.kind === 'int' || spec.kind === 'seed' ? Math.round(value) : value;
}

function formatValue(spec: ParamShape, value: ParamValue): string {
  if (typeof value !== 'number') return String(value);
  return spec.kind === 'int' || spec.kind === 'seed' ? value.toFixed(0) : value.toFixed(2);
}

function ParamControl({
  spec,
  value,
  onChange,
}: {
  spec: ParamShape;
  value: ParamValue;
  onChange: (value: ParamValue) => void;
}) {
  if (spec.kind === 'color') {
    const color = typeof value === 'string' ? value : String(spec.default);
    const label = spec.label ?? spec.key;
    return (
      <div className="flex items-center justify-between gap-2 text-xs">
        <span>{label}</span>
        <Popover>
          <PopoverTrigger
            aria-label={`${label}: ${color}`}
            title={color}
            className="size-7 shrink-0 cursor-pointer rounded-md border border-border ring-ring/40 hover:ring-2 focus-visible:outline-none focus-visible:ring-2"
            style={{ backgroundColor: color }}
          />
          <PopoverContent className="w-66 p-2">
            <HexColorPicker
              color={color}
              onChange={(next) => onChange(next ?? color)}
              className="rectangle-color-picker"
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  if (spec.kind === 'bool') {
    return (
      <label className="flex items-center justify-between gap-2 text-xs">
        <span>{spec.label ?? spec.key}</span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    );
  }

  const numeric = typeof value === 'number' ? value : Number(spec.default);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1">
          {spec.label ?? spec.key}
          {spec.kind === 'seed' && (
            <button
              type="button"
              onClick={() => onChange(Math.floor(Math.random() * 10000))}
              title="Randomize seed"
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Dices className="size-3" />
            </button>
          )}
        </span>
        <span className="tabular-nums text-muted-foreground">{formatValue(spec, numeric)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={sliderPosition(spec, numeric)}
        onChange={(event) => onChange(sliderValue(spec, Number(event.target.value)))}
        className="w-full accent-primary"
      />
    </div>
  );
}

export function GeneratorPresetsDialog() {
  const { t } = useTranslation();
  const { isOpen, close } = useGeneratorPresetsDialogStore();
  const { presets, loading, load, save, remove } = useGeneratorPresetsStore();

  const [tab, setTab] = useState<Tab>('presets');
  const [draft, setDraft] = useState<Draft>(() => makeDraft(EFFECTS[0].id));
  const [name, setName] = useState('');
  const [base, setBase] = useState<GeneratorPreset | null>(null);
  const [saving, setSaving] = useState(false);
  const [effectQuery, setEffectQuery] = useState('');
  const effectAnchor = useRef<HTMLDivElement | null>(null);

  const filteredGroups = useMemo(() => {
    const query = effectQuery.trim().toLowerCase();
    if (!query) return EFFECT_GROUPS;
    return EFFECT_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => item.name.toLowerCase().includes(query) || item.id.includes(query)
      ),
    })).filter((group) => group.items.length > 0);
  }, [effectQuery]);

  useEffect(() => {
    if (!isOpen) return;
    setTab('presets');
    void load(true);
  }, [isOpen, load]);

  const effect = EFFECTS.find((item) => item.id === draft.effectId) ?? EFFECTS[0];

  function startNew() {
    setBase(null);
    setName('');
    setDraft(makeDraft(EFFECTS[0].id, Math.floor(Math.random() * 10000)));
    setTab('editor');
  }

  function editPreset(preset: GeneratorPreset) {
    const target = EFFECTS.find((item) => item.id === preset.effect) ?? EFFECTS[0];
    const params = normalizeParams(target, preset.params);
    setBase(preset.builtIn ? null : preset);
    setName(preset.builtIn ? `${preset.name} copy` : preset.name);
    setDraft({
      effectId: target.id,
      params: { ...params, seed: preset.seed },
      seed: preset.seed,
    });
    setTab('editor');
  }

  function changeEffect(effectId: string) {
    const target = EFFECTS.find((item) => item.id === effectId);
    if (!target) return;
    setDraft((current) => ({
      effectId: target.id,
      params: { ...defaultParams(target), seed: current.seed },
      seed: current.seed,
    }));
  }

  function updateParam(key: string, value: ParamValue) {
    setDraft((current) => ({
      ...current,
      params: { ...current.params, [key]: value },
      seed: key === 'seed' && typeof value === 'number' ? value : current.seed,
    }));
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error(t('Preset name is required.'));
      return;
    }
    setSaving(true);
    try {
      const saved = await save({
        id: base?.id ?? '',
        name: name.trim(),
        effect: draft.effectId,
        params: draft.params,
        seed: draft.seed,
        createdAt: base?.createdAt ?? 0,
        version: CURRENT_VERSION,
        builtIn: false,
      });
      setBase(saved);
      setName(saved.name);
      toast.success(t('Preset saved.'));
    } catch (error) {
      toast.error(typeof error === 'string' ? error : t('Failed to save preset.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(preset: GeneratorPreset) {
    try {
      await remove(preset.id);
      if (base?.id === preset.id) setBase(null);
      toast.success(t('Preset deleted.'));
    } catch (error) {
      toast.error(typeof error === 'string' ? error : t('Failed to delete preset.'));
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-225 p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-0">
          <DialogTitle className="text-base font-semibold">{t('Generators')}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} orientation="vertical">
          <TabsList variant="line" className="h-auto w-fit justify-start gap-4 rounded-none py-0">
            <TabsTrigger value="presets" className="px-0 pb-3 after:hidden">
              {t('Presets')}
            </TabsTrigger>
            <TabsTrigger value="editor" className="px-0 pb-3 after:hidden">
              {t('Editor')}
            </TabsTrigger>
            <TabsIndicator className="bg-primary" />
          </TabsList>

          <TabsContent value="presets" className="flex flex-col gap-3 px-6 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {t('Pick a preset to preview and edit. Built-ins are copied when edited.')}
              </p>
              <Button size="sm" onClick={startNew}>
                <Plus className="size-3.5" />
                {t('New preset')}
              </Button>
            </div>

            {presets.length === 0 ? (
              <Empty className="h-[50dvh]">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Plus />
                  </EmptyMedia>
                  <EmptyTitle>{loading ? t('Loading presets...') : t('No presets yet')}</EmptyTitle>
                  <EmptyDescription>
                    {t('Create a preset from the Editor tab to reuse a look.')}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ScrollArea className="h-[52dvh]" viewportClassName="p-1">
                <div className="grid grid-cols-2 gap-3">
                  {presets.map((preset) => (
                    <div key={preset.id} className="group overflow-hidden rounded-lg border">
                      <div className="relative aspect-video bg-black">
                        <BackgroundLayer
                          effectId={preset.effect}
                          params={preset.params}
                          seed={preset.seed}
                          maxFps={15}
                          resolutionScale={0.5}
                          paused={!isOpen || tab !== 'presets'}
                        />
                        <div className="absolute inset-0 flex items-end justify-between gap-2 bg-linear-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                          <Button size="xs" variant="secondary" onClick={() => editPreset(preset)}>
                            {t('Edit')}
                          </Button>
                          {!preset.builtIn && (
                            <Button
                              size="icon-xs"
                              variant="secondary"
                              title={t('Delete preset')}
                              onClick={() => void handleDelete(preset)}
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="px-2.5 py-2">
                        <p className="truncate text-xs font-medium">{preset.name}</p>
                        <p className="truncate text-[10px] text-muted-foreground">
                          {effectName(preset.effect)}
                          {preset.builtIn ? ` · ${t('Built-in')}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="editor" className="px-6 py-4">
            <div className="grid h-[58dvh] grid-cols-[minmax(0,1fr)_300px] gap-4">
              <div className="flex min-h-0 flex-col gap-3">
                <div className="relative aspect-video overflow-hidden rounded-lg border bg-black">
                  <BackgroundLayer
                    effectId={draft.effectId}
                    params={draft.params}
                    seed={draft.seed}
                    maxFps={60}
                    paused={!isOpen || tab !== 'editor'}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-xs">
                    <span className="text-muted-foreground">{t('Name')}</span>
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={t('My preset')}
                      maxLength={80}
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="text-muted-foreground">{t('Effect')}</span>
                    <div ref={effectAnchor}>
                      <Combobox
                        value={draft.effectId}
                        onValueChange={(val) => val && changeEffect(val)}
                        itemToStringLabel={(id) => effectName(id)}
                        onInputValueChange={(value, details) => {
                          if (details.reason === 'input-change' || details.reason === 'input-clear') {
                            setEffectQuery(value);
                          }
                        }}
                        onOpenChange={(open) => !open && setEffectQuery('')}
                      >
                        <ComboboxInput
                          className="w-full"
                          placeholder={t('Search effects...')}
                          showClear
                        />
                        <ComboboxContent
                          anchor={effectAnchor}
                          align="start"
                          className="w-(--anchor-width) min-w-(--anchor-width)"
                        >
                          <ComboboxList>
                            <ComboboxEmpty>{t('No effect found.')}</ComboboxEmpty>
                            {filteredGroups.map((group) => (
                              <ComboboxGroup key={group.category}>
                                <ComboboxLabel>
                                  {t(CATEGORY_LABELS[group.category] ?? group.category)}
                                </ComboboxLabel>
                                {group.items.map((item) => (
                                  <ComboboxItem key={item.id} value={item.id}>
                                    {item.name}
                                  </ComboboxItem>
                                ))}
                              </ComboboxGroup>
                            ))}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                    </div>
                  </label>
                </div>

                <div className="mt-auto flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {base ? t('Editing an existing preset') : t('Saving a new preset')}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={startNew}>
                      {t('Reset')}
                    </Button>
                    <Button onClick={() => void handleSave()} disabled={saving}>
                      {saving ? <Loader2 className="animate-spin" /> : <Save />}
                      {t('Save preset')}
                    </Button>
                  </div>
                </div>
              </div>

              <ScrollArea className="h-full rounded-lg border" viewportClassName="space-y-4 p-3">
                {PARAM_GROUPS.map((group) => {
                  const specs = paramSpecs(effect).filter(
                    (spec) => (spec.group ?? 'advanced') === group.id
                  );
                  if (specs.length === 0) return null;
                  return (
                    <section key={group.id} className="space-y-2">
                      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {t(group.label)}
                      </h3>
                      {specs.map((spec) => (
                        <ParamControl
                          key={spec.key}
                          spec={spec}
                          value={draft.params[spec.key] ?? spec.default}
                          onChange={(value) => updateParam(spec.key, value)}
                        />
                      ))}
                    </section>
                  );
                })}
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
