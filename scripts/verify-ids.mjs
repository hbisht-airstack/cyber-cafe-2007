#!/usr/bin/env node
/**
 * Verify resolved IDs via YouTube oEmbed and generate a clickable HTML report.
 * This does not mutate IDs. It makes human review of automated matches fast.
 */
import { readFile, writeFile } from 'node:fs/promises';

const [, , file] = process.argv;
if (!file) {
  console.error('usage: node scripts/verify-ids.mjs <tracks.json>');
  process.exit(1);
}

const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
})[c]);

const data = JSON.parse(await readFile(file, 'utf8'));
const rows = [];
let ok = 0, missing = 0, failed = 0;

for (const seg of data.segments || []) {
  for (const t of seg.tracks || []) {
    if (!t.id) {
      missing++;
      rows.push({ status: 'missing', segment: seg.name, track: t });
      continue;
    }
    try {
      const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${t.id}`)}&format=json`;
      const res = await fetch(url, { headers: { 'accept-language': 'en-IN,en;q=0.9' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const meta = await res.json();
      ok++;
      rows.push({ status: 'ok', segment: seg.name, track: t, meta });
    } catch (error) {
      failed++;
      rows.push({ status: 'failed', segment: seg.name, track: t, error: error.message });
    }
  }
}

const body = rows.map(r => {
  const t = r.track;
  const score = t.match?.score ?? '';
  const cls = r.status === 'ok' && Number(score) < 70 ? 'warn' : r.status;
  const resolved = r.meta?.title || t.match?.title || '';
  const author = r.meta?.author_name || t.match?.channel || '';
  return `<tr class="${cls}">
    <td>${escape(r.status)}</td>
    <td>${escape(r.segment)}</td>
    <td><b>${escape(t.artist)}</b><br>${escape(t.title)}${t.film ? `<br><small>${escape(t.film)}</small>` : ''}</td>
    <td>${escape(resolved)}<br><small>${escape(author)}</small></td>
    <td>${escape(score)}</td>
    <td>${t.id ? `<a target="_blank" href="https://youtu.be/${encodeURIComponent(t.id)}">open</a>` : ''}</td>
  </tr>`;
}).join('\n');

const html = `<!doctype html><meta charset="utf-8"><title>Cyber Cafe 2007 — Track Verification</title>
<style>
body{font:14px system-ui;margin:30px;background:#f5f2e9;color:#222}h1{margin-bottom:4px}table{border-collapse:collapse;width:100%;background:white}th,td{border:1px solid #ccc;padding:8px;vertical-align:top;text-align:left}th{background:#183d76;color:white}.warn{background:#fff2b8}.failed,.missing{background:#ffd8d8}small{color:#666}.summary{margin:12px 0 20px;padding:10px;background:#fff;border:1px solid #bbb}a{color:#0645ad}
</style>
<h1>Cyber Cafe 2007 — Track Verification</h1>
<div class="summary"><b>${ok}</b> reachable · <b>${missing}</b> missing IDs · <b>${failed}</b> failed oEmbed checks. Yellow rows have resolver score under 70 and deserve manual review.</div>
<table><thead><tr><th>Status</th><th>Segment</th><th>Wanted</th><th>Resolved YouTube item</th><th>Score</th><th>Check</th></tr></thead><tbody>${body}</tbody></table>`;

await writeFile('verification-report.html', html);
console.log(`Verification complete: ${ok} reachable, ${missing} missing, ${failed} failed.`);
console.log('Open verification-report.html and review the yellow/red rows before publishing.');
