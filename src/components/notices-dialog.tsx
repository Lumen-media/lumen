import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useIsomorphicLayoutEffect, useResizeObserver } from 'usehooks-ts';
import { useLocalFonts } from '@/hooks/use-local-fonts';
import { useTranslation } from '@/lib/i18n';
import { getNoticesPath } from '@/services/app-paths';
import { lumenUrl } from '@/services/lumen-url';
import { type LyricData, lyricService } from '@/services/lyric-service';
import { useNoticesDialogStore } from '@/stores/notices-dialog-store';
import { usePlayerStore } from '@/stores/player-store';
import { useProfileStore } from '@/stores/profile-store';
import { LyricBackgroundModal, type LyricBackgroundModalRef } from './lyric-background-modal';
import { TextEditor, type TextEditorRef } from './text-editor';
import { Button } from './ui/button';
import { Card, CardContent, CardFooter, CardHeader } from './ui/card';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from './ui/combobox';
import { Dialog, DialogClose, DialogContent } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

type Slide = {
  id: number;
  content: string;
  lines: string[];
};

function parseSlides(markdown: string): Slide[] {
  const normalized = markdown.replace(/\r\n/g, '\n');
  if (!normalized.trim()) return [];
  return normalized.split(/\n{3,}/).reduce<Slide[]>((acc, text) => {
    const trimmed = text.trim();
    if (!trimmed) return acc;
    const lines = trimmed.split(/\n+/).filter(Boolean);
    acc.push({ id: acc.length + 1, content: trimmed, lines });
    return acc;
  }, []);
}

const VIRTUAL_W = 1920;
const VIRTUAL_H = 1080;
const AVAILABLE_H = VIRTUAL_H - VIRTUAL_W * 0.1;
const previewFontSizeCache = new WeakMap<readonly string[], number>();

function SlidePreview({
  slide,
  textAlign,
  selectedFont,
  fontSizeNum,
  globalBackground,
  profileBackground,
}: {
  slide: Slide;
  textAlign: React.CSSProperties['textAlign'];
  selectedFont: string;
  fontSizeNum: number;
  globalBackground?: string;
  profileBackground?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null!);
  const textRef = useRef<HTMLDivElement>(null);

  const { width: containerWidth = 0 } = useResizeObserver({ ref: containerRef });
  const scale = containerWidth / VIRTUAL_W;

  useIsomorphicLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;

    const cached = previewFontSizeCache.get(slide.lines);
    if (cached) {
      text.style.fontSize = `${cached}px`;
      return;
    }

    const id = requestAnimationFrame(() => {
      const hit = previewFontSizeCache.get(slide.lines);
      if (hit) {
        text.style.fontSize = `${hit}px`;
        return;
      }
      let lo = 1;
      let hi = fontSizeNum;

      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        text.style.fontSize = `${mid}px`;
        if (text.scrollHeight <= AVAILABLE_H) {
          lo = mid;
        } else {
          hi = mid;
        }
      }

      text.style.fontSize = `${lo}px`;
      let fitted = lo;
      if (text.scrollHeight > AVAILABLE_H) {
        fitted = Math.max(lo - 1, 1);
        text.style.fontSize = `${fitted}px`;
      }
      previewFontSizeCache.set(slide.lines, fitted);
    });
    return () => cancelAnimationFrame(id);
  }, [slide.lines, fontSizeNum]);

  const effectiveBg = globalBackground || profileBackground;
  const bgSrc = effectiveBg?.startsWith('#')
    ? effectiveBg
    : effectiveBg
      ? lumenUrl(effectiveBg, { w: 550 })
      : undefined;

  return (
    <div className="relative aspect-video bg-black rounded-lg border border-border/20 overflow-hidden">
      {bgSrc && (
        <img
          src={bgSrc}
          alt=""
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover"
          aria-hidden
        />
      )}
      <span className="absolute top-2 left-2 bg-primary text-primary-foreground text-xs font-bold rounded px-1.5 py-0.5 min-w-5 text-center z-10">
        {slide.id}
      </span>
      <div ref={containerRef} className="absolute inset-0">
        <div
          className="absolute top-1/2 left-1/2 flex items-center justify-center overflow-hidden pointer-events-none"
          style={{
            width: `${VIRTUAL_W}px`,
            height: `${VIRTUAL_H}px`,
            padding: '5%',
            transform: `translate(-50%, -50%) scale(${scale})`,
            opacity: scale > 0 ? 1 : 0,
          }}
        >
          <div
            ref={textRef}
            className="text-white uppercase leading-relaxed w-full font-semibold"
            style={{
              textAlign,
              fontFamily: selectedFont || undefined,
            }}
          >
            {slide.lines.map((line, i) => (
              <div key={`${slide.id}-${i}`}>{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const defaultValues = {
  font: '',
  fontSize: '48px',
  alignment: ['center'],
  markdown: '',
  globalBackground: '',
};

function buildLyricData(values: typeof defaultValues): LyricData {
  const slides = parseSlides(values.markdown);
  return {
    metadata: {
      name: '',
      author: '',
      notes: '',
      font: values.font,
      fontSize: values.fontSize,
      alignment: values.alignment[0] || 'center',
      globalBackground: values.globalBackground,
    },
    slides: slides.map((s) => ({
      lines: s.lines,
    })),
  };
}

export const NoticesDialog = () => {
  const { t } = useTranslation();
  const { isOpen, close } = useNoticesDialogStore();
  const { profiles, activeProfileId } = useProfileStore();
  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const profileBackground = activeProfile?.defaultBackground?.src ?? undefined;
  const editorRef = useRef<TextEditorRef | null>(null);
  const backgroundModalRef = useRef<LyricBackgroundModalRef>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const { fonts } = useLocalFonts();
  const loadedRef = useRef(false);

  const [font, setFont] = useState('');
  const [fontSize, setFontSize] = useState('48px');
  const [alignment, setAlignment] = useState(['center']);
  const [markdown, setMarkdown] = useState('');
  const [globalBackground, setGlobalBackground] = useState('');

  useEffect(() => {
    if (!isOpen) {
      loadedRef.current = false;
      return;
    }

    if (loadedRef.current) return;

    setLoading(true);
    lyricService
      .loadNotices()
      .then((data) => {
        loadedRef.current = true;
        setFont(data.metadata.font);
        setFontSize(data.metadata.fontSize);
        setAlignment([data.metadata.alignment || 'center']);
        setGlobalBackground(data.metadata.globalBackground);

        const html = data.slides
          .map((s) => s.lines.map((l) => `<p>${l}</p>`).join(''))
          .join('<p></p>');
        editorRef.current?.setMarkdown('');
        if (html) {
          editorRef.current?.editor?.commands.setContent(html);
        }
        const md = editorRef.current?.getMarkdown() ?? '';
        setMarkdown(md);
      })
      .catch((err) => {
        console.error('Failed to load notices:', err);
        toast.error(t('Failed to load notices'));
      })
      .finally(() => setLoading(false));
  }, [isOpen, t]);

  const fontOptions = fonts.map((f) => ({ label: f, value: f }));

  const persist = useCallback(
    () => lyricService.saveNotices(buildLyricData({ font, fontSize, alignment, markdown, globalBackground })),
    [font, fontSize, alignment, markdown, globalBackground]
  );

  useEffect(() => {
    if (!isOpen || !loadedRef.current) return;
    const id = setTimeout(() => {
      void persist();
    }, 600);
    return () => clearTimeout(id);
  }, [isOpen, persist]);

  const handlePresent = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await persist();
      const filePath = await getNoticesPath();
      await usePlayerStore.getState().presentLyric(filePath);
      close();
    } catch (err) {
      console.error(err);
      toast.error(t('Failed to start presentation'));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      if (loadedRef.current) {
        persist().catch(() => {});
      }
      close();
    }
  };

  const textAlign = (alignment[0] || 'center') as React.CSSProperties['textAlign'];
  const fontSizeNum = Number.parseFloat(fontSize) || 48;
  const slides = parseSlides(markdown);

  return (
    <>
      <LyricBackgroundModal ref={backgroundModalRef} />
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="w-full sm:max-w-[90dvw] h-full max-h-[80dvh] flex"
        >
          <Card className="flex-1 p-0 gap-0 overflow-hidden">
            <CardHeader className="p-4 flex-row items-center gap-7">
              <h4 className="uppercase">{t('Notices')}</h4>

              <Combobox value={font} onValueChange={(val) => setFont(val ?? '')}>
                <ComboboxInput
                  className="w-full max-w-44 h-8 bg-background dark:bg-background border-0"
                  placeholder="Font"
                />
                <ComboboxContent
                  className="w-72 max-w-[min(18rem,calc(100dvw-2rem))]"
                  align="center"
                >
                  <ComboboxList>
                    <ComboboxEmpty>{t('No font found.')}</ComboboxEmpty>
                    {fontOptions.map((item) => (
                      <ComboboxItem key={item.value} value={item.value}>
                        <span
                          className="min-w-0 flex-1 truncate"
                          style={{ fontFamily: item.value }}
                        >
                          {item.label}
                        </span>
                      </ComboboxItem>
                    ))}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>

              <Input
                className="max-w-24 h-8 bg-background border-0"
                placeholder={t('Font size')}
                value={fontSize}
                onChange={(e) => setFontSize(e.target.value)}
                onBlur={() => {
                  const trimmed = fontSize.trim();
                  if (trimmed && /^\d+(\.\d+)?$/.test(trimmed)) {
                    setFontSize(`${trimmed}px`);
                  }
                }}
              />

              <Button
                type="button"
                variant="ghost"
                className={globalBackground ? 'text-primary' : ''}
                onClick={() =>
                  backgroundModalRef.current?.open((bg) => setGlobalBackground(bg.src))
                }
              >
                {t('Global Background')}
              </Button>
            </CardHeader>
            <Separator />
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="size-full">
                {slides.length === 0 ? (
                  <div className="flex items-center justify-center h-full p-6">
                    <p className="text-muted-foreground text-sm">
                      {t('Start typing in the editor to preview slides')}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 p-6">
                    {slides.map((slide) => (
                      <SlidePreview
                        key={slide.id}
                        slide={slide}
                        textAlign={textAlign}
                        selectedFont={font}
                        fontSizeNum={fontSizeNum}
                        globalBackground={globalBackground || profileBackground}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="flex-1 max-w-1/5 overflow-hidden">
            <section className="flex flex-col gap-3">
              <Label className="uppercase text-xs">{t('Text Alignment')}</Label>
              <ToggleGroup
                value={alignment}
                onValueChange={(val) => setAlignment(val)}
                variant="secondary"
                spacing={4}
                className="gap-2 p-2 bg-background w-full justify-between"
              >
                <ToggleGroupItem
                  value="left"
                  aria-label="Toggle left"
                  className="flex-1 rounded-[4px]"
                >
                  <AlignLeft />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="center"
                  aria-label="Toggle center"
                  className="flex-1 rounded-[4px]"
                >
                  <AlignCenter />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="right"
                  aria-label="Toggle right"
                  className="flex-1 rounded-[4px]"
                >
                  <AlignRight />
                </ToggleGroupItem>
              </ToggleGroup>
            </section>

            <section className="flex flex-col flex-1 gap-3 min-h-0">
              <Label className="uppercase">{t('Lyrics Editor')}</Label>

              <ScrollArea className="flex-1 overflow-hidden bg-background rounded-xl pb-4">
                <TextEditor
                  ref={editorRef}
                  onChange={(md) => setMarkdown(md)}
                  debounce={300}
                  placeholder={t('Type your lyrics here...')}
                />
              </ScrollArea>

              <p className="opacity-60">{t('Double enter creates a new slide')}</p>
            </section>

            <CardFooter className="flex items-center gap-3 w-full px-0 mt-auto">
              <DialogClose
                className="flex-1 h-auto py-2"
                render={(props) => (
                  <Button {...props} variant="secondary">
                    {t('Cancel')}
                  </Button>
                )}
              />
              <Button
                className="flex-1 h-auto py-2"
                disabled={saving || loading}
                onClick={handlePresent}
              >
                {t('Present')}
              </Button>
            </CardFooter>
          </Card>
        </DialogContent>
      </Dialog>
    </>
  );
};
