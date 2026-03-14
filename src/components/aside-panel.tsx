import { CheckCircle2, ListX } from 'lucide-react';
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
  const { queue, removeFromQueue, markPlayed, togglePlayed, loadFromDb, clearQueue, shuffleQueue } =
    useQueueStore();
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
            onClear={clearQueue}
            onShuffle={shuffleQueue}
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
  onClear,
  onShuffle,
  onPlay,
}: {
  queue: QueueItem[];
  onRemove: (id: number) => void;
  onTogglePlayed: (id: number) => void;
  onClear: () => Promise<void>;
  onShuffle: () => Promise<void>;
  onPlay: (item: QueueItem) => void;
}) {
  const currentFilePath = usePlayerStore((s) => s.currentFilePath);

  if (queue.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Queue is empty
      </div>
    );
  }

  const currentItemIndex = currentFilePath
    ? queue.findIndex((item) => item.file.path === currentFilePath)
    : -1;

  const currentItem = currentItemIndex >= 0 ? queue[currentItemIndex] : queue[0];
  const upNextItems =
    currentItemIndex >= 0
      ? [...queue.slice(0, currentItemIndex), ...queue.slice(currentItemIndex + 1)]
      : queue.slice(1);

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <div className="p-4 pb-2">
          <h3 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-widest">
            Now Playing
          </h3>
          <ContextMenu>
            <ContextMenuTrigger>
              <Button
                variant="ghost"
                className="w-full justify-between text-left p-3 h-auto gap-3 border border-primary/40 rounded-lg hover:bg-primary/10 hover:border-primary/60"
                onDoubleClick={() => onPlay(currentItem)}
              >
                <div className="flex-1 min-w-0">
                  <div
                    className={cn(
                      'font-semibold text-sm text-primary leading-tight line-clamp-1 text-ellipsis',
                      currentItem.played && 'line-through opacity-60'
                    )}
                  >
                    {currentItem.file.title || currentItem.file.name}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {currentItem.file.artist ||
                      currentItem.file.name.split('.').pop()?.toUpperCase()}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground font-medium shrink-0">
                  {formatDuration(currentItem.file.duration)}
                </div>
              </Button>
            </ContextMenuTrigger>
            <ContextMenuContent side="bottom">
              <ContextMenuItem onClick={() => onTogglePlayed(currentItem.id)}>
                <CheckCircle2 className="h-4 w-4" />
                {currentItem.played ? 'Mark as unplayed' : 'Mark as played'}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onRemove(currentItem.id)} variant="destructive">
                <ListX className="h-4 w-4" />
                Remove from queue
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>

        {upNextItems.length > 0 && (
          <div className="px-4 pb-4 pt-2">
            <h3 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-widest">
              Up Next
            </h3>
            <div className="space-y-2">
              {upNextItems.map((item) => {
                const originalIndex = queue.findIndex((q) => q.id === item.id);
                return (
                  <ContextMenu key={item.id}>
                    <ContextMenuTrigger>
                      <Button
                        variant="ghost"
                        className={cn(
                          'w-full justify-between text-left p-3 h-auto gap-2 rounded-lg hover:bg-accent/50 transition-colors',
                          item.played && 'opacity-50'
                        )}
                        onDoubleClick={() => onPlay(item)}
                      >
                        <div className="flex items-start gap-1 flex-1 min-w-0">
                          <span className="text-sm font-medium text-muted-foreground w-5 shrink-0 pt-0.5">
                            {originalIndex + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div
                              className={cn(
                                'font-medium text-sm text-foreground leading-tight line-clamp-1 text-ellipsis',
                                item.played && 'line-through opacity-60'
                              )}
                            >
                              {item.file.title || item.file.name}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {item.file.artist || item.file.name.split('.').pop()?.toUpperCase()}
                            </div>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground font-medium shrink-0">
                          {formatDuration(item.file.duration)}
                        </div>
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
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border p-3 shrink-0 flex gap-2">
        <Button variant="secondary" size="sm" className="flex-1 rounded-md" onClick={onClear}>
          Clear
        </Button>
        <Button variant="secondary" size="sm" className="flex-1 rounded-md" onClick={onShuffle}>
          Shuffle
        </Button>
      </div>
    </div>
  );
}
