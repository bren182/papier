#!/usr/bin/env node
// Converts Playwright demo recordings → GIFs.
// Requires: ffmpeg on PATH  (brew install ffmpeg / winget install ffmpeg)
// Usage:    node scripts/demo-gif.mjs
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const videosDir = join(root, 'apps', 'web', 'e2e', 'demos', 'videos');
const outDir = join(root, 'demos');

// ── Check ffmpeg ─────────────────────────────────────────────────────────────

const ffmpegCheck = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
if (ffmpegCheck.status !== 0) {
  console.error('ffmpeg not found on PATH.');
  console.error('  macOS:   brew install ffmpeg');
  console.error('  Windows: winget install ffmpeg');
  console.error('  Linux:   sudo apt install ffmpeg');
  process.exit(1);
}

// ── Find videos ───────────────────────────────────────────────────────────────

/** @param {string} dir @returns {string[]} */
function findVideos(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findVideos(full));
    } else if (['.webm', '.mp4'].includes(extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

const videos = findVideos(videosDir);

if (videos.length === 0) {
  console.log('No videos found under', videosDir);
  console.log('Run `pnpm demo:record` first to generate recordings.');
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

// ── Convert each video ────────────────────────────────────────────────────────

for (const video of videos) {
  // Derive a readable slug from the grandparent directory name (Playwright test folder).
  // Playwright names dirs like "editor---block-editing-and-slash-menu-a1b2c3d4/".
  const dirName = basename(dirname(video));
  const slug = dirName
    .replace(/-[a-f0-9]{8}$/, '')   // strip trailing hash
    .replace(/[^a-z0-9]+/gi, '-')   // non-alnum runs → dash
    .replace(/^-|-$/g, '')          // trim leading/trailing dashes
    .toLowerCase();

  const outPath = join(outDir, `${slug}.gif`);
  const palettePath = join(tmpdir(), `palette-${randomUUID()}.png`);

  console.log(`Converting: ${basename(dirName)} → demos/${slug}.gif`);

  // Pass 1: generate optimised palette.
  const pass1 = spawnSync(
    'ffmpeg',
    ['-y', '-i', video, '-vf', 'fps=15,scale=960:-1:flags=lanczos,palettegen=max_colors=128', palettePath],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  if (pass1.status !== 0) {
    console.error(`  palette generation failed:\n${pass1.stderr?.toString()}`);
    continue;
  }

  // Pass 2: render GIF using the palette.
  const pass2 = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i', video,
      '-i', palettePath,
      '-filter_complex', 'fps=15,scale=960:-1:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer',
      '-loop', '0',
      outPath,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  if (pass2.status !== 0) {
    console.error(`  GIF render failed:\n${pass2.stderr?.toString()}`);
    continue;
  }

  console.log(`  ✓ ${outPath}`);
}
