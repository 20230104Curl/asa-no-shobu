import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const script = scripts.find(s => s.includes('function updateReadingApp()'));
const cardHtml = html.match(/<a class="card reading"[\s\S]*?<\/a>/)[0];
const studentUrl = 'https://script.google.com/macros/s/AKfycbxK0tgkNPygRssr7nxi99Fw0gsEZDl1GAqcEoacafJLpubsgBMJUsWAgrllqCacrkj4/exec';

function harness(iso) {
  let now = Date.parse(iso), timer;
  const events = {};
  const attributes = { href: studentUrl, 'aria-label': '国語の一読勝負をはじめる' };
  const nodes = {
    '.app-title': { textContent: '一読勝負' },
    '.reading-text': { textContent: 'いちどくしょうぶ' },
    '.description': { innerHTML: '<span>本文を３分間読んでから、思い出して答える</span><span>4分間の読解トレーニング</span>' },
    '.action': { firstChild: { nodeValue: '一読勝負をはじめる ' } },
    '.monogram': { textContent: '一' }
  };
  const meta = { content: '一読勝負・一題勝負・計算勝負' };
  const card = {
    getAttribute: k => attributes[k],
    setAttribute: (k, v) => { attributes[k] = v; },
    querySelector: k => nodes[k],
    addEventListener: (k, f) => { events[k] = f; },
    get href() { return attributes.href; },
    set href(v) { attributes.href = v; }
  };
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(script, {
    Date: Clock,
    document: {
      querySelector: k => k === '.card.reading' ? card : meta,
      addEventListener: (k, f) => { events[k] = f; }
    },
    window: { addEventListener: (k, f) => { events[k] = f; } },
    clearTimeout: () => { timer = undefined; },
    setTimeout: (fn, delay) => { timer = { fn, delay }; return 1; }
  });
  return { card, nodes, meta, events, get timer() { return timer; }, setNow: iso => { now = Date.parse(iso); } };
}

for (const [iso, title] of [
  ['2026-09-30T23:59:59+09:00', '一読勝負'],
  ['2026-10-01T00:00:00+09:00', '文脈勝負'],
  ['2026-10-31T23:59:59+09:00', '文脈勝負'],
  ['2026-11-01T00:00:00+09:00', '一読勝負'],
  ['2026-11-30T23:59:59+09:00', '一読勝負']
]) test(`JST boundary ${iso}`, () => {
  const h = harness(iso);
  assert.equal(h.nodes['.app-title'].textContent, title);
  assert.equal(h.card.getAttribute('aria-label'), `国語の${title}をはじめる`);
  assert.equal(h.nodes['.action'].firstChild.nodeValue, `${title}をはじめる `);
  assert.ok(h.meta.content.startsWith(title));
  assert.equal(h.card.href, title === '一読勝負' ? studentUrl : 'https://20230104curl.github.io/bunmyaku-shobu/?v=20260906-1');
  if (title === '一読勝負') assert.match(h.nodes['.description'].innerHTML, /本文を３分間読んでから/);
  if (h.timer) assert.ok(h.timer.delay > 0 && h.timer.delay <= 2147483647);
});

test('an already-open portal returns at midnight without reloading', () => {
  const h = harness('2026-10-31T23:59:59+09:00');
  assert.equal(h.timer.delay, 1000);
  h.setNow('2026-11-01T00:00:00+09:00');
  h.timer.fn();
  assert.equal(h.card.href, studentUrl);
  assert.equal(h.nodes['.app-title'].textContent, '一読勝負');
  assert.equal(h.timer, undefined);
});

test('refocusing or tapping an older tab refreshes the reading destination', () => {
  for (const event of ['visibilitychange', 'pageshow', 'focus', 'click', 'auxclick']) {
    const h = harness('2026-10-14T09:00:00+09:00');
    h.setNow('2026-11-01T00:00:00+09:00');
    h.events[event]();
    assert.equal(h.card.href, studentUrl, event);
  }
});

test('the fallback reading card uses the actual production URL and current rules', () => {
  assert.ok(cardHtml.includes(`href="${studentUrl}"`));
  assert.match(cardHtml, /本文を３分間読んでから/);
  assert.doesNotMatch(cardHtml, /一度だけ/);
});
