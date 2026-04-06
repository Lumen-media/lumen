'use client';

import { t } from 'i18next';
import {
  ChevronDown,
  Info,
  Monitor,
  Palette,
  RotateCcw,
  Save,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wifi,
} from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import { DevicePermissionsSection } from './settings/device-permissions-section';
import { GeneralAccessSection } from './settings/general-access-section';
import { PlaceholderSection } from './settings/placeholder-section';
import { ThemeSection } from './settings/theme-section';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';

type NavSection = 'theme' | 'remote_general' | 'remote_permissions' | 'advanced' | 'about';

const SECTION_TITLES: Record<NavSection, { label: string; title: string }> = {
  theme: { label: 'Application settings', title: 'Configure themes, devices and transmission' },
  remote_general: { label: 'Remote Access', title: 'General Access' },
  remote_permissions: { label: 'Remote Access', title: 'Device Permissions' },
  advanced: { label: 'Application settings', title: 'Advanced Configuration' },
  about: { label: 'Application settings', title: 'About Lumen' },
};

export const SettingsDialog = () => {
  const [activeSection, setActiveSection] = useState<NavSection>('theme');
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [activeProfile, setActiveProfile] = useState('Default Studio');
  const [activeColor, setActiveColor] = useState('Cyan');

  const isRemoteSection =
    activeSection === 'remote_general' || activeSection === 'remote_permissions';

  const handleNavClick = (section: NavSection) => {
    setActiveSection(section);
    if (section === 'remote_general' || section === 'remote_permissions') {
      setRemoteOpen(true);
    } else {
      setRemoteOpen(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger render={<button />}>
        <Settings className="size-4 text-muted-foreground" />
      </DialogTrigger>

      <DialogContent
        showCloseButton={false}
        className="w-full p-0 gap-0 sm:max-w-[60dvw] h-full max-h-[70dvh] flex"
      >
        <Card className="w-56 shrink-0 p-0 border-0 rounded-l-xl rounded-r-none gap-0">
          <CardHeader className="p-3 flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <span className="font-semibold text-sm">Lumen</span>
            </div>
            <DialogClose render={<Button variant="ghost" size="icon-sm" />}>
              <span className="sr-only">{t('Close')}</span>×
            </DialogClose>
          </CardHeader>

          <Separator />

          <div className="p-2">
            <div className="rounded-lg bg-muted/60 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">{t('Workspace')}</p>
              <p className="text-sm font-medium leading-tight mt-0.5">
                {t('Default Studio Profile')}
              </p>
            </div>
          </div>

          <Separator />

          <nav className="flex flex-1 flex-col gap-0.5 p-2">
            <button
              onClick={() => handleNavClick('theme')}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors text-left',
                activeSection === 'theme'
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Palette className="size-4" />
              {t('Theme & Profiles')}
            </button>

            <div>
              <button
                onClick={() => {
                  const next = !remoteOpen;
                  setRemoteOpen(next);
                  if (next && !isRemoteSection) setActiveSection('remote_general');
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors text-left',
                  isRemoteSection
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Monitor className="size-4" />
                <span className="flex-1">{t('Remote Access')}</span>
                <ChevronDown
                  className={cn('size-3.5 transition-transform', remoteOpen && 'rotate-180')}
                />
              </button>

              {remoteOpen && (
                <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-3">
                  <button
                    onClick={() => handleNavClick('remote_general')}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors text-left',
                      activeSection === 'remote_general'
                        ? 'text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Wifi className="size-3.5" />
                    {t('General Access')}
                  </button>
                  <button
                    onClick={() => handleNavClick('remote_permissions')}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors text-left',
                      activeSection === 'remote_permissions'
                        ? 'text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Users className="size-3.5" />
                    {t('Device Permissions')}
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => handleNavClick('advanced')}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors text-left',
                activeSection === 'advanced'
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <SlidersHorizontal className="size-4" />
              {t('Advanced')}
            </button>

            <button
              onClick={() => handleNavClick('about')}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors text-left',
                activeSection === 'about'
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Info className="size-4" />
              {t('About')}
            </button>
          </nav>

          <Separator />

          <div className="p-3 text-xs text-muted-foreground space-y-1.5">
            <div className="flex items-center justify-between">
              <span>{t('Remote access')}</span>
              <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {t('Enabled')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>{t('Version')}</span>
              <span>1.4.2</span>
            </div>
          </div>
        </Card>

        <Separator orientation="vertical" />

        <Card className="flex-1 p-0 border-0 rounded-l-none rounded-r-xl gap-0">
          <CardHeader className="p-4 flex-row items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-primary">
                {t(SECTION_TITLES[activeSection].label)}
              </p>
              <h2 className="text-xl font-bold leading-tight mt-0.5">
                {t(SECTION_TITLES[activeSection].title)}
              </h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="secondary" size="sm">
                <RotateCcw className="size-3.5" />
                {t('Reset')}
              </Button>
              <Button size="sm">
                <Save className="size-3.5" />
                {t('Save Changes')}
              </Button>
            </div>
          </CardHeader>

          <Separator />

          <CardContent className="flex-1 overflow-hidden p-0">
            <ScrollArea className="size-full">
              <div className="p-4 space-y-4">
                {activeSection === 'theme' && (
                  <ThemeSection
                    activeProfile={activeProfile}
                    setActiveProfile={setActiveProfile}
                    activeColor={activeColor}
                    setActiveColor={setActiveColor}
                  />
                )}
                {activeSection === 'remote_general' && <GeneralAccessSection />}
                {activeSection === 'remote_permissions' && <DevicePermissionsSection />}
                {activeSection === 'advanced' && (
                  <PlaceholderSection
                    title={t('Advanced')}
                    description={t('Advanced configuration options.')}
                  />
                )}
                {activeSection === 'about' && (
                  <PlaceholderSection
                    title={t('About')}
                    description={t('Lumen version 1.4.2. Built for worship teams.')}
                  />
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
};
