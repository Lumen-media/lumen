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

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  useSingleInstance();
  useTheme();
  useProfiles();
  useModules();

  return (
    <React.Fragment>
      <Outlet />
      <Toaster />
      <GlobalAlert />
      <QuickShortcutsModal />
      <LyricModal />
    </React.Fragment>
  );
}
