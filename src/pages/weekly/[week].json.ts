// One weekly recap (pipeline/daily.py --weekly), for the cloud voice (server/tts.js ?week=&k=): its text always comes
// from the site's own files.
import type { APIRoute } from 'astro';
import { weeklies, type Weekly } from '../../lib/knowledge';

export function getStaticPaths() {
  return weeklies().slice(0, 8).map((w) => ({ params: { week: w.week }, props: { w } }));
}
export const GET: APIRoute = ({ props }) => {
  const w = props.w as Weekly;
  return new Response(JSON.stringify({ week: w.week, title: w.title, intro: w.intro, items: w.items, outro: w.outro }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
