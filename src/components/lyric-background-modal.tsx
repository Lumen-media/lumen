import { useVirtualizer } from '@tanstack/react-virtual';
import { join } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, readFile, remove, stat, writeFile } from '@tauri-apps/plugin-fs';
import { t } from 'i18next';
import {
  CheckIcon,
  DownloadIcon,
  ImageIcon,
  Loader2,
  RefreshCw,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { useDebounceValue } from 'usehooks-ts';
import { cn } from '@/lib/utils';
import { getThemesPath } from '@/services/app-paths';
import { mediaDbService } from '@/services/media-db-service';
import type { FileInfo } from '@/services/types';
import { ImageLoader } from './image-loader';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty';
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

interface UnsplashPhoto {
  id: string;
  alt_description: string | null;
  urls: { raw: string; small: string };
}

interface UnsplashSearchResponse {
  total_pages: number;
  results: UnsplashPhoto[];
}

const UNSPLASH_CLIENT_ID = import.meta.env.VITE_UNSPLASH_CLIENT_ID as string;
const UNSPLASH_PER_PAGE = 20;

const DEFAULT_IMAGES: UnsplashPhoto[] = [
  {
    id: '1',
    alt_description: 'Red mountains',
    urls: {
      raw: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b',
      small: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&q=80&fit=crop',
    },
  },
  {
    id: '2',
    alt_description: 'Forest lake',
    urls: {
      raw: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429',
      small: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=400&q=80&fit=crop',
    },
  },
  {
    id: '4',
    alt_description: 'Galaxy',
    urls: {
      raw: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564',
      small: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=400&q=80&fit=crop',
    },
  },
  {
    id: '5',
    alt_description: 'Snow mountains',
    urls: {
      raw: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4',
      small: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=80&fit=crop',
    },
  },
  {
    id: '6',
    alt_description: 'Dark mountain',
    urls: {
      raw: 'https://images.unsplash.com/photo-1519681393784-d120267933ba',
      small: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=400&q=80&fit=crop',
    },
  },
  {
    id: '7',
    alt_description: 'Waterfall',
    urls: {
      raw: 'https://images.unsplash.com/photo-1433086966358-54859d0ed716',
      small: 'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=400&q=80&fit=crop',
    },
  },
  {
    id: '8',
    alt_description: 'Snowy mountain',
    urls: {
      raw: 'https://images.unsplash.com/photo-1773781556147-2106e3145777',
      small: 'https://images.unsplash.com/photo-1773781556147-2106e3145777?w=400&q=80&fit=crop',
    },
  },
  {
    id: '10',
    alt_description: 'Milky Way',
    urls: {
      raw: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a',
      small: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=400&q=80&fit=crop',
    },
  },
  {
    id: '11',
    alt_description: 'Mountain lake',
    urls: {
      raw: 'https://images.unsplash.com/photo-1494500764479-0c8f2919a3d8',
      small: 'https://images.unsplash.com/photo-1494500764479-0c8f2919a3d8?w=400&q=80&fit=crop',
    },
  },
];

interface MediaThumbnailProps {
  file: FileInfo;
  selected: boolean;
  onClick: () => void;
  onDelete?: () => void;
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

const THUMB_WIDTH = 400;
const MAX_CONCURRENT_THUMBS = 3;
let activeThumbs = 0;
const thumbQueue: Array<() => void> = [];

function acquireThumbSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const tryRun = () => {
      if (activeThumbs < MAX_CONCURRENT_THUMBS) {
        activeThumbs++;
        resolve(() => {
          activeThumbs--;
          thumbQueue.shift()?.();
        });
      } else {
        thumbQueue.push(tryRun);
      }
    };
    tryRun();
  });
}

function MediaThumbnail({ file, selected, onClick, onDelete }: MediaThumbnailProps) {
  const ext = file.extension.toLowerCase();
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);

  useEffect(() => {
    let thumbUrl: string | null = null;
    let cancelled = false;

    acquireThumbSlot().then(async (release) => {
      if (cancelled) {
        release();
        return;
      }
      try {
        const bytes = await readFile(file.path);
        if (cancelled) return;
        const mime = MIME[ext] ?? 'application/octet-stream';
        const blob = new Blob([bytes], { type: mime });
        const bmp = await createImageBitmap(blob, {
          resizeWidth: THUMB_WIDTH,
          resizeQuality: 'low',
        });
        if (cancelled) {
          bmp.close();
          return;
        }
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        const thumbBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.2 });
        thumbUrl = URL.createObjectURL(thumbBlob);
        if (!cancelled) setDisplaySrc(thumbUrl);
      } catch {
      } finally {
        release();
      }
    });

    return () => {
      cancelled = true;
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    };
  }, [file.path, ext]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      className={cn(
        'group relative aspect-video rounded-lg overflow-hidden transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer',
        selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:opacity-90'
      )}
    >
      {displaySrc ? (
        <img src={displaySrc} alt={file.name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-card animate-pulse opacity-70 flex items-center justify-center">
          <Loader2 className="size-4 text-muted-foreground animate-spin" />
        </div>
      )}
      {selected && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="rounded-full bg-black/60 p-1.5">
            <CheckIcon className="size-4 text-white" />
          </div>
        </div>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-1.5 right-1.5 p-1 rounded bg-black/50 hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100"
          title={t('Delete')}
        >
          <Trash2Icon className="size-3 text-white" />
        </button>
      )}
    </div>
  );
}

function UnsplashImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && <div className="absolute inset-0 bg-card/60 animate-pulse" />}
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        className="w-full h-full object-cover"
      />
    </>
  );
}

export function LyricBackgroundModal({ ref }: { ref?: Ref<LyricBackgroundModalRef> }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<MediaTab>('themes');
  const [selected, setSelected] = useState<SelectedBackground | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [themes, setThemes] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [unsplashResults, setUnsplashResults] = useState<UnsplashPhoto[]>([]);
  const [unsplashLoading, setUnsplashLoading] = useState(false);
  const [unsplashPage, setUnsplashPage] = useState(1);
  const [unsplashTotalPages, setUnsplashTotalPages] = useState(0);
  const onSelectRef = useRef<((bg: SelectedBackground) => void) | undefined>(undefined);
  const themesScrollRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    open(onSelect?: (bg: SelectedBackground) => void) {
      onSelectRef.current = onSelect;
      setSelected(null);
      setSearchQuery('');
      setActiveTab('themes');
      setOpen(true);
    },
  }));

  const loadThemes = useCallback(async () => {
    setLoading(true);
    try {
      setThemes(await mediaDbService.listThemes());
    } catch {
      setThemes([]);
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
    loadThemes();
  }, [open, loadThemes]);

  const COLS = 4;
  const GAP = 12;
  const themeRows = useMemo(() => {
    const rows: FileInfo[][] = [];
    for (let i = 0; i < themes.length; i += COLS) {
      rows.push(themes.slice(i, i + COLS));
    }
    return rows;
  }, [themes]);

  const themesVirtualizer = useVirtualizer({
    count: themeRows.length,
    getScrollElement: () => themesScrollRef.current,
    estimateSize: () => 130,
    gap: GAP,
  });

  const searchUnsplash = useCallback(async (query: string, page: number) => {
    setUnsplashLoading(true);
    try {
      const params = new URLSearchParams({
        query: query.trim(),
        page: String(page),
        per_page: String(UNSPLASH_PER_PAGE),
        client_id: UNSPLASH_CLIENT_ID,
      });
      const res = await fetch(`https://api.unsplash.com/search/photos?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: UnsplashSearchResponse = await res.json();
      setUnsplashResults((prev) => (page === 1 ? data.results : [...prev, ...data.results]));
      setUnsplashTotalPages(data.total_pages);
      setUnsplashPage(page);
    } catch (err) {
      console.error(err);
      toast.error(t('Failed to search Unsplash.'));
    } finally {
      setUnsplashLoading(false);
    }
  }, []);

  const [debouncedQuery] = useDebounceValue(searchQuery, 400);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setUnsplashResults([]);
      setUnsplashTotalPages(0);
      setUnsplashPage(1);
      return;
    }
    searchUnsplash(debouncedQuery, 1);
  }, [debouncedQuery, searchUnsplash]);

  const handleDownload = async (photo: UnsplashPhoto) => {
    if (downloading.has(photo.id)) return;
    setDownloading((prev) => new Set(prev).add(photo.id));
    try {
      const res = await fetch(photo.urls.raw);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      const themesPath = await getThemesPath();
      if (!(await exists(themesPath))) await mkdir(themesPath, { recursive: true });
      const label = (photo.alt_description ?? photo.id)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 60);
      const fileName = `${label}.jpg`;
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
        s.delete(photo.id);
        return s;
      });
    }
  };

  const handleDeleteTheme = async (file: FileInfo) => {
    try {
      await remove(file.path);
      await mediaDbService.deleteTheme(file.path);
      setThemes((prev) => prev.filter((f) => f.path !== file.path));
      if (selected?.src === file.path) setSelected(null);
      toast.success(t('Theme deleted.'));
    } catch (err) {
      console.error(err);
      toast.error(t('Failed to delete theme.'));
    }
  };

  const handleConfirm = () => {
    if (selected) onSelectRef.current?.(selected);
    setOpen(false);
  };

  const hasSearched = searchQuery.trim().length > 0;
  const displayedImages = hasSearched ? unsplashResults : DEFAULT_IMAGES;

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

          <TabsContent
            value="themes"
            className="px-6 py-4 flex flex-col gap-3 min-h-[25rem] h-[40dvh]"
          >
            {themes.length === 0 ? (
              <Empty className="min-h-[25rem] h-[40dvh]">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ImageIcon />
                  </EmptyMedia>
                  <EmptyTitle>{t('No themes yet')}</EmptyTitle>
                  <EmptyDescription>
                    {t('Add images or videos to the files/themes folder and sync.')}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ScrollArea
                ref={themesScrollRef}
                className="min-h-[25rem] h-[40dvh]"
                viewportClassName="pt-1 px-1.5"
              >
                <div
                  className="relative w-full"
                  style={{ height: themesVirtualizer.getTotalSize() }}
                >
                  {themesVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = themeRows[virtualRow.index];
                    return (
                      <div
                        key={virtualRow.index}
                        className="absolute left-0 right-0 grid grid-cols-4 gap-3 pr-1"
                        style={{
                          height: virtualRow.size,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        {row.map((file) => (
                          <MediaThumbnail
                            key={file.path}
                            file={file}
                            selected={selected?.src === file.path}
                            onClick={() =>
                              setSelected({ type: 'theme', src: file.path, name: file.name })
                            }
                            onDelete={() => handleDeleteTheme(file)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="images" className="px-6 py-4 flex flex-col gap-4">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder={t('Search Unsplash...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <ScrollArea className="min-h-[22rem] h-[34dvh]">
              {unsplashLoading && unsplashResults.length === 0 ? (
                <div className="flex items-center justify-center min-h-[20rem]">
                  <ImageLoader className="mx-auto" />
                </div>
              ) : hasSearched && unsplashResults.length === 0 ? (
                <Empty className="h-full min-h-[20rem]">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ImageIcon />
                    </EmptyMedia>
                    <EmptyTitle>{t('No results')}</EmptyTitle>
                    <EmptyDescription>{t('No images found for this search.')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-4 gap-3 pr-1 mt-1">
                    {displayedImages.map((photo) => {
                      const isSelected = selected?.src === photo.urls.raw;
                      const isDownloading = downloading.has(photo.id);
                      const label = photo.alt_description ?? photo.id;
                      return (
                        <div
                          key={photo.id}
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            setSelected({ type: 'image', src: photo.urls.raw, name: label })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ')
                              setSelected({ type: 'image', src: photo.urls.raw, name: label });
                          }}
                          className={cn(
                            'group relative aspect-video rounded-lg overflow-hidden transition-all focus-visible:outline-none cursor-pointer',
                            isSelected
                              ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                              : 'hover:opacity-90'
                          )}
                        >
                          <UnsplashImage src={photo.urls.small} alt={label} />
                          {isSelected && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                              <div className="rounded-full bg-black/60 p-1.5">
                                <CheckIcon className="size-4 text-white" />
                              </div>
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(photo);
                            }}
                            disabled={isDownloading}
                            className="absolute bottom-1.5 right-1.5 p-1 rounded bg-black/50 hover:bg-black/70 transition-colors opacity-0 group-hover:opacity-100"
                            title={t('Save to themes')}
                          >
                            {isDownloading ? (
                              <Loader2 className="size-3 text-white animate-spin" />
                            ) : (
                              <DownloadIcon className="size-3 text-white" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {unsplashPage < unsplashTotalPages &&
                    (unsplashLoading ? (
                      <ImageLoader className="mx-auto my-3" />
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="self-center"
                        onClick={() => searchUnsplash(searchQuery, unsplashPage + 1)}
                      >
                        {t('Load more')}
                      </Button>
                    ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* <TabsContent value="video" className="px-6 py-4">
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
          </TabsContent> */}
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
