// The films published for everyone (functions/media/[[path]].js → R2), as the build sees them: one read of
// /media/films/index.json per build — never a request per story. Off with FILMS_INDEX=0, and empty when the site
// can't be reached within 8 s: a story then simply lists no film until the next build.
import { SITE } from '../site';

export type FilmShape = 'h' | 'v' | 's';
type Entry = { sec: number | null; at: string; cover: boolean };
type Index = Record<string, Partial<Record<FilmShape, Entry>>>;

let index: Promise<Index> | null = null;
export function publishedFilms(): Promise<Index> {
  index ??=
    process.env.FILMS_INDEX === '0'
      ? Promise.resolve({})
      : fetch(`${SITE.url}/media/films/index.json`, { signal: AbortSignal.timeout(8000) })
          .then((r) => (r.ok ? r.json() : {}))
          .then((x) => (x && typeof x === 'object' ? (x as Index) : {}))
          .catch(() => ({}));
  return index;
}

export type StoryFilm = { shape: FilmShape; sec: number | null; at: string; mp4: string; cover: string | null };
/** A story's published film (landscape first: what a search engine and a desktop reader show best), or null. */
export async function filmOf(id: number): Promise<StoryFilm | null> {
  const f = (await publishedFilms())[String(id)];
  const shape = f && (['h', 's', 'v'] as const).find((s) => f[s]);
  if (!f || !shape) return null;
  const e = f[shape]!;
  const base = `${SITE.url}/media/films/${id}-${shape}`;
  return { shape, sec: e.sec ?? null, at: e.at, mp4: `${base}.mp4`, cover: e.cover ? `${base}.jpg` : null };
}
