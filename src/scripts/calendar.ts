// «Add to my calendar» on /calendar/ and /en/calendar/ (src/components/CalendarView.astro), the right way for the
// reader's phone: iPhone/iPad/Mac subscribe with webcal:// (Apple Calendar) and add one event from a small .ics made
// here (a data: URL Safari opens as «Add to Calendar»; no file per event on the site); Android (and other systems)
// subscribe through Google Calendar's page and add one event with its template link. The other ways stay under «more».
import { $, $$, L, esc, track } from './core';
import { googleEventUrl, icsCalendar } from '../lib/ics';

type Platform = 'apple' | 'android' | 'other';
const platform = (): Platform => {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  // iPadOS asks for desktop pages as a Mac; a Mac with touch is an iPad.
  if (/iPhone|iPad|iPod|Macintosh/.test(ua)) return 'apple';
  return 'other';
};
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

type Ev = { uid: string; date: string; summary: string; url: string };
const evOf = (li: HTMLElement): Ev => ({ uid: li.dataset.uid!, date: li.dataset.date!, url: li.dataset.url!, summary: ($('.cal-what', li)?.textContent ?? '').trim() });

/** One event as an .ics the system's calendar opens: Safari on iOS shows «Add to Calendar» for a text/calendar data:
 *  URL opened in the page; elsewhere it's a download the calendar app opens. */
function saveIcs(e: Ev) {
  const text = icsCalendar({ name: e.summary, lang: document.documentElement.lang === 'en' ? 'en' : 'fa', host: location.host, events: [{ ...e, description: e.url }] });
  const a = document.createElement('a');
  if (ios()) {
    // Opened, not downloaded: a download would go to Files instead of the calendar's sheet.
    a.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(text)}`;
  } else {
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    a.download = `${e.date}-${e.uid.replace(/[^\w-]/g, '')}.ics`;
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
  document.body.append(a);
  a.click();
  a.remove();
}

export function initCalendar() {
  const root = $('[data-cal]');
  if (!root) return;
  const p = platform();
  root.dataset.platform = p;

  // Subscribing: the primary button is the way this device's calendar takes it; the rest stay in «more».
  const primary = $<HTMLAnchorElement>('[data-cal-sub]', root);
  const way = $<HTMLAnchorElement>(`[data-cal-way="${p === 'apple' ? 'webcal' : 'google'}"]`, root);
  if (primary && way) {
    primary.href = way.href;
    if (way.target) primary.target = way.target;
    else primary.removeAttribute('target');
    const hint = $('[data-cal-hint]', root);
    if (hint) hint.textContent = p === 'apple' ? L('در تقویم آیفون، آیپد یا مک', 'In Apple Calendar on iPhone, iPad or Mac') : L('در تقویم گوگل (اندروید)', 'In Google Calendar (Android)');
    primary.addEventListener('click', () => track('calendar'));
  }

  // One event: «+» adds it the device's way; «⋯» offers the other way.
  const menu = document.createElement('div');
  menu.className = 'cal-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  const close = () => {
    menu.hidden = true;
    $$('[data-cal-more][aria-expanded="true"]', root).forEach((b) => b.setAttribute('aria-expanded', 'false'));
  };
  root.addEventListener('click', (ev) => {
    const t = ev.target as Element;
    const add = t.closest<HTMLAnchorElement>('[data-cal-add]');
    const li = t.closest<HTMLElement>('[data-uid]');
    if (add && li) {
      track('calendar');
      if (p === 'apple') {
        ev.preventDefault();
        saveIcs(evOf(li));
      }
      return;
    }
    const more = t.closest<HTMLButtonElement>('[data-cal-more]');
    if (more && li) {
      const open = more.getAttribute('aria-expanded') === 'true';
      close();
      if (open) return;
      const e = evOf(li);
      menu.innerHTML = [
        `<a role="menuitem" href="${esc(googleEventUrl({ ...e, description: e.summary }))}" target="_blank" rel="noopener">${esc(L('تقویم گوگل', 'Google Calendar'))}</a>`,
        `<button role="menuitem" type="button" data-cal-ics>${esc(L('فایل ‎.ics (تقویم اپل، Outlook…)', '.ics file (Apple Calendar, Outlook…)'))}</button>`,
      ].join('');
      $('[data-cal-ics]', menu)!.addEventListener('click', () => (close(), saveIcs(e)));
      more.after(menu);
      menu.hidden = false;
      more.setAttribute('aria-expanded', 'true');
      return;
    }
    if (!t.closest('.cal-menu')) close();
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
}
