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
const st = { theme: Math.max(0, Math.min(THEMES.length - 1, (+q.get('theme') || 1) - 1)), mode: ['lineup', 'play'].includes(q.get('mode')) ? q.get('mode') : 'box', sel: -1 };
let rip = null, flying = true, bounds = { hx: 1, hz: 1 };
const goal = { pos: new V3(), target: new V3() };
const STAGE = new V3(0, 0, 6.6);

function clearDoods() { blobs.forEach(kill); blobs = []; st.sel = -1; drag = null; }
function enter() {
  clearOpened(); killPack(); rip = null;
  const th = THEMES[st.theme];
  if (st.mode === 'box') pack = buildPack(st.theme);
  else { blobs = specsFor(st.theme).map(spawn); st.mode === 'play' ? scatter() : layout(); }
  controls.enabled = st.mode !== 'play'; playmat.visible = st.mode === 'play'; $('#swipe').hidden = true;
  $('#tname').textContent = th.name; $('#tnum').textContent = `Series ${String(st.theme + 1).padStart(2, '0')} / ${THEMES.length}`;
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.m === st.mode));
  document.documentElement.style.setProperty('--theme', th.bag[1]);
  select(-1);
  history.replaceState(null, '', `?theme=${st.theme + 1}${st.mode !== 'box' ? '&mode=' + st.mode : ''}`);
}
function footer() {
  const box = st.mode === 'box', n = foundSet(st.theme).size;
  $('#hint').textContent = box && opened ? `You got 3! Fling ’em around · tap one for its card · ${n}/${PER} found` : box ? `3 Doods in every bag! Tap one, then swipe the top to rip · ${n}/${PER} found` : st.mode === 'play' ? 'Squish them! Grab one and fling it!' : 'Tap a Dood · drag to look around';
  $('#all').textContent = box ? (opened ? '🎲 Rip another bag' : '🎲 Rip a random bag') : st.mode === 'play' ? '🌈 Shake them up!' : '⬇ Download this set (.glb)';
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
  return fit(pts, (st.mode === 'play' ? (portrait() ? 62 : 52) : (portrait() ? 54 : 44)) * D, new V3(0, 0.8, 0));
}
function closeup(p, lift = 0) {
  const asp = innerWidth / innerHeight, tanH = Math.tan(camera.fov * D / 2), dist = Math.max(9, 3.4 / (2 * tanH * asp)), vh = 2 * dist * tanH;
  const target = p.clone(); target.y = (innerWidth < 760 ? 1.4 - vh * 0.17 : 1.3) + lift;
  return { target, pos: target.clone().addScaledVector(new V3(0.22, 0.24, 1).normalize(), dist) };
}
function ripView() {   // the whole bag, tear strip included, clear of the header and footer
  const pts = [], hw = BW * 1.25 / 2 + 0.5, hh = BH * 1.25 / 2;
  for (const x of [-1, 1]) for (const y of [-hh - 0.2, hh + 0.9]) pts.push(new V3(STAGE.x + x * hw, 2.5 + y, STAGE.z));
  return fit(pts, 8 * D, new V3(STAGE.x, 2.5, STAGE.z));
}
function refocus() {
  const g = rip && rip.phase !== 'pop' ? ripView() : st.sel >= 0 ? closeup(opened ? blobs[st.sel].p : blobs[st.sel].home) : opened ? arenaView() : overview();
  goal.pos.copy(g.pos); goal.target.copy(g.target); flying = true;
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (st.mode === 'lineup') layout();
  if (st.mode === 'play') arenaSize();
  if (opened) arenaBox();
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
    $('#prev').hidden = $('#next').hidden = box && blobs.length < 2; $('#again').hidden = !box;
    $('#new').hidden = !(fresh || blobs[i].fresh);
    blobs[i].sv = -4; if (!box) blobs[i].hop = 0; blobs[i].wv = 2.5;
  }
  footer(); refocus();
}
function closeCard() {
  if (opened) { select(-1); return; }
  if (st.mode === 'box') { clearDoods(); if (pack && !pack.bags.length) { killPack(); pack = buildPack(st.theme); } }
  select(-1);
}
const step = d => select((st.sel + d + blobs.length) % blobs.length);   // also flips through the 3 from a bag
$('#x').onclick = closeCard;
$('#prev').onclick = () => step(-1);
$('#next').onclick = () => step(1);
$('#again').onclick = () => { closeCard(); ripRandom(); };

/* ---------- feel: sparkles, sound, buzz (sound starts quiet, can be muted) ---------- */

const spriteTex = star => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.beginPath();
  if (star) for (let i = 0; i < 10; i++) { const r = i % 2 ? 12 : 30, a = i / 10 * TAU - Math.PI / 2; c.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } else c.arc(32, 32, 28, 0, TAU);
  c.fill(); return new THREE.CanvasTexture(cv); };
const STAR = spriteTex(true), DOT = spriteTex(false), PARTY = ['#ffd93b', '#ff5fa8', '#2fd3c9', '#b06bff', '#ffffff'];
const sparks = [];
function sparkle(pos, n, colors = PARTY, { speed = 5, up = 4, size = 0.35, star = true, life = 0.9 } = {}) {
  for (let k = 0; k < n && sparks.length < 260; k++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: star ? STAR : DOT, color: colors[k % colors.length], transparent: true, depthWrite: false }));
    const a = Math.random() * TAU, sp = speed * (0.4 + Math.random() * 0.6);
    m.position.copy(pos); m.scale.setScalar(size * (0.6 + Math.random() * 0.8)); scene.add(m);
    sparks.push({ m, v: new V3(Math.cos(a) * sp, up * (0.6 + Math.random()), Math.sin(a) * sp), life: life * (0.7 + Math.random() * 0.5), t: 0, s0: m.scale.x, spin: (Math.random() - 0.5) * 8 });
  }
}
function tickSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i]; p.t += dt; p.v.y -= 9 * dt; p.m.position.addScaledVector(p.v, dt); p.m.material.rotation += p.spin * dt;
    const k = 1 - p.t / p.life; p.m.material.opacity = Math.max(0, k); p.m.scale.setScalar(p.s0 * (0.5 + 0.5 * Math.max(0, k)));
    if (p.t >= p.life) { scene.remove(p.m); p.m.material.dispose(); sparks.splice(i, 1); }
  }
}
let actx = null, master = null, soundOn = true, touched = false;   // no sound or buzz until the first touch
try { soundOn = localStorage.getItem('doods-sound') !== '0'; } catch { /* storage blocked: default on, quiet */ }
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); master = actx.createGain(); master.gain.value = 0.1; master.connect(actx.destination); } catch { return null; } }
  if (actx.state === 'suspended') actx.resume(); return actx;
}
function tone(f0, f1, dur, k = 1, type = 'sine', delay = 0) {
  if (!soundOn || !touched) return; const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + delay;
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6 * Math.min(1, k), t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, freq, k = 1) {
  if (!soundOn || !touched) return; const a = audio(); if (!a) return;
  const buf = a.createBuffer(1, a.sampleRate * dur | 0, a.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(); src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = 0.5 * k;
  src.connect(f).connect(g).connect(master); src.start();
}
const boing = (k = 1, p = 1) => tone(520 * p, 150 * p, 0.26, k);
const squeak = (k = 1, p = 1) => tone(320 * p, 760 * p, 0.12, k * 0.7, 'triangle');
const crinkle = (k = 1) => noise(0.07, 2600 + Math.random() * 1500, k);
const reveal = () => { noise(0.12, 900, 1); [523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.22, 0.5, 'triangle', 0.08 + i * 0.07)); };
const buzz = ms => { if (!touched) return; try { navigator.vibrate?.(ms); } catch { /* no haptics here */ } };
const sndBtn = $('#snd'), sndIcon = () => { sndBtn.textContent = soundOn ? '🔈' : '🔇'; };
sndIcon(); sndBtn.onclick = () => { soundOn = !soundOn; sndIcon(); try { localStorage.setItem('doods-sound', soundOn ? '1' : '0'); } catch { /* ignore */ } if (soundOn) boing(0.5); };

/* ---------- play mode: squish, grab, fling, bounce ---------- */

const ARENA = { hx: 6, hz: 3.4, cx: 0, cz: 0 };   // centre + half-size of the invisible walls
const playmat = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: '#f3ecff', roughness: 0.95 }));
playmat.rotation.x = -Math.PI / 2; playmat.position.y = 0.005; playmat.receiveShadow = true; playmat.visible = false; scene.add(playmat);
function arenaSize() {
  const asp = innerWidth / innerHeight; ARENA.hx = asp < 0.85 ? 4.2 : 6.6; ARENA.hz = asp < 0.85 ? 5.2 : 3.8; ARENA.cx = ARENA.cz = 0;
  playmat.position.set(0, 0.005, 0); playmat.scale.set(ARENA.hx + 1.4, ARENA.hz + 1.4, 1); bounds = { hx: ARENA.hx + 0.6, hz: ARENA.hz + 0.6 };
}
// after a rip: a play area in front of the display box (its back edge stays clear of the box)
function arenaBox() {
  const p = portrait(); Object.assign(ARENA, { hx: p ? 3.4 : 5.2, hz: p ? 3.0 : 2.6, cx: STAGE.x, cz: STAGE.z });
  playmat.position.set(ARENA.cx, 0.005, ARENA.cz); playmat.scale.set(ARENA.hx + 1.2, ARENA.hz + 0.6, 1); playmat.visible = true;
}
function arenaView() {
  const pts = [];
  for (const x of [-1, 1]) for (const z of [-1, 1]) for (const y of [0, 2.8]) pts.push(new V3(ARENA.cx + x * (ARENA.hx + 0.8), y, ARENA.cz + z * (ARENA.hz + 0.8)));
  return fit(pts, (portrait() ? 52 : 40) * D, new V3(ARENA.cx, 0.8, ARENA.cz));
}

/* litter: the torn bag + strip stay on the floor; Doods land on them or bump off, never pass through */
let litter = [], opened = false;
function clearLitter() {
  for (const L of litter) { scene.remove(L.obj); if (L.own) { L.obj.geometry.dispose(); L.obj.material.dispose(); } }
  litter = [];
}
function clearOpened() { clearDoods(); clearLitter(); opened = false; playmat.visible = st.mode === 'play'; }
function toss(obj, x, z, yaw, scl, dur, hop, own) {
  const p0 = obj.position.clone(), q0 = obj.quaternion.clone(), s0 = obj.scale.clone();
  obj.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, yaw, 0, 'YXZ')); obj.scale.copy(scl); obj.position.set(x, 0, z);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj), dy = -box.min.y; box.translate(new V3(0, dy, 0));
  const p1 = new V3(x, dy, z), q1 = obj.quaternion.clone(), s1 = scl.clone();
  obj.position.copy(p0); obj.quaternion.copy(q0); obj.scale.copy(s0);
  litter.push({ obj, box, own, fly: { t: 0, dur, hop, p0, p1, q0, q1, s0, s1, spin: (Math.random() < 0.5 ? -1 : 1) * TAU } });
}
const YAXIS = new V3(0, 1, 0);
function tickLitter(dt) {
  for (const L of litter) {
    const f = L.fly; if (!f) continue;
    f.t += dt; const k = Math.min(1, f.t / f.dur), e = ease(k);
    L.obj.position.lerpVectors(f.p0, f.p1, k); L.obj.position.y += Math.sin(k * Math.PI) * f.hop;
    L.obj.quaternion.slerpQuaternions(f.q0, f.q1, e).premultiply(new THREE.Quaternion().setFromAxisAngle(YAXIS, (1 - e) * f.spin));
    L.obj.scale.lerpVectors(f.s0, f.s1, k);
    if (k >= 1) { L.fly = null; crinkle(0.8); buzz(8); sparkle(new V3(f.p1.x, 0.2, f.p1.z), 8, ['#ffffff', THEMES[st.theme].bag[0]], { speed: 2.5, up: 1.5, size: 0.2, star: false, life: 0.5 }); }
  }
}
function groundAt(p) {
  let h = 0;
  for (const L of litter) if (!L.fly && p.x > L.box.min.x + 0.15 && p.x < L.box.max.x - 0.15 && p.z > L.box.min.z + 0.15 && p.z < L.box.max.z - 0.15) h = Math.max(h, L.box.max.y);
  return h;
}
function scatter() {
  arenaSize();
  blobs.forEach((b, k) => {
    b.held = true; b.p = new V3((Math.random() * 2 - 1) * ARENA.hx * 0.8, 3 + k * 0.6, (Math.random() * 2 - 1) * ARENA.hz * 0.8);
    b.v = new V3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3); b.spin = (Math.random() - 0.5) * 4; b.sq = 0;
    place(b, b.p.x, b.p.z); b.root.position.copy(b.p);
  });
}
function shakeUp() { blobs.forEach(b => { b.v.set((Math.random() - 0.5) * 10, 9 + Math.random() * 6, (Math.random() - 0.5) * 8); b.spin = (Math.random() - 0.5) * 10; b.sv = -6; }); boing(1, 0.8); buzz([20, 30, 20]); }
let drag = null;
function tickPlay(dt) {
  const R = 1.08;
  for (const b of blobs) {
    if (drag && b === drag.b) continue;
    if (b.wait > 0) { b.wait -= dt; if (b.wait > 0) continue; b.launch?.(); }
    if (b.grow < 1) b.grow = Math.min(1, b.grow + dt * 5);
    b.v.y -= 24 * dt; b.p.addScaledVector(b.v, dt);
    const fl = groundAt(b.p);
    if (b.p.y < fl) {
      const imp = -b.v.y; b.p.y = fl;
      if (imp > 3) {
        b.v.y = imp * 0.48; b.sv = -Math.min(14, imp * 0.9); b.wv += (Math.random() - 0.5) * imp * 0.6;
        boing(Math.min(1, imp / 14), 0.75 + Math.random() * 0.5); buzz(Math.min(30, imp * 2 | 0));
        if (imp > 7) sparkle(new V3(b.p.x, fl + 0.25, b.p.z), Math.min(12, imp | 0), PARTY, { speed: 3.5, up: 3, size: 0.28 });
      } else b.v.y = 0;
      const f = Math.exp(-4 * dt); b.v.x *= f; b.v.z *= f;
    }
    for (const [ax, lim, c] of [['x', ARENA.hx, ARENA.cx], ['z', ARENA.hz, ARENA.cz]]) if (Math.abs(b.p[ax] - c) > lim) {
      b.p[ax] = c + Math.sign(b.p[ax] - c) * lim;
      if (Math.abs(b.v[ax]) > 2.5) { b.sv = -4; b.wv += b.v[ax] * 0.25; boing(Math.min(1, Math.abs(b.v[ax]) / 16), 1.3); buzz(10); }
      b.v[ax] *= -0.6;
    }
    for (const L of litter) {   // beside a piece of litter and below its top: push the Dood out sideways
      if (L.fly || b.p.y >= L.box.max.y - 0.02) continue;
      const nx = Math.max(L.box.min.x, Math.min(L.box.max.x, b.p.x)), nz = Math.max(L.box.min.z, Math.min(L.box.max.z, b.p.z));
      let dx = b.p.x - nx, dz = b.p.z - nz, d = Math.hypot(dx, dz);
      if (d >= R) continue;
      if (d < 1e-4) { const c = L.box.getCenter(new V3()); dx = b.p.x - c.x; dz = b.p.z - c.z; d = Math.hypot(dx, dz) || 1; const out = R + Math.max(L.box.max.x - L.box.min.x, L.box.max.z - L.box.min.z) / 2; b.p.x = c.x + dx / d * out; b.p.z = c.z + dz / d * out; continue; }
      const nX = dx / d, nZ = dz / d, rel = b.v.x * nX + b.v.z * nZ;
      b.p.x = nx + nX * R; b.p.z = nz + nZ * R;
      if (rel < 0) { b.v.x -= 1.6 * rel * nX; b.v.z -= 1.6 * rel * nZ; if (rel < -3) { crinkle(0.5); b.sv = -3; } }
    }
    b.spin *= Math.exp(-2 * dt); b.root.rotation.y += b.spin * dt;
  }
  for (let pass = 0; pass < 3; pass++) for (let i = 0; i < blobs.length; i++) for (let j = i + 1; j < blobs.length; j++) {   // soft bumps between Doods (3 passes so piles separate cleanly)
    const a = blobs[i], c = blobs[j], dx = c.p.x - a.p.x, dz = c.p.z - a.p.z, d = Math.hypot(dx, dz) + 1e-6;
    if (d < 2 * R && Math.abs(c.p.y - a.p.y) < 1.6) {
      const nx = dx / d, nz = dz / d, push = (2 * R - d) / 2, fa = drag && a === drag.b ? 0 : 1, fc = drag && c === drag.b ? 0 : 1;
      a.p.x -= nx * push * fa * (fc ? 1 : 2); a.p.z -= nz * push * fa * (fc ? 1 : 2); c.p.x += nx * push * fc * (fa ? 1 : 2); c.p.z += nz * push * fc * (fa ? 1 : 2);
      const rel = (c.v.x - a.v.x) * nx + (c.v.z - a.v.z) * nz;
      if (rel < 0) { const k = -rel * 0.45; if (fa) { a.v.x -= nx * k; a.v.z -= nz * k; } if (fc) { c.v.x += nx * k; c.v.z += nz * k; } if (-rel > 4) { a.sv = c.sv = -3; boing(Math.min(1, -rel / 14), 1.7); } }
    }
  }
  for (const b of blobs) { b.root.position.copy(b.p); b.proxy.position.set(b.p.x, b.p.y + 1.2, b.p.z); b.shade.position.set(b.p.x, 0.012, b.p.z); }
}

/* ---------- ripping a bag ---------- */

function weightedPick(ti) {
  const w = specsFor(ti).map(s => s.rarity === 'Ultra Rare' ? 0.3 : s.rarity === 'Rare' ? 0.6 : 1);
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) if ((r -= w[i]) < 0) return i;
  return 0;
}
function pick3(ti, force) {   // 3 different Doods per bag, never a duplicate in one pouch
  const out = force != null ? [force] : [];
  for (let guard = 0; out.length < 3 && guard < 300; guard++) { const i = weightedPick(ti); if (!out.includes(i)) out.push(i); }
  return out;
}
function startRip(k, forceIdx) {
  if (rip || st.sel >= 0 || !pack) return;
  clearOpened();
  const bag = pack.bags.splice(k, 1)[0];
  pack.bags.forEach((b, i) => { b.main.userData.bag = i; });
  scene.attach(bag.g);
  bag.strip.geometry = bagStripGeo.clone(); bag.strip.material = bag.strip.material.clone();
  rip = { bag, t: 0, phase: 'fly', tp: 0, shown: 0, dir: 1, swiping: false, base0: bag.strip.geometry.attributes.position.array.slice(), from: bag.g.position.clone(), fromQ: bag.g.quaternion.clone(), idxs: pick3(st.theme, forceIdx) };
  select(-1); squeak(0.6, 0.9); buzz(10); controls.enabled = false;   // the swipe tears the bag, not the camera
}
function ripRandom() {
  if (!pack) return;
  if (!pack.bags.length) { clearOpened(); killPack(); pack = buildPack(st.theme); }
  startRip(Math.floor(Math.random() * pack.bags.length));
}
const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
const HOVER = new V3(STAGE.x, 2.5, STAGE.z);
const tearPoint = (u, g) => g.localToWorld(new V3((u - 0.5) * BW, TEAR * BH / 2, 0.25));
// the strip peels from the side the finger started on, hinged on the tear line, curling as it lifts
function peel(strip, base, shown, dir) {
  const pos = strip.geometry.attributes.position, hy = TEAR * BH / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
    let u = x / BW + 0.5; if (dir < 0) u = 1 - u;
    const d = shown * 1.25 - u;
    if (d <= 0) { pos.setXYZ(i, x, y, z); continue; }
    const yp = y - hy, th = Math.min(1.1, d * 3) * (1 + yp * 2), lift = Math.min(0.5, d * 0.6);   // flap curls up and out
    pos.setXYZ(i, x - (dir > 0 ? 1 : -1) * lift * 0.25, hy + lift + yp * Math.cos(th) - z * Math.sin(th), 0.1 * lift + yp * Math.sin(th) + z * Math.cos(th));
  }
  pos.needsUpdate = true; strip.geometry.computeVertexNormals();
}
// the tear line on screen, in pixels
function tearLine() {
  const g = rip.bag.g, px = v => { v.project(camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; };
  return { a: px(tearPoint(0, g)), b: px(tearPoint(1, g)) };
}
function onLine(e) {   // u along the tear line (0 left, 1 right) and distance from it, in px
  const { a, b } = tearLine(), dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  const u = ((e.clientX - a.x) * dx + (e.clientY - a.y) * dy) / L2, cu = Math.max(0, Math.min(1, u));
  return { u: cu, off: Math.hypot(e.clientX - (a.x + dx * cu), e.clientY - (a.y + dy * cu)), raw: u };
}
const swipeEl = $('#swipe');
function placeSwipe() {
  const { a, b } = tearLine(), w = Math.max(160, Math.hypot(b.x - a.x, b.y - a.y));
  swipeEl.style.left = (a.x + b.x) / 2 + 'px'; swipeEl.style.top = ((a.y + b.y) / 2 - 24) + 'px';
  swipeEl.querySelector('.track').style.width = w + 'px';
  swipeEl.hidden = rip.tp > 0.04;   // once the peel starts, the strip itself shows the way
}
function popOut() {   // the strip comes off: litter it, pop the 3 Doods out of the top
  const r = rip, g = r.bag.g, side = Math.random() < 0.5 ? -1 : 1, strip = r.bag.strip;
  opened = true; arenaBox();
  scene.attach(strip); strip.geometry.attributes.position.array.set(r.base0); strip.geometry.attributes.position.needsUpdate = true;
  strip.geometry.computeVertexNormals(); strip.geometry.computeBoundingBox();
  const c0 = strip.geometry.boundingBox.getCenter(new V3()), w0 = strip.localToWorld(c0.clone());   // pivot the strip on its own middle
  strip.geometry.translate(-c0.x, -c0.y, -c0.z); strip.geometry.computeBoundingBox(); strip.geometry.computeBoundingSphere(); strip.position.copy(w0);
  toss(strip, ARENA.cx - side * ARENA.hx * 0.6, ARENA.cz - ARENA.hz * 0.55, side * 0.5 + (Math.random() - 0.5) * 0.4, new V3(1.2, 1.2, 1.2), 0.8, 1.6, true);
  r.side = side;
  const mouth = g.localToWorld(new V3(0, TEAR * BH / 2 - 0.1, 0)), sp = portrait() ? 2.3 : 2.7;
  blobs = r.idxs.map((idx, k) => {
    const b = spawn(specsFor(st.theme)[idx], idx);
    Object.assign(b, { held: true, p: mouth.clone(), v: new V3(), spin: 0, sq: 0, grow: 0, wait: 0.2 + k * 0.2, yaw: 0, fresh: markFound(st.theme, idx) });
    const tx = ARENA.cx + (k - 1) * sp, tz = ARENA.cz + 1.0 + (k === 1 ? 0.35 : 0), T = 0.75;
    b.launch = () => {
      b.v.set((tx - b.p.x) / T, (0 - b.p.y + 12 * T * T) / T, (tz - b.p.z) / T); b.spin = (k - 1) * -2;
      squeak(0.7, 0.9 + k * 0.18); buzz(12); r.squeeze = 1;
      sparkle(mouth, 10, PARTY, { speed: 3, up: 4, size: 0.26 });
    };
    b.root.position.copy(b.p); b.root.rotation.y = 0;
    return b;
  });
  const rare = r.idxs.some(i => specsFor(st.theme)[i].rarity !== 'Common');
  reveal(); buzz([20, 40, 30]);
  sparkle(mouth, rare ? 60 : 36, rare ? ['#ffd93b', '#fff3b0', '#ffffff', '#ffb347'] : PARTY, { speed: 6, up: 7, size: rare ? 0.42 : 0.34, life: 1.2 });
  refocus();
}
function tickRip(dt) {
  const r = rip, g = r.bag.g; r.t += dt;
  if (r.phase === 'fly') {
    const fly = ease(r.t / 0.55);
    g.position.lerpVectors(r.from, HOVER, fly); g.position.y += Math.sin(fly * Math.PI) * 1.2;
    g.quaternion.slerpQuaternions(r.fromQ, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.12, 0)), fly);
    g.scale.setScalar(1 + 0.25 * fly);
    if (r.t > 0.6) { r.phase = 'swipe'; r.t = 0; swipeEl.hidden = false; }
  } else if (r.phase === 'swipe') {
    g.position.copy(HOVER); g.position.y += Math.sin(r.t * 3) * 0.06;
    g.rotation.set(0, 0.12, Math.sin(r.t * 2) * 0.03 + (r.swiping ? Math.sin(r.t * 55) * 0.012 : 0));
    r.shown += (r.tp - r.shown) * Math.min(1, dt * 18);
    peel(r.bag.strip, r.base0, r.shown, r.dir);
    placeSwipe();
    if (r.tp >= 1 && r.shown > 0.92) { r.phase = 'pop'; r.t = 0; swipeEl.hidden = true; crinkle(1); buzz(25); sparkle(tearPoint(r.dir > 0 ? 1 : 0, g), 14, THEMES[st.theme].bag.concat(['#ffffff']), { speed: 4, up: 3, size: 0.22, star: false }); popOut(); }
  } else {   // pop: Doods jump out one by one, then the empty bag gets tossed aside
    r.squeeze = Math.max(0, (r.squeeze || 0) - dt * 5);
    if (!r.tossed) {
      g.position.copy(HOVER); g.rotation.set(-0.15 * ease(r.t / 0.3), 0.12, Math.sin(r.t * 32) * 0.05 * Math.max(0, 1 - r.t));
      g.scale.set(1.25 * (1 + 0.08 * r.squeeze), 1.25 * (1 - 0.1 * r.squeeze), 1.25);
    }
    if (!r.tossed && r.t > 0.95) { r.tossed = true; squeak(0.4, 0.6); toss(g, ARENA.cx + r.side * ARENA.hx * 0.55, ARENA.cz - ARENA.hz * 0.45, Math.PI / 2 + (Math.random() - 0.5) * 0.5, new V3(0.9, 0.9, 0.55), 0.7, 1.8, false); }
    if (r.tossed && r.t > 1.75) { rip = null; controls.enabled = false; select(-1); }   // fingers fling Doods now, not the camera
  }
}

/* ---------- input ---------- */

const ptr = new THREE.Vector2(), down = { x: 0, y: 0, ok: false };
function cast(e) { ptr.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); rc.setFromCamera(ptr, camera); }
function pickDood(e) { cast(e); const hit = rc.intersectObjects(blobs.filter((b, i) => st.sel < 0 || i === st.sel).map(b => b.proxy), false)[0]; return hit ? blobs.indexOf(hit.object.userData.b) : -1; }
function pickBag(e) { if (!pack || rip || st.sel >= 0) return -1; cast(e); const hit = rc.intersectObjects(pack.bags.map(b => b.main), false)[0]; return hit ? hit.object.userData.bag : -1; }
const floorPlane = new THREE.Plane(new V3(0, 1, 0), 0), hitP = new V3();
function floorAt(e) { cast(e); return rc.ray.intersectPlane(floorPlane, hitP) ? hitP.clone() : null; }
canvas.addEventListener('pointerdown', e => {
  touched = true; audio(); down.x = e.clientX; down.y = e.clientY; down.ok = true;
  if (rip && rip.phase === 'swipe') {
    const o = onLine(e);
    if (o.off > Math.max(60, innerHeight * 0.08)) { swipeEl.classList.remove('nudge'); void swipeEl.offsetWidth; swipeEl.classList.add('nudge'); buzz(5); return; }   // not on the top: show where
    if (rip.tp === 0) rip.dir = o.u < 0.5 ? 1 : -1;
    rip.swiping = true; canvas.setPointerCapture(e.pointerId); return;
  }
  if (rip) return;
  const i = pickDood(e);
  if (i < 0) return;
  const b = blobs[i]; b.press = true; squeak(0.5, 0.9 + Math.random() * 0.3); buzz(8);
  if ((st.mode === 'play' || opened) && st.sel < 0) { drag = { b, trail: [], lifted: false }; canvas.setPointerCapture(e.pointerId); }
});
canvas.addEventListener('pointermove', e => {
  if (rip && rip.swiping) {
    const o = onLine(e), tp = o.off > Math.max(140, innerHeight * 0.16) ? 0 : Math.min(1, rip.dir > 0 ? o.u : 1 - o.u);
    if (tp > rip.tp) {
      if (Math.floor(tp * 7) > Math.floor(rip.tp * 7)) { crinkle(0.6); buzz(6); sparkle(tearPoint(rip.dir > 0 ? tp : 1 - tp, rip.bag.g), 3, ['#ffffff', THEMES[st.theme].bag[0]], { speed: 2, up: 2.5, size: 0.16, star: false, life: 0.6 }); }
      rip.tp = tp;
    }
    return;
  }
  if (drag) {
    if (!drag.lifted && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) { drag.lifted = true; drag.b.press = false; squeak(0.5, 1.3); }
    const p = drag.lifted && floorAt(e);
    if (p) {
      p.x = Math.max(ARENA.cx - ARENA.hx, Math.min(ARENA.cx + ARENA.hx, p.x)); p.z = Math.max(ARENA.cz - ARENA.hz, Math.min(ARENA.cz + ARENA.hz, p.z));
      drag.b.p.lerp(new V3(p.x, 1.4, p.z), 0.6); drag.b.v.set(0, 0, 0);
      drag.trail.push({ p: drag.b.p.clone(), t: performance.now() }); if (drag.trail.length > 6) drag.trail.shift();
    }
    return;
  }
  if (e.pointerType === 'mouse' && !e.buttons) canvas.style.cursor = pickDood(e) >= 0 || pickBag(e) >= 0 ? 'pointer' : st.mode === 'play' ? 'default' : 'grab';
});
function endPointer(e) {
  if (rip && rip.swiping) { rip.swiping = false; if (rip.tp > 0.75) rip.tp = 1; return; }
  if (drag) {
    const b = drag.b; b.press = false;
    if (drag.lifted && drag.trail.length > 1) {
      const a = drag.trail[0], z = drag.trail[drag.trail.length - 1], sec = Math.max(16, z.t - a.t) / 1000;
      b.v.set((z.p.x - a.p.x) / sec, 0, (z.p.z - a.p.z) / sec); const sp = Math.hypot(b.v.x, b.v.z);
      if (sp > 22) b.v.multiplyScalar(22 / sp);
      b.v.y = 3 + Math.min(22, sp) * 0.35; b.spin = (Math.random() - 0.5) * sp * 0.8; b.sv = 5; boing(0.4, 1.5); buzz(12);
    } else { b.sv = 9; b.v.y = 8; b.wv += (Math.random() - 0.5) * 6; boing(0.8, 1); buzz(15); sparkle(new V3(b.p.x, 2, b.p.z), 10, PARTY, { speed: 3, up: 4, size: 0.3 }); }
    if (opened && !drag.lifted) { drag = null; down.ok = false; select(blobs.indexOf(b), b.fresh); return; }
    drag = null; down.ok = false; return;
  }
  const pressed = blobs.find(b => b.press);
  if (pressed) { pressed.press = false; pressed.sv = 8; boing(0.6, 1.1); }
  if (!down.ok || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || rip) return;
  down.ok = false;
  const i = pickDood(e);
  if (i >= 0 && i === st.sel) { blobs[i].sv = -5; blobs[i].wv = (Math.random() < 0.5 ? -1 : 1) * 4; sparkle(new V3(blobs[i].root.position.x, 2.2, blobs[i].root.position.z), 8, PARTY, { speed: 3, up: 3, size: 0.28 }); return; }
  if (st.mode === 'box') { const k = pickBag(e); if (k >= 0) startRip(k); else if (st.sel >= 0 && i < 0) closeCard(); return; }
  select(i);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
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
$('#all').onclick = () => st.mode === 'box' ? ripRandom() : st.mode === 'play' ? shakeUp() : download(specsFor(st.theme), `doods-${slug(THEMES[st.theme].name)}.glb`);

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
  if (st.mode === 'play' || opened) tickPlay(dt);
  tickLitter(dt); tickSparks(dt);
  blobs.forEach((b, i) => {
    b.sv += (-70 * b.s - 5 * b.sv) * dt; b.s += b.sv * dt;
    const breathe = Math.sin(t * 1.8 + b.ph) * 0.025, sy = 1 + b.s * 0.16 + breathe;
    b.vis += ((st.sel < 0 || i === st.sel ? 1 : 0) - b.vis) * Math.min(1, dt * 9);
    b.root.visible = b.vis > 0.02;
    const gr = b.grow ?? 1; b.shade.material.opacity = b.vis * gr * Math.max(0, 1 - b.root.position.y * 0.5); b.shade.scale.setScalar(b.vis * gr);
    b.sq = (b.sq || 0) + ((b.press ? 1 : 0) - (b.sq || 0)) * Math.min(1, dt * (b.press ? 14 : 22));   // press-and-hold squish
    const fly = (st.mode === 'play' || opened) && b.v ? Math.min(0.28, Math.abs(b.v.y) * 0.014) : 0;
    const syy = sy * (1 - 0.42 * b.sq) * (1 + fly), sxz = (1 - (sy - 1) * 0.8) * (1 + 0.3 * b.sq) * (1 - fly * 0.5);
    b.root.scale.set(sxz * b.vis * gr, syy * b.vis * gr, sxz * b.vis * gr);
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
