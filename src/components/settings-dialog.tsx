'use client';

import {
  ChevronDown,
  Info,
  Monitor,
  Package,
  Palette,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wifi,
} from 'lucide-react';
import { useState } from 'react';
import { useAppVersion } from '@/hooks/use-app-version';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useProfileStore } from '@/stores/profile-store';
import { type SettingsSection, useSettingsStore } from '@/stores/settings-store';
import { AboutSection } from './settings/about-section';
import { AdvancedSection } from './settings/advanced-section';
import { DevicePermissionsSection } from './settings/device-permissions-section';
import { GeneralAccessSection } from './settings/general-access-section';
import { ModulesSection } from './settings/modules-section';
import { ThemeSection } from './settings/theme-section';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';

const SECTION_TITLES: Record<
  SettingsSection,
  { label: string; title: string; description?: string }
> = {
  theme: { label: 'Application settings', title: 'Configure themes, devices and transmission' },
  remote_general: { label: 'Remote Access', title: 'General Access' },
  remote_permissions: { label: 'Remote Access', title: 'Device Permissions' },
  advanced: { label: 'Application settings', title: 'Advanced Settings' },
  about: {
    label: 'Application settings',
    title: 'About',
    description:
      'Review app version details, system information, and quick access to release notes and legal resources.',
  },
  modules: {
    label: 'Application settings',
    title: 'Modules',
    description: 'Manage installed modules. Enable, disable, reload or uninstall.',
  },
};

export const SettingsDialog = () => {
  const { t } = useTranslation();
  const version = useAppVersion();
  const { profiles, activeProfileId, resetProfile } = useProfileStore();
  const { isOpen, activeSection, open, close } = useSettingsStore();
  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const [remoteOpen, setRemoteOpen] = useState(false);

  const isRemoteSection =
    activeSection === 'remote_general' || activeSection === 'remote_permissions';

  const handleNavClick = (section: SettingsSection) => {
    open(section);
    if (section === 'remote_general' || section === 'remote_permissions') {
      setRemoteOpen(true);
    } else {
      setRemoteOpen(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(nextOpen) => (nextOpen ? open() : close())}>
      <DialogTrigger render={<button />}>
        <Settings className="size-4 text-muted-foreground" />
      </DialogTrigger>

      <DialogContent
        showCloseButton={false}
        className="w-full p-0 gap-0 sm:max-w-[60dvw] h-full max-h-[70dvh] flex"
      >
        <Card className="w-56 shrink-0 p-0 border-0 rounded-none rounded-l-xl gap-0">
          <CardHeader className="p-3 flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <span className="font-semibold text-sm">Lumen</span>
            </div>
            <DialogClose render={<Button variant="ghost" size="icon-sm" />}>
              <span className="sr-only">{t('Close')}</span>×
            </DialogClose>
          </CardHeader>

          <div className="p-2">
            <div className="rounded-lg bg-muted/35 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">{t('Active Profile')}</p>
              <p className="text-sm font-medium leading-tight mt-0.5">
                {activeProfile?.name ?? t('Default')}
              </p>
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-1.5 p-2">
            <Button
              variant="ghost"
              onClick={() => handleNavClick('theme')}
              className={cn(
                'w-full justify-start gap-2.5',
                activeSection === 'theme' && 'bg-primary/10 text-primary font-medium'
              )}
            >
              <Palette className="size-4" />
              {t('Theme & Profiles')}
            </Button>

            <div>
              <Button
                variant="ghost"
                onClick={() => {
                  const next = !remoteOpen;
                  setRemoteOpen(next);
                  if (next && !isRemoteSection) open('remote_general');
                }}
                className={cn(
                  'w-full justify-start gap-2.5',
                  isRemoteSection && 'bg-primary/10 text-primary font-medium'
                )}
              >
                <Monitor className="size-4" />
                <span className="flex-1 text-left">{t('Remote Access')}</span>
                <ChevronDown
                  className={cn('size-3.5 transition-transform', remoteOpen && 'rotate-180')}
                />
              </Button>

              {remoteOpen && (
                <div className="ml-3 mt-1 flex flex-col gap-1 border-l border-border pl-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleNavClick('remote_general')}
                    className={cn(
                      'w-full justify-start gap-2',
                      activeSection === 'remote_general' && 'text-primary font-medium'
                    )}
                  >
                    <Wifi className="size-3.5" />
                    {t('General Access')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleNavClick('remote_permissions')}
                    className={cn(
                      'w-full justify-start gap-2',
                      activeSection === 'remote_permissions' && 'text-primary font-medium'
                    )}
                  >
                    <Users className="size-3.5" />
                    {t('Device Permissions')}
                  </Button>
                </div>
              )}
            </div>

            <Button
              variant="ghost"
              onClick={() => handleNavClick('advanced')}
              className={cn(
                'w-full justify-start gap-2.5',
                activeSection === 'advanced' && 'bg-primary/10 text-primary font-medium'
              )}
            >
              <SlidersHorizontal className="size-4" />
              {t('Advanced')}
            </Button>

            <Button
              variant="ghost"
              onClick={() => handleNavClick('modules')}
              className={cn(
                'w-full justify-start gap-2.5',
                activeSection === 'modules' && 'bg-primary/10 text-primary font-medium'
              )}
            >
              <Package className="size-4" />
              {t('Modules')}
            </Button>

            <Button
              variant="ghost"
              onClick={() => handleNavClick('about')}
              className={cn(
                'w-full justify-start gap-2.5',
                activeSection === 'about' && 'bg-primary/10 text-primary font-medium'
              )}
            >
              <Info className="size-4" />
              {t('About')}
            </Button>
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
              <span>{version}</span>
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
              {SECTION_TITLES[activeSection].description && (
                <p className="text-sm text-muted-foreground mt-1">
                  {t(SECTION_TITLES[activeSection].description!)}
                </p>
              )}
            </div>
            {activeSection === 'theme' && activeProfileId && (
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => resetProfile(activeProfileId)}
              >
                <RotateCcw className="size-3.5" />
                {t('Reset')}
              </Button>
            )}
          </CardHeader>

          <CardContent className="flex-1 overflow-hidden p-0">
            <ScrollArea className="size-full">
              <div className="p-4 space-y-4">
                {activeSection === 'theme' && <ThemeSection />}
                {activeSection === 'remote_general' && <GeneralAccessSection />}
                {activeSection === 'remote_permissions' && <DevicePermissionsSection />}
                {activeSection === 'advanced' && <AdvancedSection />}
                {activeSection === 'modules' && <ModulesSection />}
                {activeSection === 'about' && <AboutSection />}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
};
