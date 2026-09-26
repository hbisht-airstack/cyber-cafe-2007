#!/usr/bin/env node
/**
 * Resolve missing YouTube video IDs in tracks.json without an API key.
 *
 * Usage:
 *   node scripts/resolve-ids.mjs tracks.json
 *   node scripts/resolve-ids.mjs tracks.json --dry
 *   node scripts/resolve-ids.mjs tracks.json --force
 *   node scripts/resolve-ids.mjs tracks.json --top=5
 *
 * This intentionally treats public YouTube search scraping as a discovery aid,
 * not a source of truth. It ranks several candidates and stores match metadata
 * so `npm run verify` can make human review quick.
 */

import { readFile, writeFile } from 'node:fs/promises';

const [, , file, ...flags] = process.argv;
if (!file) {
  console.error('usage: node scripts/resolve-ids.mjs <tracks.json> [--dry] [--force] [--top=5]');
  process.exit(1);
}

const dry = flags.includes('--dry');
const force = flags.includes('--force');
const topArg = flags.find(f => f.startsWith('--top='));
const TOP = Math.max(1, Math.min(10, Number(topArg?.split('=')[1] || 5)));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const text = obj => obj?.simpleText || obj?.runs?.map(r => r.text).join('') || '';
const norm = value => String(value || '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const tokens = value => new Set(norm(value).split(/\s+/).filter(Boolean));

function parseDuration(value) {
  const parts = String(value || '').split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function extractJsonObjectAfter(html, markers) {
  let pos = -1;
  for (const marker of markers) {
    const i = html.indexOf(marker);
    if (i !== -1) { pos = i + marker.length; break; }
  }
  if (pos === -1) throw new Error('ytInitialData marker not found');

  while (pos < html.length && html[pos] !== '{') pos++;
  if (html[pos] !== '{') throw new Error('ytInitialData JSON start not found');

  let depth = 0, inString = false, escaped = false;
  for (let i = pos; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return html.slice(pos, i + 1);
    }
  }
  throw new Error('unterminated ytInitialData JSON');
}

function collectVideoRenderers(root) {
  const found = [];
  const seen = new Set();
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.videoRenderer?.videoId) {
      const v = node.videoRenderer;
      if (!seen.has(v.videoId)) {
        seen.add(v.videoId);
        found.push({
          id: v.videoId,
          title: text(v.title),
          channel: text(v.ownerText) || text(v.longBylineText),
          duration: text(v.lengthText),
          views: text(v.viewCountText)
        });
      }
    }
    if (Array.isArray(node)) node.forEach(walk);
    else Object.values(node).forEach(walk);
  };
  walk(root);
  return found;
}

const preferred = [
  't-series', 'tseries', 'sony music india', 'sonymusicindiavevo', 'tips official',
  'saregama', 'yrf', 'zee music company', 'universal music india', 'eros now music',
  'speed records', 'artist - topic', '- topic', 'vevo'
];
const penalties = [
  ['cover', -45], ['slowed', -55], ['reverb', -55], ['nightcore', -70],
  ['karaoke', -55], ['reaction', -70], ['8d', -55], ['jukebox', -55],
  ['mashup', -45], ['lofi', -35], ['lo-fi', -35], ['instrumental', -35]
];

function overlapScore(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const t of A) if (B.has(t)) common++;
  return common / A.size;
}

function scoreCandidate(track, candidate) {
  const hay = norm(`${candidate.title} ${candidate.channel}`);
  const title = norm(track.title);
  const artist = norm(track.artist);
  const film = norm(track.film);
  let score = 0;

  score += overlapScore(track.title, candidate.title) * 70;
  if (title && hay.includes(title)) score += 35;
  if (artist && hay.includes(artist)) score += 28;
  if (film && hay.includes(film)) score += 12;
  if (/official|audio|video|topic|vevo/.test(hay)) score += 10;
  if (preferred.some(p => hay.includes(p))) score += 18;

  for (const [word, penalty] of penalties) {
    if (hay.includes(word) && !norm(track.title).includes(word)) score += penalty;
  }

  // Lyrics videos are acceptable fallbacks, but prefer the official recording/audio.
  if (hay.includes('lyrics') || hay.includes('lyrical')) score -= 5;

  const seconds = parseDuration(candidate.duration);
  if (seconds && seconds < 80) score -= 40;
  if (seconds > 720) score -= 65;
  if (seconds >= 150 && seconds <= 480) score += 8;

  return Math.round(score * 10) / 10;
}

async function search(query) {
  const url = 'https://www.youtube.com/results?search_query=' +
    encodeURIComponent(query) + '&sp=EgIQAQ%3D%3D';
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      'accept-language': 'en-IN,en;q=0.9'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  if (/consent\.youtube\.com|Before you continue to YouTube/i.test(html)) {
    throw new Error('YouTube consent wall');
  }

  const json = extractJsonObjectAfter(html, [
    'var ytInitialData = ',
    'ytInitialData = ',
    'window["ytInitialData"] = '
  ]);
  return collectVideoRenderers(JSON.parse(json));
}

const data = JSON.parse(await readFile(file, 'utf8'));
let filled = 0, skipped = 0, failed = 0;

for (const seg of data.segments || []) {
  console.log(`\n── ${seg.name}`);
  for (const t of seg.tracks || []) {
    if (t.id && !force) {
      skipped++;
      console.log(`   ·  ${t.artist ? t.artist + ' — ' : ''}${t.title}  (${t.id})`);
      continue;
    }

    const query = [
      t.title,
      t.artist,
      t.film,
      t.searchHint,
      data.searchSuffix || 'official audio song'
    ].filter(Boolean).join(' ');

    try {
      const results = await search(query);
      if (!results.length) throw new Error('no video results');
      const ranked = results
        .map(c => ({ ...c, score: scoreCandidate(t, c) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP);

      const best = ranked[0];
      t.id = best.id;
      t.match = {
        title: best.title,
        channel: best.channel,
        duration: best.duration,
        score: best.score,
        url: `https://youtu.be/${best.id}`,
        alternatives: ranked.slice(1).map(c => ({
          id: c.id,
          title: c.title,
          channel: c.channel,
          duration: c.duration,
          score: c.score
        }))
      };
      filled++;
      console.log(`   ✓  ${t.artist ? t.artist + ' — ' : ''}${t.title}`);
      console.log(`      → ${best.title} — ${best.channel || 'unknown channel'} [score ${best.score}]`);
      console.log(`      https://youtu.be/${best.id}`);
    } catch (err) {
      failed++;
      console.log(`   ✗  ${t.title} — ${err.message}`);
    }

    await sleep(900 + Math.random() * 700);
  }
}

console.log(`\n${filled} filled, ${skipped} already set, ${failed} failed.`);
if (dry) {
  console.log('--dry: nothing written.');
} else {
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote ${file}`);
  console.log('Run `npm run verify` next and review low-score or suspicious matches.');
}
