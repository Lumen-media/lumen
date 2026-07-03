'use client';

import { readFile } from '@tauri-apps/plugin-fs';
import { useTranslation } from '@/lib/i18n';
import { ImagePlus, X } from 'lucide-react';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { useBoolean, useOnClickOutside } from 'usehooks-ts';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';
import type { Profile } from '@/services/profile-service';
import { useProfileStore } from '@/stores/profile-store';
import { ACCENT_PRESETS } from '@/stores/theme-store';
import {
  LyricBackgroundModal,
  type LyricBackgroundModalRef,
  type SelectedBackground,
} from '../lyric-background-modal';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

function BackgroundPreview({ background }: { background: Profile['defaultBackground'] }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!background || (background.type === 'image' && background.src.startsWith('http'))) {
      setBlobUrl(null);
      return;
    }
    let url: string | null = null;
    readFile(background.src).then((bytes) => {
      const ext = background.src.split('.').pop()?.toLowerCase() ?? '';
      const mime =
        ext === 'mp4'
          ? 'video/mp4'
          : ext === 'webm'
            ? 'video/webm'
            : ext === 'mov'
              ? 'video/quicktime'
              : 'image/jpeg';
      const blob = new Blob([bytes], { type: mime });
      url = URL.createObjectURL(blob);
      setBlobUrl(url);
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [background]);

  if (!background) {
    return (
      <div className="size-full bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900" />
    );
  }

  const src =
    background.type === 'image' && background.src.startsWith('http') ? background.src : blobUrl;

  if (!src) {
    return <div className="size-full bg-muted animate-pulse" />;
  }

  if (background.type === 'video') {
    return <video src={src} className="size-full object-cover" muted />;
  }

  return <img src={src} alt={background.name} className="size-full object-cover" />;
}

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
];

export function ThemeSection() {
  const { t, locale } = useTranslation();
  const { colorMode, accentId } = useTheme();
  const {
    profiles,
    activeProfileId,
    setActiveProfile,
    createProfile,
    updateProfile,
    removeProfile,
  } = useProfileStore();
  const [newProfileName, setNewProfileName] = useState('');
  const { value: creating, setTrue: startCreating, setFalse: stopCreating } = useBoolean(false);
  const backgroundModalRef = useRef<LyricBackgroundModalRef>(null);
  const newProfileInputRef = useRef<HTMLInputElement>(null);
  const creatingFormRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (creating) newProfileInputRef.current?.focus();
  }, [creating]);

  useOnClickOutside(creatingFormRef as RefObject<HTMLElement>, () => {
    stopCreating();
    setNewProfileName('');
  });

  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  function handleCreateProfile() {
    const name = newProfileName.trim();
    if (!name) return;
    createProfile(name);
    setNewProfileName('');
    stopCreating();
  }

  function handleSelectBackground(bg: SelectedBackground) {
    if (!activeProfileId) return;
    updateProfile(activeProfileId, { defaultBackground: bg });
  }

  function handleSetColorMode(mode: 'dark' | 'light') {
    if (!activeProfileId) return;
    updateProfile(activeProfileId, { colorMode: mode });
  }

  function handleSetAccentId(id: string) {
    if (!activeProfileId) return;
    updateProfile(activeProfileId, { accentId: id });
  }

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
            {t('Workspace')}
          </h4>
          <div className="flex flex-wrap items-center gap-2">
            {profiles.map((profile) => (
              <div key={profile.id} className="relative group">
                <Button
                  variant={activeProfileId === profile.id ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveProfile(profile.id)}
                >
                  {profile.name}
                </Button>
                {profiles.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeProfile(profile.id);
                    }}
                    className="absolute -top-1 -right-1 hidden group-hover:flex size-4 rounded-full bg-destructive text-destructive-foreground items-center justify-center"
                  >
                    <X className="size-2.5" />
                  </button>
                )}
              </div>
            ))}

            {creating ? (
              <div ref={creatingFormRef} className="flex items-center gap-1">
                <input
                  ref={newProfileInputRef}
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateProfile();
                    if (e.key === 'Escape') {
                      stopCreating();
                      setNewProfileName('');
                    }
                  }}
                  placeholder={t('Profile name...')}
                  className="h-8 px-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring w-36"
                />
                <Button size="sm" variant="ghost" onClick={handleCreateProfile}>
                  {t('Add')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    stopCreating();
                    setNewProfileName('');
                  }}
                >
                  {t('Cancel')}
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="border border-dashed border-border text-muted-foreground hover:text-foreground"
                onClick={startCreating}
              >
                {t('+ New Profile')}
              </Button>
            )}
          </div>
        </div>

        <div>
          <h4 className="uppercase text-xs font-semibold tracking-widest text-muted-foreground mb-3">
            {t('Appearance Settings')}
          </h4>
          <div className="flex flex-wrap items-end gap-6">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('Color Mode')}</p>
              <Select
                value={activeProfile?.colorMode ?? colorMode}
                onValueChange={(v) => handleSetColorMode(v as 'dark' | 'light')}
              >
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
              <p className="text-sm font-medium">{t('Language')}</p>
              <Select
                value={activeProfile?.language ?? locale ?? 'en'}
                onValueChange={(lang) => {
                  if (activeProfile)
                    updateProfile(activeProfile.id, { language: lang ?? undefined });
                }}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((lang) => (
                    <SelectItem key={lang.value} value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('Accent Color')}</p>
              <div className="flex items-center gap-2">
                {ACCENT_PRESETS.map(({ id, label, oklch }) => (
                  <button
                    key={id}
                    onClick={() => handleSetAccentId(id)}
                    title={t(label)}
                    className={cn(
                      'size-8 rounded-full transition-all',
                      (activeProfile?.accentId ?? accentId) === id
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
            {t('Default Background')}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            {activeProfile?.defaultBackground && (
              <div className="aspect-video rounded-lg overflow-hidden bg-muted border border-border">
                <BackgroundPreview background={activeProfile?.defaultBackground ?? null} />
              </div>
            )}
            <Button
              onClick={() => backgroundModalRef.current?.open(handleSelectBackground)}
              variant="ghost"
              className="aspect-video h-auto w-full rounded-lg border border-dashed border-border bg-muted/30 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors"
            >
              <ImagePlus className="size-5" />
              <span className="text-xs">{t('Add background')}</span>
            </Button>
          </div>
        </div>
      </div>

      <LyricBackgroundModal ref={backgroundModalRef} />
    </>
  );
}
