import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  BoldIcon,
  CheckCircle2,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  ListX,
  QuoteIcon,
  StrikethroughIcon,
  Tag,
  UnderlineIcon,
  X,
  Zap,
} from 'lucide-react';
import type React from 'react';
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { TextEditor, type TextEditorRef } from '@/components/text-editor';
import { type BubbleMenuItem, TextEditorBubbleMenu } from '@/components/text-editor-bubble-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
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
import type { QueueTriggerSpec } from '@/modules/types';
import { usePlayerStore } from '@/stores/player-store';
import {
  type ListEntry,
  type TriggerInstance,
  useQueueEntriesStore,
} from '@/stores/queue-entries-store';
import { type QueueItem, useQueueStore } from '@/stores/queue-store';

type TriggerDialog = {
  triggerId: string;
  config: unknown;
  instanceId: string | null;
} | null;

type TabValue = 'queue' | 'notes' | 'themes';

function getDownloadStatusLabel(item: QueueItem): string | null {
  if (item.file.extension !== 'url' && !item.file.originalUrl) return null;
  switch (item.file.downloadStatus) {
    case 'downloaded':
      return 'Downloaded';
    case 'missing':
      return 'Missing download';
    default:
      return 'Not downloaded';
  }
}

const TABS: { value: TabValue; label: string }[] = [
  { value: 'queue', label: 'Queue' },
  { value: 'notes', label: 'Notes' },
  { value: 'themes', label: 'Themes' },
];

export function AsidePanel() {
  const {
    queue,
    removeFromQueue,
    markPlayed,
    togglePlayed,
    loadFromDb,
    clearQueue,
    shuffleQueue,
    reorderQueue,
  } = useQueueStore();
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
          <NotesTab />
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

  const entries = useQueueEntriesStore((s) => s.entries);
  const { syncQueue, setEntries } = useQueueEntriesStore.getState();

  const [triggerDialog, setTriggerDialog] = useState<TriggerDialog>(null);
  const [contextTargetItem, setContextTargetItem] = useState<QueueItem | null>(null);

  useEffect(() => {
    syncQueue(queue);
  }, [queue, syncQueue]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = entries.findIndex((e) => e.id === String(active.id));
    const newIdx = entries.findIndex((e) => e.id === String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    const next = arrayMove(entries, oldIdx, newIdx);
    setEntries(next);
    const orderedQueueIds = next
      .filter((e): e is Extract<ListEntry, { kind: 'item' }> => e.kind === 'item')
      .map((e) => e.item.id);
    onReorder(orderedQueueIds);
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
    if (instanceId) {
      setEntries(
        entries.map((e) =>
          e.kind === 'trigger' && e.id === instanceId ? { ...e, inst: { ...e.inst, config } } : e
        )
      );
    } else {
      const newInst: TriggerInstance = {
        id: crypto.randomUUID(),
        triggerId,
        config,
        showLabel: false,
      };
      setEntries([...entries, { kind: 'trigger', id: newInst.id, inst: newInst }]);
    }
    setTriggerDialog(null);
  }

  function removeTriggerInstance(entryId: string) {
    setEntries(entries.filter((e) => e.id !== entryId));
  }

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const dialogSpec = triggerDialog
    ? triggerSpecs.find((s) => s.id === triggerDialog.triggerId)
    : null;
  const ConfigComp = dialogSpec?.ConfigComponent as
    | React.ComponentType<{ value: unknown; onChange: (v: unknown) => void }>
    | undefined;

  const itemPositions = new Map<string, number>();
  let pos = 0;
  for (const entry of entries) {
    if (entry.kind === 'item') itemPositions.set(entry.id, pos++);
  }

  if (queue.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Queue is empty
      </div>
    );
  }

  return (
    <>
      <ContextMenu
        onOpenChange={(open) => {
          if (!open) setContextTargetItem(null);
        }}
      >
        <ContextMenuTrigger className="flex flex-col h-full flex-1 min-h-0">
          <ScrollArea className="flex-1">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            >
              <SortableContext
                items={entries.map((e) => e.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="px-4 py-3 space-y-1">
                  {entries.map((entry) => {
                    if (entry.kind === 'item') {
                      const isCurrent = entry.item.file.path === currentFilePath;
                      return (
                        <SortableQueueItem
                          key={entry.id}
                          sortableId={entry.id}
                          item={entry.item}
                          isCurrent={isCurrent}
                          index={itemPositions.get(entry.id) ?? 0}
                          onPlay={onPlay}
                          onContextMenu={() => setContextTargetItem(entry.item)}
                          formatDuration={formatDuration}
                        />
                      );
                    }
                    const spec = triggerSpecs.find((s) => s.id === entry.inst.triggerId);
                    if (!spec) return null;
                    return (
                      <SortableTriggerItem
                        key={entry.id}
                        inst={entry.inst}
                        spec={spec}
                        onEdit={() => openEditTrigger(entry.inst)}
                        onRemove={() => removeTriggerInstance(entry.id)}
                        onToggleLabel={() =>
                          setEntries(
                            entries.map((e) =>
                              e.id === entry.id && e.kind === 'trigger'
                                ? { ...e, inst: { ...e.inst, showLabel: !e.inst.showLabel } }
                                : e
                            )
                          )
                        }
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
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
  sortableId,
  item,
  isCurrent,
  index,
  onPlay,
  onContextMenu,
  formatDuration,
}: {
  sortableId: string;
  item: QueueItem;
  isCurrent: boolean;
  index?: number;
  onPlay: (item: QueueItem) => void;
  onContextMenu: () => void;
  formatDuration: (s?: number) => string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
  });
  const downloadStatus = getDownloadStatusLabel(item);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <div
        {...attributes}
        {...listeners}
        onContextMenu={onContextMenu}
        onDoubleClick={() => onPlay(item)}
        role="button"
        tabIndex={0}
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
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                {item.file.originalUrl && (
                  <Badge variant="secondary" className="h-4 rounded px-1.5 text-[10px]">
                    YouTube
                  </Badge>
                )}
                {downloadStatus && (
                  <Badge variant="outline" className="h-4 rounded px-1.5 text-[10px]">
                    {downloadStatus}
                  </Badge>
                )}
                <span className="truncate">
                  {item.file.artist || item.file.name.split('.').pop()?.toUpperCase()}
                </span>
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

function useEditorState(editorRef: RefObject<TextEditorRef | null>) {
  const subscribe = useCallback(
    (callback: () => void) => {
      const editor = editorRef.current?.editor;
      if (!editor) return () => { };
      editor.on('transaction', callback);
      editor.on('selectionUpdate', callback);
      return () => {
        editor.off('transaction', callback);
        editor.off('selectionUpdate', callback);
      };
    },
    [editorRef]
  );

  return useSyncExternalStore(
    subscribe,
    () => editorRef.current?.editor?.state ?? null,
    () => null
  );
}

function NotesTab() {
  const editorRef = useRef<TextEditorRef | null>(null);
  useEditorState(editorRef);
  const editor = editorRef.current?.editor;

  const items: BubbleMenuItem[] = [
    {
      children: <BoldIcon />,
      action: () => editor?.chain().focus().toggleBold().run(),
      active: editor?.isActive('bold'),
    },
    {
      children: <ItalicIcon />,
      action: () => editor?.chain().focus().toggleItalic().run(),
      active: editor?.isActive('italic'),
    },
    {
      children: <UnderlineIcon />,
      action: () => editor?.chain().focus().toggleUnderline().run(),
      active: editor?.isActive('underline'),
    },
    {
      children: <StrikethroughIcon />,
      action: () => editor?.chain().focus().toggleStrike().run(),
      active: editor?.isActive('strike'),
    },
    {
      children: <Heading1Icon />,
      action: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
      active: editor?.isActive('heading', { level: 1 }),
    },
    {
      children: <Heading2Icon />,
      action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor?.isActive('heading', { level: 2 }),
    },
    {
      children: <Heading3Icon />,
      action: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
      active: editor?.isActive('heading', { level: 3 }),
    },
    {
      children: <ListIcon />,
      action: () => editor?.chain().focus().toggleBulletList().run(),
      active: editor?.isActive('bulletList'),
    },
    {
      children: <ListOrderedIcon />,
      action: () => editor?.chain().focus().toggleOrderedList().run(),
      active: editor?.isActive('orderedList'),
    },
    {
      children: <QuoteIcon />,
      action: () => editor?.chain().focus().toggleBlockquote().run(),
      active: editor?.isActive('blockquote'),
    },
  ];

  return (
    <div className="relative size-full">
      <TextEditor ref={editorRef} placeholder="Write your notes here...">
        <TextEditorBubbleMenu editorRef={editorRef} items={items} />
      </TextEditor>
    </div>
  );
}

function SortableTriggerItem({
  inst,
  spec,
  onEdit,
  onRemove,
  onToggleLabel,
}: {
  inst: TriggerInstance;
  spec: QueueTriggerSpec;
  onEdit: () => void;
  onRemove: () => void;
  onToggleLabel: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: inst.id,
  });

  const SummaryComp = spec.SummaryComponent as
    | React.ComponentType<{ value: unknown; onEdit: () => void }>
    | undefined;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <div
        {...attributes}
        {...listeners}
        onDoubleClick={onEdit}
        role="button"
        tabIndex={0}
        className="flex items-center rounded-lg touch-none select-none border border-primary/40 bg-primary/5 hover:bg-primary/10 transition-colors"
      >
        <div className="flex flex-1 items-center justify-between min-w-0 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            {spec.icon ? (
              <spec.icon size={14} className="text-primary shrink-0" />
            ) : (
              <Zap size={14} className="text-primary shrink-0" />
            )}
            <div className="flex flex-col min-w-0">
              {inst.showLabel && (
                <span className="font-semibold text-sm text-primary leading-tight line-clamp-1">
                  {spec.label}
                </span>
              )}
              {SummaryComp && <SummaryComp value={inst.config} onEdit={onEdit} />}
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0 ml-2">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onToggleLabel}
              className={cn(
                'p-0.5 rounded bg-transparent border-none cursor-pointer text-primary transition-opacity',
                inst.showLabel ? 'opacity-70 hover:opacity-100' : 'opacity-25 hover:opacity-60'
              )}
            >
              <Tag size={11} />
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onRemove}
              className="p-0.5 rounded opacity-50 hover:opacity-100 text-primary bg-transparent border-none cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
