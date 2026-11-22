import * as THREE from 'three';

const D = Math.PI / 180, TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const YA = new V3(0, 1, 0), ZA = new V3(0, 0, 1);

/* ---------- materials & primitive helpers ---------- */

// soft-touch squishy rubber: matte, with a velvety edge glow instead of hard highlights
const SOFT = { roughness: 0.78, sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color('#ffffff') };
const matCache = new Map();
function M(color, o) {
  if (color && color.isMaterial) return color;
  const base = { color, ...SOFT };
  if (o) return new THREE.MeshPhysicalMaterial({ ...base, ...o });
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshPhysicalMaterial(base));
  return matCache.get(color);
}
// printed details: flat ink
const INK = (color, o) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.45, ...o });
const BLACK = INK('#1d1a2b'), CHEEK = INK('#ff86ad', { roughness: 0.8 }), WHITE = INK('#ffffff');
const GOLD = M('#ffcc33'), STEEL = M('#c3ccdd', { side: THREE.DoubleSide });

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
  const body = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ map: paintBody(spec), ...SOFT }));
  g.add(body);
  const probe = new THREE.Mesh(geo);

  const b = {
    s, g, color: spec.color, belly: spec.belly, floor: -s.h * s.low, face: { ey: 4, ...spec.face },
    // body radius at a height given as a fraction of the top (0 = widest point, 1 = crown)
    rAt(frac) { const a = Math.asin(Math.min(1, Math.pow(frac, 1 / 0.95))); return Math.pow(Math.cos(a), s.full) * (1 - s.taper * Math.sin(a)) * (s.w + s.d) / 2; },
    // pitch (degrees) that lands on the front of the body at texture height v
    pv(v) { const p = bodyPoint(s, 0.5, v); return Math.atan2(p[1], p[2]) / D; },
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
    e.add(at(ball(0.03 * es, WHITE), -0.022 * es, 0.042 * es, 0.036 * es));
    e.add(at(ball(0.014 * es, WHITE), 0.03 * es, -0.032 * es, 0.04 * es));
  } else if (type === 'happy') {
    e.add(at(arc(0.066 * es, 0.021 * es, BLACK), 0, -0.03 * es, 0.005));
  } else if (type === 'sleepy') {
    const a = arc(0.066 * es, 0.021 * es, BLACK); a.rotation.z = Math.PI; e.add(at(a, 0, 0.03 * es, 0.005));
  } else if (type === 'big') {
    e.add(ball(0.135 * es, WHITE, 1, 1.1, 0.45));
    e.add(at(ball(0.085 * es, BLACK, 1, 1.1, 0.45), -side * 0.012 * es, -0.005, 0.036 * es));
    e.add(at(ball(0.03 * es, WHITE), -side * 0.012 * es - 0.025 * es, 0.04 * es, 0.07 * es));
  }
  return e;
}

function face(b, f = {}) {
  const { eyes = 'dot', mouth = 'smile', ey = 4, eg = 27, es = 1.55, cheeks = true, my = ey - 6 } = f;
  if (eyes === 'cyclops') { const e = eye('dot', es * 1.5); e.scale.z = 0.4; b.put(e, 0, ey + 3); }
  else if (eyes === 'three') for (const [yw, p, k] of [[-eg + 2, ey - 2, 0.9], [eg - 2, ey - 2, 0.9], [0, ey + 19, 1.1]]) { const e = eye('dot', es * k); e.scale.z = 0.4; b.put(e, yw, p); }
  else if (eyes !== 'none') for (const side of [-1, 1]) {
    const type = eyes === 'wink' ? (side < 0 ? 'dot' : 'happy') : eyes;
    const e = eye(type, es, side); e.scale.z = 0.4; b.put(e, side * eg, ey);
  }
  if (cheeks) for (const side of [-1, 1]) b.put(ball(0.105, CHEEK, 1, 0.62, 0.2), side * (eg + 13), ey - 9);
  const smile = (r, x = 0) => { const a = arc(r, 0.022, BLACK); a.rotation.z = Math.PI; return at(a, x, r * 0.5, 0.004); };
  if (mouth === 'smile') b.put(group(smile(0.06)), 0, my);
  if (mouth === 'wide') b.put(group(smile(0.1)), 0, my);
  if (mouth === 'w') b.put(group(smile(0.045, -0.045), smile(0.045, 0.045)), 0, my);
  if (mouth === 'fang' || mouth === 'tongue' || mouth === 'teeth') b.put(group(smile(mouth === 'teeth' ? 0.1 : 0.06)), 0, my);
  if (mouth === 'fang') for (const sd of [-1, 1]) b.put(ball(0.045, WHITE, 1, 1.6, 0.8), sd * 3.2, my - 3.5);
  if (mouth === 'tongue') b.put(ball(0.05, '#ff7fa3', 1, 1.2, 0.6), 0, my - 4);
  if (mouth === 'teeth') for (const yw of [-9, -3, 3, 9]) b.put(ball(0.05, WHITE, 1, 1.4, 0.8), yw, my - 5);
  if (mouth === 'o') b.put(ball(0.06, '#5b2440', 1, 1.15, 0.4), 0, my);
}

/* ---------- the cast ---------- */

const arms = (b, c = b.color, yaw = 64, pitch = -16) => { for (const sd of [-1, 1]) b.put(ball(0.15, c, 1, 1.25, 1), sd * yaw, pitch, { out: 0.02 }); };
const feet = (b, c = b.color) => { for (const sd of [-1, 1]) b.add(ball(0.2, c, 1.1, 0.55, 1.3), sd * 0.4, b.floor + 0.1, b.s.d * 0.66); };
const muzzle = (b, c, pitch = 0, nose = BLACK) => b.put(group(ball(0.24, c, 1, 0.75, 0.6), at(ball(0.065, nose, 1.2, 0.8, 0.8), 0, 0.05, 0.13)), 0, pitch, { out: -0.03 });
function roundEars(b, c, inner, k = 1) {
  for (const sd of [-1, 1]) {
    const ear = group(at(ball(0.27 * k, c, 1, 1, 0.7), 0, 0.17 * k, 0), at(ball(0.16 * k, inner, 1, 1, 0.5), 0, 0.17 * k, 0.12 * k));
    const { p } = b.surf(sd * 44, 50); ear.rotation.z = -sd * 0.55; b.add(ear, p.x, p.y - 0.08, p.z);
  }
}

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
    shape: { w: 1.12, h: 0.82, d: 1.02, taper: 0.3, low: 0.8, flat: 0.5 }, blurb: 'First monster you meet in every dungeon. Rules a kingdom of exactly one puddle.',
    face: { ey: 6, eg: 30, mouth: 'w' },
    paint(P) { P.ell(0.405, 0.71, 0.03, 0.075, 'rgba(255,255,255,.75)', 0.5); P.ell(0.385, 0.6, 0.011, 0.022, 'rgba(255,255,255,.75)'); P.ell(0.5, 0.2, 0.2, 0.2, 'rgba(60,190,90,.25)'); },
    build(b) {
      b.add(horn(0.48, 0.6, 0.8, b.color, { pow: 0.6, tip: 0.45 }), -0.02, b.s.h * 0.72, 0);
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
    shape: { w: 1.03, h: 0.98, d: 1.0, taper: 0.04, low: 0.78 }, blurb: 'Tastes like strawberry. Restores 50 HP. Would really prefer you not drink him though.',
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
        const bump = group(ball(0.25, b.color), at(ball(0.17, WHITE, 1, 1, 0.4), 0, 0.03, 0.2), at(ball(0.105, BLACK, 1, 1.1, 0.35), -sd * 0.015, 0.03, 0.245), at(ball(0.034, WHITE, 1, 1, 0.5), -sd * 0.015 - 0.03, 0.08, 0.275));
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
  /* ---------- Series 2: Snack Quest ---------- */
  {
    set: 'snacks', name: 'Dumplin', cls: 'Soup Monk', color: '#fff1dc', accent: '#f0b56a', stats: [3, 1, 5],
    shape: { w: 1.1, h: 0.95, d: 1.05, taper: 0.35, low: 0.78 },
    blurb: 'Full of hot soup and inner peace. Do not squeeze. (Okay, squeeze a little.)',
    face: { ey: 0 },
    paint(P) { P.rect(0.5, 0.1, 1, 0.2, '#ffe3b8'); },
    build(b) {
      for (let i = 0; i < 8; i++) b.put(ball(0.16, b.color, 0.7, 1.9, 0.7), i * 45 + 10, 62, { roll: 22 });
      b.put(ball(0.2, b.color, 1, 0.8, 1), 0, 90, { up: true, out: 0.04 });
      arms(b);
    },
  },
  {
    set: 'snacks', name: 'Nori', cls: 'Rice Paladin', color: '#f8f4e8', accent: '#2f3b36', stats: [4, 2, 5],
    shape: { w: 1.05, h: 1.25, d: 0.72, taper: 0.5, low: 0.58 },
    blurb: 'Wears his seaweed like armor. It is not armor. It is delicious.',
    face: { ey: 10 },
    paint(P) { P.rect(0.5, 0.2, 0.2, 0.44, '#2f3b36'); },
    build(b) { b.put(ball(0.18, '#ff5d6c'), 0, 90, { up: true, out: 0.02 }); arms(b); },
  },
  {
    set: 'snacks', name: 'Flanny', cls: 'Wobble Mage', color: '#ffd873', rarity: 'Rare', stats: [2, 2, 5],
    shape: { w: 1.0, h: 0.8, d: 1.0, taper: 0.32, low: 0.85, flat: 0.3, full: 0.45 },
    blurb: 'Casts Jiggle on herself at the start of every fight. And at the end. And at lunch.',
    face: { ey: -4 },
    paint(P) {
      const { ctx } = P; ctx.fillStyle = '#a9591f'; ctx.beginPath(); ctx.moveTo(0, 0);
      for (let x = 0; x <= P.W; x += 8) ctx.lineTo(x, P.Y(0.7 + 0.06 * Math.sin(x / P.W * TAU * 7)));
      ctx.lineTo(P.W, 0); ctx.fill();
    },
    build(b) {
      b.put(ball(0.32, '#fffaf0', 1, 0.55, 1), 0, 90, { up: true, out: 0.03 });
      b.add(ball(0.17, '#ff4d6d'), 0, b.s.h + 0.28, 0);
    },
  },
  {
    set: 'snacks', name: 'Boba Bo', cls: 'Tea Alchemist', color: '#d6aa7c', stats: [3, 3, 5],
    shape: { w: 0.88, h: 1.1, d: 0.88, taper: -0.14, low: 0.8, flat: 0.3, full: 0.4 },
    blurb: 'Brews potions. They are all milk tea. Nobody has complained.',
    face: { ey: 16 },
    paint(P) { for (let i = 0; i < 26; i++) P.ell((i * 0.0773 + 0.03) % 1, 0.2 + (i * 37 % 10) * 0.024, 0.017, 0.034, '#4a2c1a'); },
    build(b) {
      b.cap(0.8, '#f4f8ff', 1.04); b.ring(0.8, '#ff8fb5', 0.07, 1.05);
      const straw = cyl(0.12, 0.12, 0.9, '#ff8fb5'); straw.rotation.z = -0.3;
      b.add(straw, 0.2, b.s.h + 0.2, -0.05);
    },
  },
  {
    set: 'snacks', name: 'Toasty', cls: 'Breakfast Knight', color: '#c98b4d', accent: '#c98b4d', stats: [4, 2, 5],
    shape: { w: 1.0, h: 1.05, d: 0.52, boxy: 0.5, taper: 0, low: 0.8, flat: 0.3, full: 0.45 },
    blurb: 'Always lands butter side up. This is his only power and he is very proud of it.',
    face: { ey: -4, eg: 24 },
    paint(P) { for (const u of [0, 0.5, 1]) P.ell(u, 0.5, 0.115, 0.37, '#f8e3b4'); },
    build(b) { b.put(box(0.34, 0.26, 0.14, '#ffe26a'), 0, 34, { roll: 12 }); arms(b, b.color, 80, -20); },
  },
  {
    set: 'snacks', name: 'Berry', cls: 'Berry Bard', color: '#ff5470', stats: [2, 2, 5],
    shape: { taper: 0.3 },
    blurb: 'Sweet voice, tiny seeds, enormous opinions about jam.',
    face: { ey: 2 },
    paint(P) { for (let i = 0; i < 80; i++) { const u = (i * 0.618) % 1, v = 0.22 + (i * 0.377 % 1) * 0.58; if (Math.abs(u - 0.5) < 0.15 && v > 0.36 && v < 0.64) continue; P.ell(u, v, 0.008, 0.022, '#ffe08a'); } },
    build(b) {
      const crown = group(at(pill(0.1, 0.14, '#3da34a'), 0, 0.14, 0));
      for (let i = 0; i < 6; i++) { const l = horn(0.22, 0.6, 1.0, '#4fbf5a', { pow: 0.4, tip: 0.7 }); l.scale.z = 0.8; l.rotation.set(0, i / 6 * TAU, -1.0); crown.add(l); }
      b.add(crown, 0, b.s.h * 0.9, 0);
      arms(b);
    },
  },
  {
    set: 'snacks', name: 'Swirl', cls: 'Frosting Cleric', color: '#8fd3ff', rarity: 'Rare', stats: [3, 1, 5],
    shape: { w: 0.95, h: 0.85, d: 0.95, taper: -0.1, low: 0.95, flat: 0.3, full: 0.4 },
    blurb: 'Heals all wounds with sprinkles. Scientifically dubious. Emotionally effective.',
    face: { ey: -14 },
    paint(P) { for (let i = 0; i < 16; i += 2) P.rect((i + 0.5) / 16, 0.3, 1 / 16, 0.6, '#6fbfee'); },
    build(b) {
      const frost = '#ffc2d9', y = b.s.h * 0.55;
      b.add(ball(1.0, frost, 1, 0.42, 1), 0, y, 0); b.add(ball(0.76, frost, 1, 0.45, 1), 0, y + 0.32, 0);
      b.add(ball(0.5, frost, 1, 0.5, 1), 0, y + 0.6, 0); b.add(ball(0.27, frost, 1, 0.8, 1), 0, y + 0.84, 0);
      b.add(ball(0.18, '#ff3d5e'), 0, y + 1.06, 0);
    },
  },
  {
    set: 'snacks', name: 'Nigi', cls: 'Sushi Samurai', color: '#f8f4e8', accent: '#ff9a70', stats: [3, 4, 5],
    shape: { w: 1.2, h: 0.6, d: 0.8, boxy: 0.6, low: 1.0, flat: 0.3, full: 0.45, taper: 0.1 },
    blurb: 'Honor. Discipline. A cozy salmon blanket.',
    face: { ey: -10, es: 1.25, eg: 22 },
    build(b) {
      b.cap(0.6, '#ff9a70', 1.07);
      for (const x of [-0.55, 0, 0.55]) { const p = pill(0.075, 0.5, '#ffd9c7'); p.rotation.set(Math.PI / 2, 0.5, 0); b.add(p, x, b.s.h * (x ? 0.93 : 1.03), 0); }
    },
  },

  /* ---------- Series 3: Critter Club ---------- */
  {
    set: 'critters', name: 'Mochi', cls: 'Nap Champion', color: '#ffb14a', belly: '#fff3d6', stats: [3, 3, 5],
    blurb: 'Knocks exactly one thing off every table she meets. Maintains eye contact throughout.',
    face: { mouth: 'w', my: -5 },
    under(P) {
      for (const [u, h] of [[0.5, 0.13], [0.462, 0.1], [0.538, 0.1]]) P.rect(u, 0.83, 0.018, h, '#f08a24');
      for (const u of [0.28, 0.72]) for (let k = 0; k < 3; k++) P.rect(u, 0.38 + k * 0.1, 0.08, 0.035, '#f08a24');
    },
    build(b) {
      for (const sd of [-1, 1]) {
        const ear = group(horn(0.3, 0.42, 0, b.color, { pow: 0.7, tip: 0.4 }), at(horn(0.17, 0.28, 0, '#ff8fa8', { pow: 0.7, tip: 0.4 }), 0, 0.03, 0.13));
        ear.scale.z = 0.6; b.put(ear, sd * 36, 60, { up: true, out: -0.1 });
      }
      b.put(ball(0.05, '#ff7f9c', 1.2, 0.8, 0.8), 0, 0, { out: 0.01 });
      const tail = horn(0.22, 0.9, 1.9, b.color, { pow: 0.4, tip: 0.7 }); tail.scale.x = -1; tail.rotation.z = -Math.PI / 2; tail.rotation.y = 0.35;
      b.add(tail, 0.5, b.floor + 0.3, -0.42);
      arms(b); feet(b);
    },
  },
  {
    set: 'critters', name: 'Flopsy', cls: 'Hop Scout', color: '#ffc4dc', belly: '#fff4f9', stats: [2, 2, 5],
    blurb: 'One ear up for danger, one ear down for vibes.',
    face: { mouth: 'w', my: -5 },
    build(b) {
      const earL = group(pill(0.19, 0.6, b.color), at(pill(0.1, 0.42, '#ff8fb5'), 0, 0, 0.13)); earL.scale.z = 0.65; earL.rotation.z = 0.12;
      b.add(earL, -0.3, b.s.h + 0.3, -0.05);
      const earR = horn(0.21, 1.0, 1.9, b.color, { pow: 0.15, tip: 0.85 }); earR.scale.z = 0.65; earR.rotation.z = -0.1;
      b.add(earR, 0.3, b.s.h * 0.8, -0.05);
      b.put(ball(0.05, '#ff7f9c', 1.2, 0.8, 0.8), 0, 0, { out: 0.01 });
      b.put(ball(0.22, '#ffffff'), 180, -35, { out: 0.08 });
      arms(b); feet(b);
    },
  },
  {
    set: 'critters', name: 'Bruno', cls: 'Honey Guard', color: '#b98a5e', belly: '#f3dcb8', stats: [5, 3, 5],
    blurb: 'Guards the honey. Has also eaten the honey. Investigation ongoing.',
    face: { mouth: 'none', ey: 8 },
    build(b) { roundEars(b, b.color, '#f3dcb8'); muzzle(b, '#f3dcb8', -3); arms(b); feet(b); },
  },
  {
    set: 'critters', name: 'Pip', cls: 'Ice Slider', color: '#44568a', rarity: 'Rare', stats: [3, 2, 5],
    blurb: 'Formally dressed for every occasion, including belly-sliding into your stuff.',
    face: { ey: 6, mouth: 'none', eg: 22 },
    paint(P) { P.ell(0.5, 0.28, 0.125, 0.3, '#ffffff'); P.ell(0.5 - 0.062, 0.55, 0.07, 0.1, '#ffffff'); P.ell(0.5 + 0.062, 0.55, 0.07, 0.1, '#ffffff'); },
    build(b) {
      b.put(ball(0.12, '#ffa53d', 1.2, 0.7, 1), 0, -2, { out: 0.02 });
      for (const sd of [-1, 1]) { const f = ball(0.22, b.color, 0.55, 1.5, 1); b.put(f, sd * 74, -8); f.rotateZ(-sd * 0.3); }
      feet(b, '#ffa53d');
    },
  },
  {
    set: 'critters', name: 'Lottie', cls: 'Pond Princess', color: '#ffb3cb', belly: '#ffe6ee', rarity: 'Ultra Rare', stats: [2, 1, 5],
    blurb: 'Regrows a lost limb in a week. Regrows a lost snack never. Guard your snacks.',
    face: { eg: 31, mouth: 'wide', ey: 6, my: 0 },
    build(b) {
      for (const sd of [-1, 1]) for (const [yaw, p] of [[56, 42], [68, 26], [76, 9]]) b.put(horn(0.12, 0.4, 0, '#ff6f9c', { pow: 0.3, tip: 0.8 }), sd * yaw, p, { up: true, out: -0.06 });
      const tail = horn(0.26, 0.8, 0.8, b.color, { pow: 0.5, tip: 0.6 }); tail.scale.x = -1; tail.rotation.z = -Math.PI / 2; tail.rotation.y = 0.5;
      b.add(tail, 0.5, b.floor + 0.3, -0.5);
      arms(b); feet(b);
    },
  },
  {
    set: 'critters', name: 'Bumble', cls: 'Pollen Courier', color: '#ffd43b', stats: [1, 3, 5],
    blurb: 'Aerodynamically should not fly. Has not been told. Please do not tell him.',
    under(P) { P.rect(0.5, 0.33, 1, 0.1, '#3a2f2a'); P.rect(0.5, 0.77, 1, 0.1, '#3a2f2a'); },
    build(b) {
      const dark = '#3a2f2a';
      for (const sd of [-1, 1]) {
        b.put(group(horn(0.1, 0.3, 0, dark, { pow: 0.2, tip: 0.8 }), at(ball(0.13, dark), 0, 0.32, 0)), sd * 24, 70, { up: true, out: -0.05 });
        const w = ball(0.36, '#dff3ff', 1, 1.25, 0.42); w.rotation.set(0, sd * 0.5, -sd * 0.5);
        b.add(w, sd * 0.66, 0.6, -0.4);
      }
      b.put(horn(0.16, 0.3, 0, dark, { pow: 0.7, tip: 0.4 }), 180, -25, { up: true, out: -0.05 });
      arms(b, dark);
    },
  },
  {
    set: 'critters', name: 'Sprinkle', cls: 'Rainbow Steed', color: '#efe6ff', belly: '#ffffff', accent: '#b79cf2', rarity: 'Ultra Rare', stats: [3, 3, 5],
    blurb: 'Leaves a trail of glitter everywhere. Blames the wizard.',
    face: { ey: 12, mouth: 'none' },
    build(b) {
      b.put(horn(0.17, 0.6, 0, GOLD, { pow: 0.8, tip: 0.3 }), 0, 72, { up: true, out: -0.05 });
      for (const sd of [-1, 1]) b.put(horn(0.17, 0.28, 0, b.color, { pow: 0.7, tip: 0.4 }), sd * 40, 60, { up: true, out: -0.05 });
      muzzle(b, '#ffc9de', 0, '#e77aa5');
      const rb = ['#ff6f91', '#ffb347', '#ffe066', '#7ddc7a', '#6fc8ff', '#b79cf2'];
      rb.forEach((c, i) => b.put(ball(0.21, c), 180, 84 - i * 18, { out: 0.06 }));
      b.put(ball(0.19, rb[0]), 22, 80, { out: 0.05 }); b.put(ball(0.16, rb[1]), 34, 68, { out: 0.04 });
      rb.slice(3).forEach((c, i) => b.add(ball(0.2, c), 0.62 + i * 0.16, b.floor + 0.22 + i * 0.17, -0.45));
      feet(b);
    },
  },
  {
    set: 'critters', name: 'Chomps', cls: 'Reef Bruiser', color: '#6fa3c7', stats: [4, 5, 5],
    blurb: 'Terror of the deep end. Wears floaties in the shallow end.',
    face: { ey: 10, mouth: 'wide', my: 1, eg: 29 },
    paint(P) { P.ell(0.5, 0.22, 0.16, 0.26, '#ffffff'); for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) P.rect(0.5 + sd * (0.21 + 0.022 * k), 0.44, 0.008, 0.09, '#4f86ac'); },
    build(b) {
      const fin = horn(0.34, 0.6, 0.7, b.color, { pow: 0.6, tip: 0.4 }); fin.scale.z = 0.5;
      b.put(fin, 0, 90, { up: true, out: -0.12 }); fin.rotateY(Math.PI / 2);
      for (const yaw of [-14, -5, 5, 14]) b.put(ball(0.075, '#ffffff', 1, 1.3, 0.8), yaw, -7);
      for (const sd of [-1, 1]) { const f = ball(0.22, b.color, 0.55, 1.5, 1); b.put(f, sd * 74, -8); f.rotateZ(-sd * 0.5); }
      b.put(ball(0.32, b.color, 0.5, 1.4, 1), 180, -15, { out: 0.16 });
    },
  },

  /* ---------- Series 4: Cosmic Crew ---------- */
  {
    set: 'cosmic', name: 'Zorp', cls: 'Space Tourist', color: '#7fe0c8', belly: '#dcfff5', stats: [2, 3, 5],
    blurb: 'Came 40 light-years for the snacks. Three eyes, all of them on your fries.',
    face: { eyes: 'none', mouth: 'o', ey: 6, my: -5 },
    build(b) {
      for (const [yaw, p, es] of [[-25, 4, 1.4], [25, 4, 1.4], [0, 25, 1.75]]) { const e = eye('dot', es); e.scale.z = 0.4; b.put(e, yaw, p); }
      for (const sd of [-1, 1]) b.put(group(horn(0.1, 0.34, 0, b.color, { pow: 0.2, tip: 0.8 }), at(ball(0.15, '#ff8fb5'), 0, 0.37, 0)), sd * 30, 66, { up: true, out: -0.05 });
      arms(b); feet(b);
    },
  },
  {
    set: 'cosmic', name: 'Bolt', cls: 'Helper Bot', color: '#a9bdd1', stats: [4, 3, 5],
    shape: { w: 0.95, h: 1.05, d: 0.85, boxy: 0.5, flat: 0.3, low: 0.85, taper: 0.05, full: 0.5 },
    blurb: 'Programmed to assist. Mostly assists by beeping encouragingly.',
    face: { ey: 15, eg: 15, my: 8, es: 1.3 },
    paint(P) {
      const { ctx } = P; ctx.fillStyle = '#e6f6ff'; ctx.beginPath(); ctx.roundRect(P.X(0.385), P.Y(0.8), 0.23 * P.W, 0.3 * P.H, 40); ctx.fill();
      P.ell(0.465, 0.4, 0.013, 0.026, '#ff5d6c'); P.ell(0.5, 0.4, 0.013, 0.026, '#ffd93b'); P.ell(0.535, 0.4, 0.013, 0.026, '#5fe08a');
      P.rect(0.5, 0.32, 0.08, 0.035, '#7d93aa');
    },
    build(b) {
      const dk = '#7d93aa';
      b.add(pill(0.09, 0.16, dk), 0, b.s.h + 0.08, 0); b.add(ball(0.16, '#ff5d6c'), 0, b.s.h + 0.32, 0);
      for (const sd of [-1, 1]) { const bolt = cyl(0.18, 0.18, 0.18, dk); bolt.rotation.x = Math.PI / 2; b.put(group(bolt), sd * 90, 12, { out: 0.03 }); }
      arms(b, dk, 76, -22); feet(b, dk);
    },
  },
  {
    set: 'cosmic', name: 'Saturnia', cls: 'Ring Bearer', color: '#ffb86b', rarity: 'Rare', stats: [5, 2, 5],
    shape: { w: 1, h: 0.95, d: 1, taper: 0, low: 0.9, flat: 0.7, full: 1 },
    blurb: 'Has the fanciest hula hoop in the solar system and will not let anyone else try it.',
    face: { ey: 10 },
    paint(P) { P.rect(0.5, 0.8, 1, 0.07, '#ffd29a'); P.rect(0.5, 0.3, 1, 0.09, '#f79c4a'); P.rect(0.5, 0.16, 1, 0.05, '#ffd29a'); P.ell(0.68, 0.64, 0.03, 0.035, '#f2794a'); },
    build(b) { const ring = torus(1.3, 0.13, '#ffe6b0'); ring.rotation.set(Math.PI / 2 + 0.22, 0.2, 0); b.add(ring, 0, -0.12, 0); },
  },
  {
    set: 'cosmic', name: 'Luna', cls: 'Night Shift', color: '#ffe9a3', accent: '#6f8cff', stats: [3, 1, 5],
    blurb: 'Works nights. Would like everyone to know she is very tired.',
    face: { eyes: 'sleepy', ey: 2 },
    under(P) { for (const [u, v, r] of [[0.25, 0.6, 0.03], [0.75, 0.35, 0.035], [0.68, 0.7, 0.02], [0.33, 0.25, 0.025], [0.9, 0.6, 0.03], [0.1, 0.4, 0.028]]) P.ell(u, v, r, r * 1.7, '#f3d37c'); },
    build(b) {
      const band = torus(0.56, 0.11, '#ffffff'); band.rotation.x = Math.PI / 2;
      const hat = group(horn(0.6, 0.95, 1.7, '#6f8cff', { pow: 0.6, tip: 0.3 }), at(band, 0.02, 0.08, 0), at(ball(0.18, '#ffffff'), 0.6, 0.52, 0));
      hat.rotation.set(-0.1, 0.4, -0.15);
      b.add(hat, 0, b.s.h * 0.78, 0);
      arms(b);
    },
  },
  {
    set: 'cosmic', name: 'Twinkle', cls: 'Wish Granter', color: '#ffd84d', rarity: 'Ultra Rare', stats: [1, 4, 5],
    shape: { w: 0.9, h: 0.95, d: 0.75, low: 0.85, flat: 0.5, taper: 0.1 },
    blurb: 'Grants one wish per customer. The wish is always more Doods.',
    face: { eyes: 'happy', ey: 0, eg: 24 },
    build(b) {
      for (const a of [0, 72, -72, 128, -128]) {
        const n = horn(0.44, 0.72, 0, b.color, { pow: 0.6, tip: 0.4 }), r = a * D; n.scale.z = 0.8; n.rotation.z = -r;
        b.add(n, Math.sin(r) * 0.52, Math.cos(r) * 0.55 + 0.1, 0);
      }
    },
  },
  {
    set: 'cosmic', name: 'Nimbus', cls: 'Weather Intern', color: '#dbe9ff', accent: '#6fc8ff', stats: [2, 2, 5],
    shape: { w: 1.15, h: 0.75, d: 0.9, low: 0.85, flat: 0.4, taper: 0.1 },
    blurb: 'Rains only when embarrassed. Rains a lot.',
    face: { ey: -6 },
    build(b) {
      for (const [x, y, z, r] of [[-0.75, 0.35, 0, 0.5], [0.7, 0.3, 0.05, 0.52], [0, 0.7, -0.05, 0.6], [-0.4, 0.62, 0.1, 0.48], [0.42, 0.6, 0.1, 0.46], [-1.0, -0.15, 0, 0.4], [1.0, -0.2, 0, 0.42], [0, 0.3, -0.6, 0.6]])
        b.add(ball(r, b.color), x, y, z);
    },
  },
];


/* ---------- parts library: everything a recipe can ask for ---------- */

const S2 = [-1, 1], PI = Math.PI;
const lighten = (c, t = 0.5) => '#' + new THREE.Color(c).lerp(new THREE.Color('#ffffff'), t).getHexString();
const darken = (c, t = 0.28) => '#' + new THREE.Color(c).lerp(new THREE.Color('#2a1a3a'), t).getHexString();
const ringY = (r, t, c) => { const m = torus(r, t, c); m.rotation.x = PI / 2; return m; };
const rz = (o, z) => { o.rotation.z = z; return o; };
const gemMat = c => M(c, { flatShading: true, roughness: 0.6 });
const gem = (c, sx, sy, sz) => { const m = mesh(new THREE.IcosahedronGeometry(1, 0), gemMat(c)); m.scale.set(sx, sy, sz); return m; };
const NAMED = { w: '#ffffff', k: '#3a2f2a', y: '#ffcc33', r: '#ff5470', p: '#ff8fb5', g: '#4fbf5a', b: '#6fc8ff', o: '#ffa53d', n: '#8a5a3c', c: '#fff1dc', s: '#c3ccdd', v: '#b79cf2' };

const SHAPES = {
  egg: {}, round: { w: 1.02, h: 1.0, d: 0.98, taper: 0.05, low: 0.85, flat: 0.55, full: 0.9 },
  tall: { w: 0.86, h: 1.6, d: 0.82, taper: 0.15 }, squat: { w: 1.15, h: 0.85, d: 1.02, taper: 0.25, low: 0.8, flat: 0.45 },
  box: { w: 0.98, h: 0.95, d: 0.85, boxy: 0.5, flat: 0.3, low: 0.9, taper: 0.05, full: 0.5 },
  drop: { w: 1.05, h: 1.3, d: 0.95, taper: 0.5, low: 0.58 }, cup: { w: 0.88, h: 1.1, d: 0.88, taper: -0.14, low: 0.8, flat: 0.3, full: 0.4 },
  tri: { w: 1.05, h: 1.25, d: 0.72, taper: 0.5, low: 0.58 }, slab: { w: 1.0, h: 1.05, d: 0.52, boxy: 0.5, taper: 0, low: 0.8, flat: 0.3, full: 0.45 },
  pear: { w: 1.08, h: 1.45, d: 0.98, taper: 0.42, low: 0.55 }, mound: { w: 1.12, h: 0.82, d: 1.02, taper: 0.3, low: 0.8, flat: 0.5 },
  loaf: { w: 1.2, h: 0.7, d: 0.8, boxy: 0.6, low: 1.0, flat: 0.3, full: 0.45, taper: 0.1 }, can: { w: 0.85, h: 1.15, d: 0.85, taper: 0, low: 0.85, flat: 0.25, full: 0.3 },
};
const SHAPE_FACE = { squat: { ey: 0 }, mound: { ey: 6, eg: 30 }, loaf: { ey: -10, es: 1.25, eg: 22 }, box: { ey: 8, eg: 20 }, slab: { ey: -4, eg: 24 }, tri: { ey: 10 }, cup: { ey: 14 }, tall: { ey: 10 }, drop: { ey: 2 }, pear: { ey: -6 }, can: { ey: 8 }, round: { ey: 4 } };

function mountHat(b, hat, frac = 0.84) {
  let k = b.rAt(frac) / 0.52;
  if (k > 1.2) { frac = 0.96; k = Math.min(1.15, b.rAt(0.96) / 0.3); }
  hat.scale.multiplyScalar(Math.max(0.7, Math.min(1.25, k)));
  return b.add(hat, 0, b.s.h * frac, 0);
}
const dome = (c, r = 0.6, sy = 0.75) => at(ball(r, c, 1, sy, 1), 0, 0.02, 0);
const HATS = {
  wizard(c = '#5b3fb5', c2 = '#ffcc33') { const st = star(0.2, c2); st.rotation.x = -0.35; const h = group(ball(0.82, c, 1, 0.22, 1), horn(0.56, 1.05, 0.9, c, { pow: 0.6, tip: 0.45 }), at(ringY(0.5, 0.09, c2), 0.02, 0.15, 0), at(st, 0.1, 0.46, 0.34)); h.rotation.set(-0.08, 0.5, -0.1); return h; },
  top: (c = '#3a2f2a', c2 = '#ff5470') => group(ball(0.78, c, 1, 0.2, 1), at(cyl(0.48, 0.44, 0.7, c), 0, 0.4, 0), at(ball(0.48, c, 1, 0.25, 1), 0, 0.75, 0), at(ringY(0.47, 0.08, c2), 0, 0.16, 0)),
  party: (c = '#ff8fb5', c2 = '#ffcc33') => group(horn(0.42, 0.95, 0, c, { pow: 0.9, tip: 0.2 }), at(ball(0.16, c2), 0, 0.9, 0), at(ringY(0.4, 0.08, c2), 0, 0.05, 0)),
  chef: (c = '#ffffff') => group(at(cyl(0.42, 0.45, 0.4, c), 0, 0.2, 0), at(ball(0.36, c), -0.26, 0.55, 0), at(ball(0.36, c), 0.26, 0.55, 0), at(ball(0.4, c), 0, 0.68, 0.05)),
  cowboy: (c = '#8a5a3c', c2 = '#ffcc33') => group(ball(0.95, c, 1, 0.16, 0.85), at(ball(0.5, c, 1, 0.85, 0.9), 0, 0.22, 0), at(ringY(0.47, 0.07, c2), 0, 0.14, 0)),
  santa(c = '#ff5470', c2 = '#ffffff') { const h = group(horn(0.6, 0.95, 1.7, c, { pow: 0.6, tip: 0.3 }), at(ringY(0.56, 0.11, c2), 0.02, 0.08, 0), at(ball(0.18, c2), 0.6, 0.52, 0)); h.rotation.set(-0.1, 0.4, -0.15); return h; },
  night: (c = '#6f8cff', c2 = '#ffffff') => HATS.santa(c, c2),
  beanie: (c = '#ff5470', c2) => group(dome(c, 0.6, 0.8), ringY(0.56, 0.11, c2 || darken(c)), at(ball(0.17, c2 || '#ffffff'), 0, 0.5, 0)),
  cap: (c = '#ff5470', c2) => group(dome(c, 0.58), at(ball(0.42, c2 || c, 1, 0.22, 1), 0, 0.02, 0.5), at(ball(0.08, c2 || c), 0, 0.46, 0)),
  straw: (c = '#f2d27a', c2 = '#ff5470') => group(ball(1.0, c, 1, 0.13, 1), at(ball(0.5, c, 1, 0.7, 1), 0, 0.12, 0), at(ringY(0.48, 0.07, c2), 0, 0.12, 0)),
  hard: (c = '#ffcc33') => group(dome(c), at(ball(0.72, c, 1, 0.14, 1), 0, 0, 0.1), at(ball(0.14, c, 1, 1, 3.4), 0, 0.4, 0)),
  bucket: (c = '#f2d27a') => group(at(cyl(0.42, 0.56, 0.45, c), 0, 0.2, 0), at(ball(0.42, c, 1, 0.3, 1), 0, 0.42, 0)),
  cone: (c = '#ffa53d', c2 = '#ffffff') => group(ball(0.6, c, 1, 0.14, 1), horn(0.4, 0.9, 0, c, { pow: 0.9, tip: 0.15 }), at(ringY(0.27, 0.07, c2), 0, 0.35, 0)),
  crown(c = '#ffcc33', c2 = '#ff4d6d') { const g = group(ringY(0.44, 0.1, c)); for (let i = 0; i < 5; i++) { const a = (i + 0.5) / 5 * TAU, a2 = i / 5 * TAU; g.add(at(ball(0.13, c, 1, 1.6, 1), Math.sin(a) * 0.44, 0.13, Math.cos(a) * 0.44), at(ball(0.075, i % 2 ? c2 : '#4dc3ff'), Math.sin(a2) * 0.52, 0, Math.cos(a2) * 0.52)); } g.position.y = 0.05; return group(g); },
  pirate: (c = '#ff5470') => group(dome(c, 0.6, 0.7), at(ball(0.16, c), 0.55, 0.05, -0.2), at(ball(0.13, c, 1, 1.6, 1), 0.66, -0.12, -0.25)),
  tricorn: (c = '#3a2f2a', c2 = '#ffcc33') => group(ball(0.9, c, 1, 0.2, 0.75), at(ball(0.5, c, 1, 0.7, 0.9), 0, 0.2, 0), at(ball(0.13, c2), 0, 0.3, 0.42)),
  viking(c = '#c3ccdd', c2 = '#fff1cf') { const g = group(dome(c), ringY(0.57, 0.08, '#ffcc33')); for (const sd of S2) g.add(at(rz(horn(0.16, 0.5, -1.0 * sd, c2, { pow: 0.6, tip: 0.4 }), -sd * 1.1), sd * 0.5, 0.15, 0)); return g; },
  fez: (c = '#ff5470', c2 = '#ffcc33') => group(at(cyl(0.3, 0.38, 0.42, c), 0, 0.2, 0), at(ball(0.3, c, 1, 0.3, 1), 0, 0.41, 0), at(ball(0.1, c2), 0, 0.5, 0)),
  grad: (c = '#3a2f2a', c2 = '#ffcc33') => group(dome(c, 0.5, 0.6), at(box(1.1, 0.13, 1.1, c), 0, 0.34, 0), at(ball(0.1, c2), 0, 0.44, 0), at(ball(0.09, c2, 1, 2.2, 1), 0.5, 0.2, 0.5)),
};
function heartMesh(c, k = 1) {
  const sh = new THREE.Shape(); sh.moveTo(0, -0.22); sh.bezierCurveTo(-0.36, 0.02, -0.16, 0.3, 0, 0.1); sh.bezierCurveTo(0.16, 0.3, 0.36, 0.02, 0, -0.22);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.06, bevelSegments: 4 }); geo.center();
  const m = mesh(geo, c); m.scale.setScalar(k); return m;
}
const ITEMS = {
  star: (c = '#ffd93b') => star(0.27, c, 0.14), heart: (c = '#ff5470') => heartMesh(c, 1.1),
  coin: (c = '#ffcc33') => { const m = cyl(0.22, 0.22, 0.11, c); m.rotation.x = PI / 2; return m; },
  gem: (c = '#86e9f7') => gem(c, 0.22, 0.27, 0.14), ball: (c = '#ff5470') => ball(0.25, c), egg: (c = '#fff1dc') => ball(0.22, c, 1, 1.25, 1),
  bone: (c = '#fffdf5') => group(rz(pill(0.07, 0.3, c), PI / 2), ...[[-1, 1], [-1, -1], [1, 1], [1, -1]].map(([x, y]) => at(ball(0.09, c), x * 0.2, y * 0.06, 0))),
  book: (c = '#6f8cff') => group(box(0.36, 0.44, 0.16, c), at(box(0.3, 0.38, 0.17, '#fffdf5'), 0.02, 0, 0)),
  mug: (c = '#ffffff') => group(cyl(0.2, 0.18, 0.34, c), at(rz(torus(0.11, 0.045, c), 0), 0.2, 0, 0), at(cyl(0.16, 0.16, 0.02, '#8a5a3c'), 0, 0.17, 0)),
  sack: (c = '#dcb878') => group(ball(0.28, c, 1, 0.95, 1), at(ball(0.13, c), 0, 0.27, 0)),
  sword(c = '#c3ccdd') { const g = pill(0.085, 0.24, '#ffcc33'); g.rotation.z = PI / 2; return group(at(pill(0.1, 0.32, c), 0, 0.37), at(g, 0, 0.1), at(ball(0.1, '#ffcc33'), 0, -0.06)); },
  shield: (c = '#3f6fd8') => group(ball(0.34, '#ffcc33', 1, 1.15, 0.4), at(ball(0.28, c, 1, 1.15, 0.5), 0, 0, 0.04), at(ball(0.11, '#ffcc33', 1, 1, 0.7), 0, 0, 0.13)),
  fish: (c = '#6fc8ff') => group(ball(0.22, c, 1.4, 0.9, 0.6), at(ball(0.13, c, 0.6, 1.4, 0.5), -0.34, 0, 0), at(ball(0.03, BLACK), 0.18, 0.05, 0.11)),
  carrot: (c = '#ffa53d') => group(at(rz(horn(0.14, 0.5, 0, c, { pow: 0.7, tip: 0.3 }), PI), 0, 0.2, 0), at(ball(0.13, '#4fbf5a', 1, 1.2, 0.8), 0, 0.3, 0)),
  lolly: (c = '#ff8fb5') => group(at(ball(0.24, c, 1, 1, 0.6), 0, 0.3, 0), at(ball(0.13, '#ffffff', 1, 1, 0.6), 0, 0.3, 0.06), pill(0.06, 0.26, '#ffffff')),
  wand: (c = '#ffd93b') => group(at(pill(0.06, 0.4, '#8a5a3c'), 0, 0.05), at(star(0.22, c, 0.12), 0, 0.42, 0)),
  mic: (c = '#3a2f2a') => group(at(pill(0.07, 0.3, c), 0, 0, 0), at(ball(0.15, '#c3ccdd'), 0, 0.3, 0)),
  donut: (c = '#ff8fb5') => group(torus(0.17, 0.11, '#e6ad62'), at(torus(0.17, 0.09, c), 0, 0, 0.045)),
  leaf: (c = '#4fbf5a') => rz(ball(0.26, c, 0.6, 1.3, 0.4), -0.4),
  drop: (c = '#6fc8ff') => group(ball(0.2, c), at(horn(0.18, 0.34, 0, c, { pow: 0.7, tip: 0.3 }), 0, 0.06, 0)),
};
const TOPS = {
  cherry: (c = '#ff3d5e') => at(ball(0.18, c), 0, 0.12, 0),
  dollop: (c = '#fffaf0', c2 = '#ff4d6d') => group(at(ball(0.32, c, 1, 0.55, 1), 0, 0.05, 0), at(ball(0.17, c2), 0, 0.3, 0)),
  stem: (c = '#8a5a3c', c2 = '#4fbf5a') => group(at(pill(0.08, 0.2, c), 0, 0.14, 0), at(rz(ball(0.22, c2, 1.5, 0.45, 0.8), 0.4), 0.26, 0.3, 0)),
  swirl: (c = '#ffc2d9') => group(at(ball(0.5, c, 1, 0.5, 1), 0, 0.05, 0), at(ball(0.36, c, 1, 0.55, 1), 0, 0.3, 0), at(ball(0.2, c, 1, 0.9, 1), 0, 0.52, 0)),
  cork: (c = '#ffe6ee', c2 = '#c8935a') => group(at(cyl(0.3, 0.38, 0.4, c), 0, 0.1, 0), at(ringY(0.31, 0.085, c), 0, 0.3, 0), at(cyl(0.3, 0.25, 0.28, c2), 0, 0.44, 0)),
  straw: (c = '#ff8fb5') => at(rz(cyl(0.12, 0.12, 0.9, c), -0.3), 0.2, 0.22, -0.05),
  candle: (c = '#ffffff', c2 = '#ffa53d') => group(at(pill(0.11, 0.3, c), 0, 0.2, 0), at(horn(0.11, 0.26, 0, c2, { pow: 0.7, tip: 0.35 }), 0, 0.42, 0)),
  scoop: (c = '#ffc2d9', c2) => group(at(ball(0.58, c), 0, 0.3, 0), ...(c2 ? [at(ball(0.42, c2), 0.05, 0.92, 0)] : [])),
  knot: (c = '#fff1dc') => at(ball(0.2, c, 1, 0.8, 1), 0, 0.06, 0),
};
function lobes(c, sd) { const w = group(); for (const [ang, len] of [[0.3, 0.6], [0.9, 0.5], [1.45, 0.38]]) { const f = horn(0.18, len, 0, c, { pow: 0.35, tip: 0.85 }); f.rotation.z = -sd * ang; w.add(f); } w.scale.set(1.35, 1.35, 0.85); w.rotation.y = sd * 0.25; return w; }
function sideTail(b, t) { t.scale.x = -1; t.rotation.z = -PI / 2; t.rotation.y = 0.4; b.add(t, 0.5, b.floor + 0.32, -0.45); }

const PARTS = {
  arms: (b, [c]) => arms(b, c || b.color), feet: (b, [c]) => feet(b, c || b.color),
  ears(b, [type = 'cat', inner]) {
    const c = b.color;
    if (type === 'round' || type === 'mouse') return roundEars(b, c, inner || lighten(c, 0.55), type === 'mouse' ? 1.4 : 1);
    for (const sd of S2) {
      if (type === 'bunny') { const ear = group(pill(0.19, 0.6, c), at(pill(0.1, 0.42, inner || lighten(c, 0.55)), 0, 0, 0.13)); ear.scale.z = 0.65; ear.rotation.z = -sd * 0.16; const { p } = b.surf(sd * 24, 70); b.add(ear, p.x, p.y + 0.3, p.z - 0.05); }
      else if (type === 'flop') { const ear = ball(0.24, inner || darken(c), 0.75, 1.7, 0.55); b.put(ear, sd * 66, 30, { out: 0.03 }); ear.rotateZ(sd * 0.25); }
      else if (type === 'elf') { const ear = horn(0.2, 0.5, 0, c, { pow: 0.7, tip: 0.35 }); ear.scale.z = 0.6; b.put(ear, sd * 78, 22, { up: true, out: -0.08 }); }
      else { const ear = group(horn(0.3, 0.42, 0, c, { pow: 0.7, tip: 0.4 }), at(horn(0.17, 0.28, 0, inner || lighten(c, 0.55), { pow: 0.7, tip: 0.4 }), 0, 0.03, 0.13)); ear.scale.z = 0.6; b.put(ear, sd * 36, 60, { up: true, out: -0.1 }); }
    }
  },
  horns(b, [type = 'nub', c = '#fff1cf']) {
    for (const sd of S2) {
      if (type === 'curl') { const h = horn(0.2, 0.95, 3.4, c, { pow: 0.5, tip: 0.5 }); b.put(h, sd * 62, 44, { up: true, out: -0.08 }); h.rotateY(-PI / 2); }
      else if (type === 'devil') b.put(horn(0.15, 0.4, 0.9 * sd, c, { pow: 0.8, tip: 0.3 }), sd * 34, 62, { up: true, out: -0.05 });
      else if (type === 'bull') b.put(horn(0.16, 0.55, -1.1 * sd, c, { pow: 0.6, tip: 0.4 }), sd * 62, 48, { up: true, out: -0.06 });
      else if (type === 'antler') b.put(group(horn(0.11, 0.5, 0, c, { pow: 0.25, tip: 0.8 }), at(rz(horn(0.1, 0.3, 0, c, { pow: 0.25, tip: 0.8 }), -sd * 0.9), 0, 0.2, 0), at(rz(horn(0.1, 0.24, 0, c, { pow: 0.25, tip: 0.8 }), sd * 0.8), 0, 0.3, 0)), sd * 32, 64, { up: true, out: -0.05 });
      else b.put(horn(0.17, 0.34, 0.7 * sd, c, { pow: 0.4, tip: 0.8 }), sd * 30, 64, { up: true, out: -0.05 });
    }
  },
  uni: (b, [c = '#ffcc33']) => b.put(horn(0.17, 0.6, 0, c, { pow: 0.8, tip: 0.3 }), 0, 72, { up: true, out: -0.05 }),
  antenna(b, [c, tip]) { c = c || darken(b.color); for (const sd of S2) b.put(group(horn(0.1, 0.3, 0, c, { pow: 0.2, tip: 0.8 }), at(ball(0.14, tip || c), 0, 0.33, 0)), sd * 24, 70, { up: true, out: -0.05 }); },
  sprout(b, [c = '#4fbf5a']) { const g = group(at(pill(0.07, 0.2, c), 0, 0.12, 0)); for (const sd of S2) g.add(at(rz(ball(0.2, c, 1.5, 0.5, 0.8), sd * 0.5), sd * 0.26, 0.38, 0)); b.put(g, 0, 90, { up: true, out: -0.03 }); },
  leaf: (b, [c = '#4fbf5a']) => b.put(group(at(pill(0.07, 0.16, darken(c)), 0, 0.1, 0), at(rz(ball(0.3, c, 1.6, 0.45, 0.9), 0.5), 0.3, 0.32, 0)), 0, 90, { up: true, out: -0.03 }),
  tuft(b, [c]) { c = c || darken(b.color); b.put(ball(0.2, c), 0, 84, { out: 0.04 }); b.put(ball(0.17, c), 18, 72, { out: 0.03 }); b.put(ball(0.15, c), -16, 74, { out: 0.03 }); },
  mohawk(b, [c = '#ff5470']) { for (const [yaw, p, k] of [[0, 58, 0.75], [0, 74, 0.95], [0, 88, 1.05], [180, 72, 0.95], [180, 56, 0.8]]) b.put(ball(0.17 * k, c, 0.8, 1.5, 1), yaw, p, { up: true, out: 0.04 * k }); },
  plume(b, [c = '#ff5470']) { const p = horn(0.3, 0.75, 1.3, c, { pow: 0.4, tip: 0.8 }); b.put(p, 0, 90, { up: true, out: -0.1 }); p.rotateY(PI / 2); },
  gems(b, [c = '#86e9f7']) { for (const [yaw, p, k, roll] of [[0, 88, 1.2, 0], [-36, 64, 0.9, 20], [40, 62, 1, 50]]) b.put(gem(c, 0.3 * k, 0.4 * k, 0.3 * k), yaw, p, { up: true, out: 0.06 * k, roll }); },
  flame: (b, [c = '#ff8a3d', c2 = '#ffd84d']) => b.put(group(horn(0.34, 0.75, 0.5, c, { pow: 0.7, tip: 0.35 }), at(horn(0.2, 0.45, 0.4, c2, { pow: 0.7, tip: 0.35 }), 0.02, 0.02, 0.17)), 0, 90, { up: true, out: -0.12 }),
  bow(b, [c = '#ff5470']) { const g = group(ball(0.12, c)); for (const sd of S2) g.add(at(ball(0.22, c, 1.2, 0.9, 0.6), sd * 0.26, 0.02, 0)); b.put(g, 30, 64, { out: 0.06, roll: -20 }); },
  flower(b, [c = '#ff8fb5', c2 = '#ffcc33']) { const g = group(at(ball(0.13, c2, 1, 1, 0.7), 0, 0, 0.05)); for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; g.add(at(ball(0.14, c, 1, 1, 0.6), Math.sin(a) * 0.2, Math.cos(a) * 0.2, 0)); } b.put(g, 32, 62, { out: 0.05 }); },
  halo(b, [c = '#ffd95a']) { const h = torus(0.4, 0.095, c); h.rotation.set(PI / 2 - 0.15, 0, 0.08); const k = Math.max(0.8, Math.min(1.5, b.rAt(0.92) / 0.33)); h.scale.setScalar(k); b.add(h, 0, b.s.h * 0.92, 0.02); },
  hat(b, [type = 'party', c, c2]) { mountHat(b, (HATS[type] || HATS.party)(c, c2), type === 'santa' || type === 'night' ? 0.78 : 0.84); },
  helmet(b, [c = '#c3ccdd', c2 = '#ffcc33']) { b.cap(0.68, M(c, { side: THREE.DoubleSide }), 1.06); b.ring(0.68, c2, 0.075, 1.07); },
  drip(b, [c = '#ffffff', v = 0.62]) { v = +v; b.cap(v, c, 1.05); for (let i = 0; i < 7; i++) { const p = bodyPoint(b.s, (i / 7 + 0.07) % 1, v - 0.03 - (i % 2) * 0.05); b.add(ball(0.13 + (i % 3) * 0.02, c), p[0] * 1.03, p[1], p[2] * 1.03); } },
  phones(b, [c = '#ff5470']) {
    const { p } = b.surf(88, 18), R = p.x + 0.06, band = mesh(new THREE.TorusGeometry(R, 0.085, 10, 30, PI), c);
    band.scale.y = (b.s.h + 0.08 - p.y) / R; b.add(band, 0, p.y, 0);
    for (const sd of S2) b.add(ball(0.26, c, 0.6, 1, 1), sd * R, p.y, 0);
  },
  goggles(b, [c = '#8a5a3c', lens = '#bfe9ff']) { b.ring(0.7, c, 0.055, 1.02); for (const sd of S2) b.put(group(ball(0.2, c, 1, 1, 0.5), at(ball(0.14, lens, 1, 1, 0.5), 0, 0, 0.05)), sd * 19, b.pv(0.7)); },
  snout: (b, [c, nose]) => muzzle(b, c || lighten(b.color), b.face.ey - 7, nose || BLACK),
  beak: (b, [c = '#ffa53d']) => b.put(ball(0.12, c, 1.2, 0.7, 1), 0, b.face.ey - 7, { out: 0.02 }),
  bill: (b, [c = '#ffa53d']) => b.put(ball(0.2, c, 1.3, 0.45, 1.1), 0, b.face.ey - 8, { out: 0.04 }),
  tusks(b, [c = '#fffdf5']) { for (const sd of S2) b.put(horn(0.09, 0.26, 0, c, { pow: 0.5, tip: 0.6 }), sd * 13, b.face.ey - 14, { out: -0.02 }); },
  teeth(b) { for (const yaw of [-14, -5, 5, 14]) b.put(ball(0.075, '#ffffff', 1, 1.3, 0.8), yaw, b.face.ey - 16); },
  fangs(b) { for (const sd of S2) b.put(ball(0.06, '#ffffff', 1, 1.7, 0.8), sd * 7, b.face.ey - 13); },
  stache(b, [c = '#8a5a3c']) { for (const sd of S2) b.put(ball(0.13, c, 1.5, 0.6, 0.6), sd * 9, b.face.ey - 5, { roll: -sd * 15 }); },
  beard(b, [c = '#ffffff']) { const e = b.face.ey; for (const [yw, pt, r] of [[0, -28, 0.2], [-13, -21, 0.17], [13, -21, 0.17], [-24, -13, 0.13], [24, -13, 0.13], [0, -40, 0.14]]) b.put(ball(r, c), yw, e + pt + 6, { out: -0.03 }); },
  nose: (b, [c = '#ff7f9c']) => b.put(ball(0.06, c, 1.2, 0.8, 0.8), 0, b.face.ey - 4, { out: 0.01 }),
  trunk(b, [c]) { const t = horn(0.17, 0.7, 1.6, c || b.color, { pow: 0.35, tip: 0.7 }); t.rotation.y = -PI / 2; const g = group(t); b.put(g, 0, b.face.ey - 7, { out: -0.08 }); g.rotateX(PI / 2); },
  wings(b, [type = 'bat', c]) {
    for (const sd of S2) {
      if (type === 'bug') { const w = ball(0.36, c || '#dff3ff', 1, 1.25, 0.42); w.rotation.set(0, sd * 0.5, -sd * 0.5); b.add(w, sd * 0.66 * b.s.w, 0.6, -0.4); }
      else b.add(lobes(c || (type === 'angel' ? '#ffffff' : darken(b.color)), sd), sd * 0.74 * b.s.w, 0.15, -0.08);
    }
  },
  tail(b, [type = 'curl', c, c2]) {
    c = c || b.color;
    if (type === 'stub') b.put(ball(0.22, c), 150, -35, { out: 0.1 });
    else if (type === 'fat') sideTail(b, horn(0.27, 0.75, 1.5, c, { pow: 0.5, tip: 0.6 }));
    else if (type === 'stripe') sideTail(b, horn(0.3, 0.9, 1.7, null, { pow: 0.4, tip: 0.7, stripes: [c, c2 || lighten(c)], bands: 6 }));
    else if (type === 'fish') { for (const k of S2) { const l = ball(0.26, c, 0.5, 1.5, 1); l.rotation.z = k * 0.7; b.add(l, 0.75 * b.s.w + 0.1, b.floor + 0.55 + k * 0.2, -0.3); } b.add(ball(0.22, c), 0.6 * b.s.w, b.floor + 0.5, -0.3); }
    else if (type === 'fluffy') { b.add(ball(0.3, c), 0.7 * b.s.w, b.floor + 0.32, -0.4); b.add(ball(0.26, c), 0.88 * b.s.w, b.floor + 0.58, -0.4); b.add(ball(0.2, c2 || '#ffffff'), 0.98 * b.s.w, b.floor + 0.84, -0.4); }
    else sideTail(b, horn(0.22, 0.9, 1.9, c, { pow: 0.4, tip: 0.7 }));
  },
  fins(b, [c]) { for (const sd of S2) { const f = ball(0.22, c || b.color, 0.55, 1.5, 1); b.put(f, sd * 74, -8); f.rotateZ(-sd * 0.4); } },
  dorsal(b, [c]) { const fin = horn(0.34, 0.6, 0.7, c || b.color, { pow: 0.6, tip: 0.4 }); fin.scale.z = 0.5; b.put(fin, 0, 90, { up: true, out: -0.12 }); fin.rotateY(PI / 2); },
  hem(b, [c]) { for (let i = 0; i < 9; i++) { const a = (i + 0.5) / 9 * TAU; b.add(ball(0.22, c || b.color), Math.sin(a) * 0.76 * b.s.w, b.floor + 0.21, Math.cos(a) * 0.76 * b.s.d); } },
  spikes(b, [c = '#ffb347']) { for (const [p, k] of [[86, 1], [60, 0.85], [34, 0.7]]) b.put(ball(0.15 * k, c, 1, 1.3, 1), 180, p, { up: true, out: 0.03 }); },
  shell(b, [c = '#7cc47a', c2]) { const k = b.s.w; b.add(ball(0.95 * k, c, 1.05, 1, 0.7), 0, 0.05, -0.42 * b.s.d); for (const [x, y] of [[-0.7, 0.5], [0.7, 0.5], [0, 0.95], [-0.95, -0.1], [0.95, -0.1]]) b.add(ball(0.2, c2 || darken(c)), x * k, y * 0.9, -0.42 * b.s.d); },
  cape(b, [c = '#ff5470']) { b.ring(0.38, c, 0.08, 1.03); b.add(ball(1.0 * b.s.w, c, 1.05, 1, 0.3), 0, b.floor * 0.45, -0.72 * b.s.d); b.put(ball(0.1, '#ffcc33'), 0, b.pv(0.38), { out: 0.06 }); },
  pack: (b, [c = '#8a5a3c']) => { b.add(ball(0.55, c, 1.1, 1.15, 0.7), 0, 0, -0.78 * b.s.d); b.ring(0.42, darken(c), 0.055, 1.02); },
  band: (b, [c = '#ff5470', v = 0.36]) => b.ring(+v, c, 0.075, 1.03),
  scarf(b, [c = '#ff5470']) { b.ring(0.38, c, 0.11, 1.04); const p = b.pv(0.38); b.put(ball(0.14, c), 28, p, { out: 0.1 }); b.put(ball(0.13, c, 0.9, 2.1, 0.7), 28, p - 13, { out: 0.06, roll: -8 }); },
  belt(b, [c = '#8a5a3c', c2 = '#ffcc33']) { b.ring(0.3, c, 0.08, 1.03); b.put(box(0.22, 0.2, 0.12, c2), 0, b.pv(0.3), { out: 0.05 }); },
  collar(b, [c = '#ff5470']) { b.ring(0.38, c, 0.075, 1.03); b.put(ball(0.1, '#ffcc33'), 0, b.pv(0.38) - 4, { out: 0.07 }); },
  bowtie(b, [c = '#ff5470']) { const g = group(ball(0.09, c)); for (const sd of S2) g.add(at(ball(0.17, c, 1.2, 0.9, 0.6), sd * 0.2, 0, 0)); b.put(g, 0, b.pv(0.37), { out: 0.05 }); },
  buttons(b, [c = '#3a2f2a']) { for (const v of [0.38, 0.28, 0.18]) b.put(ball(0.07, c, 1, 1, 0.6), 0, b.pv(v)); },
  core: (b, [c = '#86e9f7']) => b.put(gem(c, 0.22, 0.26, 0.12), 0, b.pv(0.27)),
  hold: (b, [type = 'star', c]) => b.put((ITEMS[type] || ITEMS.ball)(c), -46, -16, { out: 0.06, roll: 14 }),
  hold2: (b, [type = 'star', c]) => b.put((ITEMS[type] || ITEMS.ball)(c), 46, -16, { out: 0.06, roll: -14 }),
  saturn(b, [c = '#ffe6b0']) { const r = torus(1.3 * b.s.w, 0.13, c); r.rotation.set(PI / 2 + 0.22, 0.2, 0); b.add(r, 0, -0.12, 0); },
  puffs(b, [c]) { const k = b.s.w / 1.15; for (const [x, y, z, r] of [[-0.75, 0.35, 0, 0.5], [0.7, 0.3, 0.05, 0.52], [0, 0.7, -0.05, 0.6], [-0.4, 0.62, 0.1, 0.48], [0.42, 0.6, 0.1, 0.46], [-1.0, -0.15, 0, 0.4], [1.0, -0.2, 0, 0.42], [0, 0.3, -0.6, 0.6]]) b.add(ball(r * k, c || b.color), x * k, y * b.s.h / 0.75, z * k); },
  points(b, [c]) { for (const a of [0, 72, -72, 128, -128]) { const n = horn(0.44, 0.72, 0, c || b.color, { pow: 0.6, tip: 0.4 }), r = a * D; n.scale.z = 0.8; n.rotation.z = -r; b.add(n, Math.sin(r) * 0.52 * b.s.w / 0.9, Math.cos(r) * 0.55 * b.s.h / 0.95 + 0.1, 0); } },
  rays(b, [c]) { for (const a of [0, 40, -40, 80, -80, 118, -118]) { const n = horn(0.24, 0.42, 0, c || b.color, { pow: 0.5, tip: 0.5 }), r = a * D; n.rotation.z = -r; b.add(n, Math.sin(r) * 0.8 * b.s.w, Math.cos(r) * 0.8 * b.s.h + 0.05, -0.05); } },
  bolts(b, [c = '#7d93aa']) { for (const sd of S2) { const bolt = cyl(0.18, 0.18, 0.18, c); bolt.rotation.x = PI / 2; b.put(group(bolt), sd * 90, 12, { out: 0.03 }); } },
  mush(b, [c = '#f2545b', c2 = '#ffffff']) {
    const R = 1.18, H = 0.82, pts = [new THREE.Vector2(0, -0.04), new THREE.Vector2(R * 0.86, -0.04), new THREE.Vector2(R, 0.08)];
    for (let i = 1; i <= 14; i++) { const p = PI / 2 * (1 - i / 14); pts.push(new THREE.Vector2(Math.max(R * Math.sin(p), 0.0001), 0.08 + H * Math.cos(p))); }
    const cap = group(mesh(new THREE.LatheGeometry(pts, 48), M(c, { side: THREE.DoubleSide })));
    for (const [ph, th, r] of [[20, 10, 0.2], [52, 48, 0.17], [55, -38, 0.19], [70, 5, 0.12], [50, 130, 0.2], [48, -125, 0.18], [62, 180, 0.15]]) {
      const sp = Math.sin(ph * D), cp = Math.cos(ph * D), s = ball(r, c2, 1, 1, 0.16);
      s.position.set(R * sp * Math.sin(th * D), 0.08 + H * cp, R * sp * Math.cos(th * D)); s.quaternion.setFromUnitVectors(ZA, new V3(sp * Math.sin(th * D) / R, cp / H, sp * Math.cos(th * D) / R).normalize());
      cap.add(s);
    }
    cap.rotation.set(-0.08, 0, 0.06); cap.scale.setScalar(b.s.w / 0.84 * 0.9);
    b.add(cap, 0, b.s.h * 0.42, 0);
  },
  mane(b, [c]) { c = c || darken(b.color); for (let i = 0; i < 11; i++) { const a = i / 11 * TAU; b.put(ball(0.25, c), Math.sin(a) * 60, Math.cos(a) * 46 + b.face.ey + 2, { out: 0.02 }); } },
  top(b, [type = 'cherry', c, c2]) { b.put(group((TOPS[type] || TOPS.cherry)(c, c2)), 0, 90, { up: true, out: -0.04 }); },
};

/* painted (pad-printed) details. UNDER ones go on before the belly patch. */
const UNDER = new Set(['hood', 'gradient', 'dip', 'pants', 'stripes', 'vstripes', 'tiger', 'spots', 'dots', 'seeds', 'zig']);
const eyeV = s => 0.51 + ((s.face && s.face.ey) ?? 4) * 0.005;
const scatter = (P, n, fn) => { for (let i = 0; i < n; i++) { const u = (i * 0.618 + 0.11) % 1, v = 0.16 + (i * 0.377 % 1) * 0.68; if (Math.abs(u - 0.5) < 0.15 && v > 0.36 && v < 0.66) continue; fn(u, v, i); } };
const PAINTS = {
  spots: (P, s, [c, n = 16]) => scatter(P, +n, (u, v, i) => { const r = 0.02 + (i % 3) * 0.007; P.ell(u, v, r, r * 1.8, c || darken(s.color, 0.15)); }),
  dots: (P, s, [c = '#ffffff']) => scatter(P, 60, (u, v) => P.ell(u, v, 0.009, 0.018, c)),
  seeds: (P, s, [c = '#ffe08a']) => scatter(P, 80, (u, v) => P.ell(u, v, 0.008, 0.022, c)),
  stripes: (P, s, [c]) => { for (const v of [0.3, 0.74, 0.88]) P.rect(0.5, v, 1, 0.085, c || darken(s.color, 0.2)); },
  vstripes: (P, s, [c]) => { for (let i = 0; i < 16; i += 2) P.rect((i + 0.5) / 16, 0.5, 1 / 16, 1, c || darken(s.color, 0.15)); },
  tiger(P, s, [c]) { c = c || darken(s.color, 0.3); for (const [u, h] of [[0.5, 0.13], [0.462, 0.1], [0.538, 0.1]]) P.rect(u, 0.83, 0.018, h, c); for (const u of [0.28, 0.72]) for (let k = 0; k < 3; k++) P.rect(u, 0.38 + k * 0.1, 0.08, 0.035, c); },
  zig(P, s, [c = '#3a2f2a']) { const { ctx } = P; ctx.strokeStyle = c; ctx.lineWidth = 22; ctx.lineJoin = 'miter'; ctx.beginPath(); for (let i = 0; i <= 24; i++) ctx[i ? 'lineTo' : 'moveTo'](i / 24 * P.W, P.Y(0.3 + (i % 2) * 0.07)); ctx.stroke(); },
  dip(P, s, [c = '#ffffff', v = 0.7]) { const { ctx } = P; ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, 0); for (let x = 0; x <= P.W; x += 8) ctx.lineTo(x, P.Y(+v + 0.05 * Math.sin(x / P.W * TAU * 7))); ctx.lineTo(P.W, 0); ctx.fill(); },
  pants: (P, s, [c, v = 0.36]) => P.rect(0.5, +v / 2, 1, +v, c || darken(s.color)),
  gradient(P, s, [c = '#ffffff']) { const { ctx } = P, g = ctx.createLinearGradient(0, P.H, 0, P.H * 0.25); g.addColorStop(0, c); g.addColorStop(1, c + '00'); ctx.fillStyle = g; ctx.fillRect(0, 0, P.W, P.H); },
  hood(P, s, [c = '#ffffff']) { const { ctx } = P, v = eyeV(s) - 0.01; ctx.fillStyle = c; ctx.fillRect(0, 0, P.W, P.H); ctx.beginPath(); ctx.ellipse(P.X(0.5), P.Y(v), 0.112 * P.W, 0.12 * P.H, 0, 0, TAU); ctx.fillStyle = s.color; ctx.fill(); ctx.strokeStyle = darken(c, 0.12); ctx.lineWidth = 10; ctx.stroke(); },
  bib: (P, s, [c = '#ffffff']) => P.ell(0.5, 0.24, 0.15, 0.27, c),
  star(P, s, [c = '#ffd93b']) { const { ctx } = P; ctx.fillStyle = c; ctx.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 20 : 44, a = i / 10 * TAU - PI / 2; ctx[i ? 'lineTo' : 'moveTo'](P.X(0.5) + Math.cos(a) * r * 0.9, P.Y(0.27) + Math.sin(a) * r); } ctx.fill(); },
  heart(P, s, [c = '#ff5470']) { const { ctx } = P, x = P.X(0.5), y = P.Y(0.27), k = 30; ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, y + k); ctx.bezierCurveTo(x - k * 1.5, y - k * 0.2, x - k * 0.6, y - k * 1.2, x, y - k * 0.4); ctx.bezierCurveTo(x + k * 0.6, y - k * 1.2, x + k * 1.5, y - k * 0.2, x, y + k); ctx.fill(); },
  bolt(P, s, [c = '#ffd93b']) { const { ctx } = P, x = P.X(0.5), y = P.Y(0.27); ctx.fillStyle = c; ctx.beginPath(); for (const [dx, dy] of [[8, -46], [-22, 4], [-2, 4], [-10, 46], [22, -8], [2, -8]]) ctx.lineTo(x + dx, y + dy); ctx.fill(); },
  cross: (P, s, [c = '#4fd69c']) => { P.rect(0.5, 0.3, 0.026, 0.16, c); P.rect(0.5, 0.3, 0.078, 0.055, c); },
  label(P, s, [c = '#fff6e0', c2 = '#ff5d8f']) { P.ell(0.5, 0.25, 0.085, 0.17, c); PAINTS.heart(P, s, [c2]); },
  mask(P, s, [c = '#4a5066']) { const v = eyeV(s); P.ell(0.5 - 0.058, v, 0.06, 0.07, c, 0.3); P.ell(0.5 + 0.058, v, 0.06, 0.07, c, -0.3); },
  visor(P, s, [c = '#e6f6ff']) { const { ctx } = P, v = eyeV(s); ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect(P.X(0.385), P.Y(v + 0.12), 0.23 * P.W, 0.24 * P.H, 40); ctx.fill(); },
  patch(P, s, [c = '#3a2f2a']) { const v = eyeV(s); P.rect(0.5, v + 0.055, 0.3, 0.02, c); P.ell(0.5 + 0.072, v, 0.045, 0.07, c); },
  freckles(P, s, [c]) { const v = eyeV(s) - 0.05; c = c || darken(s.color, 0.25); for (const sd of S2) for (const [dx, dy] of [[0, 0], [0.014, 0.02], [0.028, 0]]) P.ell(0.5 + sd * (0.085 + dx), v + dy, 0.005, 0.01, c); },
};

/* recipe: "Name|Class|shape|body|belly|eyes.mouth|part:arg:arg,part,..."  (colors: palette digit, named letter, or 6-digit hex) */
function compile(str, pal = []) {
  const [name, cls, shape = '', body = '0', belly = '', faceS = '', partS = ''] = str.split('|');
  const col = t => t === '' || t === undefined ? undefined : /^\d$/.test(t) ? pal[+t] : NAMED[t] || (/^[0-9a-f]{6}$/i.test(t) ? '#' + t : t);
  const parts = partS.split(',').map(p => p.trim()).filter(Boolean).map(p => { const [k, ...a] = p.split(':'); return [k, a.map(col)]; });
  const [eyes, mouth] = faceS.split('.');
  const face = { ey: 4, ...SHAPE_FACE[shape], eyes: eyes || 'dot', mouth: mouth || 'smile' };
  const spec = {
    name, cls, color: col(body) || '#cccccc', belly: belly && belly !== '-' ? col(belly) : null, shape: SHAPES[shape] || {}, face,
    under(P) { for (const [k, a] of parts) if (UNDER.has(k)) PAINTS[k](P, spec, a); },
    paint(P) { for (const [k, a] of parts) if (PAINTS[k] && !UNDER.has(k)) PAINTS[k](P, spec, a); },
    build(b) { for (const [k, a] of parts) if (PARTS[k]) PARTS[k](b, a); else if (!PAINTS[k]) console.warn(`Dood "${name}": unknown part "${k}"`); },
  };
  return spec;
}

const BESPOKE = Object.fromEntries(CAST.map(s => [s.name, s]));
export { makeBlob, compile, BESPOKE, D, TAU, V3 };
