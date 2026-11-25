// Every minute: asks the site whether the channel has news (/api/watch/, server/watch.js), which starts a crawl
// (site.yml) when it does. Without the key: the shared tick (one real check a minute per data centre), so this Worker
// holds no secret. A failed call shows as a failed cron run in the Worker's logs (Cloudflare dashboard → khabar-watch).
export default {
  async scheduled(_event, env) {
    const res = await fetch(env.WATCH_URL, {
      headers: { 'User-Agent': 'khabar-watch' },
      signal: AbortSignal.timeout(25_000),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`watch ${res.status}: ${body.slice(0, 200)}`);
    console.log(body);
  },
};
