import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FPS = 30;
const OUT = process.argv[2] || 'out/clasp-demo.mp4';
const FRAMES = 'frames';

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync('out', { recursive: true });

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
await p.goto('file://' + process.cwd() + '/src/scene.html');

const dur = await p.evaluate(() => window.SCENE_DURATION);
const total = Math.round(dur * FPS);
console.log(`rendering ${total} frames @ ${FPS}fps (${dur}s)`);

const canvas = await p.$('#c');
for (let i = 0; i < total; i++) {
  await p.evaluate((t) => window.renderFrame(t), i / FPS);
  await canvas.screenshot({ path: `${FRAMES}/f${String(i).padStart(5, '0')}.png` });
  if (i % 30 === 0) process.stdout.write(`  ${i}/${total}\r`);
}
await b.close();
console.log(`\nencoding -> ${OUT}`);

execFileSync('ffmpeg', [
  '-y', '-framerate', String(FPS),
  '-i', `${FRAMES}/f%05d.png`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  OUT,
], { stdio: 'inherit' });
