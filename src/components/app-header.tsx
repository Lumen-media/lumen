import { Link, useRouterState } from '@tanstack/react-router';
import { animate } from 'animejs';
import { CheckIcon, Monitor, Smartphone, Star, Volume2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useProfileStore } from '@/stores/profile-store';
import { useStreamingStore } from '@/stores/streaming-store';
import { HeaderTrailingSlot } from '@/modules/components/HeaderTrailingSlot';
import { SettingsDialog } from './settings-dialog';
import { Card } from './ui/card';

const NAV_TABS = [
  { label: 'Edit', to: '/edit' },
  { label: 'View', to: '/' },
  { label: 'Presentation', to: '/presentation' },
  { label: 'Live', to: '/live' },
  // { label: 'Settings', to: '/settings' },
] as const;

type TabTo = (typeof NAV_TABS)[number]['to'];

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const setActiveProfile = useProfileStore((s) => s.setActiveProfile);
  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const profileName = activeProfile?.name ?? 'User';
  const initials = getInitials(profileName);

  const mobileConnected = useStreamingStore((s) => s.status.mobile_connected);
  const mobileCount = Object.keys(useStreamingStore((s) => s.mobileStreams)).length;

  const activeTab: TabTo = (() => {
    const match = NAV_TABS.find((t) => t.to !== '/' && pathname.startsWith(t.to));
    return match ? match.to : '/';
  })();

  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const readyRef = useRef(false);
  const buttonRefs = useRef<Map<TabTo, HTMLAnchorElement>>(new Map());

  useEffect(() => {
    const indicator = indicatorRef.current;
    const nav = navRef.current;
    if (!indicator || !nav) return;

    let frame = 0;

    const updateIndicator = () => {
      const activeBtn = buttonRefs.current.get(activeTab);
      if (!activeBtn) return;

      const navRect = nav.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();
      const left = btnRect.left - navRect.left;
      const width = btnRect.width;

      if (!readyRef.current) {
        animationRef.current?.cancel();
        indicator.style.opacity = '1';
        indicator.style.left = `${left}px`;
        indicator.style.width = `${width}px`;
        readyRef.current = true;
        return;
      }

      animationRef.current?.cancel();
      animationRef.current = animate(indicator, {
        left: `${left}px`,
        width: `${width}px`,
        opacity: 1,
        duration: 250,
        ease: 'outCubic',
      });
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateIndicator);
    };

    const resizeObserver = new ResizeObserver(() => scheduleUpdate());
    resizeObserver.observe(nav);
    buttonRefs.current.forEach((button) => {
      resizeObserver.observe(button);
    });

    scheduleUpdate();

    return () => {
      cancelAnimationFrame(frame);
      animationRef.current?.cancel();
      resizeObserver.disconnect();
    };
  }, [activeTab]);

  return (
    <header>
      <Card className="flex flex-row min-h-12 py-1 items-center justify-between bg-card px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2 w-40">
          <Star className="size-5 text-primary fill-primary" strokeWidth={1.5} />
          <span className="font-semibold text-sm tracking-wide text-foreground">Lumen</span>
        </div>

        <nav ref={navRef} className="relative flex items-center gap-1">
          {NAV_TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              ref={(el) => {
                if (el) buttonRefs.current.set(tab.to, el);
              }}
              className={cn(
                'px-4 h-10 text-sm font-medium transition-colors flex items-center',
                activeTab === tab.to
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </Link>
          ))}

          <span
            ref={indicatorRef}
            className="absolute bottom-0 h-0.5 rounded-full bg-primary"
            style={{ opacity: 0, left: 0, width: 0 }}
          />
        </nav>

        <div className="flex min-w-0 items-center justify-end gap-3 w-56">
          <HeaderTrailingSlot />
          <span className="relative inline-flex">
            <Smartphone className={cn('size-4 shrink-0', mobileConnected ? 'text-primary' : 'text-muted-foreground')} />
            {mobileCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex min-w-[14px] h-3.5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground px-[3px] leading-none">
                {mobileCount > 9 ? '+9' : mobileCount}
              </span>
            )}
          </span>
          <Monitor className="size-4 shrink-0 text-muted-foreground" />
          <Volume2 className="size-4 shrink-0 text-muted-foreground" />
          <SettingsDialog />
          {profiles.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger>
                <Avatar size="sm">
                  <AvatarImage src="" alt={profileName} />
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8}>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Profiles</DropdownMenuLabel>
                </DropdownMenuGroup>
                {profiles.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => setActiveProfile(p.id)}
                    className="flex items-center gap-2"
                  >
                    {p.id === activeProfileId && (
                      <CheckIcon className="size-3.5 shrink-0" />
                    )}
                    <span className={p.id !== activeProfileId ? 'pl-5' : ''}>
                      {p.name}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Avatar size="sm">
              <AvatarImage src="" alt={profileName} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          )}
        </div>
      </Card>
    </header>
  );
}
