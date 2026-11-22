import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { makeBlob, compile, BESPOKE, D, TAU, V3 } from './engine.js';
import { THEMES } from './themes.js';
import { BRAND, FONT as bfont, drawLogo, pill, burst, pattern, blobPath } from './brand.js';

const $ = s => document.querySelector(s);
const PER = 15;

/* ---------- scene ---------- */

const canvas = $('#c');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
catch (e) { $('#err').style.display = 'grid'; throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#ffffff');
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;
scene.add(new THREE.HemisphereLight(0xffffff, 0xe8e4f5, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(-5, 22, 8); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = 0.04; sun.shadow.radius = 5;
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
scene.add(sun);
{
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: 0x5b4a8a, opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
}
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
Object.assign(controls, { enableDamping: true, enablePan: false, minDistance: 4, maxDistance: 80, maxPolarAngle: 86 * D });
const rc = new THREE.Raycaster();

/* ---------- theme data ---------- */

const specCache = new Map();
function specsFor(ti) {
  if (!specCache.has(ti)) {
    const th = THEMES[ti];
    specCache.set(ti, th.doods.map((d, i) => {
      const base = d[0] === '@' ? BESPOKE[d.slice(1)] : compile(d, th.pal);
      let h = 0; for (const ch of base.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      return { ...base, rarity: i === PER - 1 ? 'Ultra Rare' : i >= PER - 4 ? 'Rare' : 'Common', stats: base.stats || [1 + h % 5, 1 + (h >> 4) % 5, 5], blurb: base.blurb || th.tag };
    }));
  }
  return specCache.get(ti);
}
let found = {};
try { found = JSON.parse(localStorage.getItem('doods-found') || '{}'); } catch { /* storage unavailable: collection just won't persist */ }
const foundSet = ti => new Set(found[THEMES[ti].id] || []);
function markFound(ti, i) {
  const s = foundSet(ti), fresh = !s.has(i); s.add(i); found[THEMES[ti].id] = [...s];
  try { localStorage.setItem('doods-found', JSON.stringify(found)); } catch { /* ignore */ }
  return fresh;
}

/* ---------- Dood instances ---------- */

const shadeTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const ctx = cv.getContext('2d'), gr = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(70,50,120,.55)'); gr.addColorStop(0.55, 'rgba(70,50,120,.22)'); gr.addColorStop(1, 'rgba(70,50,120,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
})();
const shadeGeo = new THREE.PlaneGeometry(3.3, 3.0).rotateX(-Math.PI / 2);
const proxyGeo = new THREE.SphereGeometry(1.25, 12, 8), proxyMat = new THREE.MeshBasicMaterial({ visible: false });

let blobs = [];
function spawn(spec, idx) {
  const root = makeBlob(spec); scene.add(root);
  const proxy = new THREE.Mesh(proxyGeo, proxyMat); scene.add(proxy);
  const shade = new THREE.Mesh(shadeGeo, new THREE.MeshBasicMaterial({ map: shadeTex, transparent: true, depthWrite: false })); scene.add(shade);
  const b = { spec, idx, root, proxy, shade, home: new V3(), yaw: (Math.sin(idx * 12.9898) * 43758.5453 % 1) * 0.3, s: 0, sv: 0, w: 0, wv: 0, vis: 0, hop: -1, nextHop: 2 + Math.random() * 8, ph: Math.random() * 10, held: false };
  proxy.userData.b = b;
  return b;
}
function disposeTree(o) {
  o.traverse(m => { if (m.isMesh) { m.geometry.dispose(); for (const mat of [].concat(m.material)) { mat.map?.dispose(); mat.dispose(); } } });
  scene.remove(o);
}
function kill(b) {
  b.root.traverse(m => { if (m.isMesh) { m.geometry.dispose(); m.material.map?.dispose(); } });   // shared colour materials are cached, leave them
  scene.remove(b.root, b.proxy, b.shade); b.shade.material.dispose();
}
function place(b, x, z) { b.home.set(x, 0, z); b.root.position.copy(b.home); b.proxy.position.set(x, 1.2, z); b.shade.position.set(x, 0.012, z); }

/* ---------- packaging: blind bag + display box ---------- */

const BW = 2.0, BH = 2.9, TEAR = 0.84;     // bag size; tear line as a fraction of half-height
function bagGeo(y0, y1, zig) {
  const NX = 22, NY = 16, pos = [], uv = [], idx = [];
  const add = side => {
    const base = pos.length / 3;
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
      const x = i / NX * 2 - 1, y = y0 + (y1 - y0) * j / NY;
      const fy = Math.abs(y) < TEAR ? Math.pow(1 - (y / TEAR) ** 2, 0.45) : 0;
      const z = side * (0.02 + 0.42 * Math.pow(1 - x * x, 0.55) * fy + 0.012 * Math.sin(x * 9 + y * 13) * fy);
      let yy = y * BH / 2;
      if (zig && Math.abs(y) > 0.999) yy += Math.sign(y) * 0.05 * (Math.round((x + 1) * 9) % 2 ? 1 : -1);
      pos.push(x * BW / 2, yy, z); uv.push((x + 1) / 2, (y + 1) / 2);
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const a = base + j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
      side > 0 ? idx.push(a, b, c, b, d, c) : idx.push(a, c, b, b, c, d);
    }
  };
  add(1); add(-1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  return geo;
}
const bagMainGeo = bagGeo(-1, TEAR, true), bagStripGeo = bagGeo(TEAR, 1, true);

function label(ctx, text, x, y, px, fill, stroke = BRAND.ink, maxW) {
  ctx.font = bfont(px); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  if (maxW) { const w = ctx.measureText(text).width; if (w > maxW) { px *= maxW / w; ctx.font = bfont(px); } }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = px * 0.22; ctx.strokeText(text, x, y); }
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}
function tex(cv) { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
function backdrop(ctx, W, H, th, seed) {
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, th.bag[0]); g.addColorStop(1, th.bag[1]); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 0.32, 0, W / 2, H * 0.32, W * 0.75); glow.addColorStop(0, 'rgba(255,255,255,.38)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  pattern(ctx, W, H, seed);
}
// the theme name on a tilted ink ribbon with notched ends
function ribbon(ctx, text, cx, cy, w, h) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.045);
  ctx.fillStyle = 'rgba(58,21,96,.25)'; ctx.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
  ctx.fillStyle = BRAND.ink; ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, -h / 2); ctx.lineTo(w / 2 - h * 0.3, 0); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.lineTo(-w / 2 + h * 0.3, 0); ctx.closePath(); ctx.fill();
  label(ctx, text.toUpperCase(), 0, h * 0.04, h * 0.58, BRAND.yellow, null, w - h * 1.3);
  ctx.restore();
}

function bagTexture(th, ti) {
  const W = 512, H = 742, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), crimp = H * (1 - TEAR) / 2, no = String(ti + 1).padStart(2, '0');
  backdrop(ctx, W, H, th, ti);
  for (const y0 of [0, H - crimp]) {       // crimped seals
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(0, y0, W, crimp);
    ctx.fillStyle = 'rgba(0,0,0,.1)'; for (let x = 0; x < W; x += 12) ctx.fillRect(x, y0, 5, crimp);
  }
  ctx.setLineDash([12, 9]); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, crimp + 5); ctx.lineTo(W, crimp + 5); ctx.stroke(); ctx.setLineDash([]);
  label(ctx, '✂ TEAR HERE', W / 2, crimp + 22, 15, '#ffffff', null);
  drawLogo(ctx, W / 2, 158, 128);
  ribbon(ctx, th.name, W / 2, 268, 400, 58);
  // mystery window
  ctx.fillStyle = BRAND.ink; ctx.beginPath(); ctx.arc(W / 2, 440, 128, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(W / 2, 440, 116, 0, TAU); ctx.fill();
  ctx.fillStyle = BRAND.ink; blobPath(ctx, W / 2, 448, 86); ctx.fill();
  label(ctx, '?', W / 2, 446, 100, BRAND.yellow, null);
  burst(ctx, 418, 356, 54, [['BLIND', 19, '#d3122f'], ['BAG!', 19, '#d3122f']]);
  label(ctx, 'WHO’S INSIDE?', W / 2, 600, 32, '#ffffff');
  // info bar
  ctx.fillStyle = BRAND.ink; ctx.fillRect(0, 630, W, 50);
  ctx.font = bfont(17); ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
  ctx.textAlign = 'left'; ctx.fillText(`SERIES ${no}`, 22, 656); ctx.textAlign = 'right'; ctx.fillText('AGES 4+', W - 22, 656);
  ctx.textAlign = 'center'; ctx.fillStyle = BRAND.yellow; ctx.fillText(`1 OF ${PER} TO COLLECT`, W / 2, 656);
  return tex(cv);
}
function headerTexture(th, ti) {
  const W = 1024, H = 640, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  backdrop(ctx, W, H, th, ti + 9);
  drawLogo(ctx, W / 2 - 60, 150, 215);
  pill(ctx, BRAND.tagline, W / 2 - 60, 290, 24, { bg: '#ffffff', fg: BRAND.ink });
  ribbon(ctx, th.name, W / 2, 372, 640, 76);
  label(ctx, `BLIND BAGS · ${PER} TO COLLECT · SERIES ${String(ti + 1).padStart(2, '0')}`, W / 2, 446, 28, '#ffffff', BRAND.ink, W - 120);
  burst(ctx, 900, 150, 98, [['ONLY', 22], ['$4.97', 46, '#d3122f'], ['EACH!', 22]]);
  return tex(cv);
}
function lipTexture(th) {
  const W = 1024, H = 180, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'); ctx.fillStyle = BRAND.ink; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = th.bag[1]; ctx.fillRect(0, 0, W, 16); ctx.fillRect(0, H - 16, W, 16);
  ctx.fillStyle = BRAND.pink; blobPath(ctx, 70, H / 2 + 4, 44); ctx.fill(); ctx.fillStyle = BRAND.teal; blobPath(ctx, W - 70, H / 2 + 4, 44); ctx.fill();
  label(ctx, 'RIP IT · REVEAL IT · COLLECT ’EM ALL!', W / 2, H / 2 + 4, 48, BRAND.yellow, null, W - 280);
  return tex(cv);
}

const BOX = { w: 9.6, d: 5.4, front: 1.5, back: 7.4, t: 0.16 };
let pack = null;       // { group, bags: [{ g, main, strip, slot }], textures }
function buildPack(ti) {
  const th = THEMES[ti], group = new THREE.Group();
  const card = new THREE.MeshStandardMaterial({ color: th.bag[1], roughness: 0.85 }), inner = new THREE.MeshStandardMaterial({ color: '#fff7ea', roughness: 0.9 });
  const tHead = headerTexture(th, ti), tLip = lipTexture(th), tBag = bagTexture(th, ti);
  const faced = t => [card, card, card, card, new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }), inner];
  const add = (m, x, y, z) => { m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; group.add(m); return m; };
  add(new THREE.Mesh(new THREE.BoxGeometry(BOX.w, BOX.t, BOX.d), inner), 0, BOX.t / 2, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(BOX.w, BOX.front, BOX.t), faced(tLip)), 0, BOX.front / 2, BOX.d / 2);
  // header card with rounded shoulders
  const hs = new THREE.Shape(), hw = BOX.w / 2, R = 1.1;
  hs.moveTo(-hw, 0); hs.lineTo(hw, 0); hs.lineTo(hw, BOX.back - R); hs.quadraticCurveTo(hw, BOX.back, hw - R, BOX.back); hs.lineTo(-hw + R, BOX.back); hs.quadraticCurveTo(-hw, BOX.back, -hw, BOX.back - R); hs.lineTo(-hw, 0);
  tHead.repeat.set(1 / BOX.w, 1 / 4.4); tHead.offset.set(0.5, -(BOX.back - 4.4) / 4.4);
  const head = new THREE.Mesh(new THREE.ExtrudeGeometry(hs, { depth: BOX.t, bevelEnabled: false }), [new THREE.MeshStandardMaterial({ map: tHead, roughness: 0.8 }), card]);
  add(head, 0, 0, -BOX.d / 2 - BOX.t / 2);
  add(new THREE.Mesh(new THREE.BoxGeometry(BOX.w, BOX.back - 4.4, BOX.t * 0.5), inner), 0, (BOX.back - 4.4) / 2, -BOX.d / 2 + BOX.t / 2 + 0.02);
  const ss = new THREE.Shape(); ss.moveTo(-BOX.d / 2, 0); ss.lineTo(BOX.d / 2, 0); ss.lineTo(BOX.d / 2, BOX.front); ss.lineTo(-BOX.d / 2, 4.2); ss.lineTo(-BOX.d / 2, 0);
  const sideGeo = new THREE.ExtrudeGeometry(ss, { depth: BOX.t, bevelEnabled: false });
  for (const sd of [-1, 1]) { const m = add(new THREE.Mesh(sideGeo, card), sd * BOX.w / 2 + (sd > 0 ? 0 : BOX.t), 0, 0); m.rotation.y = -Math.PI / 2; }

  const bagMat = new THREE.MeshPhysicalMaterial({ map: tBag, metalness: 0.55, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.3, side: THREE.DoubleSide });
  const bags = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    const g = new THREE.Group(), main = new THREE.Mesh(bagMainGeo, bagMat), strip = new THREE.Mesh(bagStripGeo, bagMat.clone());
    main.castShadow = strip.castShadow = true; g.add(main, strip);
    g.position.set((c - 1.5) * 2.25 + (r % 2 ? 0.12 : -0.12), BOX.t + BH / 2 + r * 0.75, 1.7 - r * 1.45);
    g.rotation.set(-0.2, (Math.sin(r * 7 + c * 13) * 0.08), Math.sin(r * 3 + c * 5) * 0.05);
    main.userData.bag = bags.length; group.add(g);
    bags.push({ g, main, strip, slot: g.position.clone(), rot: g.quaternion.clone() });
  }
  scene.add(group);
  return { group, bags, bagMat };
}
function killPack() {
  if (!pack) return;
  for (const b of pack.bags) b.strip.material.dispose();
  pack.group.traverse(m => { if (m.isMesh && m.geometry !== bagMainGeo && m.geometry !== bagStripGeo) m.geometry.dispose(); if (m.isMesh) for (const mat of [].concat(m.material)) { mat.map?.dispose(); mat.dispose(); } });
  scene.remove(pack.group); pack = null;
}

/* ---------- state ---------- */

const q = new URLSearchParams(location.search);
const st = { theme: Math.max(0, Math.min(THEMES.length - 1, (+q.get('theme') || 1) - 1)), mode: q.get('mode') === 'lineup' ? 'lineup' : 'box', sel: -1 };
let rip = null, flying = true, bounds = { hx: 1, hz: 1 };
const goal = { pos: new V3(), target: new V3() };
const STAGE = new V3(0, 0, 6.6);

function clearDoods() { blobs.forEach(kill); blobs = []; st.sel = -1; }
function enter() {
  clearDoods(); killPack(); rip = null;
  const th = THEMES[st.theme];
  if (st.mode === 'box') pack = buildPack(st.theme);
  else { blobs = specsFor(st.theme).map(spawn); layout(); }
  $('#tname').textContent = th.name; $('#tnum').textContent = `Series ${String(st.theme + 1).padStart(2, '0')} / ${THEMES.length}`;
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.m === st.mode));
  document.documentElement.style.setProperty('--theme', th.bag[1]);
  select(-1);
  history.replaceState(null, '', `?theme=${st.theme + 1}${st.mode === 'lineup' ? '&mode=lineup' : ''}`);
}
function footer() {
  const box = st.mode === 'box', n = foundSet(st.theme).size;
  $('#hint').textContent = box ? `Tap a bag to rip it open · ${n}/${PER} found` : 'Tap a Dood · drag to look around';
  $('#all').textContent = box ? '🎲 Rip a random bag' : '⬇ Download this set (.glb)';
}

function layout() {
  const n = blobs.length, asp = innerWidth / innerHeight, cols = asp < 0.85 ? 3 : asp < 1.3 ? 4 : 5, rows = Math.ceil(n / cols);
  blobs.forEach((b, k) => {
    const r = Math.floor(k / cols), c = k % cols, inRow = r < rows - 1 ? cols : n - cols * (rows - 1);
    place(b, (c - (inRow - 1) / 2) * 3.0 + (r % 2 ? 0.35 : -0.35), (r - (rows - 1) / 2) * 3.2);
  });
  bounds = { hx: (cols - 1) / 2 * 3.0 + 1.6, hz: (rows - 1) / 2 * 3.2 + 1.2 };
}

const portrait = () => innerWidth / innerHeight < 0.85;
function fit(pts, el, target) {
  const dir = new V3(0, Math.sin(el), Math.cos(el));
  const top = 1 - 2 * ($('header').offsetHeight + (innerWidth < 1100 ? 58 : 10)) / innerHeight, bot = -1 + 2 * 100 / innerHeight;
  const cam = camera.clone(); let lo = 4, hi = 200;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2; cam.position.copy(target).addScaledVector(dir, mid); cam.lookAt(target); cam.updateMatrixWorld();
    if (pts.every(p => { const v = p.clone().project(cam); return Math.abs(v.x) < 0.96 && v.y < top && v.y > bot; })) hi = mid; else lo = mid;
  }
  const vh = 2 * hi * Math.tan(camera.fov * D / 2), shift = (top + bot) / 2 * vh / 2;
  target.addScaledVector(new V3(0, Math.cos(el), -Math.sin(el)), -shift);
  return { target, pos: target.clone().addScaledVector(dir, hi) };
}
function overview() {
  const pts = [];
  if (st.mode === 'box') { for (const x of [-1, 1]) for (const [y, z] of [[0, 3], [BOX.back + 0.2, -3], [0, -3]]) pts.push(new V3(x * (BOX.w / 2 + 0.3), y, z)); return fit(pts, (portrait() ? 30 : 22) * D, new V3(0, 3.2, 0)); }
  for (const x of [-1, 1]) for (const z of [-1, 1]) for (const y of [0, 3.1]) pts.push(new V3(x * bounds.hx, y, z * bounds.hz));
  return fit(pts, (portrait() ? 54 : 44) * D, new V3(0, 0.8, 0));
}
function closeup(p, lift = 0) {
  const asp = innerWidth / innerHeight, tanH = Math.tan(camera.fov * D / 2), dist = Math.max(9, 3.4 / (2 * tanH * asp)), vh = 2 * dist * tanH;
  const target = p.clone(); target.y = (innerWidth < 760 ? 1.4 - vh * 0.17 : 1.3) + lift;
  return { target, pos: target.clone().addScaledVector(new V3(0.22, 0.24, 1).normalize(), dist) };
}
function refocus() {
  const g = rip ? closeup(STAGE, 1.1) : st.sel >= 0 ? closeup(blobs[st.sel].home) : overview();
  goal.pos.copy(g.pos); goal.target.copy(g.target); flying = true;
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (st.mode === 'lineup') layout();
  refocus();
}

/* ---------- card ---------- */

const card = $('#card'), foot = $('#foot');
function select(i, fresh) {
  st.sel = i;
  card.classList.toggle('on', i >= 0);
  foot.style.opacity = i >= 0 || rip ? 0 : 1; foot.style.visibility = i >= 0 || rip ? 'hidden' : 'visible';
  if (i >= 0) {
    const { spec, idx } = blobs[i], box = st.mode === 'box';
    card.querySelector('.no').textContent = `#${String(idx + 1).padStart(2, '0')} of ${PER} · ${spec.cls} · ${spec.rarity}`;
    card.querySelector('h2').textContent = spec.name;
    $('#new').hidden = !fresh;
    card.querySelector('p').textContent = spec.blurb;
    const pale = c => { const k = new THREE.Color(c); return k.r + k.g + k.b > 2.55; };
    const accent = spec.accent || (pale(spec.color) ? THEMES[st.theme].bag[1] : spec.color);
    card.querySelector('.stats').innerHTML = ['HP', 'ATK', 'CUTE'].map((k, j) =>
      `<span>${k}</span><span class="pips" style="--c:${accent}">${[0, 1, 2, 3, 4].map(n => `<i class="${n < spec.stats[j] ? 'f' : ''}"></i>`).join('')}</span>`).join('');
    $('#prev').hidden = $('#next').hidden = box; $('#again').hidden = !box;
    blobs[i].sv = -4; if (!box) blobs[i].hop = 0; blobs[i].wv = 2.5;
  }
  footer(); refocus();
}
function closeCard() {
  if (st.mode === 'box') { clearDoods(); if (pack && !pack.bags.length) { killPack(); pack = buildPack(st.theme); } }
  select(-1);
}
const step = d => select((st.sel + d + blobs.length) % blobs.length);
$('#x').onclick = closeCard;
$('#prev').onclick = () => step(-1);
$('#next').onclick = () => step(1);
$('#again').onclick = () => { closeCard(); ripRandom(); };

/* ---------- ripping a bag ---------- */

function weightedPick(ti) {
  const w = specsFor(ti).map(s => s.rarity === 'Ultra Rare' ? 0.3 : s.rarity === 'Rare' ? 0.6 : 1);
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) if ((r -= w[i]) < 0) return i;
  return 0;
}
function startRip(k, forceIdx) {
  if (rip || st.sel >= 0 || !pack) return;
  const bag = pack.bags.splice(k, 1)[0];
  pack.bags.forEach((b, i) => { b.main.userData.bag = i; });
  scene.attach(bag.g);
  bag.strip.material.transparent = true;
  rip = { bag, t: 0, from: bag.g.position.clone(), fromQ: bag.g.quaternion.clone(), idx: forceIdx ?? weightedPick(st.theme), blob: null };
  select(-1);
}
function ripRandom() { if (pack && pack.bags.length) startRip(Math.floor(Math.random() * pack.bags.length)); }
const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
const HOVER = new V3(STAGE.x, 2.5, STAGE.z);
function tickRip(dt) {
  const r = rip, g = r.bag.g; r.t += dt;
  const fly = ease(r.t / 0.55), tear = ease((r.t - 0.8) / 0.4), pop = (r.t - 1.2) / 0.65;
  if (pop < 0) {
    g.position.lerpVectors(r.from, HOVER, fly); g.position.y += Math.sin(fly * Math.PI) * 1.2;
    g.quaternion.slerpQuaternions(r.fromQ, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.12, 0)), fly);
    g.scale.setScalar(1 + 0.25 * fly);
    if (r.t > 0.55 && r.t < 0.8) g.rotation.z = Math.sin(r.t * 60) * 0.05;
  }
  r.bag.strip.position.set(tear * 1.6, tear * 0.9, 0); r.bag.strip.rotation.z = -tear * 1.3; r.bag.strip.material.opacity = 1 - tear;
  if (pop >= 0 && !r.blob) {
    r.blob = spawn(specsFor(st.theme)[r.idx], r.idx); r.blob.held = true; blobs = [r.blob];
    place(r.blob, STAGE.x, STAGE.z); r.blob.root.rotation.y = 0; r.blob.yaw = 0;
  }
  if (r.blob) {
    const e = Math.min(1, pop);
    r.blob.root.position.y = Math.max(0, (HOVER.y + 0.6) * (1 - e * e) + Math.sin(e * Math.PI) * 1.2);
    g.position.y = HOVER.y - ease(pop) * 4.2; g.rotation.x = -ease(pop) * 1.1; g.scale.setScalar(1.25 * (1 - ease(pop) * 0.9));
    if (pop >= 1) {
      r.blob.root.position.y = 0; r.blob.held = false; r.blob.sv = -7;
      r.bag.strip.material.dispose(); scene.remove(g);
      const fresh = markFound(st.theme, r.idx); rip = null;
      select(0, fresh);
    }
  }
}

/* ---------- input ---------- */

const ptr = new THREE.Vector2(), down = { x: 0, y: 0, ok: false };
function cast(e) { ptr.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); rc.setFromCamera(ptr, camera); }
function pickDood(e) { cast(e); const hit = rc.intersectObjects(blobs.filter((b, i) => st.sel < 0 || i === st.sel).map(b => b.proxy), false)[0]; return hit ? blobs.indexOf(hit.object.userData.b) : -1; }
function pickBag(e) { if (!pack || rip || st.sel >= 0) return -1; cast(e); const hit = rc.intersectObjects(pack.bags.map(b => b.main), false)[0]; return hit ? hit.object.userData.bag : -1; }
canvas.addEventListener('pointerdown', e => { down.x = e.clientX; down.y = e.clientY; down.ok = true; });
canvas.addEventListener('pointerup', e => {
  if (!down.ok || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || rip) return;
  down.ok = false;
  const i = pickDood(e);
  if (i >= 0 && i === st.sel) { blobs[i].sv = -5; blobs[i].wv = (Math.random() < 0.5 ? -1 : 1) * 4; return; }
  if (st.mode === 'box') { const k = pickBag(e); if (k >= 0) startRip(k); else if (st.sel >= 0 && i < 0) closeCard(); return; }
  select(i);
});
canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !e.buttons) canvas.style.cursor = pickDood(e) >= 0 || pickBag(e) >= 0 ? 'pointer' : 'grab'; });
controls.addEventListener('start', () => { flying = false; });
addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('#picker').classList.remove('on'); if (st.sel >= 0) closeCard(); }
  if (st.sel >= 0 && st.mode === 'lineup' && e.key === 'ArrowLeft') step(-1);
  if (st.sel >= 0 && st.mode === 'lineup' && e.key === 'ArrowRight') step(1);
});
addEventListener('resize', resize);

const setTheme = i => { st.theme = (i + THEMES.length) % THEMES.length; enter(); };
$('#tprev').onclick = () => setTheme(st.theme - 1);
$('#tnext').onclick = () => setTheme(st.theme + 1);
document.querySelectorAll('#mode button').forEach(b => { b.onclick = () => { st.mode = b.dataset.m; enter(); }; });
$('#tpick').onclick = () => $('#picker').classList.add('on');
$('#pclose').onclick = () => $('#picker').classList.remove('on');
THEMES.forEach((th, i) => {
  const el = document.createElement('button');
  el.style.background = `linear-gradient(135deg, ${th.bag[0]}, ${th.bag[1]})`;
  el.innerHTML = `<small>${String(i + 1).padStart(2, '0')}</small>${th.name}`;
  el.onclick = () => { $('#picker').classList.remove('on'); setTheme(i); };
  $('#pgrid').append(el);
});

/* ---------- GLB export ---------- */

async function download(specs, filename) {
  const out = new THREE.Group(), made = [];
  specs.forEach((spec, k) => { const c = makeBlob(spec); c.position.set((k % 5 - Math.min(4, specs.length - 1) / 2) * 2.8, 0, Math.floor(k / 5) * 3); out.add(c); made.push(c); });
  const buf = await new GLTFExporter().parseAsync(out, { binary: true });
  made.forEach(c => c.traverse(m => { if (m.isMesh) { m.geometry.dispose(); m.material.map?.dispose(); } }));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' })); a.download = filename;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
$('#glb').onclick = () => st.sel >= 0 && download([blobs[st.sel].spec], `dood-${slug(blobs[st.sel].spec.name)}.glb`);
$('#all').onclick = () => st.mode === 'box' ? ripRandom() : download(specsFor(st.theme), `doods-${slug(THEMES[st.theme].name)}.glb`);

/* ---------- go ---------- */

function pageLogo() {
  const cv = $('#logo'), W = 720, H = 300; cv.width = W; cv.height = H;
  drawLogo(cv.getContext('2d'), W / 2, H / 2 - 6, 206);
}
const start = () => {
  pageLogo(); enter(); resize();
  camera.position.copy(goal.pos).addScaledVector(new V3(0, 0.4, 1), 6); controls.target.copy(goal.target);
};
(document.fonts?.load ? Promise.race([document.fonts.load('700 40px Fredoka'), new Promise(r => setTimeout(r, 1500))]) : Promise.resolve()).then(start, start);

window.__doods = {
  THEMES, st, specsFor, setTheme, get blobs() { return blobs; }, get pack() { return pack; }, get rip() { return rip; }, startRip, select,
  setMode(m) { st.mode = m; enter(); },
  snap(i) { select(i); camera.position.copy(goal.pos); controls.target.copy(goal.target); blobs.forEach((b, k) => { b.vis = k === i ? 1 : 0; b.root.rotation.y = 0; }); },
  // build every Dood in every theme once and report recipe problems
  audit() { const bad = []; THEMES.forEach((th, ti) => { if (th.doods.length !== PER) bad.push(`${th.name}: ${th.doods.length} doods`); specsFor(ti).forEach(s => { try { const r = makeBlob(s); r.traverse(m => { if (m.isMesh) { m.geometry.dispose(); m.material.map?.dispose(); } }); } catch (e) { bad.push(`${th.name} / ${s && s.name}: ${e.message}`); } }); }); return bad; },
};

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
  if (rip) tickRip(dt);
  blobs.forEach((b, i) => {
    b.sv += (-70 * b.s - 5 * b.sv) * dt; b.s += b.sv * dt;
    const breathe = Math.sin(t * 1.8 + b.ph) * 0.025, sy = 1 + b.s * 0.16 + breathe;
    b.vis += ((st.sel < 0 || i === st.sel ? 1 : 0) - b.vis) * Math.min(1, dt * 9);
    b.root.visible = b.vis > 0.02;
    b.shade.material.opacity = b.vis * Math.max(0, 1 - b.root.position.y * 0.5); b.shade.scale.setScalar(b.vis);
    b.root.scale.set((1 - (sy - 1) * 0.8) * b.vis, sy * b.vis, (1 - (sy - 1) * 0.8) * b.vis);
    b.wv += (-60 * b.w - 3.2 * b.wv) * dt; b.w += b.wv * dt; b.root.rotation.z = b.w * 0.35;
    if (!b.held) {
      if (b.hop < 0 && st.sel < 0 && (b.nextHop -= dt) < 0) { b.hop = 0; b.sv = -3; }
      if (b.hop >= 0) {
        b.hop += dt / 0.55;
        if (b.hop >= 1) { b.hop = -1; b.nextHop = 4 + Math.random() * 9; b.sv = -5; b.root.position.y = 0; }
        else b.root.position.y = Math.sin(Math.max(0, b.hop - 0.15) / 0.85 * Math.PI) * 0.55;
      }
      if (i === st.sel) b.root.rotation.y += dt * 0.7;
      else { let d = (b.yaw - b.root.rotation.y) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; b.root.rotation.y += d * Math.min(1, dt * 5); }
    }
  });
  if (pack && !rip) pack.bags.forEach((b, i) => { b.g.position.y = b.slot.y + Math.sin(t * 1.5 + i) * 0.02; });
  if (flying) {
    const k = 1 - Math.exp(-dt * 4.5);
    camera.position.lerp(goal.pos, k); controls.target.lerp(goal.target, k);
    if (camera.position.distanceTo(goal.pos) < 0.01) flying = false;
  }
  controls.update();
  renderer.render(scene, camera);
});
