// What the model added to a story page (PLAN.md P2), wired up on the device:
// - the quiz (src/components/Quiz.astro): one tap answers; a right first answer earns points (src/scripts/game.ts);
// - technical terms (card.json `terms`, P2-5): a dotted underline on their first use in the text, found at runtime so the
//   page's HTML stays lean; a tap opens a small card with the explanation and a link to /glossary/;
// - «به زبان ساده» opened: counted for the owner's page.
import { $, $$, BASE, card, esc, store, track } from './core';
import { award } from './game';

function quiz() {
  const box = $('[data-quiz]');
  if (!box) return;
  const id = box.dataset.quiz!;
  const answer = Number(box.dataset.answer);
  const msg = $('[data-quiz-msg]', box)!;
  const done = store.get<Record<string, number>>('quiz', {});
  const show = (picked: number) => {
    box.dataset.done = '';
    $$<HTMLButtonElement>('[data-opt]', box).forEach((b) => {
      const k = Number(b.dataset.opt);
      b.disabled = true;
      b.classList.toggle('right', k === answer);
      b.classList.toggle('wrong', k === picked && k !== answer);
    });
    msg.textContent = picked === answer ? 'درست است! 🎉' : 'نه؛ پاسخ درست سبز شده.';
  };
  if (done[id] !== undefined) return show(done[id]);
  box.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-opt]');
    if (!b || box.hasAttribute('data-done')) return;
    const picked = Number(b.dataset.opt);
    store.set('quiz', { ...store.get<Record<string, number>>('quiz', {}), [id]: picked });
    show(picked);
    if (picked === answer) {
      award('quiz');
      track('quiz-right');
    } else track('quiz-wrong');
  });
}

/** The first use of each term in the story's text gets a button around it, in place (no spans in the built HTML). */
function terms(list: [string, string][]) {
  const prose = $('.article .prose');
  if (!prose || !list.length) return;
  const defs = new Map(list.map(([t, d]) => [t, d]));
  const left = new Set(defs.keys());
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
  const hits: { node: Text; at: number; term: string }[] = [];
  for (let n = walker.nextNode() as Text | null; n && left.size; n = walker.nextNode() as Text | null) {
    for (const term of [...left]) {
      const at = n.data.toLowerCase().indexOf(term.toLowerCase());
      // Whole words only (Persian letters or Latin ones on either side mean it's part of another word).
      if (at < 0 || /[\p{L}\p{N}]/u.test(n.data[at - 1] ?? '') || /[\p{L}\p{N}]/u.test(n.data[at + term.length] ?? '')) continue;
      hits.push({ node: n, at, term });
      left.delete(term);
    }
  }
  // From the end of each node backwards, so earlier offsets stay right.
  hits.sort((a, b) => b.at - a.at);
  for (const { node, at, term } of hits) {
    if (!node.parentNode) continue;
    const word = node.splitText(at);
    word.splitText(term.length);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'term';
    btn.dataset.term = term;
    btn.textContent = word.data;
    word.replaceWith(btn);
  }
  let card: HTMLElement | null = null;
  const close = () => (card?.remove(), (card = null));
  prose.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.term');
    if (!b) return;
    e.stopPropagation();
    close();
    card = document.createElement('div');
    card.className = 'term-card';
    card.setAttribute('role', 'dialog');
    card.innerHTML = `<b>${esc(b.dataset.term!)}</b><p>${esc(defs.get(b.dataset.term!) ?? '')}</p><a href="${BASE}/glossary/#${encodeURIComponent(b.dataset.term!)}">همه‌ی اصطلاح‌ها</a>`;
    b.after(card);
    track('term');
  });
  document.addEventListener('click', (e) => card && !(e.target as Element).closest('.term-card') && close());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
}

export function initExtras() {
  const article = $<HTMLElement>('[data-article]');
  if (!article) return;
  quiz();
  $('[data-simple]')?.addEventListener('toggle', (e) => (e.target as HTMLDetailsElement).open && track('simple'), { once: true });
  // The terms come with the story's small card.json (the long-press preview and the voices read it too).
  const load = () => card(Number(article.dataset.id)).then((c) => c?.terms && terms(c.terms));
  'requestIdleCallback' in window ? requestIdleCallback(load, { timeout: 2500 }) : setTimeout(load, 800);
}
