// Shared by the templates and the browser script; keys must match REACTIONS in api/_lib.js.
export const REACTIONS = [
  { key: 'like', emoji: '👍', label: 'پسندیدم' },
  { key: 'love', emoji: '❤️', label: 'عالی بود' },
  { key: 'fire', emoji: '🔥', label: 'داغ' },
  { key: 'wow', emoji: '🤯', label: 'شگفت‌انگیز' },
  { key: 'haha', emoji: '😂', label: 'خنده‌دار' },
  { key: 'sad', emoji: '😢', label: 'ناراحت‌کننده' },
] as const;
