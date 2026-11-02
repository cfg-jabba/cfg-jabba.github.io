(() => {
'use strict';

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
// Wikimedia "media requests" per file: human traffic only, monthly buckets.
const STATS_API = 'https://wikimedia.org/api/rest_v1/metrics/mediarequests/per-file/all-referers/user';
const STATS_START = '20150101'; // earliest month Wikimedia has data for
const BATCH_SIZE = 50;          // random files per Commons call
const TARGET_MATCHES = 16;      // matches to find per "Dig"
const MAX_ROUNDS = 8;           // give up after this many batches per "Dig"
const STATS_CONCURRENCY = 4;
const STATS_GAP = 350;          // ms between view-count lookups (Wikimedia rate-limits bursts)
const STATS_RETRIES = 3;        // extra tries when Wikimedia says "slow down"
const STATS_CACHE_MAX = 3000;   // view counts remembered in this browser

const TIERS = [
  { key: 'ghost',      name: 'Ghost',      max: 4 },
  { key: 'rare',       name: 'Rare',       max: 30 },
  { key: 'quiet',      name: 'Quiet',      max: 300 },
  { key: 'familiar',   name: 'Familiar',   max: 3000 },
  { key: 'everywhere', name: 'Everywhere', max: Infinity },
];

const NOISE = /\b(logo|flag|coat of arms|escudo|wappen|diagram|map|mapa|karte|scan|screenshot|icon|signature|stamp|banknote|coin|chart|graph|poster|cover|page|plate|document|certificate|invoice|letter|manuscript|sheet|table|schema)\b/i;

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmt = n => Number(n).toLocaleString('en-US');
const pad = n => String(n).padStart(2, '0');

// Build DOM without innerHTML: every string from Wikimedia goes in as text.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}

// Commons metadata fields are HTML. Reduce to plain text; DOMParser never runs scripts.
function plain(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  doc.querySelectorAll('script, style').forEach(n => n.remove());
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('oi:' + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('oi:' + key, JSON.stringify(value)); } catch { /* private mode etc. */ }
  },
};

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */
const score = views => Math.max(0, Math.min(100, Math.round(100 - 20 * Math.log10(1 + views))));
const tierOf = views => TIERS.find(t => views <= t.max);

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */
const state = {
  maxViews: Number(store.get('maxViews', 30)),
  hideNoise: store.get('hideNoise', true),
  pool: [],                 // every file scanned this session, with its view counts
  seenIds: new Set(),
  scanned: 0,
  statsData: 0,             // lookups that returned real data
  digging: false,
  slowUntil: 0,             // Wikimedia asked us to wait until this time
  stop: false,
  saved: store.get('saved', {}),       // id -> item snapshot (+ note)
  localViews: store.get('localViews', {}), // id -> times opened on this site, this browser
};
if (!Number.isFinite(state.maxViews) && state.maxViews !== Infinity) state.maxViews = 30;

const siteViews = it => state.localViews[it.id] || 0;
const totalViews = it => it.commons + siteViews(it);

/* ------------------------------------------------------------------ *
 * Data: Commons + Wikimedia view counts
 * ------------------------------------------------------------------ */
async function fetchCandidates() {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    // Commons caches identical requests for an hour, which would hand back the same
    // "random" 50 files every time. A throwaway parameter makes each request unique
    // (the API ignores it, with a harmless warning).
    nocache: Math.random().toString(36).slice(2),
    generator: 'random', grnnamespace: '6', grnlimit: String(BATCH_SIZE),
    prop: 'imageinfo|globalusage', gulimit: 'max', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '900',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ImageDescription|DateTimeOriginal',
  });
  const res = await fetch(`${COMMONS_API}?${params}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Commons responded ${res.status}`);
  const json = await res.json();
  const q = json.query && json.query.pages;
  const pages = Array.isArray(q) ? q : Object.values(q || {});

  const out = [];
  for (const p of pages) {
    const info = p.imageinfo && p.imageinfo[0];
    if (!info || !info.thumburl) continue;
    if (!/^image\/(jpeg|png|webp)$/.test(info.mime)) continue;
    if (info.width < 900 || info.height < 600) continue;
    const ratio = info.width / info.height;
    if (ratio < 0.4 || ratio > 3) continue;
    if (state.seenIds.has(p.pageid)) continue;
    // A file that sits on a Wikipedia page is almost never rare, and each view-count
    // lookup is rationed by Wikimedia (see takeTurn), so don't spend lookups on those.
    if (p.globalusage && p.globalusage.length) continue;

    const md = info.extmetadata || {};
    const val = k => plain(md[k] && md[k].value);
    let path;
    try { path = new URL(info.url).pathname; } catch { continue; }

    out.push({
      id: p.pageid,
      title: p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' '),
      thumb: info.thumburl,
      tw: info.thumbwidth || info.width,
      th: info.thumbheight || info.height,
      page: info.descriptionurl,
      original: info.url,
      path,
      artist: val('Artist'),
      license: val('LicenseShortName'),
      licenseUrl: val('LicenseUrl'),
      desc: val('ImageDescription'),
      date: val('DateTimeOriginal'),
    });
  }
  return out;
}

const now = new Date();
const monthStart = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}0100`;
const STATS_END = monthStart.slice(0, 8);
const last12From = (() => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1));
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}0100`;
})();

// Wikimedia limits how fast one visitor can ask for view counts (it answers 429 "slow down",
// with a Retry-After in seconds). Every lookup takes a turn in one shared line, spaced
// STATS_GAP apart, and a 429 pauses the whole line.
let nextSlot = 0;
let throttledUntil = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function takeTurn() {
  const slot = Math.max(Date.now(), nextSlot, throttledUntil);
  nextSlot = slot + STATS_GAP;
  const wait = slot - Date.now();
  if (wait > 0) await sleep(wait);
}

// Counts we already looked up are kept in this browser, so a file seen twice costs nothing.
const statsCache = store.get('statsCache', {});
function cacheStats(path, r) {
  statsCache[path] = { s: r.status, t: r.total, l: r.last12, m: monthStart };
  const keys = Object.keys(statsCache);
  if (keys.length > STATS_CACHE_MAX) for (const k of keys.slice(0, keys.length - STATS_CACHE_MAX)) delete statsCache[k];
  store.set('statsCache', statsCache);
}

// Returns { status: 'data' | 'none' | 'error', total, last12 }.
// Wikimedia answers 404 for a file with no recorded requests, which for us means "nobody saw it".
async function fetchViews(file) {
  const hit = statsCache[file.path];
  if (hit && hit.m === monthStart) return { status: hit.s, total: hit.t, last12: hit.l };

  let decoded;
  try { decoded = decodeURIComponent(file.path); } catch { decoded = file.path; }
  const url = `${STATS_API}/${encodeURIComponent(decoded)}/monthly/${STATS_START}/${STATS_END}`;

  for (let attempt = 0; attempt <= STATS_RETRIES; attempt++) {
    await takeTurn();
    let res;
    try { res = await fetch(url); } catch { return { status: 'error' }; }

    if (res.status === 429) {
      // Browsers can't read Retry-After from this API; Wikimedia's own wait is ~25-55 s.
      const secs = Math.min(Number(res.headers.get('retry-after')) || 20 * (attempt + 1), 60);
      throttledUntil = Date.now() + secs * 1000;
      state.slowUntil = throttledUntil;
      continue;
    }
    if (res.status === 404) {
      const r = { status: 'none', total: 0, last12: 0 };
      cacheStats(file.path, r);
      return r;
    }
    if (!res.ok) return { status: 'error' };
    try {
      const json = await res.json();
      let total = 0, last12 = 0;
      for (const row of json.items || []) {
        if (row.timestamp >= monthStart) continue; // skip the current, partial month
        total += row.requests;
        if (row.timestamp >= last12From) last12 += row.requests;
      }
      const r = { status: 'data', total, last12 };
      cacheStats(file.path, r);
      return r;
    } catch {
      return { status: 'error' };
    }
  }
  return { status: 'error' };
}

/* ------------------------------------------------------------------ *
 * Feed
 * ------------------------------------------------------------------ */
const grid = $('#grid');
const statusEl = $('#status');
const banner = $('#banner');

function matches(it) {
  if (totalViews(it) > state.maxViews) return false;
  if (state.hideNoise && NOISE.test(it.title)) return false;
  return true;
}

function viewsLabel(it) {
  const n = totalViews(it);
  return n === 0 ? 'No recorded views' : `${fmt(n)} view${n === 1 ? '' : 's'}`;
}

function makeCard(it) {
  const views = totalViews(it);
  const tier = tierOf(views);
  const img = h('img', { src: it.thumb, alt: it.title, width: it.tw, height: it.th, loading: 'lazy' });
  const card = h('button', {
    type: 'button',
    class: 'card' + (state.saved[it.id] ? ' is-saved' : ''),
    'data-id': it.id,
    'aria-label': `${it.title}. ${tier.name}, obscurity ${score(views)}. ${viewsLabel(it)}.`,
    onclick: () => openDetail(it),
  },
    img,
    h('span', { class: 'badge tier-' + tier.key }, h('b', { text: String(score(views)) }), tier.name),
    h('span', { class: 'meta' },
      h('span', { class: 'title', text: it.title }),
      h('span', { class: 'views', text: viewsLabel(it) })),
  );
  img.addEventListener('error', () => card.remove());
  return card;
}

function tierLabel() {
  if (state.maxViews === Infinity) return 'any';
  const t = TIERS.find(t => t.max === state.maxViews);
  return t ? `${t.name.toLowerCase()} or rarer` : `≤ ${fmt(state.maxViews)} views`;
}

function setStatus() {
  const shown = grid.children.length;
  const slow = state.digging && Date.now() < state.slowUntil;
  const where = slow ? 'Wikimedia asked us to slow down, waiting a moment… ' : state.digging ? 'Digging… ' : '';
  statusEl.textContent = state.scanned === 0
    ? where
    : `${where}Scanned ${fmt(state.scanned)} files · ${fmt(shown)} ${tierLabel()} on screen`;
}

function setDigButtons() {
  for (const b of $$('.digBtn')) {
    b.textContent = state.digging ? 'Stop' : (state.pool.length ? 'Dig deeper' : 'Dig');
  }
}

function showBanner(msg) {
  banner.textContent = msg;
  banner.hidden = !msg;
}

function renderGrid() {
  grid.replaceChildren(...state.pool.filter(matches).map(makeCard));
  setStatus();
}

async function dig() {
  if (state.digging) { state.stop = true; return; }
  state.digging = true; state.stop = false;
  showBanner('');
  setDigButtons();

  let found = 0;
  let rounds = 0;
  let errors = 0;
  try {
    while (found < TARGET_MATCHES && rounds < MAX_ROUNDS && !state.stop) {
      rounds++;
      setStatus();
      const candidates = await fetchCandidates();
      candidates.forEach(c => state.seenIds.add(c.id));

      const scannedBefore = state.scanned;
      await mapLimit(candidates, STATS_CONCURRENCY, async file => {
        if (state.stop) return;
        const r = await fetchViews(file);
        if (r.status === 'error') { errors++; return; }
        if (r.status === 'data') state.statsData++;
        file.commons = r.total;
        file.last12 = r.last12;
        file.statsStatus = r.status;
        state.scanned++;
        state.pool.push(file);
        if (matches(file)) { grid.append(makeCard(file)); found++; }
        setStatus();
      });

      // Every lookup failed outright: stop instead of hammering a service that isn't answering.
      if (candidates.length && state.scanned === scannedBefore) break;

      // Tripwire: lookups succeeded but not one carried any data, so "0 views" can't be trusted.
      if (state.scanned >= 15 && state.statsData === 0) {
        showBanner('Wikimedia returned no view data for any of these files, so the ratings below may be wrong. Try again later.');
        break;
      }
    }
    if (found === 0 && !state.stop && errors > 0 && state.scanned === 0) {
      showBanner('Couldn’t reach Wikimedia just now. Check your connection and hit Dig again.');
    }
  } catch (err) {
    showBanner(`Couldn’t reach Wikimedia (${err.message}). Hit Dig to try again.`);
  } finally {
    state.digging = false; state.stop = false;
    setDigButtons();
    setStatus();
    if (!grid.children.length && state.scanned > 0 && !banner.textContent) {
      statusEl.textContent += ' · nothing this obscure yet, dig deeper';
    }
  }
}

/* ------------------------------------------------------------------ *
 * Detail dialog
 * ------------------------------------------------------------------ */
const dialog = $('#detail');
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => { refreshCards(); renderSaved(); });

function openDetail(it) {
  state.localViews[it.id] = siteViews(it) + 1;
  store.set('localViews', state.localViews);
  paintDetail(it);
  if (!dialog.open) dialog.showModal();
}

function paintDetail(it) {
  const views = totalViews(it);
  const tier = tierOf(views);
  const isSaved = Boolean(state.saved[it.id]);
  const noteBox = h('textarea', { id: 'noteBox', placeholder: 'Why this one? Brief, mood, product idea…' });
  noteBox.value = (state.saved[it.id] && state.saved[it.id].note) || '';

  const sheet = h('div', { class: 'sheet' },
    h('div', { class: 'pic' }, h('img', { src: it.thumb, alt: it.title })),
    h('div', { class: 'info' },
      h('button', { type: 'button', class: 'close', 'aria-label': 'Close', text: '×', onclick: () => dialog.close() }),
      h('h2', { text: it.title }),
      h('p', { class: 'byline', text: [it.artist, it.date].filter(Boolean).join(' · ') || 'Author not listed' }),
      h('div', { class: 'scorebox' },
        h('span', { class: 'num', text: String(score(views)) }),
        h('span', { class: 'tier', text: `${tier.name} · obscurity` })),
      h('div', { class: 'meter', role: 'img', 'aria-label': `Obscurity ${score(views)} out of 100` },
        h('i', { style: `width:${score(views)}%` })),
      h('dl', { class: 'stats' },
        h('dt', { text: 'Views on Wikimedia since 2015' }), h('dd', { text: fmt(it.commons) }),
        h('dt', { text: 'Of those, last 12 months' }), h('dd', { text: fmt(it.last12) }),
        h('dt', { text: 'Opened on this site (this browser)' }), h('dd', { text: fmt(siteViews(it)) }),
        h('dt', { text: 'Counted total' }), h('dd', { text: fmt(views) })),
      h('p', { class: 'note', text: 'People-only traffic served by Wikimedia. It can’t see views elsewhere on the internet, so treat it as a floor.' }),
      h('p', { class: 'license' },
        'License: ',
        it.licenseUrl ? h('a', { href: it.licenseUrl, target: '_blank', rel: 'noopener noreferrer', text: it.license || 'see file page' })
                      : (it.license || 'see file page'),
        '. Check it, and credit the author, before using this in commercial work.'),
      it.desc ? h('p', { class: 'desc', text: it.desc.length > 280 ? it.desc.slice(0, 280) + '…' : it.desc }) : null,
      h('label', { for: 'noteBox', text: 'Your note' }),
      noteBox,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'primary', text: isSaved ? 'Update' : 'Save', onclick: () => saveItem(it, noteBox.value) }),
        isSaved ? h('button', { type: 'button', class: 'ghostbtn', text: 'Remove', onclick: () => removeItem(it) }) : null,
        h('a', { class: 'ghostbtn', href: it.page, target: '_blank', rel: 'noopener noreferrer', text: 'Source page ↗' }),
      ),
    ),
  );
  dialog.replaceChildren(sheet);
}

/* ------------------------------------------------------------------ *
 * Saved
 * ------------------------------------------------------------------ */
function saveItem(it, note) {
  state.saved[it.id] = { ...it, note: note.trim(), savedAt: state.saved[it.id]?.savedAt || Date.now() };
  store.set('saved', state.saved);
  paintDetail(it);
  updateSavedCount();
}

function removeItem(it) {
  delete state.saved[it.id];
  store.set('saved', state.saved);
  paintDetail(it);
  updateSavedCount();
}

function updateSavedCount() {
  $('#savedCount').textContent = String(Object.keys(state.saved).length);
}

function savedList() {
  return Object.values(state.saved).sort((a, b) => b.savedAt - a.savedAt);
}

function renderSaved() {
  const list = savedList();
  $('#savedGrid').replaceChildren(...list.map(makeCard));
  $('#savedEmpty').hidden = list.length > 0;
  $('#savedStatus').textContent = list.length ? `${list.length} saved` : '';
  updateSavedCount();
}

function refreshCards() {
  // Opening an image changes its count and saved state; refresh the badges in place.
  for (const card of $$('#grid .card')) {
    const it = state.pool.find(p => String(p.id) === card.dataset.id);
    if (it) card.replaceWith(makeCard(it));
  }
}

function creditsText() {
  return savedList().map(it => [
    it.title,
    `By: ${it.artist || 'unknown'}`,
    `License: ${it.license || 'see file page'}${it.licenseUrl ? ' (' + it.licenseUrl + ')' : ''}`,
    `Source: ${it.page}`,
    `Views on Wikimedia since 2015: ${fmt(it.commons)} · obscurity ${score(it.commons + siteViews(it))}`,
    it.note ? `Note: ${it.note}` : null,
  ].filter(Boolean).join('\n')).join('\n\n');
}

$('#copyCredits').addEventListener('click', async () => {
  if (!savedList().length) { $('#savedStatus').textContent = 'Nothing to copy yet.'; return; }
  try {
    await navigator.clipboard.writeText(creditsText());
    $('#savedStatus').textContent = 'Credits copied.';
  } catch {
    $('#savedStatus').textContent = 'Couldn’t access the clipboard. Use Download JSON instead.';
  }
});

$('#downloadJson').addEventListener('click', () => {
  if (!savedList().length) { $('#savedStatus').textContent = 'Nothing to download yet.'; return; }
  const blob = new Blob([JSON.stringify(savedList(), null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'obscure-images-saved.json' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */
function showView(name) {
  $('#digView').hidden = name !== 'dig';
  $('#savedView').hidden = name !== 'saved';
  for (const b of $$('.navbtn')) b.setAttribute('aria-pressed', String(b.dataset.view === name));
  if (name === 'saved') renderSaved();
  window.scrollTo({ top: 0 });
}
for (const b of $$('.navbtn')) b.addEventListener('click', () => showView(b.dataset.view));

for (const chip of $$('.chip')) {
  chip.setAttribute('aria-pressed', String(Number(chip.dataset.max) === state.maxViews));
  chip.addEventListener('click', () => {
    state.maxViews = Number(chip.dataset.max);
    store.set('maxViews', state.maxViews === Infinity ? 'Infinity' : state.maxViews);
    for (const c of $$('.chip')) c.setAttribute('aria-pressed', String(c === chip));
    renderGrid();
    if (grid.children.length < TARGET_MATCHES && !state.digging) dig();
  });
}

const noise = $('#noise');
noise.checked = state.hideNoise;
noise.addEventListener('change', () => {
  state.hideNoise = noise.checked;
  store.set('hideNoise', state.hideNoise);
  renderGrid();
});

for (const b of $$('.digBtn')) b.addEventListener('click', dig);

updateSavedCount();
setDigButtons();
dig();
})();
