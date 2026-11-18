// What the AI learned across all stories (PLAN.md P2), kept in data/ and editable by hand:
// - data/glossary.json  technical terms with a one-line Persian explanation (P2-5): tapped on a story page, /glossary/
// - data/entities.json  people, companies, models and products, one Persian spelling each (P2-6): /who/<slug>/
// - data/lexicon.json   how a voice should say a Latin name or symbol in Persian (P2-2): the spoken lines in card.json
// - data/related.json   related stories by meaning and same-story clusters, from embeddings (P2-4)
// - data/daily/<day>.json, data/weekly/<week>.json  the morning podcast's host lines (P2-7), the weekly recap (P2-11)
// No imports beyond the files themselves, so the build, feeds and tests share it.

export type Term = { term: string; fa?: string; def: string; aliases?: string[] };
export type EntityKind = 'person' | 'company' | 'model' | 'product';
export type Entity = { slug: string; name_en: string; name_fa: string; kind: EntityKind; aliases?: string[]; about?: string };
export type Related = { v?: number; model?: string; related: Record<string, number[]>; clusters: number[][] };
export type Daily = { day: string; intro: string; links: Record<string, string>; outro: string; ids: number[] };
export type Weekly = { week: string; from: string; to: string; title: string; intro: string; items: { id: number; line: string }[]; outro: string };

const one = <T>(glob: Record<string, T>): T | undefined => Object.values(glob)[0];
const G = one(import.meta.glob<{ terms: Term[] }>('../../data/glossary.json', { eager: true, import: 'default' }));
const E = one(import.meta.glob<{ entities: Entity[] }>('../../data/entities.json', { eager: true, import: 'default' }));
const L = one(import.meta.glob<Record<string, string>>('../../data/lexicon.json', { eager: true, import: 'default' }));
const R = one(import.meta.glob<Related>('../../data/related.json', { eager: true, import: 'default' }));
const DAILY = import.meta.glob<Daily>('../../data/daily/*.json', { eager: true, import: 'default' });
const WEEKLY = import.meta.glob<Weekly>('../../data/weekly/*.json', { eager: true, import: 'default' });

export const glossary = (): Term[] => [...(G?.terms ?? [])].sort((a, b) => a.term.localeCompare(b.term, 'fa'));
export const entities = (): Entity[] => E?.entities ?? [];
export const lexicon = (): Record<string, string> => L ?? {};
export const relatedFile = (): Related => R ?? { related: {}, clusters: [] };
export const dailyFor = (day: string): Daily | null => Object.values(DAILY).find((d) => d.day === day) ?? null;
export const weeklies = (): Weekly[] => Object.values(WEEKLY).sort((a, b) => (a.week < b.week ? 1 : -1));

const norm = (s: string) => s.toLowerCase().replace(/[\s‌_-]+/g, ' ').trim();

let entityIndex: Map<string, Entity> | null = null;
/** The entity a name refers to (English or Persian, any alias), or null. */
export function findEntity(name: string): Entity | null {
  if (!entityIndex) {
    entityIndex = new Map();
    for (const e of entities()) for (const n of [e.name_en, e.name_fa, e.slug, ...(e.aliases ?? [])]) if (n) entityIndex.set(norm(n), e);
  }
  return entityIndex.get(norm(name)) ?? null;
}

let termIndex: Map<string, Term> | null = null;
export function findTerm(name: string): Term | null {
  if (!termIndex) {
    termIndex = new Map();
    for (const t of glossary()) for (const n of [t.term, t.fa, ...(t.aliases ?? [])]) if (n) termIndex.set(norm(n), t);
  }
  return termIndex.get(norm(name)) ?? null;
}

/** A URL-safe slug for an entity's page: its English name, lower case. */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);

// ---- the spoken version (P2-2) ----
// What a Persian voice should say for the Latin names in a story: the lexicon's entries its lines use, shipped in its
// card.json (`lex`), where server/_say.js turns each line into its spoken form for every voice. The page shows the
// original. A hand edit of data/lexicon.json fixes every story on the next build.
let lowLex: Map<string, [string, string]> | null = null;
export function lexFor(lines: string[]): Record<string, string> {
  lowLex ??= new Map(Object.entries(lexicon()).filter(([k, v]) => k && v).map(([k, v]) => [k.toLowerCase(), [k, v]]));
  const out: Record<string, string> = {};
  for (const line of lines)
    for (const m of line.matchAll(/\$\d[\d,.]*\s?[KMBT]?\b|[A-Za-z][\w.+&'/-]*/g)) {
      const hit = lowLex.get(m[0].replace(/[.,'/&-]+$/, '').toLowerCase());
      if (hit) out[hit[0]] = hit[1];
    }
  return out;
}
