import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowLeft,
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DeleteFileAlert } from '@/components/delete-file-alert';
import { FileListItem } from '@/components/file-list-item';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAnnounce } from '@/hooks/use-announce';
import { cn } from '@/lib/utils';
import { type FileInfo, fileInitService, fileManagementService, type MediaType } from '@/services';
import { useLyricModalStore } from '@/stores/lyric-modal-store';
import { usePlayerStore } from '@/stores/player-store';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [isInitialized, setIsInitialized] = useState(false);
  const announce = useAnnounce();
  const parentRef = useRef<HTMLDivElement>(null);

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
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 10,
  });

  const loadFiles = useCallback(
    async (mediaType: MediaType) => {
      setIsLoading(true);
      setError(null);
      announce('Loading files...');

      try {
        const loadedFiles = await fileManagementService.listFiles(mediaType);
        setFiles(loadedFiles);
        announce(`Loaded ${loadedFiles.length} file${loadedFiles.length !== 1 ? 's' : ''}`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load files';
        setError(errorMessage);
        console.error('Error loading files:', err);
        toast.error('Failed to load files. Click retry to try again.');
        announce('Failed to load files');
      } finally {
        setIsLoading(false);
      }
    },
    [announce]
  );

  useEffect(() => {
    if (activeMedia && isInitialized) {
      loadFiles(activeMedia);
    }
  }, [activeMedia, isInitialized, loadFiles]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!activeMedia || files.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => (prev < files.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0) {
          console.log('File clicked:', files[focusedIndex].name);
        }
        break;
      case 'Delete':
        e.preventDefault();
        if (focusedIndex >= 0) {
          const fileToDelete = files[focusedIndex];
          handleDeleteFile(fileToDelete);
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
        loadFiles(activeMedia);
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
      loadFiles(activeMedia);
    }
  };

  const handleRefresh = async () => {
    if (!activeMedia) return;
    setIsLoading(true);
    try {
      const refreshed = await fileManagementService.refreshFiles(activeMedia);
      setFiles(refreshed);
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
    setActiveMedia(null);
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

      const uploadedFiles = await fileManagementService.uploadFiles(activeMedia, selectedPaths);

      await loadFiles(activeMedia);

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
              aria-label={
                activeMedia
                  ? `${'Search'} ${currentItem?.label.toLowerCase()} ${t('files')}`
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
                onClick={handleAddFiles}
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
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleBack}
                  className="shrink-0"
                  aria-label="Go back to media categories"
                >
                  <ArrowLeft className="size-5" aria-hidden="true" />
                </Button>
                <h2 className="font-semibold text-base" id="media-type-heading">
                  {currentItem.label}
                </h2>
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
                  aria-label="Loading files"
                >
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  <span className="sr-only">Loading files...</span>
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
              ) : files.length === 0 ? (
                <div className="flex items-center justify-center h-32" role="status">
                  <p className="text-muted-foreground">
                    {searchQuery ? t('No files match your search') : t('No files in this folder')}
                  </p>
                </div>
              ) : (
                <div
                  ref={parentRef}
                  className="h-full overflow-auto focus:outline-none"
                  onKeyDown={handleKeyDown}
                  tabIndex={0}
                  role="listbox"
                  aria-label={`${currentItem?.label || 'Files'} list`}
                >
                  <div
                    style={{
                      height: `${virtualizer.getTotalSize()}px`,
                      width: '100%',
                      position: 'relative',
                    }}
                  >
                    {virtualizer.getVirtualItems().map((virtualItem) => (
                      <div
                        key={virtualItem.key}
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
                          <FileListItem
                            file={files[virtualItem.index]}
                            mediaType={activeMedia}
                            isFocused={virtualItem.index === focusedIndex}
                            onClick={(file) => {
                              console.log('File clicked:', file.name);
                            }}
                            onDoubleClick={
                              activeMedia === 'audio' || activeMedia === 'video'
                                ? (file) => player.loadFile(file.path)
                                : activeMedia === 'lyrics'
                                  ? (file) => player.presentLyric(file.path)
                                  : undefined
                            }
                            onEdit={
                              activeMedia === 'lyrics'
                                ? (file) => openLyricModal(file.path)
                                : undefined
                            }
                            onPlayNext={activeMedia === 'video' ? playNext : undefined}
                            onAddToQueue={activeMedia === 'video' ? addToQueue : undefined}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
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
                  className="justify-start"
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
    </>
  );
}
