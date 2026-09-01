import { createRootRoute, Outlet } from '@tanstack/react-router';
import * as React from 'react';
import { GlobalAlert } from '@/components/global-alert';
import { LyricModal } from '@/components/lyric-modal';
import { OptimizingIndicator } from '@/components/optimizing-indicator';
import { QuickShortcutsModal } from '@/components/quick-shortcuts-modal';
import { Toaster } from '@/components/ui/sonner';
import { useModules } from '@/hooks/use-modules';
import { useOptimizingEvents } from '@/hooks/use-optimizing-events';
import { useProfiles } from '@/hooks/use-profiles';
import { useSingleInstance } from '@/hooks/use-single-instance';
import { useTheme } from '@/hooks/use-theme';
import { BackgroundPickerSlot } from '@/modules/components/BackgroundPickerSlot';
import { DialogSlot } from '@/modules/components/DialogSlot';

export const Route = createRootRoute({
  component: RootComponent,
});

const AUXILIARY_WINDOW_PATHS = new Set(['/media-window', '/module-overlay-window', '/module-surface-window']);
const SURFACE_WINDOW_PATH = '/module-surface-window';

function RootComponent() {
  const isAuxiliaryWindow = AUXILIARY_WINDOW_PATHS.has(window.location.pathname);
  const isSurfaceWindow = window.location.pathname === SURFACE_WINDOW_PATH;

  useSingleInstance(!isAuxiliaryWindow);
  useTheme();
  useProfiles();
  useModules(!isAuxiliaryWindow);
  useOptimizingEvents();

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
          <OptimizingIndicator />
        </React.Fragment>
      )}
      {isSurfaceWindow && <BackgroundPickerSlot />}
    </React.Fragment>
  );
}
