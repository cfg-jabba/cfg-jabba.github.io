// Doods brand kit: one wordmark, one palette, used by the page header and every piece of packaging.
export const BRAND = { ink: '#3a1560', yellow: '#ffd93b', orange: '#ffa62b', pink: '#ff5fa8', teal: '#2fd3c9', white: '#ffffff', tagline: 'SQUISH ’EM · COLLECT ’EM' };
export const FONT = px => `700 ${px}px Fredoka, ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif`;
const TAU = Math.PI * 2;

export function blobPath(ctx, x, y, r) {      // the Dood silhouette: egg with a flat-ish base
  ctx.beginPath(); ctx.ellipse(x, y, r * 0.82, r, 0, Math.PI, 0); ctx.ellipse(x, y, r * 0.82, r * 0.74, 0, 0, Math.PI); ctx.closePath();
}
function face(ctx, r) {
  ctx.fillStyle = BRAND.ink;
  for (const sd of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sd * r * 0.34, r * 0.02, r * 0.115, r * 0.15, 0, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#fff';
  for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(sd * r * 0.34 - r * 0.035, -r * 0.045, r * 0.045, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = BRAND.ink; ctx.lineWidth = r * 0.06; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, r * 0.1, r * 0.1, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.45)';
  for (const sd of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sd * r * 0.56, r * 0.22, r * 0.12, r * 0.075, 0, 0, TAU); ctx.fill(); }
}

// The wordmark: D [dood] [dood] D S, on a bouncy baseline, in a chunky ink sticker outline.
// `h` is the letter size in px; returns the drawn width.
export function drawLogo(ctx, cx, cy, h) {
  const items = [{ t: 'D' }, { c: BRAND.pink, hi: '#ff9ccb' }, { c: BRAND.teal, hi: '#8ff0e6' }, { t: 'D' }, { t: 'S' }];
  const rot = [-0.1, 0.07, -0.05, 0.09, -0.07], dy = [0.02, -0.04, 0.04, -0.03, 0.03], R = h * 0.4;
  ctx.save(); ctx.font = FONT(h); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = ctx.lineCap = 'round';
  const w = items.map(it => it.t ? ctx.measureText(it.t).width * 0.96 : R * 1.72), W = w.reduce((a, b) => a + b, 0);
  const each = fn => { let x = cx - W / 2; items.forEach((it, i) => { ctx.save(); ctx.translate(x + w[i] / 2, cy + dy[i] * h); ctx.rotate(rot[i]); fn(it, i); ctx.restore(); x += w[i]; }); };
  const shape = (it, mode) => {
    if (it.t) mode === 'stroke' ? ctx.strokeText(it.t, 0, h * 0.35) : ctx.fillText(it.t, 0, h * 0.35);
    else { blobPath(ctx, 0, -h * 0.02, R); mode === 'stroke' ? ctx.stroke() : ctx.fill(); }
  };
  // 1 drop shadow + 2 white sticker edge + 3 ink outline
  ctx.strokeStyle = ctx.fillStyle = BRAND.ink; ctx.lineWidth = h * 0.3;
  ctx.save(); ctx.translate(h * 0.05, h * 0.09); each(it => shape(it, 'stroke')); ctx.restore();
  each(it => shape(it, 'stroke'));
  // 4 fills
  each(it => {
    if (it.t) { const g = ctx.createLinearGradient(0, -h * 0.4, 0, h * 0.4); g.addColorStop(0, '#fff06a'); g.addColorStop(0.55, BRAND.yellow); g.addColorStop(1, BRAND.orange); ctx.fillStyle = g; shape(it, 'fill'); }
    else {
      ctx.fillStyle = it.c; shape(it, 'fill');
      ctx.fillStyle = it.hi; ctx.beginPath(); ctx.ellipse(-R * 0.3, -R * 0.56, R * 0.2, R * 0.11, -0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(0, R * 0.52, R * 0.42, R * 0.24, 0, 0, TAU); ctx.fill();
      face(ctx, R);
    }
  });
  ctx.restore();
  return W;
}

export function pill(ctx, text, cx, cy, px, { bg = BRAND.ink, fg = '#fff', maxW, padX = 0.9 } = {}) {
  ctx.save(); ctx.font = FONT(px); let tw = ctx.measureText(text).width;
  if (maxW && tw > maxW) { px *= maxW / tw; ctx.font = FONT(px); tw = maxW; }
  const w = tw + px * padX * 2, hgt = px * 1.7;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(cx - w / 2, cy - hgt / 2, w, hgt, hgt / 2); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, cx, cy + px * 0.04);
  ctx.restore();
}
export function burst(ctx, x, y, r, lines, rot = 0.2) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  const path = () => { ctx.beginPath(); for (let k = 0; k < 24; k++) { const a = k / 24 * TAU, rr = k % 2 ? r * 0.8 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); };
  ctx.lineJoin = 'round'; ctx.strokeStyle = BRAND.ink; ctx.lineWidth = r * 0.14; path(); ctx.stroke(); ctx.fillStyle = BRAND.yellow; path(); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const total = lines.reduce((a, l) => a + l[1], 0); let yy = -total / 2;
  for (const [t, px, col] of lines) { ctx.font = FONT(px); ctx.fillStyle = col || BRAND.ink; ctx.fillText(t, 0, yy + px / 2); yy += px; }
  ctx.restore();
}
// brand pattern: a scatter of little Dood silhouettes
export function pattern(ctx, W, H, seed, alpha = 0.13) {
  ctx.save(); ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  for (let i = 0; i < 40; i++) {
    const rnd = k => (Math.sin(i * k + seed * 1.7) * 43758.5453 % 1 + 1) % 1;
    ctx.save(); ctx.translate(rnd(127.1) * W, rnd(311.7) * H); ctx.rotate((rnd(74.7) - 0.5) * 0.9); blobPath(ctx, 0, 0, 14 + rnd(19.3) * 22); ctx.fill(); ctx.restore();
  }
  ctx.restore();
}
