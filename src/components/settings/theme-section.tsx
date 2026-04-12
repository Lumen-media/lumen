'use client';

import { t } from 'i18next';
import { ImagePlus } from 'lucide-react';

import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';
import { ACCENT_PRESETS } from '@/stores/theme-store';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const PROFILES = ['Default Studio', 'Youth Night', 'Sunday Service'];

export function ThemeSection() {
  const { colorMode, accentId, setColorMode, setAccentId } = useTheme();

  return (
    <>
      <div className="mb-6">
        <h3 className="text-base font-semibold">{t('Theme & Profiles')}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t(
            'Choose default visuals for lyrics and media states, and store them in custom profiles.'
          )}
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h4 className="uppercase text-xs font-semibold tracking-widest text-muted-foreground mb-3">
            {t('Active Profile')}
          </h4>
          <div className="flex flex-wrap items-center gap-2">
            {PROFILES.map((profile) => (
              <Button key={profile} variant="ghost" size="sm">
                {t(profile)}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="border border-dashed border-border text-muted-foreground hover:text-foreground"
            >
              {t('+ New Profile')}
            </Button>
          </div>
        </div>

        <div>
          <h4 className="uppercase text-xs font-semibold tracking-widest text-muted-foreground mb-3">
            {t('Appearance Settings')}
          </h4>
          <div className="flex flex-wrap items-end gap-6">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('Color Mode')}</p>
              <Select value={colorMode} onValueChange={(v) => setColorMode(v as 'dark' | 'light')}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="p-1">
                  <SelectItem value="light">{t('Lumen Light')}</SelectItem>
                  <SelectItem value="dark">{t('Lumen Dark')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('Accent Color')}</p>
              <div className="flex items-center gap-2">
                {ACCENT_PRESETS.map(({ id, label, oklch }) => (
                  <button
                    key={id}
                    onClick={() => setAccentId(id)}
                    title={t(label)}
                    className={cn(
                      'size-8 rounded-full transition-all',
                      accentId === id
                        ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground/50'
                        : 'opacity-70 hover:opacity-100'
                    )}
                    style={{ backgroundColor: `color-mix(in oklch, ${oklch}, transparent 0%)` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div>
          <h4 className="uppercase text-xs font-semibold tracking-widest text-muted-foreground mb-3">
            {t('Default Backgrounds')}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="aspect-video rounded-lg overflow-hidden bg-muted border border-border">
              <div className="size-full bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900" />
            </div>
            <button className="aspect-video rounded-lg border border-dashed border-border bg-muted/30 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors">
              <ImagePlus className="size-5" />
              <span className="text-xs">{t('Add background')}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
