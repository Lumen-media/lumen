import { Link, useRouterState } from '@tanstack/react-router';
import { Monitor, Settings, Star, Volume2, Wifi } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { Card } from './ui/card';

const NAV_TABS = [
  { label: 'Edit', to: '/edit' },
  { label: 'View', to: '/' },
  { label: 'Presentation', to: '/presentation' },
  { label: 'Live', to: '/live' },
  { label: 'Settings', to: '/settings' },
] as const;

type TabTo = (typeof NAV_TABS)[number]['to'];

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const activeTab: TabTo = (() => {
    const match = NAV_TABS.find((t) => t.to !== '/' && pathname.startsWith(t.to));
    return match ? match.to : '/';
  })();

  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const [ready, setReady] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const buttonRefs = useRef<Map<TabTo, HTMLAnchorElement>>(new Map());

  useEffect(() => {
    const activeBtn = buttonRefs.current.get(activeTab);
    const nav = navRef.current;
    if (!activeBtn || !nav) return;

    const navRect = nav.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();

    setIndicatorStyle({
      left: btnRect.left - navRect.left,
      width: btnRect.width,
    });
    setReady(true);
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

          {ready && (
            <span
              className="absolute bottom-0 h-0.5 bg-primary rounded-full"
              style={{
                left: indicatorStyle.left,
                width: indicatorStyle.width,
                transition: 'left 250ms ease, width 250ms ease',
              }}
            />
          )}
        </nav>

        <div className="flex items-center gap-3 w-40 justify-end">
          <Wifi className="size-4 text-muted-foreground" />
          <Monitor className="size-4 text-muted-foreground" />
          <Volume2 className="size-4 text-muted-foreground" />
          <Settings className="size-4 text-muted-foreground" />
          <Avatar size="sm">
            <AvatarImage src="" alt="User" />
            <AvatarFallback>U</AvatarFallback>
          </Avatar>
        </div>
      </Card>
    </header>
  );
}
