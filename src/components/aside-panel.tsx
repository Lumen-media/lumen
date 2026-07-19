import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
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
  CheckIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  ListX,
  Loader2,
  QuoteIcon,
  StrikethroughIcon,
  Tag,
  UnderlineIcon,
  X,
  Zap,
} from 'lucide-react';
import * as React from 'react';
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useModuleStore } from '@/modules/store';
import type { QueueTriggerSpec } from '@/modules/types';
import { mediaDbService } from '@/services/media-db-service';
import { notesService } from '@/services/notes-service';
import { thumbnailService } from '@/services/thumbnail-service';
import type { FileInfo } from '@/services/types';
import { usePlayerStore } from '@/stores/player-store';
import { useProfileStore } from '@/stores/profile-store';
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
  { value: 'queue', label: t('Queue') },
  { value: 'notes', label: t('Notes') },
  { value: 'themes', label: t('Themes') },
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

  useEffect(() => {
    loadFromDb();
  }, [loadFromDb]);

  return (
    <Card className="flex flex-col w-full h-full overflow-hidden">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
        className="flex flex-col h-full"
      >
        <div className="relative border-b border-border shrink-0">
          <TabsList
            variant="line"
            className="w-full justify-between rounded-none border-none px-2 h-10"
          >
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="flex-none px-4 after:hidden"
              >
                {tab.label}
              </TabsTrigger>
            ))}
            <TabsIndicator className="bg-primary" />
          </TabsList>
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

        <TabsContent value="notes" className="flex-1 mt-0">
          <NotesTab />
        </TabsContent>

        <TabsContent value="themes" className="flex-1 overflow-hidden mt-0">
          <ThemesTab />
        </TabsContent>
      </Tabs>
    </Card>
  );
}

function formatDuration(seconds?: number) {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
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
  const dropTargetIndex = useQueueEntriesStore((s) => s.dropTargetIndex);
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

  const { setNodeRef: setQueueDropRef } = useDroppable({ id: 'queue-drop-zone' });

  if (queue.length === 0) {
    return (
      <ContextMenu
        onOpenChange={(open) => {
          if (!open) setContextTargetItem(null);
        }}
      >
        <ContextMenuTrigger className="flex flex-col h-full flex-1 min-h-0">
          <div
            ref={setQueueDropRef}
            data-queue-container
            className={cn(
              'flex-1 min-h-0 text-sm text-muted-foreground',
              dropTargetIndex === null && 'flex items-center justify-center'
            )}
          >
            {dropTargetIndex !== null ? (
              <div className="py-3 space-y-1">
                <DropIndicator />
              </div>
            ) : (
              t('Queue is empty')
            )}
          </div>
        </ContextMenuTrigger>
      </ContextMenu>
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
          <div ref={setQueueDropRef} className="flex-1 min-h-0">
            <ScrollArea className="h-full">
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
                  <div className="py-3 space-y-1" data-queue-container>
                    {(() => {
                      let dropEntryIndex: number | null = null;
                      if (dropTargetIndex !== null) {
                        let seenItems = 0;
                        for (let i = 0; i < entries.length; i++) {
                          if (entries[i].kind === 'item') {
                            if (seenItems === dropTargetIndex) {
                              dropEntryIndex = i;
                              break;
                            }
                            seenItems++;
                          }
                        }
                        if (dropEntryIndex === null && seenItems === dropTargetIndex) {
                          dropEntryIndex = entries.length;
                        }
                      }
                      return (
                        <>
                          {entries.map((entry, idx) => (
                            <React.Fragment key={entry.id}>
                              {dropEntryIndex === idx && <DropIndicator />}
                              {entry.kind === 'item' ? (
                                <SortableQueueItem
                                  sortableId={entry.id}
                                  item={entry.item}
                                  isCurrent={entry.item.file.path === currentFilePath}
                                  index={itemPositions.get(entry.id) ?? 0}
                                  onPlay={onPlay}
                                  onContextMenu={() => setContextTargetItem(entry.item)}
                                  formatDuration={formatDuration}
                                />
                              ) : (() => {
                                const spec = triggerSpecs.find((s) => s.id === entry.inst.triggerId);
                                if (!spec) return null;
                                return (
                                  <SortableTriggerItem
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
                              })()}
                            </React.Fragment>
                          ))}
                          {dropEntryIndex === entries.length && <DropIndicator />}
                        </>
                      );
                    })()}
                  </div>
                </SortableContext>
              </DndContext>
            </ScrollArea>
          </div>

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
      data-queue-entry
      data-queue-item
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
            : 'hover:bg-accent/70 transition-colors'
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

  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const [defaultValue, setDefaultValue] = useState('');

  useEffect(() => {
    if (!activeProfileId) return;
    notesService.loadNotes(activeProfileId).then((content) => {
      setDefaultValue(content);
      editorRef.current?.setMarkdown(content);
    });
  }, [activeProfileId]);

  const handleChange = useCallback(
    (md: string) => {
      if (!activeProfileId) return;
      notesService.saveNotes(activeProfileId, md);
    },
    [activeProfileId]
  );

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
      <TextEditor
        ref={editorRef}
        defaultValue={defaultValue}
        onChange={handleChange}
        debounce={500}
        placeholder={t('Write your notes here...')}
      >
        <TextEditorBubbleMenu editorRef={editorRef} items={items} />
      </TextEditor>
    </div>
  );
}

function ThemesTab() {
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const updateProfile = useProfileStore((s) => s.updateProfile);
  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  const [themes, setThemes] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    mediaDbService
      .listThemes()
      .then(setThemes)
      .catch(() => setThemes([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="size-full overflow-hidden">
      {loading ? (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="size-5 text-muted-foreground animate-spin" />
        </div>
      ) : themes.length === 0 ? (
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ImageIcon />
            </EmptyMedia>
            <EmptyTitle>{t('No themes yet')}</EmptyTitle>
            <EmptyDescription>
              {t('Add images or videos to the themes folder in settings.')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="h-full">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2 p-3">
            {themes.map((file) => (
              <ThemeThumbnail
                key={file.path}
                file={file}
                isActive={activeProfile?.defaultBackground?.src === file.path}
                onClick={() => {
                  if (activeProfileId) {
                    updateProfile(activeProfileId, {
                      defaultBackground: { type: 'theme', src: file.path, name: file.name },
                    });
                  }
                }}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function ThemeThumbnail({
  file,
  isActive,
  onClick,
}: {
  file: FileInfo;
  isActive: boolean;
  onClick: () => void;
}) {
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    thumbnailService
      .getThumbnail(file.path)
      .then((url) => {
        if (!cancelled) setDisplaySrc(url);
      })
      .catch(() => { });
    return () => {
      cancelled = true;
    };
  }, [file.path]);

  return (
    <button
      type="button"
      tabIndex={0}
      onClick={onClick}
      className={cn(
        'relative group aspect-video rounded-lg overflow-hidden transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer',
        isActive ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:opacity-90'
      )}
    >
      {displaySrc ? (
        <img src={displaySrc} alt={file.name} className="size-full object-cover" />
      ) : (
        <div className="size-full bg-card animate-pulse opacity-70 flex items-center justify-center">
          <Loader2 className="size-4 text-muted-foreground animate-spin" />
        </div>
      )}
      {isActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
          <div className="rounded-full bg-black/60 p-1.5">
            <CheckIcon className="size-4 text-white" />
          </div>
        </div>
      )}
    </button>
  );
}

function DropIndicator() {
  const dragFileInfo = useQueueEntriesStore((s) => s.dragFileInfo);
  const dropIndex = useQueueEntriesStore((s) => s.dropTargetIndex);
  if (!dragFileInfo) return null;
  return (
    <div className="flex items-center rounded-lg mx-3 px-3 py-2 border-2 border-dashed border-primary/20 opacity-70">
      <div className="flex flex-1 items-center justify-between min-w-0">
        <div className="flex items-start gap-1 min-w-0">
          <span className="text-sm font-medium text-muted-foreground w-5 shrink-0 pt-0.5 opacity-50">
            #
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-sm leading-tight line-clamp-1 text-foreground/50">
              {dragFileInfo.title || dragFileInfo.name}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground/50">
              <span className="truncate">
                {dragFileInfo.artist || dragFileInfo.name.split('.').pop()?.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {dragFileInfo.duration ? (
            <div className="text-xs text-muted-foreground/50 font-medium">
              {formatDuration(dragFileInfo.duration)}
            </div>
          ) : null}
          <div className="text-[10px] font-mono text-primary/40 bg-primary/6 px-1 rounded">
            {dropIndex}
          </div>
        </div>
      </div>
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
      data-queue-entry
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
