import { createRootRoute, Outlet } from '@tanstack/react-router';
import * as React from 'react';
import { GlobalAlert } from '@/components/global-alert';
import { LyricModal } from '@/components/lyric-modal';
import { QuickShortcutsModal } from '@/components/quick-shortcuts-modal';
import { Toaster } from '@/components/ui/sonner';
import { useModules } from '@/hooks/use-modules';
import { useProfiles } from '@/hooks/use-profiles';
import { useSingleInstance } from '@/hooks/use-single-instance';
import { useTheme } from '@/hooks/use-theme';
import { BackgroundPickerSlot } from '@/modules/components/BackgroundPickerSlot';
import { DialogSlot } from '@/modules/components/DialogSlot';

export const Route = createRootRoute({
  component: RootComponent,
});

const AUXILIARY_WINDOW_PATHS = new Set(['/media-window', '/module-overlay-window']);

function RootComponent() {
  const isAuxiliaryWindow = AUXILIARY_WINDOW_PATHS.has(window.location.pathname);

  useSingleInstance(!isAuxiliaryWindow);
  useTheme();
  useProfiles();
  useModules(!isAuxiliaryWindow);

  return (
    <React.Fragment>
      <Outlet />
      {!isAuxiliaryWindow && (
        <React.Fragment>
          <Toaster />
          <GlobalAlert />
          <QuickShortcutsModal />
          <LyricModal />
          <DialogSlot />
          <BackgroundPickerSlot />
        </React.Fragment>
      )}
    </React.Fragment>
  );
}
