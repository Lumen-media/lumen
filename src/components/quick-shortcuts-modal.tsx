import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowLeft,
  Image as ImageIcon,
  LayoutGrid,
  Music,
  Search,
  ShieldQuestion,
  Sparkles,
  Terminal,
  Video,
} from 'lucide-react';
import {
  type ComponentType,
  Fragment,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  normalize,
  search as runSearch,
  type SearchResult,
  type SearchResults,
  type SearchScope,
  type SearchSource,
} from '@/services/search-service';
import { type ActiveApp, useCommandStore } from '@/stores/command-store';
import { Dialog, DialogContent } from './ui/dialog';
import { Kbd } from './ui/kbd';
import { ScrollArea } from './ui/scroll-area';

interface SourceTheme {
  icon: ComponentType<{ className?: string }>;
  iconBox: string;
  badge: string;
}

const SOURCE_THEME: Record<SearchSource, SourceTheme> = {
  lyric: {
    icon: Music,
    iconBox: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  audio: {
    icon: Music,
    iconBox: 'bg-primary/10 text-primary border-primary/25',
    badge: 'bg-primary/15 text-primary border-primary/30',
  },
  video: {
    icon: Video,
    iconBox: 'bg-primary/10 text-primary border-primary/25',
    badge: 'bg-primary/15 text-primary border-primary/30',
  },
  image: {
    icon: ImageIcon,
    iconBox: 'bg-primary/10 text-primary border-primary/25',
    badge: 'bg-primary/15 text-primary border-primary/30',
  },
  command: {
    icon: Terminal,
    iconBox: 'bg-purple-500/10 text-purple-300 border-purple-500/25',
    badge: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  },
  app: {
    icon: Sparkles,
    iconBox: 'bg-purple-500/10 text-purple-300 border-purple-500/25',
    badge: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  },
};

const SCOPES: SearchScope[] = ['all', 'lyrics', 'media', 'commands'];

const SCOPE_ICON: Record<SearchScope, ComponentType<{ className?: string }>> = {
  all: LayoutGrid,
  lyrics: Music,
  media: Video,
  commands: Terminal,
};

function scopeLabel(scope: SearchScope, t: (k: string) => string): string {
  switch (scope) {
    case 'all':
      return t('All');
    case 'lyrics':
      return t('Lyrics');
    case 'media':
      return t('Media');
    case 'commands':
      return t('Commands');
  }
}

function countForScope(scope: SearchScope, results: SearchResults): number {
  switch (scope) {
    case 'all':
      return results.total;
    case 'lyrics':
      return results.lyrics.length;
    case 'media':
      return results.media.length;
    case 'commands':
      return results.commands.length;
  }
}

function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  if (tokens.length === 0 || !text) return <>{text}</>;
  const lower = normalize(text);
  const matches: Array<[number, number]> = [];

  for (const token of tokens) {
    if (!token) continue;
    let idx = 0;
    while (idx < lower.length) {
      const found = lower.indexOf(token, idx);
      if (found === -1) break;
      matches.push([found, found + token.length]);
      idx = found + token.length;
    }
  }

  if (matches.length === 0) return <>{text}</>;

  matches.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of matches) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }

  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (cursor < s) out.push(<Fragment key={`p-${cursor}`}>{text.slice(cursor, s)}</Fragment>);
    out.push(
      <span key={`m-${s}`} className="text-primary font-semibold">
        {text.slice(s, e)}
      </span>
    );
    cursor = e;
  }
  if (cursor < text.length)
    out.push(<Fragment key={`p-${cursor}-end`}>{text.slice(cursor)}</Fragment>);
  return <>{out}</>;
}

function useDebounced<T>(value: T, delay = 120): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function ResultRow({
  result,
  tokens,
  selected,
  onSelect,
}: {
  result: SearchResult;
  tokens: string[];
  selected: boolean;
  onSelect: (r: SearchResult, queued: boolean) => void;
}) {
  const { t } = useTranslation();
  const theme = SOURCE_THEME[result.source];
  const Icon = theme.icon;

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={(e) => onSelect(result, e.shiftKey)}
      className={cn(
        'group/row flex w-full items-center gap-3 rounded-lg border px-2.5 py-2.5 text-left transition-colors',
        selected
          ? 'border-primary/40 bg-primary/5'
          : 'border-transparent hover:border-primary/20 hover:bg-primary/5'
      )}
    >
      <div
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-md border',
          theme.iconBox
        )}
      >
        <Icon className="size-4" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            <Highlight text={result.title} tokens={tokens} />
          </span>
          <span
            className={cn(
              'shrink-0 rounded-sm border px-1.5 py-px text-[10px] font-semibold tracking-wider uppercase',
              theme.badge
            )}
          >
            {result.badge}
          </span>
        </div>
        {result.subtitle && (
          <span className="truncate text-xs text-muted-foreground">
            <Highlight text={result.subtitle} tokens={tokens} />
          </span>
        )}
      </div>

      <Kbd className={cn('ml-2 shrink-0 opacity-60', selected && 'opacity-100')}>
        {result.shortcut ?? t('Enter')}
      </Kbd>
    </button>
  );
}

function FilterTabs({
  scope,
  setScope,
  results,
}: {
  scope: SearchScope;
  setScope: (s: SearchScope) => void;
  results: SearchResults;
}) {
  const { t } = useTranslation();

  return (
    <div
      data-no-window-drag="true"
      className="flex shrink-0 items-center gap-1 border-b border-border/40 px-3 pb-2"
    >
      {SCOPES.map((s) => {
        const Icon = SCOPE_ICON[s];
        const active = s === scope;
        const count = countForScope(s, results);
        return (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
              active
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground'
            )}
          >
            <Icon className="size-3.5" />
            <span>{scopeLabel(s, t)}</span>
            <span
              className={cn('text-[11px]', active ? 'text-primary/70' : 'text-muted-foreground/70')}
            >
              ({count})
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PaletteHeader({
  app,
  fullContent,
  setFullContent,
  inputValue,
  setInputValue,
  inputId,
}: {
  app?: ActiveApp;
  fullContent: boolean;
  setFullContent: (v: boolean) => void;
  inputValue: string;
  setInputValue: (v: string) => void;
  inputId: string;
}) {
  const { t } = useTranslation();
  const { popApp } = useCommandStore();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex shrink-0 items-center gap-2 p-3">
      {app && (
        <button
          type="button"
          onClick={popApp}
          aria-label={t('Back')}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/30 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </button>
      )}

      <label
        htmlFor={inputId}
        className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 focus-within:border-primary/40"
      >
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          id={inputId}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={app ? app.title : t('Type a command or search...')}
          className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </label>

      {!app && (
        <button
          type="button"
          onClick={() => setFullContent(!fullContent)}
          className={cn(
            'flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors',
            fullContent
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground'
          )}
          title={fullContent ? t('Searching titles + content') : t('Searching titles only')}
        >
          <Search className="size-3.5" />
          <span>{t('Global Search')}</span>
        </button>
      )}
    </div>
  );
}

function CommanderFooter({
  results,
  query,
  fullContent,
  showBack,
}: {
  results?: SearchResults;
  query?: string;
  fullContent?: boolean;
  showBack?: boolean;
}) {
  const { t } = useTranslation();
  const hasQuery = !!query?.trim();

  return (
    <div className="flex shrink-0 items-center justify-between border-t border-border/40 bg-muted/20 px-3 py-2 text-[10px] font-medium tracking-wider text-muted-foreground/80 uppercase">
      <div className="flex items-center gap-2">
        {results && !showBack && (
          <>
            <span
              className={cn(
                'inline-block size-1.5 rounded-full',
                fullContent
                  ? 'bg-primary shadow-[0_0_8px_var(--color-primary)]'
                  : 'bg-muted-foreground/40'
              )}
            />
            <span>{fullContent ? t('Global Search') : t('Title Search')}</span>
            <span className="text-muted-foreground/40">•</span>
            <span className="normal-case tracking-normal">
              {hasQuery
                ? t('{{count}} results matching query', { count: results.total })
                : t('{{count}} items', { count: results.total })}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <Kbd>↑↓</Kbd>
          {t('Navigate')}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          {showBack ? t('Select') : t('Play')}
        </span>
        {!showBack && (
          <span className="flex items-center gap-1.5">
            <Kbd>⇧↵</Kbd>
            {t('Queue')}
          </span>
        )}
        {!showBack && (
          <span className="flex items-center gap-1.5">
            <Kbd>Tab</Kbd>
            {t('Filter')}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd>
          {showBack ? t('Back') : t('Close')}
        </span>
      </div>
    </div>
  );
}

type VirtualRow = { kind: 'heading'; label: string } | { kind: 'item'; result: SearchResult };

function RootView() {
  const { t } = useTranslation();
  const { commands, prefilter, close, pushApp } = useCommandStore();
  const [query, setQuery] = useState(prefilter);
  const [scope, setScope] = useState<SearchScope>('all');
  const [fullContent, setFullContent] = useState(false);
  const [results, setResults] = useState<SearchResults>({
    lyrics: [],
    media: [],
    commands: [],
    total: 0,
  });
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const runIdRef = useRef(0);

  const debouncedQuery = useDebounced(query, 120);
  const tokens = useMemo(
    () =>
      debouncedQuery.trim() ? normalize(debouncedQuery.trim()).split(/\s+/).filter(Boolean) : [],
    [debouncedQuery]
  );

  useEffect(() => {
    const runId = ++runIdRef.current;
    setSelectedIdx(0);
    runSearch({
      query: debouncedQuery,
      scope,
      fullContent,
      commands,
      limitPerGroup: debouncedQuery.trim() ? 500 : 10,
    }).then((res) => {
      if (runIdRef.current === runId) setResults(res);
    });
  }, [debouncedQuery, scope, fullContent, commands]);

  const groups = useMemo(() => {
    const g: Array<{ key: SearchScope; heading: string; results: SearchResult[] }> = [];
    if ((scope === 'all' || scope === 'lyrics') && results.lyrics.length)
      g.push({ key: 'lyrics', heading: t('Lyrics / Songs'), results: results.lyrics });
    if ((scope === 'all' || scope === 'commands') && results.commands.length)
      g.push({ key: 'commands', heading: t('Commands & Shortcuts'), results: results.commands });
    if ((scope === 'all' || scope === 'media') && results.media.length)
      g.push({ key: 'media', heading: t('Media Assets'), results: results.media });
    return g;
  }, [results, scope, t]);

  const flatRows = useMemo<VirtualRow[]>(() => {
    const rows: VirtualRow[] = [];
    for (const g of groups) {
      rows.push({ kind: 'heading', label: g.heading });
      for (const r of g.results) rows.push({ kind: 'item', result: r });
    }
    return rows;
  }, [groups]);

  const itemIndices = useMemo(
    () =>
      flatRows.reduce<number[]>((acc, row, i) => {
        if (row.kind === 'item') acc.push(i);
        return acc;
      }, []),
    [flatRows]
  );

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (flatRows[i]?.kind === 'heading' ? 36 : 60),
    overscan: 8,
  });

  function handleSelect(r: SearchResult, queued = false) {
    if (r.source === 'app' && r.commandSpec?.component) {
      pushApp({
        commandId: r.commandSpec.id,
        title: r.commandSpec.title,
        component: r.commandSpec.component,
      } satisfies ActiveApp);
      return;
    }
    if (r.source === 'command' && r.commandSpec?.run) {
      r.commandSpec.run();
      close();
      return;
    }
    if (r.path) {
      window.dispatchEvent(
        new CustomEvent('lumen:commander-open', {
          detail: { source: r.source, id: r.id, path: r.path, action: queued ? 'queue' : 'play' },
        })
      );
      close();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Tab') {
      event.preventDefault();
      const idx = SCOPES.indexOf(scope);
      setScope(SCOPES[(idx + (event.shiftKey ? -1 + SCOPES.length : 1)) % SCOPES.length]);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = Math.min(selectedIdx + 1, itemIndices.length - 1);
      setSelectedIdx(next);
      if (itemIndices[next] !== undefined)
        virtualizer.scrollToIndex(itemIndices[next], { align: 'auto' });
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = Math.max(selectedIdx - 1, 0);
      setSelectedIdx(prev);
      if (itemIndices[prev] !== undefined)
        virtualizer.scrollToIndex(itemIndices[prev], { align: 'auto' });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = flatRows[itemIndices[selectedIdx] ?? -1];
      if (row?.kind === 'item') handleSelect(row.result, event.shiftKey);
    }
  }

  return (
    <div
      role="listbox"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="flex flex-col rounded-none bg-transparent outline-none"
    >
      <PaletteHeader
        fullContent={fullContent}
        setFullContent={setFullContent}
        inputValue={query}
        setInputValue={setQuery}
        inputId={inputId}
      />

      <FilterTabs scope={scope} setScope={setScope} results={results} />

      <ScrollArea
        ref={scrollRef}
        className="max-h-[420px]"
        viewportClassName="!h-auto max-h-[420px] px-2 pb-2 focus-visible:ring-0 focus-visible:outline-none"
      >
        {flatRows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              <ShieldQuestion className="size-6 text-muted-foreground/60" />
              <span>{t('No results found.')}</span>
            </div>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const row = flatRows[vItem.index];
              if (!row) return null;
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  className={row.kind === 'item' ? 'pb-1' : undefined}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  {row.kind === 'heading' && (
                    <div className="px-2 pb-1 pt-3 text-[10px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
                      {row.label}
                    </div>
                  )}
                  {row.kind === 'item' && (
                    <ResultRow
                      result={row.result}
                      tokens={tokens}
                      selected={itemIndices[selectedIdx] === vItem.index}
                      onSelect={(r, queued) => handleSelect(r, queued)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <CommanderFooter results={results} query={debouncedQuery} fullContent={fullContent} />
    </div>
  );
}

function AppView({ app }: { app: ActiveApp }) {
  const { close, popApp } = useCommandStore();
  const AppComponent = app.component;
  const inputId = useId();
  const [value, setValue] = useState('');

  return (
    <div className="flex flex-col rounded-none bg-transparent">
      <PaletteHeader
        app={app}
        fullContent={false}
        setFullContent={() => {}}
        inputValue={value}
        setInputValue={setValue}
        inputId={inputId}
      />
      <div className="min-h-[320px] flex-1 overflow-auto px-3 pb-3">
        <AppComponent onClose={close} onBack={popApp} />
      </div>
      <CommanderFooter showBack />
    </div>
  );
}

export function QuickShortcutsModal() {
  const { isOpen, toggle, close, activeApp } = useCommandStore();

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        toggle();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent showCloseButton={false} className="overflow-hidden p-0 sm:max-w-[760px]">
        {activeApp ? <AppView app={activeApp} /> : <RootView />}
      </DialogContent>
    </Dialog>
  );
}
