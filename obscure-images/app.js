(() => {
'use strict';

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
// Internet Archive's search returns each item's all-time download count in the same call,
// so unlike Commons it needs no per-file lookup (and no rationing).
const ARCHIVE_API = 'https://archive.org/advancedsearch.php';
// Design "lenses": steer the feed toward a kind of reference. Each is a handful of search
// words; a custom lens is whatever the designer types. 'all' means no steering.
const LENSES = {
  all:       { name: 'Anything', words: [] },
  materials: { name: 'Materials', words: ['texture', 'fabric', 'textile', 'leather', 'wood grain', 'marble', 'ceramic', 'stone', 'weave', 'metal surface'] },
  patterns:  { name: 'Patterns', words: ['pattern', 'ornament', 'wallpaper', 'tile', 'mosaic', 'lattice', 'geometric', 'repeat'] },
  packaging: { name: 'Packaging', words: ['label', 'packaging', 'tin', 'matchbox', 'bottle', 'wrapper', 'box', 'crate label'] },
  lettering: { name: 'Lettering', words: ['lettering', 'typography', 'signage', 'calligraphy', 'type specimen', 'hand painted sign', 'inscription'] },
  print:     { name: 'Posters & print', words: ['poster', 'lithograph', 'woodblock', 'screenprint', 'engraving', 'broadside', 'ephemera'] },
  objects:   { name: 'Objects', words: ['industrial design', 'furniture', 'chair', 'lamp', 'tool', 'prototype', 'appliance', 'machine'] },
  spaces:    { name: 'Spaces', words: ['interior', 'architecture', 'staircase', 'facade', 'brutalist', 'pavilion', 'lobby', 'ceiling'] },
  sport:     { name: 'Footwear & sport', words: ['shoe', 'sneaker', 'boot', 'sportswear', 'athletic', 'running', 'stadium', 'uniform', 'equipment'] },
};
const SOURCES = {
  commons: 'Wikimedia Commons',
  archive: 'Internet Archive',
};
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

// With a design lens on, words like "poster", "plate" or "label" are the point, so only
// the clearly-not-inspiration kinds are hidden.
const NOISE_STEERED = /\b(logo|flag|coat of arms|screenshot|icon|signature|banknote|diagram|map)\b/i;
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
  source: store.get('source', 'both'),   // 'commons' | 'archive' | 'both'
  lens: store.get('lens', 'all'),        // a LENSES key, or 'q:<words the designer typed>'
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
if (!TIERS.some(t => t.max === state.maxViews)) state.maxViews = 30;
if (!(state.lens in LENSES) && !String(state.lens).startsWith('q:')) state.lens = 'all';
if (!(state.source in SOURCES) && state.source !== 'both') state.source = 'both';

const siteViews = it => state.localViews[it.id] || 0;
const totalViews = it => it.commons + siteViews(it);

/* ------------------------------------------------------------------ *
 * Data: Commons + Wikimedia view counts
 * ------------------------------------------------------------------ */
async function fetchCommons() {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    // Commons caches identical requests for an hour, which would hand back the same
    // "random" 50 files every time. A throwaway parameter makes each request unique
    // (the API ignores it, with a harmless warning).
    nocache: Math.random().toString(36).slice(2),
    ...(lensWords().length
      ? { generator: 'search', gsrnamespace: '6', gsrlimit: String(BATCH_SIZE), gsrsort: 'random', gsrsearch: `filetype:bitmap (${lensQuery()})` }
      : { generator: 'random', grnnamespace: '6', grnlimit: String(BATCH_SIZE) }),
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
      source: 'commons',
      lens: state.lens,
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

// Internet Archive: ask for licensed images at or under the chosen download count, from a
// random upload year and a random page of the results so every Dig differs. The count comes
// back with each item, so these arrive already rated (`views` is set; see dig()).
async function fetchArchive() {
  const year = 2006 + Math.floor(Math.random() * (now.getUTCFullYear() - 2006 + 1));
  const cap = state.maxViews === Infinity ? 100000 : Math.max(state.maxViews, 4);
  const steered = lensWords().length > 0;
  const q = `mediatype:image AND licenseurl:* AND downloads:[0 TO ${cap}]` +
    (steered ? ` AND (${lensQuery()})` : ` AND publicdate:[${year}-01-01 TO ${year}-12-31]`);
  const fields = ['identifier', 'title', 'creator', 'licenseurl', 'downloads', 'date', 'description'];
  const search = page => {
    const params = new URLSearchParams({ q, rows: String(BATCH_SIZE), page: String(page), output: 'json' });
    fields.forEach(f => params.append('fl[]', f));
    return fetch(`${ARCHIVE_API}?${params}`, { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error(`Internet Archive responded ${r.status}`);
      return r.json();
    });
  };
  let json = await search(1 + Math.floor(Math.random() * 10));
  if (!json.response.docs.length) json = await search(1);   // that year has fewer pages: fall back to the first

  const first = v => (Array.isArray(v) ? v[0] : v);
  const out = [];
  for (const d of json.response.docs) {
    const id = 'ia:' + d.identifier;
    if (state.seenIds.has(id)) continue;
    out.push({
      id,
      source: 'archive',
      lens: state.lens,
      title: plain(first(d.title)) || d.identifier,
      thumb: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
      page: `https://archive.org/details/${encodeURIComponent(d.identifier)}`,
      original: `https://archive.org/details/${encodeURIComponent(d.identifier)}`,
      artist: plain(Array.isArray(d.creator) ? d.creator.join(', ') : d.creator),
      license: licenseName(d.licenseurl),
      licenseUrl: first(d.licenseurl) || '',
      desc: plain(Array.isArray(d.description) ? d.description[0] : d.description),
      date: (first(d.date) || '').slice(0, 10),
      views: Number(d.downloads) || 0,
    });
  }
  return out;
}

// "https://creativecommons.org/licenses/by-sa/4.0/" -> "CC BY-SA 4.0"
function licenseName(url) {
  const u = String(Array.isArray(url) ? url[0] : url || '');
  let m = u.match(/creativecommons\.org\/licenses\/([a-z-]+)\/([\d.]+)/i);
  if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
  if (/publicdomain\/zero/i.test(u)) return 'CC0';
  if (/publicdomain\/mark/i.test(u)) return 'Public domain';
  return u ? 'See license link' : '';
}

const lensWords = () => {
  if (state.lens in LENSES) return LENSES[state.lens].words;
  return String(state.lens).slice(2).split(/[\s,]+/).filter(Boolean).slice(0, 8);
};
const lensQuery = () => lensWords().map(w => (/\s/.test(w) ? `"${w}"` : w)).join(' OR ');

// With both sources on, ask each in the same round and interleave the results, so the
// feed mixes them instead of filling up from whichever answers first. If one is down
// the other still delivers.
async function fetchCandidates() {
  if (state.source === 'commons') return fetchCommons();
  if (state.source === 'archive') return fetchArchive();
  const settled = await Promise.allSettled([fetchCommons(), fetchArchive()]);
  if (settled.every(r => r.status === 'rejected')) throw settled[0].reason;
  const [a, b] = settled.map(r => (r.status === 'fulfilled' ? r.value : []));
  const mixed = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) mixed.push(a[i]);
    if (b[i]) mixed.push(b[i]);
  }
  return mixed;
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
  if (state.source !== 'both' && it.source !== state.source) return false;
  if (totalViews(it) > state.maxViews) return false;
  if ((it.lens || 'all') !== state.lens) return false;
  if (state.hideNoise && (state.lens === 'all' ? NOISE : NOISE_STEERED).test(it.title)) return false;
  return true;
}

const isUpload = it => it.source === 'upload';
const unit = it => (it.source === 'archive' ? 'download' : 'view');

function viewsLabel(it) {
  if (isUpload(it)) return 'Your own find';
  const n = totalViews(it);
  return n === 0 ? `No recorded ${unit(it)}s` : `${fmt(n)} ${unit(it)}${n === 1 ? '' : 's'}`;
}

function makeCard(it) {
  const views = totalViews(it);
  const tier = tierOf(views);
  const img = h('img', { src: thumbOf(it), alt: it.title, width: it.tw, height: it.th, loading: 'lazy' });
  const card = h('button', {
    type: 'button',
    class: 'card' + (state.saved[it.id] ? ' is-saved' : ''),
    'data-id': it.id,
    'aria-label': isUpload(it) ? `${it.title}. Your own find.` : `${it.title}. ${tier.name}, obscurity ${score(views)}. ${viewsLabel(it)}.`,
    onclick: () => openDetail(it),
  },
    img,
    isUpload(it)
      ? h('span', { class: 'badge tier-yours' }, 'Yours')
      : h('span', { class: 'badge tier-' + tier.key }, h('b', { text: String(score(views)) }), tier.name),
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

// Endless scroll: whenever the bottom of the feed is within reach, dig again.
// Pressing Stop pauses it until the reader presses Dig again; a dig that finds nothing
// waits a few seconds before the next, so an empty tier doesn't hammer the sources.
let autoPaused = false;
let lastFound = 0;
let lastDigEnd = 0;
function nearBottom() {
  return !$('#digView').hidden && document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 1500;
}
function maybeMore() {
  if (state.digging || autoPaused || !nearBottom()) return;
  if (lastFound === 0 && Date.now() - lastDigEnd < 5000) return;
  dig();
}

async function dig(fromUser = false) {
  if (state.digging) { state.stop = true; autoPaused = true; return; }
  if (fromUser === true) autoPaused = false;
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
        if (file.views != null) {
          // Already rated: the source handed us the count with the item.
          file.commons = file.views;
          file.last12 = null;
          file.statsStatus = 'data';
          state.statsData++;
        } else {
          const r = await fetchViews(file);
          if (r.status === 'error') { errors++; return; }
          if (r.status === 'data') state.statsData++;
          file.commons = r.total;
          file.last12 = r.last12;
          file.statsStatus = r.status;
        }
        state.scanned++;
        state.pool.push(file);
        if (matches(file)) { grid.append(makeCard(file)); found++; }
        setStatus();
      });

      // Every lookup failed outright: stop instead of hammering a service that isn't answering.
      if (candidates.length && state.scanned === scannedBefore) break;
      if (state.stop) break;

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
    showBanner(`Couldn’t reach the image source (${err.message}). Hit Dig to try again.`);
  } finally {
    state.digging = false; state.stop = false;
    lastFound = found; lastDigEnd = Date.now();
    setDigButtons();
    setStatus();
    setTimeout(maybeMore, found ? 0 : 5000);
    if (state.scanned === 0 && !banner.textContent && !state.stop) {
      showBanner('Nothing came back. A blocker or a flaky connection may be stopping Wikimedia and the Internet Archive from answering. Hit Dig to try again.');
    }
    if (!grid.children.length && state.scanned > 0 && !banner.textContent) {
      statusEl.textContent += ' · nothing this obscure yet, dig deeper';
    }
  }
}

/* ------------------------------------------------------------------ *
 * Uploaded finds: the image file lives in this browser's IndexedDB (localStorage is too
 * small for pictures); the saved record only holds the text.
 * ------------------------------------------------------------------ */
const uploadUrls = {};   // id -> object URL for the stored picture
function thumbOf(it) { return isUpload(it) ? (uploadUrls[it.id] || '') : it.thumb; }

const idb = {
  _db: null,
  open() {
    if (!this._db) {
      this._db = new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('no IndexedDB'));
        const req = indexedDB.open('obscure-images', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('files');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this._db;
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', mode);
      const req = fn(tx.objectStore('files'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  },
  put: (key, blob) => idb.run('readwrite', s => s.put(blob, key)),
  get: key => idb.run('readonly', s => s.get(key)),
  del: key => idb.run('readwrite', s => s.delete(key)),
};

async function restoreUploads() {
  const mine = Object.values(state.saved).filter(isUpload);
  for (const it of mine) {
    try {
      const blob = await idb.get(it.id);
      if (blob) uploadUrls[it.id] = URL.createObjectURL(blob);
    } catch { /* storage unavailable: the card will show without a picture */ }
  }
  if (mine.length) renderSaved();
}

/* ------------------------------------------------------------------ *
 * Colour and mood: read from a tiny copy of the picture, so Saved can be searched by
 * "blue" or "dark". Only works where the image host allows it (Commons and uploads do;
 * Internet Archive thumbnails don't, so those stay untagged).
 * ------------------------------------------------------------------ */
const HUES = [
  ['red', 345, 15], ['orange', 15, 45], ['yellow', 45, 70], ['green', 70, 165],
  ['teal', 165, 200], ['blue', 200, 255], ['purple', 255, 290], ['pink', 290, 345],
];
const hueName = deg => (HUES.find(([, a, b]) => (a < b ? deg >= a && deg < b : deg >= a || deg < b)) || HUES[0])[0];

function analyseColor(url) {
  return new Promise(resolve => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const N = 24;
        const c = document.createElement('canvas');
        c.width = c.height = N;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, N, N);
        const px = g.getImageData(0, 0, N, N).data;
        let L = 0, S = 0, n = 0;
        const buckets = {};
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i] / 255, gg = px[i + 1] / 255, b = px[i + 2] / 255;
          const max = Math.max(r, gg, b), min = Math.min(r, gg, b), d = max - min;
          const l = (max + min) / 2;
          const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
          L += l; S += s; n++;
          if (s < 0.25 || max < 0.2) continue;   // too grey or dark to count as a colour
          let hue = max === r ? ((gg - b) / d) % 6 : max === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
          hue = (hue * 60 + 360) % 360;
          const name = hueName(hue);
          const k = buckets[name] || (buckets[name] = { w: 0, r: 0, g: 0, b: 0, v: 0 });
          const w = s * max;
          k.w += w; k.r += px[i] * w; k.g += px[i + 1] * w; k.b += px[i + 2] * w; k.v += max;
          k.n = (k.n || 0) + 1;
        }
        L /= n; S /= n;
        let name, hex = '#808080';
        const top = Object.entries(buckets).sort((a, b) => b[1].w - a[1].w)[0];
        if (S < 0.12 || !top || top[1].n < n * 0.08) {
          name = L < 0.25 ? 'black' : L > 0.75 ? 'white' : 'grey';
        } else {
          name = top[0];
          const k = top[1];
          if ((name === 'orange' || name === 'red' || name === 'yellow') && k.v / k.n < 0.6) name = 'brown';
          hex = '#' + [k.r, k.g, k.b].map(v => Math.round(v / k.w).toString(16).padStart(2, '0')).join('');
        }
        const mood = L < 0.3 ? 'dark' : L > 0.68 ? 'bright' : S > 0.5 ? 'vivid' : S < 0.22 ? 'muted' : 'balanced';
        resolve({ name, mood, hex });
      } catch { resolve(null); }   // tainted canvas etc.
    };
    img.src = url;
  });
}

let colouring = false;
async function colourSaved() {
  if (colouring) return;
  colouring = true;
  try {
    for (const it of Object.values(state.saved)) {
      if (it.color !== undefined || it.source === 'archive') continue;
      const color = await analyseColor(thumbOf(it));
      const live = state.saved[it.id];
      if (!live) continue;
      live.color = color || null;   // null = tried, can't be read; don't retry every time
      store.set('saved', state.saved);
    }
  } finally { colouring = false; }
  if (!$('#savedView').hidden) renderSaved(false);
}

/* ------------------------------------------------------------------ *
 * Detail dialog
 * ------------------------------------------------------------------ */
const dialog = $('#detail');
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => { refreshCards(); renderSaved(); });

function openDetail(it) {
  if (!isUpload(it)) {
    state.localViews[it.id] = siteViews(it) + 1;
    store.set('localViews', state.localViews);
  }
  paintDetail(it);
  if (!dialog.open) dialog.showModal();
}

const splitTags = s => [...new Set(String(s).split(/[,#]/).map(t => t.trim().toLowerCase()).filter(Boolean))];

function paintDetail(it) {
  const views = totalViews(it);
  const tier = tierOf(views);
  const saved = state.saved[it.id];
  const isSaved = Boolean(saved);
  const own = isUpload(it);
  const noteBox = h('textarea', { id: 'noteBox', placeholder: 'Why this one? Brief, mood, product idea…' });
  noteBox.value = (saved && saved.note) || '';
  const boardBox = h('input', { id: 'boardBox', type: 'text', list: 'boardList', maxlength: '40', placeholder: 'e.g. Spring campaign' });
  boardBox.value = (saved && saved.board) || '';
  const tagsBox = h('input', { id: 'tagsBox', type: 'text', maxlength: '120', placeholder: 'rust, quiet, symmetry' });
  tagsBox.value = ((saved && saved.tags) || []).join(', ');
  const boardList = h('datalist', { id: 'boardList' }, boardNames().map(b => h('option', { value: b })));

  const unitName = it.source === 'archive' ? 'Downloads on the Internet Archive (all time)' : 'Views on Wikimedia since 2015';
  const stats = own ? null : h('dl', { class: 'stats' },
    h('dt', { text: unitName }), h('dd', { text: fmt(it.commons) }),
    it.last12 != null ? [h('dt', { text: 'Of those, last 12 months' }), h('dd', { text: fmt(it.last12) })] : null,
    h('dt', { text: 'Opened on this site (this browser)' }), h('dd', { text: fmt(siteViews(it)) }),
    h('dt', { text: 'Counted total' }), h('dd', { text: fmt(views) }));
  const statNote = it.source === 'archive'
    ? 'Downloads counted by the Internet Archive. It can’t see views elsewhere on the internet, so treat it as a floor.'
    : 'People-only traffic served by Wikimedia. It can’t see views elsewhere on the internet, so treat it as a floor.';

  const sheet = h('div', { class: 'sheet' },
    h('div', { class: 'pic' }, h('img', { src: thumbOf(it), alt: it.title })),
    h('div', { class: 'info' },
      h('button', { type: 'button', class: 'close', 'aria-label': 'Close', text: '×', onclick: () => dialog.close() }),
      h('h2', { text: it.title }),
      h('p', { class: 'byline', text: [it.artist, it.date].filter(Boolean).join(' · ') || 'Author not listed' }),
      own ? h('p', { class: 'note', text: 'Your own find. It stays in this browser and isn’t rated.' }) : [
        h('div', { class: 'scorebox' },
          h('span', { class: 'num', text: String(score(views)) }),
          h('span', { class: 'tier', text: `${tier.name} · obscurity` })),
        h('div', { class: 'meter', role: 'img', 'aria-label': `Obscurity ${score(views)} out of 100` },
          h('i', { style: `width:${score(views)}%` })),
        stats,
        h('p', { class: 'note', text: statNote }),
      ],
      h('p', { class: 'license' },
        'License: ',
        it.licenseUrl ? h('a', { href: it.licenseUrl, target: '_blank', rel: 'noopener noreferrer', text: it.license || 'see source page' })
                      : (it.license || (own ? 'not entered' : 'see source page')),
        own ? '.' : '. Check it, and credit the author, before using this in commercial work.'),
      it.desc ? h('p', { class: 'desc', text: it.desc.length > 280 ? it.desc.slice(0, 280) + '…' : it.desc }) : null,
      h('label', { for: 'noteBox', text: 'Your note' }),
      noteBox,
      h('div', { class: 'two' },
        h('div', {}, h('label', { for: 'boardBox', text: 'Board' }), boardBox, boardList),
        h('div', {}, h('label', { for: 'tagsBox', text: 'Tags (comma separated)' }), tagsBox)),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'primary', text: isSaved ? 'Update' : 'Save',
          onclick: () => saveItem(it, { note: noteBox.value, board: boardBox.value, tags: tagsBox.value }) }),
        isSaved ? h('button', { type: 'button', class: 'ghostbtn', text: 'Remove', onclick: () => removeItem(it) }) : null,
        it.page ? h('a', { class: 'ghostbtn', href: it.page, target: '_blank', rel: 'noopener noreferrer', text: 'Source page ↗' }) : null,
      ),
    ),
  );
  dialog.replaceChildren(sheet);
}

/* ------------------------------------------------------------------ *
 * Saved: boards, tags, colour, search
 * ------------------------------------------------------------------ */
const savedFilter = { q: '', board: '', tag: '', color: '', mood: '' };

function saveItem(it, { note, board, tags }) {
  const prev = state.saved[it.id];
  state.saved[it.id] = {
    ...it, ...(prev && prev.color !== undefined ? { color: prev.color } : {}),
    note: note.trim(), board: board.trim(), tags: splitTags(tags),
    savedAt: prev?.savedAt || Date.now(),
  };
  store.set('saved', state.saved);
  paintDetail(it);
  updateSavedCount();
  colourSaved();
}

async function removeItem(it) {
  delete state.saved[it.id];
  store.set('saved', state.saved);
  if (isUpload(it)) {
    try { await idb.del(it.id); } catch { /* nothing to clean up */ }
    if (uploadUrls[it.id]) { URL.revokeObjectURL(uploadUrls[it.id]); delete uploadUrls[it.id]; }
    if (dialog.open) dialog.close();
    return;
  }
  paintDetail(it);
  updateSavedCount();
}

function updateSavedCount() {
  $('#savedCount').textContent = String(Object.keys(state.saved).length);
}

function savedList() {
  return Object.values(state.saved).sort((a, b) => b.savedAt - a.savedAt);
}

function boardNames() {
  return [...new Set(savedList().map(i => i.board).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function savedMatches(it) {
  const f = savedFilter;
  if (f.board && it.board !== f.board) return false;
  if (f.tag && !(it.tags || []).includes(f.tag)) return false;
  if (f.color && !(it.color && it.color.name === f.color)) return false;
  if (f.mood && !(it.color && it.color.mood === f.mood)) return false;
  if (f.q) {
    const hay = [it.title, it.note, it.board, it.artist, ...(it.tags || [])].join(' ').toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}

function filterChips(host, label, key, counts, swatches) {
  host.replaceChildren();
  host.hidden = counts.size === 0;
  if (!counts.size) return;
  host.append(h('span', { class: 'chiplabel', text: label }));
  for (const [value, count] of counts) {
    const on = savedFilter[key] === value;
    host.append(h('button', {
      type: 'button', class: 'chip small', 'aria-pressed': String(on),
      onclick: () => { savedFilter[key] = on ? '' : value; renderSaved(false); },
    }, swatches && swatches[value] ? h('i', { class: 'swatch', style: `background:${swatches[value]}` }) : null,
      value, h('small', { text: String(count) })));
  }
}

function renderSaved(refreshChips = true) {
  const all = savedList();
  const list = all.filter(savedMatches);
  $('#savedGrid').replaceChildren(...list.map(makeCard));
  $('#savedEmpty').hidden = all.length > 0;
  $('#savedTools').hidden = all.length === 0;
  $('#savedStatus').textContent = !all.length ? '' : list.length === all.length
    ? `${all.length} saved` : `${list.length} of ${all.length} saved`;

  const tally = pick => {
    const m = new Map();
    for (const it of all) for (const v of [].concat(pick(it) || [])) if (v) m.set(v, (m.get(v) || 0) + 1);
    return new Map([...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0])));
  };
  const swatches = {};
  for (const it of all) if (it.color && !swatches[it.color.name]) swatches[it.color.name] = it.color.hex;
  filterChips($('#boardChips'), 'Boards', 'board', tally(i => i.board));
  filterChips($('#tagChips'), 'Tags', 'tag', tally(i => i.tags));
  filterChips($('#colorChips'), 'Colour', 'color', tally(i => i.color && i.color.name), swatches);
  filterChips($('#moodChips'), 'Mood', 'mood', tally(i => i.color && i.color.mood));
  updateSavedCount();
  if (refreshChips) colourSaved();
}

$('#savedSearch').addEventListener('input', e => { savedFilter.q = e.target.value.trim(); renderSaved(false); });

function refreshCards() {
  // Opening an image changes its count and saved state; refresh the badges in place.
  for (const card of $$('#grid .card')) {
    const it = state.pool.find(p => String(p.id) === card.dataset.id);
    if (it) card.replaceWith(makeCard(it));
  }
}

function creditsText() {
  const items = savedList().filter(savedMatches);
  return items.map(it => [
    it.title,
    `By: ${it.artist || 'unknown'}`,
    `License: ${it.license || 'see source page'}${it.licenseUrl ? ' (' + it.licenseUrl + ')' : ''}`,
    isUpload(it) ? 'Source: own find, uploaded in this browser' : `Source: ${it.page}`,
    isUpload(it) ? null
      : `${it.source === 'archive' ? 'Downloads on the Internet Archive' : 'Views on Wikimedia since 2015'}: ${fmt(it.commons)} · obscurity ${score(it.commons + siteViews(it))}`,
    it.board ? `Board: ${it.board}` : null,
    it.tags && it.tags.length ? `Tags: ${it.tags.join(', ')}` : null,
    it.note ? `Note: ${it.note}` : null,
  ].filter(Boolean).join('\n')).join('\n\n');
}

$('#copyCredits').addEventListener('click', async () => {
  if (!savedList().filter(savedMatches).length) { $('#savedStatus').textContent = 'Nothing to copy yet.'; return; }
  try {
    await navigator.clipboard.writeText(creditsText());
    $('#savedStatus').textContent = 'Credits copied (what you’re filtering to).';
  } catch {
    $('#savedStatus').textContent = 'Couldn’t access the clipboard. Use Download JSON instead.';
  }
});

$('#downloadJson').addEventListener('click', () => {
  const items = savedList().filter(savedMatches);
  if (!items.length) { $('#savedStatus').textContent = 'Nothing to download yet.'; return; }
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'obscure-images-saved.json' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ------------------------------------------------------------------ *
 * Add your own find
 * ------------------------------------------------------------------ */
const addDlg = $('#addDlg');
const addForm = $('#addForm');
addDlg.addEventListener('click', e => { if (e.target === addDlg) addDlg.close(); });
$('#addFind').addEventListener('click', () => {
  addForm.reset();
  $('#addMsg').textContent = '';
  $('#addBoards').replaceChildren(...boardNames().map(b => h('option', { value: b })));
  addDlg.showModal();
});
$('#addCancel').addEventListener('click', () => addDlg.close());

// Shrink to 1400 px on the long side so a phone photo doesn't eat the browser's storage.
function shrink(file, max = 1400) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t an image the browser can read.')); };
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * k), hh = Math.round(img.naturalHeight * k);
      const c = document.createElement('canvas');
      c.width = w; c.height = hh;
      c.getContext('2d').drawImage(img, 0, 0, w, hh);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? resolve({ blob: b, w, h: hh }) : reject(new Error('Couldn’t process that image.')), 'image/jpeg', 0.86);
    };
    img.src = url;
  });
}

addForm.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#addMsg');
  const fd = new FormData(addForm);
  const file = fd.get('file');
  if (!file || !file.size) { msg.textContent = 'Choose an image first.'; return; }
  msg.textContent = 'Saving…';
  try {
    const { blob, w, h: hh } = await shrink(file);
    const id = 'up:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    await idb.put(id, blob);
    uploadUrls[id] = URL.createObjectURL(blob);
    const title = String(fd.get('title') || '').trim() || file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
    state.saved[id] = {
      id, source: 'upload', title, tw: w, th: hh, thumb: '', page: '', commons: 0, last12: null,
      artist: String(fd.get('artist') || '').trim(), license: String(fd.get('license') || '').trim(),
      licenseUrl: '', desc: '', date: '',
      note: String(fd.get('note') || '').trim(), board: String(fd.get('board') || '').trim(),
      tags: splitTags(fd.get('tags') || ''), savedAt: Date.now(),
    };
    store.set('saved', state.saved);
    addDlg.close();
    showView('saved');
  } catch (err) {
    msg.textContent = err && err.message ? err.message : 'Couldn’t save that image in this browser.';
  }
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

for (const chip of $$('.chip[data-max]')) {
  chip.setAttribute('aria-pressed', String(Number(chip.dataset.max) === state.maxViews));
  chip.addEventListener('click', () => {
    state.maxViews = Number(chip.dataset.max);
    store.set('maxViews', state.maxViews === Infinity ? 'Infinity' : state.maxViews);
    for (const c of $$('.chip[data-max]')) c.setAttribute('aria-pressed', String(c === chip));
    renderGrid();
    if (grid.children.length < TARGET_MATCHES && !state.digging) dig();
  });
}

// Design lens: preset chips plus a box for your own words. Changing it starts a fresh feed.
function setLens(lens) {
  if (lens === state.lens) return;
  state.lens = lens;
  store.set('lens', lens);
  paintLens();
  grid.replaceChildren();
  window.scrollTo({ top: 0 });
  if (state.digging) state.stop = true;
  autoPaused = false;
  setStatus();
  setTimeout(() => { if (!state.digging) dig(true); else lensWait(); }, 0);
}
// If a dig was still winding down, retry once it has finished.
function lensWait() {
  const t = setInterval(() => { if (!state.digging) { clearInterval(t); dig(true); } }, 200);
}
function paintLens() {
  const custom = String(state.lens).startsWith('q:');
  $('#lensChips').replaceChildren(...Object.entries(LENSES).map(([key, l]) =>
    h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.lens === key), onclick: () => { $('#lensInput').value = ''; setLens(key); } }, l.name)));
  if (custom) $('#lensInput').value = String(state.lens).slice(2);
}
$('#lensForm').addEventListener('submit', e => {
  e.preventDefault();
  const words = $('#lensInput').value.trim().toLowerCase().replace(/\s+/g, ' ');
  setLens(words ? 'q:' + words : 'all');
});
paintLens();

for (const chip of $$('.srcchip')) {
  chip.setAttribute('aria-pressed', String(chip.dataset.source === state.source));
  chip.addEventListener('click', () => {
    state.source = chip.dataset.source;
    store.set('source', state.source);
    for (const c of $$('.srcchip')) c.setAttribute('aria-pressed', String(c === chip));
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

for (const b of $$('.digBtn')) b.addEventListener('click', () => dig(true));
window.addEventListener('scroll', maybeMore, { passive: true });

updateSavedCount();
setDigButtons();
restoreUploads();
dig();
})();
