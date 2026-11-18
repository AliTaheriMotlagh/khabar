import { getStories } from '../lib/posts';

// How many stories have the AI's headline (pipeline/ai.py), for /admin/: by model, failed ones, and by type.
export function GET() {
  const stories = getStories().filter((p) => p.kind === 'story');
  const models: Record<string, number> = {};
  const types: Record<string, number> = {};
  let failed = 0;
  for (const p of stories) {
    if (p.ai?.failed) failed++;
    else if (p.ai?.title) models[p.ai.model ?? '?'] = (models[p.ai.model ?? '?'] ?? 0) + 1;
    if (p.type) types[p.type] = (types[p.type] ?? 0) + 1;
  }
  const titled = Object.values(models).reduce((a, b) => a + b, 0);
  return new Response(JSON.stringify({ stories: stories.length, titled, failed, models, types }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
