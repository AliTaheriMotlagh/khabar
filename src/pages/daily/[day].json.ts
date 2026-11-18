// The morning podcast's host lines for one Tehran day (pipeline/daily.py): the playlist (src/scripts/playlist.ts) says
// them, and the cloud voice (server/tts.js ?day=&k=) reads them from here, so the text never comes from a request.
import type { APIRoute } from 'astro';
import type { Daily } from '../../lib/knowledge';

const days = Object.values(import.meta.glob<Daily>('../../../data/daily/*.json', { eager: true, import: 'default' }));
export function getStaticPaths() {
  // The newest week is enough: the playlist only plays today's (or the last 24 hours after a quiet night).
  return days
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, 7)
    .map((d) => ({ params: { day: d.day }, props: { d } }));
}
export const GET: APIRoute = ({ props }) => {
  const d = props.d as Daily;
  return new Response(JSON.stringify({ day: d.day, intro: d.intro, links: d.links, outro: d.outro }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
