import { join } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, readFile, stat, writeFile } from '@tauri-apps/plugin-fs';
import { t } from 'i18next';
import { CheckIcon, DownloadIcon, Loader2, RefreshCw, SearchIcon, VideoIcon } from 'lucide-react';
import { type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getThemesPath } from '@/services/app-paths';
import { extractVideoThumbnail } from '@/services/get-video-tumb';
import { mediaDbService } from '@/services/media-db-service';
import type { FileInfo } from '@/services/types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from './ui/tabs';

type MediaTab = 'themes' | 'images' | 'video';

export interface SelectedBackground {
  type: 'theme' | 'image' | 'video';
  src: string;
  name: string;
}

export interface LyricBackgroundModalRef {
  open: (onSelect?: (bg: SelectedBackground) => void) => void;
}

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv']);
const IMAGE_EXTS = new Set(['.gif', '.jpg', '.jpeg', '.png', '.webp', '.svg']);

interface UnsplashItem {
  id: string;
  photo: string | null;
  name: string;
}

function unsplashUrl(photo: string, width: number, quality = 80) {
  return `https://images.unsplash.com/${photo}?w=${width}&q=${quality}&fit=crop`;
}

function unsplashDownloadUrl(photo: string) {
  return `https://images.unsplash.com/${photo}?q=100&fm=jpg&fit=max`;
}

const UNSPLASH_IMAGES: UnsplashItem[] = [
  { id: '1', photo: 'photo-1464822759023-fed622ff2c3b', name: 'Red mountains' },
  { id: '2', photo: 'photo-1500534314209-a25ddb2bd429', name: 'Forest lake' },
  { id: '4', photo: 'photo-1462331940025-496dfbfc7564', name: 'Galaxy' },
  { id: '5', photo: 'photo-1506905925346-21bda4d32df4', name: 'Snow mountains' },
  { id: '6', photo: 'photo-1519681393784-d120267933ba', name: 'Dark mountain' },
  { id: '7', photo: 'photo-1433086966358-54859d0ed716', name: 'Waterfall' },
  { id: '8', photo: 'photo-1773781556147-2106e3145777', name: 'Snowy mountain' },
  { id: '10', photo: 'photo-1419242902214-272b3f66ee7a', name: 'Milky Way' },
  { id: '11', photo: 'photo-1494500764479-0c8f2919a3d8', name: 'Mountain lake' },
];

interface MediaThumbnailProps {
  file: FileInfo;
  selected: boolean;
  onClick: () => void;
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
};

function MediaThumbnail({ file, selected, onClick }: MediaThumbnailProps) {
  const ext = file.extension.toLowerCase();
  const isVideo = VIDEO_EXTS.has(ext);
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);

  useEffect(() => {
    let blobUrl: string | null = null;

    readFile(file.path)
      .then((bytes) => {
        const mime = MIME[ext] ?? 'application/octet-stream';
        blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
        if (isVideo) {
          extractVideoThumbnail(blobUrl).then(setDisplaySrc);
        } else {
          setDisplaySrc(blobUrl);
        }
      })
      .catch(() => {});

    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [file.path, ext, isVideo]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative aspect-video rounded-lg overflow-hidden transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:opacity-90'
      )}
    >
      {displaySrc ? (
        <img src={displaySrc} alt={file.name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-muted flex items-center justify-center">
          {isVideo && <VideoIcon className="size-5 text-muted-foreground" />}
        </div>
      )}
      {selected && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="rounded-full bg-black/60 p-1.5">
            <CheckIcon className="size-4 text-white" />
          </div>
        </div>
      )}
    </button>
  );
}

function LoadingGrid() {
  return (
    <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-32 my-auto gap-1 text-sm text-muted-foreground">
      <p>{message}</p>
      {hint && <p className="text-xs opacity-60">{hint}</p>}
    </div>
  );
}

export function LyricBackgroundModal({ ref }: { ref?: Ref<LyricBackgroundModalRef> }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<MediaTab>('themes');
  const [selected, setSelected] = useState<SelectedBackground | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [themes, setThemes] = useState<FileInfo[]>([]);
  const [videos, setVideos] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const onSelectRef = useRef<((bg: SelectedBackground) => void) | undefined>(undefined);

  useImperativeHandle(ref, () => ({
    open(onSelect?: (bg: SelectedBackground) => void) {
      onSelectRef.current = onSelect;
      setSelected(null);
      setSearchQuery('');
      setActiveTab('themes');
      setOpen(true);
    },
  }));

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [themeList, videoList] = await Promise.all([
        mediaDbService.listThemes(),
        mediaDbService.listFiles('video'),
      ]);
      setThemes(themeList);
      setVideos(videoList);
    } catch {
      setThemes([]);
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const syncThemes = useCallback(async () => {
    setLoading(true);
    try {
      const themesPath = await getThemesPath();
      if (!(await exists(themesPath))) await mkdir(themesPath, { recursive: true });

      const entries = await readDir(themesPath);
      const fsFiles: FileInfo[] = [];
      for (const entry of entries) {
        if (!entry.isFile) continue;
        const dotIdx = entry.name.lastIndexOf('.');
        const ext = dotIdx > 0 ? entry.name.substring(dotIdx) : '';
        if (!VIDEO_EXTS.has(ext.toLowerCase()) && !IMAGE_EXTS.has(ext.toLowerCase())) continue;
        const fullPath = await join(themesPath, entry.name);
        const meta = await stat(fullPath);
        fsFiles.push({
          name: entry.name,
          path: fullPath,
          size: meta.size,
          modifiedAt: meta.mtime ?? new Date(),
          extension: ext,
        });
      }

      await mediaDbService.syncThemes(fsFiles);
      setThemes(await mediaDbService.listThemes());
    } catch {
      setThemes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    loadAll();
  }, [open, loadAll]);

  const handleDownload = async (item: UnsplashItem) => {
    if (!item.photo || downloading.has(item.id)) return;
    setDownloading((prev) => new Set(prev).add(item.id));
    try {
      const url = unsplashDownloadUrl(item.photo);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      const themesPath = await getThemesPath();
      if (!(await exists(themesPath))) await mkdir(themesPath, { recursive: true });
      const fileName = `${item.name.toLowerCase().replace(/\s+/g, '-')}.jpg`;
      const filePath = await join(themesPath, fileName);
      await writeFile(filePath, new Uint8Array(buffer));
      const meta = await stat(filePath);
      await mediaDbService.insertTheme({
        name: fileName,
        path: filePath,
        size: meta.size,
        modifiedAt: meta.mtime ?? new Date(),
        extension: '.jpg',
      });
      setThemes(await mediaDbService.listThemes());
      toast.success(t('Image saved to themes folder.'));
      setActiveTab('themes');
    } catch (err) {
      console.error(err);
      toast.error(t('Failed to download image.'));
    } finally {
      setDownloading((prev) => {
        const s = new Set(prev);
        s.delete(item.id);
        return s;
      });
    }
  };

  const handleConfirm = () => {
    if (selected) onSelectRef.current?.(selected);
    setOpen(false);
  };

  const filteredImages = searchQuery
    ? UNSPLASH_IMAGES.filter((img) => img.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : UNSPLASH_IMAGES;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[56.25rem] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-0">
          <DialogTitle className="text-base font-semibold">Select Media</DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value as MediaTab);
            setSelected(null);
          }}
          orientation="vertical"
        >
          <div className="flex w-full justify-between relative border-b border-border/50">
            <TabsList
              variant="line"
              className="w-fit justify-start px-6 rounded-none h-auto py-0 gap-4"
            >
              <TabsTrigger value="themes" className="pb-3 px-0 after:hidden">
                Themes
              </TabsTrigger>
              <TabsTrigger value="images" className="pb-3 px-0 after:hidden">
                Images
              </TabsTrigger>
              <TabsTrigger value="video" className="pb-3 px-0 after:hidden">
                Video
              </TabsTrigger>
              <TabsIndicator className="bg-primary" />
            </TabsList>

            <Button
              variant="ghost"
              size="sm"
              className={cn('h-7 gap-1.5 text-xs mr-5', {
                hidden: activeTab !== 'themes',
              })}
              onClick={syncThemes}
              disabled={loading}
            >
              <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />
              Sync folder
            </Button>
          </div>

          <TabsContent value="themes" className="px-6 py-4 flex flex-col gap-3">
            <ScrollArea className="min-h-[25rem] h-[40dvh]" viewportClassName="flex flex-col">
              {loading ? (
                <LoadingGrid />
              ) : themes.length === 0 ? (
                <EmptyState
                  message={t("No themes found in the 'files/themes' folder.")}
                  hint={t('Add GIFs or videos to the files/themes folder.')}
                />
              ) : (
                <div className="grid grid-cols-4 gap-3 pr-1 pt-1">
                  {themes.map((file) => (
                    <MediaThumbnail
                      key={file.path}
                      file={file}
                      selected={selected?.src === file.path}
                      onClick={() =>
                        setSelected({ type: 'theme', src: file.path, name: file.name })
                      }
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="images" className="px-6 py-4 flex flex-col gap-4">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search Unsplash..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <ScrollArea className="min-h-[22rem] h-[34dvh]">
              <div
                className={cn('grid grid-cols-4 gap-3 pr-1 mt-1', {
                  'px-2.5': filteredImages.length > 8,
                })}
              >
                {filteredImages.map((item) => {
                  const fullSrc = item.photo ? unsplashUrl(item.photo, 3840, 100) : null;
                  const thumbSrc = item.photo ? unsplashUrl(item.photo, 400) : null;
                  const selectedSrc = fullSrc ?? '#000000';
                  const isSelected = selected?.src === selectedSrc;
                  const isDownloading = downloading.has(item.id);
                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        setSelected({ type: 'image', src: selectedSrc, name: item.name })
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ')
                          setSelected({ type: 'image', src: selectedSrc, name: item.name });
                      }}
                      className={cn(
                        'relative aspect-video rounded-lg overflow-hidden transition-all focus-visible:outline-none cursor-pointer',
                        isSelected
                          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                          : 'hover:opacity-90'
                      )}
                    >
                      {thumbSrc ? (
                        <img
                          src={thumbSrc}
                          alt={item.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-black" />
                      )}
                      {isSelected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <div className="rounded-full bg-black/60 p-1.5">
                            <CheckIcon className="size-4 text-white" />
                          </div>
                        </div>
                      )}
                      {item.photo && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(item);
                          }}
                          disabled={isDownloading}
                          className="absolute bottom-1.5 right-1.5 p-1 rounded bg-black/50 hover:bg-black/70 transition-colors"
                          title={t('Save to themes')}
                        >
                          {isDownloading ? (
                            <Loader2 className="size-3 text-white animate-spin" />
                          ) : (
                            <DownloadIcon className="size-3 text-white" />
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="video" className="px-6 py-4">
            <ScrollArea className="min-h-[25rem] h-[40dvh]">
              {loading ? (
                <LoadingGrid />
              ) : videos.length === 0 ? (
                <EmptyState
                  message="Nenhum vídeo encontrado."
                  hint="Faça upload de vídeos para usá-los como fundo."
                />
              ) : (
                <div className="grid grid-cols-4 gap-3 pr-1 pt-1">
                  {videos.map((file) => (
                    <MediaThumbnail
                      key={file.path}
                      file={file}
                      selected={selected?.src === file.path}
                      onClick={() =>
                        setSelected({ type: 'video', src: file.path, name: file.name })
                      }
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border/50">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button className="font-semibold" disabled={!selected} onClick={handleConfirm}>
            Set Background
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
