import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const D = Math.PI / 180, TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const YA = new V3(0, 1, 0), ZA = new V3(0, 0, 1);

/* ---------- materials & primitive helpers ---------- */

// soft-touch squishy rubber: matte, with a velvety edge glow instead of hard highlights
const SOFT = { roughness: 0.78, clearcoat: 0, sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color('#ffffff') };
const matCache = new Map();
function M(color, o) {
  if (color && color.isMaterial) return color;
  const base = { color, ...SOFT };
  if (o) return new THREE.MeshPhysicalMaterial({ ...base, ...o });
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshPhysicalMaterial(base));
  return matCache.get(color);
}
const BLACK = M('#1d1a2b', { roughness: 0.45, sheen: 0 });
const GOLD = M('#ffcc33');
const STEEL = M('#c3ccdd', { side: THREE.DoubleSide });
const CHEEK = M('#ff86ad', { sheen: 0 });

const mesh = (geo, m) => new THREE.Mesh(geo, M(m));
const ball = (r, c, sx = 1, sy = 1, sz = 1) => { const m = mesh(new THREE.SphereGeometry(r, 28, 20), c); m.scale.set(sx, sy, sz); return m; };
const cyl = (rt, rb, h, c, open = false) => mesh(new THREE.CylinderGeometry(rt, rb, h, 28, 1, open), c);
const cone = (r, h, c) => mesh(new THREE.ConeGeometry(r, h, 20), c);
const box = (w, h, d, c) => mesh(new THREE.BoxGeometry(w, h, d), c);
const pill = (r, len, c) => mesh(new THREE.CapsuleGeometry(r, len, 8, 18), c);
const torus = (r, t, c) => mesh(new THREE.TorusGeometry(r, t, 12, 40), c);
const group = (...kids) => { const g = new THREE.Group(); kids.forEach(k => g.add(k)); return g; };
const at = (o, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); return o; };

// half-ring with rounded ends: ∩ by default
function arc(r, tube, c, angle = Math.PI) {
  const g = group(mesh(new THREE.TorusGeometry(r, tube, 10, 24, angle), c));
  g.add(at(ball(tube, c), r, 0, 0), at(ball(tube, c), r * Math.cos(angle), r * Math.sin(angle), 0));
  return g;
}

// tapered, bendable cone: grows +Y from the origin and curls toward +X
function horn(r, len, bend, c, { pow = 1, tip = 0, stripes = null, bands = 5 } = {}) {
  const N = 28, S = 18, pos = [], col = [], idx = [];
  const ca = stripes && new THREE.Color(stripes[0]), cb = stripes && new THREE.Color(stripes[1]);
  for (let j = 0; j <= N; j++) {
    const t = j / N, psi = bend * t;
    const cx = bend ? len / bend * (1 - Math.cos(psi)) : 0, cy = bend ? len / bend * Math.sin(psi) : len * t;
    const rr = r * ((1 - tip) * Math.pow(1 - t, pow) + tip * Math.sqrt(1 - t * t));
    for (let i = 0; i < S; i++) {
      const a = i / S * TAU, ex = Math.cos(a), ez = Math.sin(a);
      pos.push(cx + rr * ex * Math.cos(psi), cy - rr * ex * Math.sin(psi), rr * ez);
      if (stripes) { const k = Math.floor(t * bands) % 2 ? cb : ca; col.push(k.r, k.g, k.b); }
    }
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < S; i++) {
    const a = j * S + i, b = j * S + (i + 1) % S, c2 = a + S, d = b + S;
    idx.push(a, c2, b, b, c2, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (stripes) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  return mesh(geo, stripes ? M('#ffffff', { vertexColors: true }) : c);
}

function star(R, c, depth = 0.1) {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? R * 0.58 : R * 0.85, a = i / 10 * TAU + Math.PI / 2;
    sh[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: R * 0.2, bevelThickness: depth * 0.6, bevelSegments: 5 });
  geo.center();
  return mesh(geo, c);
}

// scalloped little wing, root at origin, spreading toward +X and up
function wing(c) {
  const sh = new THREE.Shape();
  sh.moveTo(0, -0.05);
  sh.quadraticCurveTo(0.1, 0.5, 0.7, 0.7);
  sh.quadraticCurveTo(0.56, 0.48, 0.6, 0.32);
  sh.quadraticCurveTo(0.42, 0.34, 0.4, 0.12);
  sh.quadraticCurveTo(0.24, 0.16, 0.16, -0.1);
  sh.quadraticCurveTo(0.06, -0.04, 0, -0.05);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 4, curveSegments: 10 });
  geo.translate(0, 0, -0.05);
  return mesh(geo, c);
}

/* ---------- the squishy body ---------- */

const SHAPE = { w: 0.98, h: 1.38, d: 0.9, taper: 0.2, boxy: 1, flat: 0.42, low: 0.6, full: 0.8 };
const spow = (x, p) => Math.sign(x) * Math.pow(Math.abs(x), p);

// u: 0..1 around (0.5 = front), v: 0..1 bottom to top. Origin sits at the widest point.
function bodyPoint(s, u, v) {
  const a = (v - 0.5) * Math.PI, ca = Math.max(Math.cos(a), 0), sa = Math.sin(a);
  const r = Math.pow(ca, s.full) * (1 - s.taper * Math.max(0, sa));
  const y = sa >= 0 ? Math.pow(sa, 0.95) * s.h : -Math.pow(-sa, s.flat) * s.h * s.low;
  const t = (u - 0.5) * TAU;
  return [spow(Math.sin(t), s.boxy) * r * s.w, y, spow(Math.cos(t), s.boxy) * r * s.d];
}

function bodyGeo(s, v0 = 0, v1 = 1) {
  const U = 80, V = 52, pos = [], uv = [], idx = [];
  for (let j = 0; j <= V; j++) for (let i = 0; i <= U; i++) {
    const u = i / U, v = v0 + (v1 - v0) * j / V;
    pos.push(...bodyPoint(s, u, v)); uv.push(u, v);
  }
  for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) {
    const a = j * (U + 1) + i, b = a + 1, c = a + U + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const n = geo.attributes.normal;
  for (let j = 0; j <= V; j++) {           // weld the seam and poles so shading is smooth
    const a = j * (U + 1), b = a + U, v = v0 + (v1 - v0) * j / V;
    if (v <= 0 || v >= 1) { for (let i = 0; i <= U; i++) n.setXYZ(a + i, 0, v <= 0 ? -1 : 1, 0); continue; }
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  return geo;
}

function paintBody(spec) {
  const W = 1024, H = 512, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const P = {
    ctx, W, H, X: u => u * W, Y: v => (1 - v) * H,
    ell(u, v, ru, rv, color, rot = 0) { ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(u * W, (1 - v) * H, ru * W, rv * H, rot, 0, TAU); ctx.fill(); },
    rect(u, v, du, dv, color) { ctx.fillStyle = color; ctx.fillRect((u - du / 2) * W, (1 - v - dv / 2) * H, du * W, dv * H); },
  };
  ctx.fillStyle = spec.color; ctx.fillRect(0, 0, W, H);
  spec.under?.(P);
  if (spec.belly) P.ell(0.5, 0.25, 0.1, 0.21, spec.belly);
  spec.paint?.(P);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

const rc = new THREE.Raycaster();

function makeBlob(spec) {
  const s = { ...SHAPE, ...spec.shape };
  const geo = bodyGeo(s);
  const root = new THREE.Group(); root.name = spec.name;
  const g = new THREE.Group(); g.position.y = s.h * s.low; root.add(g);
  const body = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ map: paintBody(spec), ...SOFT, ...spec.mat }));
  g.add(body);
  const probe = new THREE.Mesh(geo);

  const b = {
    s, g, color: spec.color, floor: -s.h * s.low,
    // where a ray from outside (at yaw/pitch degrees, 0/0 = straight ahead) lands on the body
    surf(yaw, pitch) {
      yaw += 0.013; pitch = Math.max(-88.5, Math.min(88.5, pitch));   // stay off the poles and the seam
      const dir = new V3(Math.sin(yaw * D) * Math.cos(pitch * D), Math.sin(pitch * D), Math.cos(yaw * D) * Math.cos(pitch * D));
      rc.set(dir.clone().multiplyScalar(8), dir.clone().negate());
      const hit = rc.intersectObject(probe, false)[0];
      return { p: hit.point.clone(), n: (hit.normal || hit.face.normal).clone().normalize() };
    },
    // stick something on the surface. Default: its +Z points outward (stickers, faces). up: its +Y points outward (ears, horns).
    put(o, yaw, pitch, { out = 0, up = false, roll = 0 } = {}) {
      const { p, n } = b.surf(yaw, pitch);
      o.position.copy(p).addScaledVector(n, out);
      if (up) o.quaternion.setFromUnitVectors(YA, n);
      else {
        const x = new V3().crossVectors(YA, n).normalize(), y = new V3().crossVectors(n, x);
        o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n));
      }
      if (roll) o.rotateOnAxis(up ? YA : ZA, roll * D);
      g.add(o); return o;
    },
    // a snug shell over the top of the body (helmets, hoods)
    cap(v0, c, scale = 1.04, v1 = 1) {
      const m = mesh(bodyGeo(s, v0, v1), c.isMaterial ? c : M(c, { side: THREE.DoubleSide }));
      m.scale.setScalar(scale); g.add(m); return m;
    },
    // a band hugging the body at height v
    ring(v, c, tube = 0.045, scale = 1.03) {
      const pts = []; for (let i = 0; i < 64; i++) pts.push(new V3(...bodyPoint(s, i / 64, v)).multiplyScalar(scale));
      const m = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 128, tube, 10, true), c);
      g.add(m); return m;
    },
    add(o, x = 0, y = 0, z = 0) { o.position.set(x, y, z); g.add(o); return o; },
  };
  spec.build?.(b);
  face(b, spec.face);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}

/* ---------- faces ---------- */

function eye(type, es = 1, side = 1) {
  const e = new THREE.Group();
  if (type === 'dot') {
    e.add(ball(0.088 * es, BLACK, 1, 1.15, 0.5));
    e.add(at(ball(0.03 * es, '#ffffff'), -0.022 * es, 0.042 * es, 0.036 * es));
    e.add(at(ball(0.014 * es, '#ffffff'), 0.03 * es, -0.032 * es, 0.04 * es));
  } else if (type === 'happy') {
    e.add(at(arc(0.066 * es, 0.021 * es, BLACK), 0, -0.03 * es, 0.005));
  } else if (type === 'sleepy') {
    const a = arc(0.066 * es, 0.021 * es, BLACK); a.rotation.z = Math.PI; e.add(at(a, 0, 0.03 * es, 0.005));
  } else if (type === 'big') {
    e.add(ball(0.135 * es, '#ffffff', 1, 1.1, 0.45));
    e.add(at(ball(0.085 * es, BLACK, 1, 1.1, 0.45), -side * 0.012 * es, -0.005, 0.036 * es));
    e.add(at(ball(0.03 * es, '#ffffff'), -side * 0.012 * es - 0.025 * es, 0.04 * es, 0.07 * es));
  }
  return e;
}

function face(b, f = {}) {
  const { eyes = 'dot', mouth = 'smile', ey = 4, eg = 27, es = 1.55, cheeks = true, my = ey - 6 } = f;
  if (eyes !== 'none') for (const side of [-1, 1]) {
    const type = eyes === 'wink' ? (side < 0 ? 'dot' : 'happy') : eyes;
    const e = eye(type, es, side); e.scale.z = 0.4; b.put(e, side * eg, ey);
  }
  if (cheeks) for (const side of [-1, 1]) b.put(ball(0.105, CHEEK, 1, 0.62, 0.2), side * (eg + 13), ey - 9);
  const smile = (r, x = 0) => { const a = arc(r, 0.022, BLACK); a.rotation.z = Math.PI; return at(a, x, r * 0.5, 0.004); };
  if (mouth === 'smile') b.put(group(smile(0.06)), 0, my);
  if (mouth === 'wide') b.put(group(smile(0.1)), 0, my);
  if (mouth === 'w') b.put(group(smile(0.045, -0.045), smile(0.045, 0.045)), 0, my);
  if (mouth === 'o') b.put(ball(0.06, '#5b2440', 1, 1.15, 0.4), 0, my);
}

/* ---------- the cast ---------- */

const CAST = [
  {
    name: 'Sir Squish', cls: 'Knight', color: '#7db4ea', belly: '#e8f4ff', stats: [4, 3, 5],
    blurb: 'Sworn protector of the snack drawer. Has never once lost a duel (has never once been in a duel).',
    build(b) {
      b.cap(0.68, STEEL, 1.06); b.ring(0.68, GOLD, 0.075, 1.07);
      const plume = horn(0.3, 0.75, 1.3, '#ff5470', { pow: 0.4, tip: 0.8 });
      b.put(plume, 0, 90, { up: true, out: -0.1 }); plume.rotateY(Math.PI / 2);
      const shield = group(ball(0.37, GOLD, 1, 1.15, 0.4), at(ball(0.3, '#3f6fd8', 1, 1.15, 0.5), 0, 0, 0.04), at(ball(0.12, GOLD, 1, 1, 0.7), 0, 0, 0.14));
      b.put(shield, 47, -20, { out: 0.02 });
      const guard = pill(0.085, 0.24, GOLD); guard.rotation.z = Math.PI / 2;
      const sword = group(at(pill(0.1, 0.32, STEEL), 0, 0.37), at(guard, 0, 0.1), at(ball(0.1, GOLD), 0, -0.06));
      b.put(sword, -46, -16, { out: 0.05, roll: 14 });
    },
  },
  {
    name: 'Wizzle', cls: 'Wizard', color: '#b9a0f5', belly: '#f1e9ff', stats: [2, 5, 5],
    blurb: 'Knows exactly one spell. It makes glitter. It cannot be undone.',
    face: { ey: 10, my: 3 },
    paint(P) {
      const { ctx } = P; ctx.fillStyle = '#ffd93b'; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 20 : 44, a = i / 10 * TAU - Math.PI / 2; ctx[i ? 'lineTo' : 'moveTo'](P.X(0.5) + Math.cos(a) * r * 0.9, P.Y(0.27) + Math.sin(a) * r); }
      ctx.fill();
    },
    build(b) {
      const purple = '#5b3fb5';
      const hat = group(ball(0.82, purple, 1, 0.22, 1), horn(0.56, 1.05, 0.9, purple, { pow: 0.6, tip: 0.45 }));
      const band = torus(0.5, 0.09, GOLD); band.rotation.x = Math.PI / 2; hat.add(at(band, 0.02, 0.15, 0));
      const st = star(0.2, '#ffd93b'); st.rotation.x = -0.35; hat.add(at(st, 0.1, 0.46, 0.34));
      hat.rotation.set(-0.08, 0.5, -0.1);
      b.add(hat, 0, b.s.h * 0.84, 0);
      for (const [yw, pt, r] of [[0, -22, 0.2], [-13, -15, 0.17], [13, -15, 0.17], [-24, -7, 0.13], [24, -7, 0.13], [0, -34, 0.14]]) b.put(ball(r, '#ffffff'), yw, pt, { out: -0.03 });
      for (const sd of [-1, 1]) b.put(ball(0.15, b.color, 1, 1.25, 1), sd * 64, -18, { out: 0.02 });
    },
  },
  {
    name: 'Embry', cls: 'Dragon Whelp', color: '#f25a52', belly: '#ffe6bd', stats: [3, 4, 5],
    blurb: 'Breathes fire, technically. Mostly it just warms up your cocoa a tiny bit.',
    face: { ey: 17, mouth: 'none', eg: 28 },
    paint(P) {
      const { ctx } = P; ctx.save(); ctx.beginPath(); ctx.ellipse(P.X(0.5), P.Y(0.25), 0.1 * P.W, 0.21 * P.H, 0, 0, TAU); ctx.clip();
      ctx.strokeStyle = '#f3c98e'; ctx.lineWidth = 7;
      for (let v = 0.1; v < 0.45; v += 0.075) { ctx.beginPath(); ctx.moveTo(P.X(0.38), P.Y(v)); ctx.quadraticCurveTo(P.X(0.5), P.Y(v - 0.03), P.X(0.62), P.Y(v)); ctx.stroke(); }
      ctx.restore();
    },
    build(b) {
      const snout = group(ball(0.25, '#ffb9ab', 1, 0.7, 0.6), at(ball(0.04, '#b5303a', 1, 1.3, 0.6), -0.085, 0.04, 0.125), at(ball(0.04, '#b5303a', 1, 1.3, 0.6), 0.085, 0.04, 0.125));
      b.put(snout, 0, 3, { out: -0.04 });
      for (const sd of [-1, 1]) {
        b.put(horn(0.17, 0.34, 0.7 * sd, '#fff1cf', { pow: 0.4, tip: 0.8 }), sd * 30, 64, { up: true, out: -0.05 });
        const w = group();   // stubby three-lobed wing, as thick as a thumb
        for (const [ang, len] of [[0.3, 0.6], [0.9, 0.5], [1.45, 0.38]]) { const f = horn(0.18, len, 0, '#c73a3f', { pow: 0.35, tip: 0.85 }); f.rotation.z = -sd * ang; w.add(f); }
        w.scale.set(1.35, 1.35, 0.85); w.rotation.y = sd * 0.25;
        b.add(w, sd * 0.74 * b.s.w, 0.15, -0.08);
        b.add(ball(0.2, b.color, 1, 0.6, 1.25), sd * 0.38, b.floor + 0.1, 0.62);
      }
      for (const [p, sz] of [[86, 1], [60, 0.85], [34, 0.7]]) b.put(ball(0.15 * sz, '#ffb347', 1, 1.3, 1), 180, p, { up: true, out: 0.03 });
      const tail = horn(0.27, 0.75, 1.5, b.color, { pow: 0.5, tip: 0.6 }); tail.scale.x = -1; tail.rotation.z = -Math.PI / 2; tail.rotation.y = 0.5;
      b.add(tail, 0.5, b.floor + 0.3, -0.5);
    },
  },
  {
    name: 'King Gloop', cls: 'Slime Royalty', color: '#7fe36c', stats: [5, 1, 5],
    shape: { w: 1.12, h: 0.82, d: 1.02, taper: 0.3, low: 0.8, flat: 0.5 }, mat: { roughness: 0.5 },
    blurb: 'First monster you meet in every dungeon. Rules a kingdom of exactly one puddle.',
    face: { ey: 6, eg: 30, mouth: 'w' },
    paint(P) { P.ell(0.405, 0.71, 0.03, 0.075, 'rgba(255,255,255,.75)', 0.5); P.ell(0.385, 0.6, 0.011, 0.022, 'rgba(255,255,255,.75)'); P.ell(0.5, 0.2, 0.2, 0.2, 'rgba(60,190,90,.25)'); },
    build(b) {
      b.add(horn(0.48, 0.6, 0.8, M(b.color, { roughness: 0.5 }), { pow: 0.6, tip: 0.45 }), -0.02, b.s.h * 0.72, 0);
      const band = torus(0.44, 0.1, GOLD); band.rotation.x = Math.PI / 2;
      const crown = group(band);
      for (let i = 0; i < 5; i++) {
        const a = (i + 0.5) / 5 * TAU, a2 = i / 5 * TAU;
        crown.add(at(ball(0.13, GOLD, 1, 1.6, 1), Math.sin(a) * 0.44, 0.13, Math.cos(a) * 0.44), at(ball(0.075, i % 2 ? '#ff4d6d' : '#4dc3ff'), Math.sin(a2) * 0.52, 0, Math.cos(a2) * 0.52));
      }
      crown.rotation.set(0.06, 0, -0.1);
      b.add(crown, 0, b.s.h * 0.72 + 0.14, 0);
    },
  },
  {
    name: 'Mendy', cls: 'Healer', color: '#f1eeff', stats: [3, 1, 5],
    blurb: 'Restores 5 HP with a boop on the nose. Out of mana by 8pm, please respect her bedtime.',
    face: { eyes: 'happy', ey: 14, eg: 19, es: 1.3, my: 7 },
    paint(P) {
      const { ctx } = P; ctx.strokeStyle = '#ffcb3d'; ctx.lineWidth = 12;
      ctx.beginPath(); ctx.ellipse(P.X(0.5), P.Y(0.565), 0.112 * P.W, 0.12 * P.H, 0, 0, TAU); ctx.fillStyle = '#ffd9c2'; ctx.fill(); ctx.stroke();
      P.rect(0.5, 0.3, 0.026, 0.16, '#4fd69c'); P.rect(0.5, 0.3, 0.078, 0.055, '#4fd69c');
      P.rect(0.5, 0.045, 1, 0.03, '#ffcb3d');
    },
    build(b) {
      const tip = horn(0.36, 0.5, 1.4, b.color, { pow: 0.5, tip: 0.6 }); tip.rotation.y = Math.PI / 2;
      b.add(tip, 0, b.s.h * 0.8, -0.3);
      const halo = torus(0.4, 0.095, '#ffd95a'); halo.rotation.set(Math.PI / 2 - 0.15, 0, 0.08);
      b.add(halo, 0, b.s.h * 0.92, 0.02);
      for (const sd of [-1, 1]) b.put(ball(0.15, b.color, 1, 1.25, 1), sd * 64, -16, { out: 0.02 });
    },
  },
  {
    name: 'Pilf', cls: 'Rogue', color: '#a3acbf', belly: '#f1f3f8', stats: [2, 3, 5],
    blurb: 'Steals only the left sock. Nobody knows why. He has four hundred of them.',
    face: { eyes: 'big', es: 1.05, ey: 13, eg: 21, mouth: 'w', my: 0 },
    under(P) { P.ell(0.5 - 0.058, 0.575, 0.06, 0.07, '#4a5066', 0.3); P.ell(0.5 + 0.058, 0.575, 0.06, 0.07, '#4a5066', -0.3); },
    build(b) {
      for (const sd of [-1, 1]) {
        const ear = group(ball(0.27, b.color, 1, 1, 0.7), at(ball(0.16, '#4a5066', 1, 1, 0.5), 0, 0, 0.12));
        ear.children.forEach(k => k.position.y = 0.17);
        const { p } = b.surf(sd * 44, 50); ear.rotation.z = -sd * 0.55; b.add(ear, p.x, p.y - 0.08, p.z);
      }
      b.put(ball(0.065, BLACK, 1.2, 0.8, 0.8), 0, 6, { out: 0.01 });
      const tail = horn(0.3, 0.9, 1.7, null, { pow: 0.4, tip: 0.7, stripes: ['#4a5066', '#c9cfdc'], bands: 6 }); tail.scale.x = -1; tail.rotation.z = -Math.PI / 2; tail.rotation.y = 0.35;
      b.add(tail, 0.5, b.floor + 0.34, -0.42);
      const coin = cyl(0.11, 0.11, 0.09, GOLD); coin.rotation.set(1.2, 0, 0.4);
      const sack = group(ball(0.3, '#dcb878', 1, 0.95, 1), at(ball(0.14, '#dcb878'), 0, 0.29), at(coin, 0.02, 0.4, 0.04));
      b.put(sack, -50, -27, { out: 0.12, up: true });
    },
  },
  {
    name: 'Sporo', cls: 'Mushroom Sprout', color: '#fff0d4', belly: '#fff9ec', stats: [3, 2, 5],
    shape: { w: 0.84, h: 0.95, d: 0.8, taper: 0.08 },
    blurb: 'Grows two inches when praised. Releases a puff of spores when startled (rude, but sparkly).',
    face: { ey: -6, eg: 27, es: 1.35 },
    build(b) {
      const R = 1.18, H = 0.82, pts = [new THREE.Vector2(0, -0.04), new THREE.Vector2(R * 0.86, -0.04), new THREE.Vector2(R, 0.08)];
      for (let i = 1; i <= 14; i++) { const p = Math.PI / 2 * (1 - i / 14); pts.push(new THREE.Vector2(Math.max(R * Math.sin(p), 0.0001), 0.08 + H * Math.cos(p))); }
      const capM = mesh(new THREE.LatheGeometry(pts, 48), M('#f2545b', { side: THREE.DoubleSide }));
      const cap = group(capM);
      for (const [ph, th, r] of [[20, 10, 0.2], [52, 48, 0.17], [55, -38, 0.19], [70, 5, 0.12], [50, 130, 0.2], [48, -125, 0.18], [62, 180, 0.15], [75, 85, 0.11], [74, -82, 0.12]]) {
        const sp = Math.sin(ph * D), cp = Math.cos(ph * D), n = new V3(sp * Math.sin(th * D) / R, cp / H, sp * Math.cos(th * D) / R).normalize();
        const s = ball(r, '#ffffff', 1, 1, 0.16);
        s.position.set(R * sp * Math.sin(th * D), 0.08 + H * cp, R * sp * Math.cos(th * D)); s.quaternion.setFromUnitVectors(ZA, n);
        cap.add(s);
      }
      cap.rotation.set(-0.08, 0, 0.06);
      b.add(cap, 0, b.s.h * 0.4, 0);
      for (const sd of [-1, 1]) b.put(ball(0.12, b.color, 1, 1.3, 1), sd * 70, -22, { out: 0.02 });
    },
  },
  {
    name: 'Chompy', cls: 'Mimic', color: '#b57440', stats: [4, 4, 5],
    shape: { w: 1.05, h: 0.8, d: 0.82, boxy: 0.5, flat: 0.3, low: 0.9, taper: 0.05, full: 0.55 },
    blurb: 'Pretends to be treasure. Gives it away immediately by giggling.',
    face: { eyes: 'big', ey: 36, eg: 19, es: 1.2, mouth: 'none', cheeks: false },
    paint(P) {
      const { ctx } = P;
      ctx.strokeStyle = '#96592c'; ctx.lineWidth = 4;
      for (const v of [0.15, 0.28, 0.41, 0.7, 0.82]) { ctx.beginPath(); ctx.moveTo(0, P.Y(v)); ctx.lineTo(P.W, P.Y(v)); ctx.stroke(); }
      for (const u of [0.5 - 0.085, 0.5 + 0.085, 0.085, 0.915]) P.rect(u, 0.5, 0.022, 1, '#ffcb3d');
      P.rect(0.5, 0.03, 1, 0.06, '#ffcb3d'); P.rect(0.5, 0.56, 1, 0.045, '#5a2f14'); P.rect(0.5, 0.6, 1, 0.03, '#ffcb3d');
    },
    build(b) {
      for (const yaw of [-30, -13, -3, 3, 13, 30]) b.put(ball(0.09, '#fffdf5', 1, 1.4, 0.8), yaw, 5);
      const tongue = ball(0.2, '#ff7fa3', 1, 0.5, 1.2); tongue.rotation.x = 0.55;
      b.add(tongue, 0.05, -0.14, b.s.d * 0.84);
      for (const sd of [-1, 1]) b.put(ball(0.09, CHEEK, 1, 0.62, 0.22), sd * 34, 27);
    },
  },
  {
    name: 'Shardy', cls: 'Crystal Golem', color: '#a9b6cc', belly: '#e6ecf5', stats: [5, 3, 5],
    blurb: 'Ancient guardian of the Glimmer Caves. Has been napping for 900 years and would like 5 more minutes.',
    face: { eyes: 'sleepy' },
    under(P) { for (const [u, v, r] of [[0.2, 0.6, 0.03], [0.3, 0.3, 0.04], [0.72, 0.45, 0.035], [0.8, 0.7, 0.03], [0.9, 0.3, 0.04], [0.1, 0.25, 0.03], [0.66, 0.75, 0.02], [0.34, 0.74, 0.022]]) P.ell(u, v, r, r * 1.6, '#93a1ba'); },
    build(b) {
      const cm = M('#86e9f7', { flatShading: true, roughness: 0.6 });
      const gem = sc => { const m = mesh(new THREE.IcosahedronGeometry(1, 0), cm); m.scale.set(0.3 * sc, 0.4 * sc, 0.3 * sc); return m; };
      for (const [yaw, p, sc, roll] of [[0, 88, 1.25, 0], [-36, 64, 0.95, 20], [40, 62, 1.05, 50], [180, 58, 1, 0], [120, 50, 0.8, 0], [-125, 52, 0.75, 0]])
        b.put(gem(sc), yaw, p, { up: true, out: 0.06 * sc, roll });
      const core = mesh(new THREE.IcosahedronGeometry(1, 0), cm); core.scale.set(0.22, 0.26, 0.12);
      b.put(core, 0, -26);
      for (const sd of [-1, 1]) b.put(ball(0.16, '#93a1ba', 1, 1.2, 1), sd * 68, -18, { out: 0.02 });
    },
  },
  {
    name: 'Boo-Hoo', cls: 'Friendly Ghost', color: '#e4e9ff', stats: [1, 2, 5],
    shape: { w: 0.92, h: 1.25, d: 0.86, taper: 0.12, low: 0.6 },
    blurb: 'Tried haunting once. Felt bad about it. Now leaves little apology notes.',
    face: { es: 1.7, ey: 10, mouth: 'o', eg: 24 },
    build(b) {
      for (let i = 0; i < 9; i++) { const a = (i + 0.5) / 9 * TAU; b.add(ball(0.22, b.color), Math.sin(a) * 0.74 * b.s.w, b.floor + 0.21, Math.cos(a) * 0.74 * b.s.d); }
      for (const sd of [-1, 1]) { const arm = ball(0.16, b.color, 1, 1.5, 1); b.put(arm, sd * 66, -4, { out: 0.01 }); arm.rotateZ(-sd * 0.8); }
      const fm = M('#8fdcff');   // little soul-flame buddy, fused to the head
      const wisp = group(ball(0.22, fm), at(horn(0.2, 0.36, -0.9, fm, { pow: 0.5, tip: 0.6 }), 0, 0.08, 0), at(ball(0.035, BLACK, 1, 1.2, 0.5), -0.07, 0.02, 0.2), at(ball(0.035, BLACK, 1, 1.2, 0.5), 0.07, 0.02, 0.2));
      const { p } = b.surf(48, 58); b.add(wisp, p.x + 0.04, p.y + 0.1, p.z);
    },
  },
  {
    name: 'Brewster', cls: 'Health Potion', color: '#ffd9e4', stats: [5, 1, 5],
    shape: { w: 1.03, h: 0.98, d: 1.0, taper: 0.04, low: 0.78 }, mat: { roughness: 0.55 },
    blurb: 'Tastes like strawberry. Restores 50 HP. Would really prefer you not drink him though.',
    face: { eyes: 'wink', ey: 8 },
    paint(P) {
      const { ctx } = P; ctx.fillStyle = '#ff5d8f'; ctx.beginPath(); ctx.moveTo(0, P.H);
      for (let x = 0; x <= P.W; x += 8) ctx.lineTo(x, P.Y(0.7 + 0.018 * Math.sin(x / P.W * TAU * 6)));
      ctx.lineTo(P.W, P.H); ctx.fill();
      for (const [u, v, r] of [[0.33, 0.45, 0.014], [0.36, 0.58, 0.008], [0.66, 0.5, 0.012], [0.63, 0.34, 0.008], [0.7, 0.62, 0.007], [0.2, 0.5, 0.012], [0.85, 0.4, 0.014], [0.1, 0.3, 0.01]]) P.ell(u, v, r, r * 2, 'rgba(255,255,255,.55)');
      P.ell(0.5, 0.25, 0.085, 0.17, '#fff6e0');
      ctx.fillStyle = '#ff5d8f'; const x = P.X(0.5), y = P.Y(0.27), k = 30;
      ctx.beginPath(); ctx.moveTo(x, y + k); ctx.bezierCurveTo(x - k * 1.5, y - k * 0.2, x - k * 0.6, y - k * 1.2, x, y - k * 0.4); ctx.bezierCurveTo(x + k * 0.6, y - k * 1.2, x + k * 1.5, y - k * 0.2, x, y + k); ctx.fill();
    },
    build(b) {
      const glass = '#ffe6ee', h = b.s.h;
      b.add(cyl(0.3, 0.38, 0.4, glass), 0, h + 0.08, 0);
      const lip = torus(0.31, 0.085, glass); lip.rotation.x = Math.PI / 2; b.add(lip, 0, h + 0.28, 0);
      b.add(cyl(0.3, 0.25, 0.28, '#c8935a'), 0, h + 0.42, 0);
      b.put(star(0.2, '#ffd93b'), 38, 50, { out: 0.03, roll: 15 });
    },
  },
  {
    name: 'Strum', cls: 'Bard', color: '#79d46f', belly: '#ecf9c6', stats: [2, 2, 5],
    blurb: 'Only knows the battle theme. Plays it at breakfast. Plays it at bedtime.',
    face: { eyes: 'none', ey: 14, mouth: 'wide', my: 12, eg: 24 },
    build(b) {
      for (const sd of [-1, 1]) {
        const bump = group(ball(0.25, b.color), at(ball(0.17, '#ffffff', 1, 1, 0.4), 0, 0.03, 0.2), at(ball(0.105, BLACK, 1, 1.1, 0.35), -sd * 0.015, 0.03, 0.245), at(ball(0.034, '#ffffff', 1, 1, 0.5), -sd * 0.015 - 0.03, 0.08, 0.275));
        const { p } = b.surf(sd * 27, 58); bump.rotation.z = -sd * 0.12; b.add(bump, p.x * 1.1, p.y + 0.02, p.z + 0.02);
        b.add(ball(0.2, b.color, 1.1, 0.55, 1.3), sd * 0.42, b.floor + 0.1, 0.6);
      }
      const red = '#e8524a';
      const hat = group(ball(0.36, red, 1, 0.32, 1), horn(0.3, 0.48, 1.0, red, { pow: 0.5, tip: 0.6 }), at(ball(0.12, '#fff3a8'), 0.24, 0.42, 0));
      hat.rotation.set(-0.35, -0.4, 0);
      b.add(hat, 0, b.s.h * 0.93, -0.22);
      const wood = '#8a5a3c';
      const lute = group(ball(0.27, '#e6ad62', 1, 1.2, 0.6), at(ball(0.08, '#5a3216', 1, 1, 0.3), 0, 0.02, 0.14), at(pill(0.085, 0.26, wood), 0, 0.48, 0.03), at(ball(0.12, wood), 0, 0.7, 0.03));
      b.put(lute, -50, -26, { out: 0.04, roll: -50 });
    },
  },
];

/* ---------- scene ---------- */

const canvas = document.getElementById('c');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
catch (e) { document.getElementById('err').style.display = 'grid'; throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const BG = new THREE.Color('#ffffff');
const scene = new THREE.Scene();
scene.background = BG;
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;
scene.add(new THREE.HemisphereLight(0xffffff, 0xe8e4f5, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(-5, 22, 8); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = 0.04; sun.shadow.radius = 5;
Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 50 });
scene.add(sun);

// white studio floor that only shows soft shadows
{
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: 0x5b4a8a, opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
}

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
Object.assign(controls, { enableDamping: true, enablePan: false, minDistance: 4, maxDistance: 70, maxPolarAngle: 86 * D });

const blobShadow = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const ctx = cv.getContext('2d'), gr = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(70,50,120,.55)'); gr.addColorStop(0.55, 'rgba(70,50,120,.22)'); gr.addColorStop(1, 'rgba(70,50,120,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 128, 128);
  const geo = new THREE.PlaneGeometry(3.3, 3.0).rotateX(-Math.PI / 2), tex = new THREE.CanvasTexture(cv);
  return () => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
})();
const proxyGeo = new THREE.SphereGeometry(1.25, 12, 8), proxyMat = new THREE.MeshBasicMaterial({ visible: false });
const RARITY = ['Common', 'Common', 'Rare', 'Common', 'Rare', 'Common', 'Common', 'Rare', 'Ultra Rare', 'Common', 'Common', 'Rare'];
const blobs = CAST.map((spec, i) => {
  const root = makeBlob(spec); scene.add(root);
  const proxy = new THREE.Mesh(proxyGeo, proxyMat); proxy.userData.i = i; scene.add(proxy);
  const shade = blobShadow(); scene.add(shade);
  return { spec, root, proxy, shade, home: new V3(), yaw: (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.3, s: 0, sv: 0, w: 0, wv: 0, vis: 1, hop: -1, nextHop: 2 + Math.random() * 8, ph: Math.random() * 10, wisp: root.getObjectByName('wisp') };
});

/* ---------- layout & camera ---------- */

let sel = -1, flying = true, bounds = { hx: 1, hz: 1 };
const goal = { pos: new V3(), target: new V3() };
const portrait = () => innerWidth / innerHeight < 0.85;

function layout() {
  const asp = innerWidth / innerHeight, cols = asp < 0.85 ? 3 : asp < 1.9 ? 4 : 6, rows = Math.ceil(blobs.length / cols);
  blobs.forEach((b, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    b.home.set((c - (cols - 1) / 2) * 2.9 + (r % 2 ? 0.35 : -0.35), 0, (r - (rows - 1) / 2) * 3.1);
    b.root.position.copy(b.home); b.proxy.position.set(b.home.x, 1.2, b.home.z); b.shade.position.set(b.home.x, 0.012, b.home.z);
  });
  bounds = { hx: (cols - 1) / 2 * 2.9 + 1.5, hz: (rows - 1) / 2 * 3.1 + 1.2 };
}

function overview() {
  const el = (portrait() ? 54 : 44) * D, dir = new V3(0, Math.sin(el), Math.cos(el)), target = new V3(0, 0.8, 0);
  const pts = []; for (const x of [-1, 1]) for (const z of [-1, 1]) for (const y of [0, 2.6]) pts.push(new V3(x * bounds.hx, y, z * bounds.hz));
  const top = 1 - 2 * (innerWidth < 760 ? document.querySelector('header').offsetHeight + 6 : 50) / innerHeight, bot = -1 + 2 * 96 / innerHeight;
  const cam = camera.clone(); let lo = 4, hi = 160;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2; cam.position.copy(target).addScaledVector(dir, mid); cam.lookAt(target); cam.updateMatrixWorld();
    const ok = pts.every(p => { const v = p.clone().project(cam); return Math.abs(v.x) < 0.97 && v.y < top && v.y > bot; });
    if (ok) hi = mid; else lo = mid;
  }
  // nudge the view so the grid sits centred between header and footer
  const vh = 2 * hi * Math.tan(camera.fov * D / 2), shift = (top + bot) / 2 * vh / 2;
  target.addScaledVector(new V3(0, Math.cos(el), -Math.sin(el)), -shift);
  return { target, pos: target.clone().addScaledVector(dir, hi) };
}

function closeup(i) {
  const asp = innerWidth / innerHeight, tanH = Math.tan(camera.fov * D / 2);
  const dist = Math.max(9, 3.4 / (2 * tanH * asp)), vh = 2 * dist * tanH;
  const target = blobs[i].home.clone(); target.y = innerWidth < 760 ? 1.4 - vh * 0.17 : 1.3;
  const dir = new V3(0.22, 0.24, 1).normalize();
  return { target, pos: target.clone().addScaledVector(dir, dist) };
}

function refocus() { const g = sel < 0 ? overview() : closeup(sel); goal.pos.copy(g.pos); goal.target.copy(g.target); flying = true; }

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  layout(); refocus();
}
addEventListener('resize', resize);
resize();
camera.position.copy(goal.pos).addScaledVector(new V3(0, 0.4, 1), 6); controls.target.copy(goal.target);

/* ---------- UI ---------- */

const $ = s => document.querySelector(s), card = $('#card'), foot = $('#foot');
function select(i) {
  sel = i;
  card.classList.toggle('on', i >= 0);
  foot.style.opacity = i >= 0 ? 0 : 1; foot.style.visibility = i >= 0 ? 'hidden' : 'visible';
  if (i >= 0) {
    const { spec } = blobs[i];
    card.querySelector('.no').textContent = `#${String(i + 1).padStart(2, '0')} · ${spec.cls} · ${RARITY[i]}`;
    card.querySelector('h2').textContent = spec.name;
    card.querySelector('p').textContent = spec.blurb;
    const accent = { '#f1eeff': '#4fd69c', '#e4e9ff': '#6fc8ff', '#fff0d4': '#f2545b', '#ffd9e4': '#ff5d8f' }[spec.color] || spec.color;
    card.querySelector('.stats').innerHTML = ['HP', 'ATK', 'CUTE'].map((k, j) =>
      `<span>${k}</span><span class="pips" style="--c:${accent}">${[0, 1, 2, 3, 4].map(n => `<i class="${n < spec.stats[j] ? 'f' : ''}"></i>`).join('')}</span>`).join('');
    blobs[i].sv = -4; blobs[i].hop = 0; blobs[i].wv = 2.5;
  }
  refocus();
}
$('#x').onclick = () => select(-1);
$('#prev').onclick = () => select((sel + blobs.length - 1) % blobs.length);
$('#next').onclick = () => select((sel + 1) % blobs.length);
addEventListener('keydown', e => {
  if (e.key === 'Escape') select(-1);
  if (sel >= 0 && e.key === 'ArrowLeft') $('#prev').onclick();
  if (sel >= 0 && e.key === 'ArrowRight') $('#next').onclick();
});

const ptr = new THREE.Vector2(), down = { x: 0, y: 0, ok: false };
function pick(e) {
  ptr.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  rc.setFromCamera(ptr, camera);
  const hit = rc.intersectObjects(blobs.filter((b, i) => sel < 0 || i === sel).map(b => b.proxy), false)[0];
  return hit ? hit.object.userData.i : -1;
}
canvas.addEventListener('pointerdown', e => { down.x = e.clientX; down.y = e.clientY; down.ok = true; });
canvas.addEventListener('pointerup', e => {
  if (!down.ok || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
  down.ok = false;
  const i = pick(e);
  if (i === sel && i >= 0) { blobs[i].sv = -5; blobs[i].wv = (Math.random() < 0.5 ? -1 : 1) * 4; return; }
  select(i);
});
canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !e.buttons) canvas.style.cursor = pick(e) >= 0 ? 'pointer' : 'grab'; });
controls.addEventListener('start', () => { flying = false; });

// GLB export
async function download(list, filename) {
  const out = new THREE.Group();
  list.forEach((b, k) => {
    const c = b.root.clone(true); c.position.set((k - (list.length - 1) / 2) * 2.8, 0, 0); c.rotation.set(0, 0, 0); c.scale.setScalar(1);
    out.add(c);
  });
  const buf = await new GLTFExporter().parseAsync(out, { binary: true });
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' })); a.download = filename;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
$('#glb').onclick = () => sel >= 0 && download([blobs[sel]], `${slug(blobs[sel].spec.name)}.glb`);
$('#all').onclick = () => download(blobs, 'doods-series-1.glb');
window.__doods = { blobs, select, download, snap(i) { select(i); camera.position.copy(goal.pos); controls.target.copy(goal.target); blobs.forEach((b, k) => { b.vis = k === i ? 1 : 0; b.root.rotation.y = 0; }); } };

/* ---------- animate ---------- */

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
  blobs.forEach((b, i) => {
    // squish spring
    b.sv += (-70 * b.s - 5 * b.sv) * dt; b.s += b.sv * dt;
    const breathe = Math.sin(t * 1.8 + b.ph) * 0.025, sy = 1 + b.s * 0.16 + breathe;
    b.vis += ((sel < 0 || i === sel ? 1 : 0) - b.vis) * Math.min(1, dt * 9);   // the others duck out during a close-up
    b.root.visible = b.vis > 0.02;
    b.shade.material.opacity = b.vis * (1 - b.root.position.y * 0.8); b.shade.scale.setScalar(b.vis);
    b.root.scale.set((1 - (sy - 1) * 0.8) * b.vis, sy * b.vis, (1 - (sy - 1) * 0.8) * b.vis);
    // weighted-bean wobble
    b.wv += (-60 * b.w - 3.2 * b.wv) * dt; b.w += b.wv * dt; b.root.rotation.z = b.w * 0.35;
    // hops
    if (b.hop < 0 && sel < 0 && (b.nextHop -= dt) < 0) { b.hop = 0; b.sv = -3; }
    if (b.hop >= 0) {
      b.hop += dt / 0.55;
      if (b.hop >= 1) { b.hop = -1; b.nextHop = 4 + Math.random() * 9; b.sv = -5; b.root.position.y = 0; }
      else b.root.position.y = Math.sin(Math.max(0, b.hop - 0.15) / 0.85 * Math.PI) * 0.55;
    }
    // selected one does a slow turntable, the rest settle back
    if (i === sel) b.root.rotation.y += dt * 0.7;
    else { let d = (b.yaw - b.root.rotation.y) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; b.root.rotation.y += d * Math.min(1, dt * 5); }
    if (b.wisp) b.wisp.position.y = 0.75 + Math.sin(t * 2.4) * 0.07;
  });
  if (flying) {
    const k = 1 - Math.exp(-dt * 4.5);
    camera.position.lerp(goal.pos, k); controls.target.lerp(goal.target, k);
    if (camera.position.distanceTo(goal.pos) < 0.01) flying = false;
  }
  controls.update();
  renderer.render(scene, camera);
});
