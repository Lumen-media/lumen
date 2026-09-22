import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  FolderOpen,
  Headphones,
  Image as ImageIcon,
  Music,
  Plus,
  RefreshCw,
  Search,
  Video,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DeleteFileAlert } from '@/components/delete-file-alert';
import { DeleteFolderAlert } from '@/components/delete-folder-alert';
import { FileListItem } from '@/components/file-list-item';
import { FolderListItem } from '@/components/folder-list-item';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAnnounce } from '@/hooks/use-announce';
import { useTranslation } from '@/lib/i18n';
import { ensureMediaWindow } from '@/lib/present-window';
import { selectPresentationPreview } from '@/lib/presentation-preview';
import { cn } from '@/lib/utils';
import {
  type FileInfo,
  fileInitService,
  fileManagementService,
  type MediaFolder,
  type MediaType,
  mediaDbService,
} from '@/services';
import { useDeleteFolderStore } from '@/stores/delete-folder-store';
import { useLyricEditStore } from '@/stores/lyric-edit-store';
import { useLyricModalStore } from '@/stores/lyric-modal-store';
import { usePlayerStore } from '@/stores/player-store';
import { usePresentationStore } from '@/stores/presentation-store';
import { useQueueStore } from '@/stores/queue-store';
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group';

const mediaItems = [
  { id: 'lyrics' as MediaType, label: 'Lyrics', icon: Music },
  { id: 'video' as MediaType, label: 'Video', icon: Video },
  { id: 'text' as MediaType, label: 'Text', icon: FileText },
  { id: 'audio' as MediaType, label: 'Audio', icon: Headphones },
  { id: 'image' as MediaType, label: 'Image', icon: ImageIcon },
  { id: 'files' as MediaType, label: 'Files', icon: FolderOpen },
];

export function MediaPanel() {
  const { t } = useTranslation();
  const player = usePlayerStore();
  const { addToQueue, playNext } = useQueueStore();
  const openLyricModal = useLyricModalStore((s) => s.open);
  const [activeMedia, setActiveMedia] = useState<MediaType | null>(null);

  const openPresentation = useCallback(async (filePath: string) => {
    try {
      const win = await ensureMediaWindow();
      if (!win) return;

      usePresentationStore.getState().loadPresentation(filePath);
      await win.show();
      await win.setFullscreen(true);
    } catch (err) {
      console.error('Failed to open presentation:', err);
      toast.error('Failed to open presentation window');
    }
  }, []);

  const activatePresentation = useCallback((filePath: string) => {
    selectPresentationPreview(filePath);
  }, []);

  const handleFileDoubleClick = useCallback(
    (file: FileInfo) => {
      if (activeMedia === 'audio' || activeMedia === 'video') {
        player.loadFile(file.path);
      }
      if (activeMedia === 'lyrics') {
        player.presentLyric(file.path);
      }
      if (activeMedia === 'image') {
        player.presentImage(file.path);
      }
      const ext = file.extension?.toLowerCase() ?? '';
      const extWithDot = ext.startsWith('.') ? ext : `.${ext}`;
      const isPpt = extWithDot === '.ppt' || extWithDot === '.pptx';
      const isUnsupportedPres =
        extWithDot === '.odp' ||
        extWithDot === '.pptm' ||
        extWithDot === '.ppsx' ||
        extWithDot === '.potx' ||
        extWithDot === '.key';
      if (activeMedia === 'presentation' || (activeMedia === 'files' && isPpt)) {
        openPresentation(file.path);
      } else if (activeMedia === 'files' && isUnsupportedPres) {
        toast.error(t('Unsupported presentation format'));
      }
    },
    [activeMedia, player, openPresentation, t]
  );

  const handleFileEdit = useCallback(
    (file: FileInfo) => {
      if (activeMedia === 'lyrics') {
        openLyricModal(file.path);
      }
    },
    [activeMedia, openLyricModal]
  );

  const handlePlayNext = useCallback(
    (file: FileInfo) => {
      playNext(file);
    },
    [playNext]
  );

  const handleAddToQueue = useCallback(
    (file: FileInfo) => {
      addToQueue(file);
    },
    [addToQueue]
  );

  const handleFolderAddToQueue = useCallback(
    async (folder: MediaFolder) => {
      if (!activeMedia) return;
      try {
        const listing = await fileManagementService.listFolder(activeMedia, folder.folder);
        if (listing.files.length === 0) {
          toast.info('Folder has no files to queue');
          return;
        }
        for (const file of listing.files) {
          await addToQueue(file);
        }
        toast.success(`Added ${listing.files.length} file(s) to queue`);
      } catch (error) {
        console.error('Failed to add folder to queue:', error);
        toast.error('Failed to add folder to queue');
      }
    },
    [activeMedia, addToQueue]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [currentFolder, setCurrentFolder] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [isInitialized, setIsInitialized] = useState(false);
  const announce = useAnnounce();
  const parentRef = useRef<HTMLDivElement>(null);

  const searching = searchQuery.trim().length > 0;

  const items = useMemo(() => {
    if (searching) {
      return files.map((file) => ({ kind: 'file', key: `file:${file.path}`, file }) as const);
    }
    return [
      ...folders.map(
        (folder) => ({ kind: 'folder', key: `folder:${folder.folder}`, folder }) as const
      ),
      ...files.map((file) => ({ kind: 'file', key: `file:${file.path}`, file }) as const),
    ];
  }, [searching, folders, files]);

  const handleEnterFolder = useCallback((folder: MediaFolder) => {
    setSearchQuery('');
    setCurrentFolder(folder.folder);
    setFocusedIndex(-1);
  }, []);

  const handleFolderDeleted = useCallback((folder: MediaFolder) => {
    setFolders((prevFolders) => prevFolders.filter((f) => f.folder !== folder.folder));
    setFocusedIndex(-1);
  }, []);

  useEffect(() => {
    const initializeFolders = async () => {
      try {
        const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

        if (isTauri) {
          await fileInitService.initializeMediaFolders();
        }
        setIsInitialized(true);
      } catch (error) {
        console.error('Failed to initialize media folders:', error);
        toast.error('Failed to initialize media folders');
        setIsInitialized(true);
      }
    };

    initializeFolders();
  }, []);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height,
    getItemKey: (index) => items[index]?.key ?? index,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer]);

  const loadFiles = useCallback(async () => {
    if (!activeMedia) return;
    setIsLoading(true);
    setError(null);
    const query = searchQuery.trim();
    announce(query ? 'Searching...' : 'Loading files...');

    try {
      if (query) {
        const hits = await mediaDbService.searchFiles(activeMedia, query);
        setFiles(hits);
        setFolders([]);
        announce(`Found ${hits.length} result${hits.length !== 1 ? 's' : ''}`);
      } else {
        const listing = await fileManagementService.listFolder(activeMedia, currentFolder);
        setFolders(listing.folders);
        setFiles(listing.files);
        announce(`Loaded ${listing.files.length} file${listing.files.length !== 1 ? 's' : ''}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load files';
      setError(errorMessage);
      console.error('Error loading files:', err);
      toast.error('Failed to load files. Click retry to try again.');
      announce('Failed to load files');
    } finally {
      setIsLoading(false);
    }
  }, [activeMedia, currentFolder, searchQuery, announce]);

  useEffect(() => {
    if (activeMedia && isInitialized) {
      loadFiles();
    }
  }, [activeMedia, isInitialized, loadFiles]);

  useEffect(() => {
    const onFilesChanged = () => {
      if (activeMedia) {
        loadFiles();
      }
    };
    window.addEventListener('lumen:media-files-changed', onFilesChanged);
    return () => window.removeEventListener('lumen:media-files-changed', onFilesChanged);
  }, [activeMedia, loadFiles]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!activeMedia || items.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => (prev < items.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        handleBack();
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0) {
          const focused = items[focusedIndex];
          if (focused.kind === 'folder') {
            handleEnterFolder(focused.folder);
          }
        }
        break;
      case 'Delete':
        e.preventDefault();
        if (focusedIndex >= 0) {
          const focused = items[focusedIndex];
          if (focused.kind === 'folder') {
            useDeleteFolderStore.getState().openDeleteDialog(focused.folder);
          } else {
            handleDeleteFile(focused.file);
          }
        }
        break;
    }
  };

  const handleDeleteFile = async (file: FileInfo) => {
    try {
      const { remove } = await import('@tauri-apps/plugin-fs');
      await remove(file.path);
      toast.success(`${file.name} removed`);
      if (activeMedia) {
        loadFiles();
      }
    } catch (error) {
      console.error('Failed to delete file:', error);
      toast.error('Failed to delete file');
    }
  };

  const handleFileDeleted = (filePath: string) => {
    setFiles((prevFiles) => prevFiles.filter((file) => file.path !== filePath));
  };

  const handleRetry = () => {
    if (activeMedia) {
      loadFiles();
    }
  };

  const handleRefresh = async () => {
    if (!activeMedia) return;
    setIsLoading(true);
    try {
      const listing = await fileManagementService.refreshFolder(activeMedia, currentFolder);
      setFolders(listing.folders);
      setFiles(listing.files);
      toast.success('Folder synced', {
        id: 'sync',
      });
    } catch (err) {
      console.error('Failed to refresh folder:', err);
      toast.error('Failed to refresh folder', {
        id: 'sync-error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    if (searching) {
      setSearchQuery('');
      return;
    }
    if (currentFolder) {
      const segments = currentFolder.split('/');
      segments.pop();
      setCurrentFolder(segments.join('/'));
      setFocusedIndex(-1);
      return;
    }
    setActiveMedia(null);
    setCurrentFolder('');
    setFocusedIndex(-1);
  };

  const handleAddFiles = async () => {
    if (!activeMedia) return;

    try {
      const selectedPaths = await fileManagementService.openFilePicker(activeMedia);

      if (!selectedPaths || selectedPaths.length === 0) {
        return;
      }

      setIsLoading(true);
      announce(`Uploading ${selectedPaths.length} file${selectedPaths.length !== 1 ? 's' : ''}...`);

      const uploadedFiles = await fileManagementService.uploadFiles(
        activeMedia,
        selectedPaths,
        currentFolder
      );

      await loadFiles();

      const successMessage = `${uploadedFiles.length} file(s) added successfully`;
      toast.success(successMessage);
      announce(successMessage);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add files';
      setError(errorMessage);
      console.error('Error adding files:', err);
      toast.error(`Failed to add files: ${errorMessage}`);
      announce(`Failed to add files: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const currentItem = mediaItems.find((item) => item.id === activeMedia);

  const folderSegments = currentFolder ? currentFolder.split('/') : [];

  return (
    <>
      <Card
        className="w-full h-full p-4 flex flex-col gap-4"
        aria-label="Media file management panel"
      >
        <div className="flex items-center gap-2">
          <InputGroup>
            <InputGroupInput
              placeholder={
                activeMedia ? t(`Search ${currentItem?.label.toLowerCase()}...`) : t('Search...')
              }
              autoComplete={'off'}
              aria-label={
                activeMedia
                  ? `${t('Search')} ${currentItem?.label.toLowerCase()} ${t('files')}`
                  : t('Search files')
              }
              role="searchbox"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            {searchQuery && (
              <InputGroupAddon align="inline-end">
                {files.length} {t('results')}
              </InputGroupAddon>
            )}
          </InputGroup>

          {activeMedia && (
            <div className="flex gap-1 shrink-0">
              <Button
                size="icon"
                className="rounded-full"
                onClick={activeMedia === 'lyrics' ? () => openLyricModal() : handleAddFiles}
                aria-label={`Add files to ${currentItem?.label.toLowerCase()}`}
                disabled={isLoading}
              >
                <Plus className="size-5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>

        {activeMedia && currentItem ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleBack}
                  className="shrink-0"
                  aria-label={t('Go back')}
                >
                  <ArrowLeft className="size-5" aria-hidden="true" />
                </Button>
                <h2 id="media-type-heading" className="sr-only">
                  {currentItem.label}
                </h2>
                <nav
                  className="flex items-center gap-1 min-w-0 overflow-hidden text-sm"
                  aria-label={t('Folder path')}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setCurrentFolder('');
                      setFocusedIndex(-1);
                    }}
                    className="font-semibold whitespace-nowrap hover:underline"
                  >
                    {currentItem.label}
                  </button>
                  {folderSegments.map((segment, index) => {
                    const path = folderSegments.slice(0, index + 1).join('/');
                    const isCurrent = index === folderSegments.length - 1;
                    return (
                      <Fragment key={path}>
                        <ChevronRight
                          className="size-3.5 text-muted-foreground shrink-0"
                          aria-hidden="true"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setCurrentFolder(path);
                            setFocusedIndex(-1);
                          }}
                          className={cn(
                            'truncate max-w-44 whitespace-nowrap',
                            isCurrent ? 'font-semibold' : 'text-muted-foreground hover:underline'
                          )}
                        >
                          {segment}
                        </button>
                      </Fragment>
                    );
                  })}
                </nav>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="rounded-full"
                onClick={handleRefresh}
                aria-label={`Refresh ${currentItem.label.toLowerCase()} folder`}
                disabled={isLoading}
              >
                <RefreshCw
                  className={cn('size-4', isLoading && 'animate-spin')}
                  aria-hidden="true"
                />
              </Button>
            </div>

            <div
              className="flex-1 overflow-hidden"
              role="region"
              aria-labelledby="media-type-heading"
              aria-live="polite"
              aria-busy={isLoading}
            >
              {isLoading ? (
                <div
                  className="flex items-center justify-center h-32"
                  role="status"
                  aria-label={t('Loading files...')}
                >
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  <span className="sr-only">{t('Loading files...')}</span>
                </div>
              ) : error ? (
                <div
                  className="flex flex-col items-center justify-center h-32 gap-3"
                  role="alert"
                  aria-live="assertive"
                >
                  <p className="text-destructive text-center">{error}</p>
                  <Button
                    onClick={handleRetry}
                    variant="outline"
                    size="sm"
                    aria-label="Retry loading files"
                  >
                    {t('Retry')}
                  </Button>
                </div>
              ) : folders.length === 0 && files.length === 0 ? (
                <div className="flex items-center justify-center h-32" role="status">
                  <p className="text-muted-foreground">
                    {searchQuery ? t('No files match your search') : t('No files in this folder')}
                  </p>
                </div>
              ) : (
                <ScrollArea
                  ref={parentRef}
                  className="h-full"
                  viewportProps={{
                    onKeyDown: handleKeyDown,
                    tabIndex: 0,
                    role: 'listbox',
                    'aria-label': `${currentItem?.label || 'Files'} list`,
                  }}
                >
                  <div
                    style={{
                      height: `${virtualizer.getTotalSize()}px`,
                      width: '100%',
                      position: 'relative',
                    }}
                  >
                    {virtualizer.getVirtualItems().map((virtualItem) => {
                      const item = items[virtualItem.index];
                      return (
                        <div
                          key={virtualItem.key}
                          ref={virtualizer.measureElement}
                          data-index={virtualItem.index}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${virtualItem.start}px)`,
                          }}
                        >
                          <div className="px-2 py-1">
                            {item.kind === 'folder' ? (
                              <FolderListItem
                                folder={item.folder}
                                isFocused={virtualItem.index === focusedIndex}
                                onClick={handleEnterFolder}
                                onAddToQueue={handleFolderAddToQueue}
                              />
                            ) : (
                              <FileListItem
                                file={item.file}
                                mediaType={activeMedia}
                                isFocused={virtualItem.index === focusedIndex}
                                onClick={(file) => {
                                  if (activeMedia === 'lyrics') {
                                    useLyricEditStore.getState().loadLyric(file.path);
                                  }

                                  const ext = file.extension?.toLowerCase() ?? '';
                                  const extWithDot = ext.startsWith('.') ? ext : `.${ext}`;
                                  const isPpt = extWithDot === '.ppt' || extWithDot === '.pptx';
                                  if (
                                    activeMedia === 'presentation' ||
                                    (activeMedia === 'files' && isPpt)
                                  ) {
                                    activatePresentation(file.path);
                                  }
                                }}
                                onDoubleClick={handleFileDoubleClick}
                                onEdit={activeMedia === 'lyrics' ? handleFileEdit : undefined}
                                onPlayNext={handlePlayNext}
                                onAddToQueue={handleAddToQueue}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          </>
        ) : (
          <nav className="flex flex-col gap-1" aria-label="Media categories">
            {mediaItems.map((item) => {
              const Icon = item.icon;

              return (
                <Button
                  key={item.id}
                  onClick={() => setActiveMedia(item.id)}
                  className="justify-start p-5 px-3"
                  type="button"
                  variant="ghost"
                  aria-label={`Open ${item.label} category`}
                >
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  <span className="font-medium">{item.label}</span>
                </Button>
              );
            })}
          </nav>
        )}
      </Card>
      <DeleteFileAlert onDelete={handleFileDeleted} />
      <DeleteFolderAlert mediaType={activeMedia} onDelete={handleFolderDeleted} />
    </>
  );
}
