#!/usr/bin/env node
/**
 * Create/update the Cyber Cafe 2007 playlist in the signed-in YouTube account.
 * Uses the official YouTube Data API + OAuth. No password/cookies are stored.
 *
 * First run requirements:
 *   - Enable YouTube Data API v3 in Google Cloud.
 *   - Create a Desktop OAuth client.
 *   - Download it as client_secret.json in the repo root.
 *
 * Usage:
 *   node scripts/sync-playlist.mjs tracks.json
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import { google } from 'googleapis';
import { authenticate } from '@google-cloud/local-auth';
import { fileURLToPath } from 'node:url';

const [, , file] = process.argv;
if (!file) {
  console.error('usage: node scripts/sync-playlist.mjs <tracks.json>');
  process.exit(1);
}

const CREDENTIALS_PATH = new URL('../client_secret.json', import.meta.url);
const TOKEN_PATH = new URL('../.youtube-token.json', import.meta.url);
const GENERATED_JS = new URL('../playlist.generated.js', import.meta.url);
const SCOPES = ['https://www.googleapis.com/auth/youtube'];

async function exists(url) {
  try { await access(url); return true; } catch { return false; }
}

async function loadOAuthClientFromSavedToken() {
  if (!(await exists(CREDENTIALS_PATH)) || !(await exists(TOKEN_PATH))) return null;
  const credentials = JSON.parse(await readFile(CREDENTIALS_PATH, 'utf8'));
  const token = JSON.parse(await readFile(TOKEN_PATH, 'utf8'));
  const key = credentials.installed || credentials.web;
  if (!key) throw new Error('client_secret.json does not contain an installed/web OAuth client');
  const client = new google.auth.OAuth2(key.client_id, key.client_secret, key.redirect_uris?.[0]);
  client.setCredentials(token);
  return client;
}

async function authorize() {
  const saved = await loadOAuthClientFromSavedToken();
  if (saved) return saved;
  if (!(await exists(CREDENTIALS_PATH))) {
    throw new Error('Missing client_secret.json. See docs/PLAYLIST_AUTOMATION.md.');
  }
  const client = await authenticate({ scopes: SCOPES, keyfilePath: fileURLToPath(CREDENTIALS_PATH) });
  await writeFile(TOKEN_PATH, JSON.stringify(client.credentials, null, 2) + '\n');
  return client;
}

async function findPlaylist(youtube, title) {
  let pageToken;
  do {
    const response = await youtube.playlists.list({
      part: ['snippet', 'status'], mine: true, maxResults: 50, pageToken
    });
    const found = response.data.items?.find(p => p.snippet?.title === title);
    if (found) return found;
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  return null;
}

async function createPlaylist(youtube, meta) {
  const response = await youtube.playlists.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: meta.title || 'Cyber Cafe 2007',
        description: meta.description || 'Cyber Cafe 2007 — ₹20/hour, Winamp, Orkut, Yahoo Messenger and CS 1.6.'
      },
      status: { privacyStatus: meta.privacyStatus || 'unlisted' }
    }
  });
  return response.data;
}

async function existingVideos(youtube, playlistId) {
  const ids = new Set();
  let pageToken;
  do {
    const response = await youtube.playlistItems.list({
      part: ['contentDetails'], playlistId, maxResults: 50, pageToken
    });
    for (const item of response.data.items || []) {
      const id = item.contentDetails?.videoId;
      if (id) ids.add(id);
    }
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  return ids;
}

async function addVideo(youtube, playlistId, videoId) {
  await youtube.playlistItems.insert({
    part: ['snippet'],
    requestBody: {
      snippet: {
        playlistId,
        resourceId: { kind: 'youtube#video', videoId }
      }
    }
  });
}

const data = JSON.parse(await readFile(file, 'utf8'));
const unresolved = (data.segments || []).flatMap(s => (s.tracks || []).filter(t => !t.id));
if (unresolved.length) {
  console.error(`${unresolved.length} tracks still have no video ID. Run npm run resolve and review npm run verify first.`);
  process.exit(2);
}

const auth = await authorize();
const youtube = google.youtube({ version: 'v3', auth });
const meta = data.playlist || {};
const title = meta.title || 'Cyber Cafe 2007';
console.log(`\nLooking for playlist: ${title}`);

let playlist = meta.youtubePlaylistId
  ? { id: meta.youtubePlaylistId }
  : await findPlaylist(youtube, title);

if (!playlist) {
  console.log('Playlist not found. Creating it...');
  playlist = await createPlaylist(youtube, meta);
  console.log(`Created playlist: ${playlist.id}`);
} else {
  console.log(`Using playlist: ${playlist.id}`);
}

const existing = await existingVideos(youtube, playlist.id);
let added = 0, skipped = 0, failed = 0;

for (const segment of data.segments || []) {
  console.log(`\n── ${segment.name}`);
  for (const track of segment.tracks || []) {
    const label = `${track.artist ? track.artist + ' — ' : ''}${track.title}`;
    if (existing.has(track.id)) {
      skipped++;
      console.log(`   · ${label} — already in playlist`);
      continue;
    }
    try {
      await addVideo(youtube, playlist.id, track.id);
      existing.add(track.id);
      added++;
      console.log(`   ✓ ${label}`);
      await new Promise(r => setTimeout(r, 250));
    } catch (error) {
      failed++;
      console.error(`   ✗ ${label} — ${error.response?.data?.error?.message || error.message}`);
    }
  }
}

data.playlist = { ...meta, youtubePlaylistId: playlist.id };
await writeFile(file, JSON.stringify(data, null, 2) + '\n');
await writeFile(GENERATED_JS,
  `/* Generated by npm run sync. Safe to commit: contains only a playlist ID. */\nwindow.CYBER_CAFE_PLAYLIST_ID = ${JSON.stringify(playlist.id)};\n`
);

console.log(`\nDone. Added ${added}, skipped ${skipped}, failed ${failed}.`);
console.log(`YouTube: https://www.youtube.com/playlist?list=${playlist.id}`);
console.log(`YouTube Music: https://music.youtube.com/playlist?list=${playlist.id}`);
console.log('Updated tracks.json and playlist.generated.js, so the website now points at this playlist.');
