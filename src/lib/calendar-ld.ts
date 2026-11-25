// schema.org for the events calendars: an ItemList of Events (all-day, online: the story is where it's told).
import type { DayEvent } from './calendar';

export function eventsLd(name: string, pageUrl: string, list: DayEvent[], inLanguage: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    url: pageUrl,
    inLanguage,
    numberOfItems: Math.min(list.length, 50),
    itemListElement: list.slice(0, 50).map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Event',
        name: e.summary.slice(0, 200),
        startDate: e.date,
        endDate: e.date,
        url: e.url,
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
        location: { '@type': 'VirtualLocation', url: e.url },
      },
    })),
  };
}
