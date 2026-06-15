import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle2, ListX, X, Zap } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useModuleStore } from '@/modules/store';

import { usePlayerStore } from '@/stores/player-store';
import { type QueueItem, useQueueStore } from '@/stores/queue-store';

type TriggerInstance = { id: string; triggerId: string; config: unknown };
type TriggerDialog = {
  triggerId: string;
  config: unknown;
  instanceId: string | null;
} | null;

type TabValue = 'queue' | 'notes' | 'themes';

const TABS: { value: TabValue; label: string }[] = [
  { value: 'queue', label: 'Queue' },
  { value: 'notes', label: 'Notes' },
  { value: 'themes', label: 'Themes' },
];

export function AsidePanel() {
  const { queue, removeFromQueue, markPlayed, togglePlayed, loadFromDb, clearQueue, shuffleQueue, reorderQueue } =
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
    setIndicatorStyle({ left: btnRect.left - navRect.left, width: btnRect.width });
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
            className="w-full justify-between rounded-none border-none px-2 h-10"
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
            onReorder={reorderQueue}
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
  onReorder,
  onPlay,
}: {
  queue: QueueItem[];
  onRemove: (id: number) => void;
  onTogglePlayed: (id: number) => void;
  onClear: () => Promise<void>;
  onShuffle: () => Promise<void>;
  onReorder: (orderedIds: number[]) => Promise<void>;
  onPlay: (item: QueueItem) => void;
}) {
  const currentFilePath = usePlayerStore((s) => s.currentFilePath);
  const triggerSpecsMap = useModuleStore((s) => s.queueTriggerSpecs);
  const triggerSpecs = Array.from(triggerSpecsMap.values());
  const [triggerInstances, setTriggerInstances] = useState<TriggerInstance[]>([]);
  const [triggerDialog, setTriggerDialog] = useState<TriggerDialog>(null);
  const [contextTargetItem, setContextTargetItem] = useState<QueueItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = queue.findIndex((i) => String(i.id) === String(active.id));
    const newIndex = queue.findIndex((i) => String(i.id) === String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(queue, oldIndex, newIndex).map((i) => i.id));
  }

  function openAddTrigger(triggerId: string) {
    const spec = triggerSpecs.find((s) => s.id === triggerId);
    if (!spec) return;
    setTriggerDialog({ triggerId, config: spec.defaultConfig, instanceId: null });
  }

  function openEditTrigger(inst: TriggerInstance) {
    setTriggerDialog({ triggerId: inst.triggerId, config: inst.config, instanceId: inst.id });
  }

  function saveTrigger() {
    if (!triggerDialog) return;
    const { triggerId, config, instanceId } = triggerDialog;
    setTriggerInstances((prev) => {
      if (instanceId) {
        return prev.map((i) => (i.id === instanceId ? { ...i, config } : i));
      }
      return [...prev, { id: crypto.randomUUID(), triggerId, config }];
    });
    setTriggerDialog(null);
  }

  function removeTriggerInstance(instanceId: string) {
    setTriggerInstances((prev) => prev.filter((i) => i.id !== instanceId));
  }

  function handlePlay(item: QueueItem) {
    onPlay(item);
    const specs = useModuleStore.getState().getQueueTriggerSpecs();
    for (const inst of triggerInstances) {
      const spec = specs.find((s) => s.id === inst.triggerId);
      spec?.onFire(inst.config);
    }
  }

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const dialogSpec = triggerDialog ? triggerSpecs.find((s) => s.id === triggerDialog.triggerId) : null;
  const ConfigComp = dialogSpec?.ConfigComponent as
    | React.ComponentType<{ value: unknown; onChange: (v: unknown) => void }>
    | undefined;

  const currentItemIndex = currentFilePath
    ? queue.findIndex((item) => item.file.path === currentFilePath)
    : -1;

  const isPlaying = currentItemIndex >= 0;
  const currentItem = isPlaying ? queue[currentItemIndex] : null;
  const upNextItems = isPlaying
    ? [...queue.slice(0, currentItemIndex), ...queue.slice(currentItemIndex + 1)]
    : queue;

  if (queue.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Queue is empty
      </div>
    );
  }

  return (
    <>
      <ContextMenu onOpenChange={(open) => { if (!open) setContextTargetItem(null); }}>
        <ContextMenuTrigger className="flex flex-col h-full flex-1 min-h-0">
          <ScrollArea className="flex-1">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            >
              <SortableContext
                items={queue.map((i) => String(i.id))}
                strategy={verticalListSortingStrategy}
              >
                {currentItem && (
                  <div className="px-4 pt-4 pb-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                      Now Playing
                    </h3>
                    <SortableQueueItem
                      item={currentItem}
                      isCurrent
                      onPlay={handlePlay}
                      onContextMenu={() => setContextTargetItem(currentItem)}
                      formatDuration={formatDuration}
                    />
                  </div>
                )}

                {upNextItems.length > 0 && (
                  <div className="px-4 pb-4 pt-2">
                    {isPlaying && (
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                        Up Next
                      </h3>
                    )}
                    <div className="space-y-1">
                      {upNextItems.map((item, idx) => (
                        <SortableQueueItem
                          key={item.id}
                          item={item}
                          isCurrent={false}
                          index={isPlaying ? (idx < currentItemIndex ? idx : idx + 1) : idx}
                          onPlay={handlePlay}
                          onContextMenu={() => setContextTargetItem(item)}
                          formatDuration={formatDuration}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </SortableContext>
            </DndContext>

            {triggerInstances.length > 0 && (
              <div className="px-4 pb-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                  Queue Triggers
                </h3>
                <div className="flex flex-col gap-1">
                  {triggerInstances.map((inst) => {
                    const spec = triggerSpecs.find((s) => s.id === inst.triggerId);
                    if (!spec) return null;
                    return (
                      <div
                        key={inst.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium"
                        style={{
                          background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
                          color: 'var(--primary)',
                        }}
                      >
                        {spec.icon ? <spec.icon size={11} /> : <Zap size={11} />}
                        <button
                          type="button"
                          onClick={() => openEditTrigger(inst)}
                          className="bg-transparent border-none p-0 cursor-pointer flex-1 text-left"
                          style={{ color: 'inherit' }}
                        >
                          {spec.label}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeTriggerInstance(inst.id)}
                          className="bg-transparent border-none p-0 cursor-pointer opacity-50 hover:opacity-100"
                          style={{ color: 'inherit' }}
                        >
                          <X size={10} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </ScrollArea>

          <div className="border-t border-border p-3 shrink-0 flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1 rounded-md" onClick={onClear}>
              Clear
            </Button>
            <Button variant="secondary" size="sm" className="flex-1 rounded-md" onClick={onShuffle}>
              Shuffle
            </Button>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          {contextTargetItem && (
            <>
              <ContextMenuItem onClick={() => onTogglePlayed(contextTargetItem.id)}>
                <CheckCircle2 className="h-4 w-4" />
                {contextTargetItem.played ? 'Mark as unplayed' : 'Mark as played'}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onRemove(contextTargetItem.id)} variant="destructive">
                <ListX className="h-4 w-4" />
                Remove from queue
              </ContextMenuItem>
            </>
          )}
          {!contextTargetItem && triggerSpecs.length > 0 && triggerSpecs.length <= 6 && (
            <ContextMenuGroup>
              <ContextMenuLabel>Queue Triggers</ContextMenuLabel>
              {triggerSpecs.map((spec) => (
                <ContextMenuItem key={spec.id} onClick={() => openAddTrigger(spec.id)}>
                  {spec.icon ? <spec.icon size={14} /> : <Zap className="h-4 w-4" />}
                  {spec.label}
                </ContextMenuItem>
              ))}
            </ContextMenuGroup>
          )}
          {!contextTargetItem && triggerSpecs.length > 6 && (
            <ContextMenuGroup>
              <ContextMenuLabel>Queue Triggers</ContextMenuLabel>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Zap className="h-4 w-4" />
                  Add Queue Trigger
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {triggerSpecs.map((spec) => (
                    <ContextMenuItem key={spec.id} onClick={() => openAddTrigger(spec.id)}>
                      {spec.icon ? <spec.icon size={14} /> : <Zap className="h-4 w-4" />}
                      {spec.label}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            </ContextMenuGroup>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={!!triggerDialog} onOpenChange={(open) => !open && setTriggerDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogSpec?.label ?? 'Configure Trigger'}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            {ConfigComp && triggerDialog && (
              <ConfigComp
                value={triggerDialog.config}
                onChange={(config) => setTriggerDialog((d) => (d ? { ...d, config } : d))}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTriggerDialog(null)}>
              Cancel
            </Button>
            <Button onClick={saveTrigger}>
              {triggerDialog?.instanceId ? 'Save' : 'Add Trigger'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SortableQueueItem({
  item,
  isCurrent,
  index,
  onPlay,
  onContextMenu,
  formatDuration,
}: {
  item: QueueItem;
  isCurrent: boolean;
  index?: number;
  onPlay: (item: QueueItem) => void;
  onContextMenu: () => void;
  formatDuration: (s?: number) => string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(item.id),
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
    >
      <div
        {...attributes}
        {...listeners}
        onContextMenu={onContextMenu}
        onDoubleClick={() => onPlay(item)}
        className={cn(
          'flex items-center rounded-lg touch-none select-none',
          isCurrent
            ? 'border border-primary/40 bg-primary/5'
            : 'hover:bg-accent/50 transition-colors'
        )}
      >
        <div className="flex flex-1 items-center justify-between min-w-0 px-3 py-2">
          <div className="flex items-start gap-1 min-w-0">
            {!isCurrent && index !== undefined && (
              <span className="text-sm font-medium text-muted-foreground w-5 shrink-0 pt-0.5">
                {index + 1}
              </span>
            )}
            <div className="min-w-0">
              <div
                className={cn(
                  'font-semibold text-sm leading-tight line-clamp-1',
                  isCurrent ? 'text-primary' : 'text-foreground',
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
          <div className="text-xs text-muted-foreground font-medium shrink-0 ml-2">
            {formatDuration(item.file.duration)}
          </div>
        </div>
      </div>
    </div>
  );
}
