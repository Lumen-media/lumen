import { CheckCircle2, ListX, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '@/stores/player-store';
import { type QueueItem, useQueueStore } from '@/stores/queue-store';

type TabValue = 'queue' | 'notes' | 'themes';

const TABS: { value: TabValue; label: string }[] = [
  { value: 'queue', label: 'Queue' },
  { value: 'notes', label: 'Notes' },
  { value: 'themes', label: 'Themes' },
];

export function AsidePanel() {
  const { queue, removeFromQueue, markPlayed, togglePlayed, loadFromDb } = useQueueStore();
  const loadFile = usePlayerStore((s) => s.loadFile);

  const [activeTab, setActiveTab] = useState<TabValue>('queue');
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const [ready, setReady] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Map<TabValue, HTMLButtonElement>>(new Map());

  useEffect(() => {
    loadFromDb();
  }, [loadFromDb]);

  useEffect(() => {
    const activeBtn = triggerRefs.current.get(activeTab);
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
    <Card className="flex flex-col w-full h-full overflow-hidden">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
        className="flex flex-col h-full"
      >
        <div ref={navRef} className="relative border-b border-border shrink-0">
          <TabsList
            variant="line"
            className="w-full justify-start rounded-none border-none px-2 h-10"
          >
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                ref={(el: HTMLButtonElement | null) => {
                  if (el) triggerRefs.current.set(tab.value, el);
                }}
                className="flex-none px-4 after:hidden"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

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
        </div>

        <TabsContent value="queue" className="flex-1 overflow-hidden mt-0">
          <QueueTab
            queue={queue}
            onRemove={removeFromQueue}
            onTogglePlayed={togglePlayed}
            onPlay={(item) => {
              loadFile(item.file.path);
              markPlayed(item.id);
            }}
          />
        </TabsContent>

        <TabsContent value="notes" className="flex-1 overflow-hidden mt-0">
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Coming soon
          </div>
        </TabsContent>

        <TabsContent value="themes" className="flex-1 overflow-hidden mt-0">
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Coming soon
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
}

function QueueTab({
  queue,
  onRemove,
  onTogglePlayed,
  onPlay,
}: {
  queue: QueueItem[];
  onRemove: (id: number) => void;
  onTogglePlayed: (id: number) => void;
  onPlay: (item: QueueItem) => void;
}) {
  if (queue.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Queue is empty
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {queue.map((item) => (
        <ContextMenu key={item.id}>
          <ContextMenuTrigger>
            <Button
              variant="ghost"
              className={cn(
                'w-full justify-start text-left p-3 h-auto gap-3',
                item.played && 'opacity-50'
              )}
              onDoubleClick={() => onPlay(item)}
            >
              {item.played ? (
                <CheckCircle2 className="size-4 text-primary shrink-0" />
              ) : (
                <Video className="size-4 text-muted-foreground shrink-0" />
              )}
              <span className={cn('text-sm truncate', item.played && 'line-through')}>
                {item.file.name}
              </span>
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent side="bottom">
            <ContextMenuItem onClick={() => onTogglePlayed(item.id)}>
              <CheckCircle2 className="h-4 w-4" />
              {item.played ? 'Mark as unplayed' : 'Mark as played'}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onRemove(item.id)} variant="destructive">
              <ListX className="h-4 w-4" />
              Remove from queue
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </div>
  );
}
