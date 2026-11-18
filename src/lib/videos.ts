// Mehrzad's YouTube channel (data/videos.json, written by pipeline/videos.py) joined with the channel's posts about
// each video: the /videos/ section, the home page's new-video card, the rail's video circle and rss/videos.xml.
// YouTube is filtered in Iran, so nothing is embedded: the Persian summary is the value, the thumbnail comes through the
// site's relay (i.ytimg.com is one of /api/img's hosts) and «تماشا در یوتیوب» links out.
import { SITE } from '../site';
import { faNum, getPosts, url, type Post } from './posts';

type RawVideo = {
  id: string;
  title: string;
  name: string;
  n?: number | null;
  live?: boolean;
  date?: string;
  duration?: number;
  description?: string;
  chapters?: { t: number; title: string }[];
  links?: string[];
  post?: number;
  /** From the video's subtitles by the model (pipeline/videos.py summarize, PLAN.md P2-3): a Persian summary, key
   *  points, chapter titles in Persian with their times, and a category for the shelves. */
  ai?: { summary?: string; points?: string[]; chapters?: { t: number; title: string }[]; category?: string; title?: string; model?: string; from?: 'subtitles' | 'description'; v?: number } | null;
};
type VideosFile = { channel: { url: string; id: string | null }; checked: string | null; videos: RawVideo[] };

export type Video = RawVideo & {
  href: string;
  youtube: string;
  /** hqdefault (480×360) is there for every video; maxres isn't. */
  thumb: string;
  /** «قسمت ۵۱» / «لایو ۱» / '' */
  label: string;
  /** The Persian headline when the site has one (the post's), else the video's own name. */
  headline: string;
  /** The channel's post about it, with Gholam's Persian when he wrote one. */
  story: Post | null;
};

const file = Object.values(import.meta.glob<VideosFile>('../../data/videos.json', { eager: true, import: 'default' }))[0];
export const channelUrl = () => file?.channel.url ?? 'https://www.youtube.com/@mehrzad.samadi';

let cache: Video[] | null = null;
/** Newest first. */
export function getVideos(): Video[] {
  if (cache) return cache;
  const posts = new Map(getPosts().map((p) => [p.id, p]));
  cache = (file?.videos ?? []).map((v) => {
    const story = (v.post && posts.get(v.post)) || null;
    const label = v.n == null ? '' : v.live ? `لایو ${faNum(v.n)}` : `قسمت ${faNum(v.n)}`;
    // The AI's Persian headline when there is one; Gholam's first sentence is often a run-up, not the episode's subject.
    const headline = (!story?.ai?.failed && story?.ai?.title) || v.ai?.title || v.name;
    return {
      ...v,
      href: url(`videos/${v.id}/`),
      youtube: `https://www.youtube.com/watch?v=${v.id}`,
      thumb: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      label,
      headline,
      story,
    };
  });
  return cache;
}

/** The newest video, if it came out in the last `days` days (of the newest post, so a quiet build doesn't drop it). */
export function newVideo(days = 2): Video | null {
  const v = getVideos()[0];
  const newest = getPosts()[0];
  if (!v?.date || !newest) return null;
  return Date.parse(newest.date) - Date.parse(v.date) <= days * 864e5 ? v : null;
}

export const ytTime = (v: Video, t: number) => `${v.youtube}&t=${t}s`;
export const clock = (s: number) =>
  faNum(s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
export const videoTitle = (v: Video) => `${v.label ? `${v.label}: ` : ''}${v.headline}`;
export const VIDEOS_TITLE = `ویدیوهای ${SITE.owner.name}`;
