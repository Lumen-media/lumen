import type { CommandSpec } from '@/modules/types';
import { mediaDbService, type SearchHit } from './media-db-service';
import type { MediaType } from './types';

export type SearchSource = 'lyric' | 'audio' | 'video' | 'image' | 'command' | 'app';

export type SearchScope = 'all' | 'lyrics' | 'media' | 'commands';

export interface SearchResult {
  source: SearchSource;
  id: string;
  title: string;
  subtitle?: string;
  badge: string;
  shortcut?: string;
  path?: string;
  artist?: string;
  commandSpec?: CommandSpec;
}

export interface SearchResults {
  lyrics: SearchResult[];
  media: SearchResult[];
  commands: SearchResult[];
  total: number;
}

export interface SearchOpts {
  query: string;
  scope: SearchScope;
  fullContent: boolean;
  commands: CommandSpec[];
  limitPerGroup?: number;
}

const SEARCHABLE_MEDIA: MediaType[] = ['audio', 'video', 'image'];

function badgeForMediaType(type: string): string {
  switch (type) {
    case 'lyrics': return 'LYRIC';
    case 'audio':  return 'AUDIO';
    case 'video':  return 'VIDEO';
    case 'image':  return 'IMAGE';
    default:       return type.toUpperCase();
  }
}

function sourceForMediaType(type: string): SearchSource {
  switch (type) {
    case 'lyrics': return 'lyric';
    case 'audio':  return 'audio';
    case 'video':  return 'video';
    case 'image':  return 'image';
    default:       return 'audio';
  }
}

function hitToResult(hit: SearchHit): SearchResult {
  const source = sourceForMediaType(hit.media_type);
  return {
    source,
    id: `media:${hit.id}`,
    title: hit.name.replace(/\.[^/.]+$/, ''),
    subtitle: hit.artist ?? undefined,
    badge: badgeForMediaType(hit.media_type),
    path: hit.path,
    artist: hit.artist ?? undefined,
  };
}

export function normalize(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
}

function commandMatches(spec: CommandSpec, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = normalize(
    [spec.title, spec.subtitle ?? '', (spec.keywords ?? []).join(' ')].join(' ')
  );
  return tokens.every((t) => haystack.includes(t));
}

function commandToResult(spec: CommandSpec): SearchResult {
  const isApp = spec.type === 'app';
  return {
    source: isApp ? 'app' : 'command',
    id: `cmd:${spec.id}`,
    title: spec.title,
    subtitle: spec.subtitle,
    badge: isApp ? 'APP' : 'COMMAND',
    shortcut: spec.keybinding,
    commandSpec: spec,
  };
}

export async function search(opts: SearchOpts): Promise<SearchResults> {
  const limit = opts.limitPerGroup ?? 12;
  const trimmed = opts.query.trim();
  const tokens = trimmed ? normalize(trimmed).split(/\s+/).filter(Boolean) : [];

  const wantLyrics = opts.scope === 'all' || opts.scope === 'lyrics';
  const wantMedia = opts.scope === 'all' || opts.scope === 'media';
  const wantCommands = opts.scope === 'all' || opts.scope === 'commands';

  const lyricsPromise: Promise<SearchHit[]> = wantLyrics
    ? trimmed
      ? mediaDbService.search(trimmed, { mediaType: 'lyrics', fullContent: opts.fullContent, limit })
      : mediaDbService.listByType('lyrics', limit)
    : Promise.resolve([]);

  const mediaPromise: Promise<SearchHit[]> = wantMedia
    ? trimmed
      ? Promise.all(
          SEARCHABLE_MEDIA.map((t) =>
            mediaDbService.search(trimmed, { mediaType: t, fullContent: opts.fullContent, limit })
          )
        ).then((arrs) => arrs.flat().slice(0, limit))
      : Promise.all(SEARCHABLE_MEDIA.map((t) => mediaDbService.listByType(t, Math.ceil(limit / 3)))).then(
          (arrs) => arrs.flat().slice(0, limit)
        )
    : Promise.resolve([]);

  const [lyricsHits, mediaHits] = await Promise.all([lyricsPromise, mediaPromise]);

  const commandResults: SearchResult[] = wantCommands
    ? opts.commands.filter((c) => commandMatches(c, tokens)).slice(0, limit).map(commandToResult)
    : [];

  const lyricsResults = lyricsHits.map(hitToResult);
  const mediaResults = mediaHits.map(hitToResult);

  return {
    lyrics: lyricsResults,
    media: mediaResults,
    commands: commandResults,
    total: lyricsResults.length + mediaResults.length + commandResults.length,
  };
}
