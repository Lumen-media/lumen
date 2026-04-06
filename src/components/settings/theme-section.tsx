'use client';

import { t } from 'i18next';
import { ImagePlus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const PROFILES = ['Default Studio', 'Youth Night', 'Sunday Service'];

const APP_COLORS = [
  { color: 'bg-primary', label: 'Cyan' },
  { color: 'bg-emerald-400', label: 'Green' },
  { color: 'bg-violet-400', label: 'Purple' },
  { color: 'bg-amber-400', label: 'Amber' },
  { color: 'bg-rose-400', label: 'Rose' },
];

interface ThemeSectionProps {
  activeProfile: string;
  setActiveProfile: (p: string) => void;
  activeColor: string;
  setActiveColor: (c: string) => void;
}

export function ThemeSection({
  activeProfile,
  setActiveProfile,
  activeColor,
  setActiveColor,
}: ThemeSectionProps) {
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
              <button
                key={profile}
                onClick={() => setActiveProfile(profile)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                  activeProfile === profile
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-transparent text-foreground hover:bg-muted'
                )}
              >
                {activeProfile === profile && <span className="size-2 rounded-full bg-primary" />}
                {t(profile)}
              </button>
            ))}
            <button className="rounded-lg border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors">
              {t('+ New Profile')}
            </button>
          </div>
        </div>

        <div>
          <h4 className="uppercase text-xs font-semibold tracking-widest text-muted-foreground mb-3">
            {t('Appearance Settings')}
          </h4>
          <div className="flex flex-wrap items-end gap-6">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('Profile Theme')}</p>
              <Select defaultValue="lumen-cyan">
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lumen-cyan">{t('Lumen Cyan')}</SelectItem>
                  <SelectItem value="lumen-dark">{t('Lumen Dark')}</SelectItem>
                  <SelectItem value="lumen-light">{t('Lumen Light')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('Accent Preset')}</p>
              <Select defaultValue="ocean-cyan">
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ocean-cyan">{t('Ocean Cyan')}</SelectItem>
                  <SelectItem value="forest-green">{t('Forest Green')}</SelectItem>
                  <SelectItem value="sunset-amber">{t('Sunset Amber')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('App Colors')}</p>
              <div className="flex items-center gap-2">
                {APP_COLORS.map(({ color, label }) => (
                  <button
                    key={label}
                    onClick={() => setActiveColor(label)}
                    className={cn(
                      'size-8 rounded-full transition-all',
                      color,
                      activeColor === label
                        ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground/50'
                        : 'opacity-70 hover:opacity-100'
                    )}
                    title={t(label)}
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
