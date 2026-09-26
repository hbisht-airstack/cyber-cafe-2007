# Playlist automation

The project now has a three-stage playlist pipeline:

```text
tracks.json
   ↓ npm run resolve
YouTube search candidates + best video IDs
   ↓ npm run verify
verification-report.html
   ↓ npm run sync
Cyber Cafe 2007 playlist in your YouTube account
   ↓
playlist.generated.js
   ↓
website automatically loads the playlist
```

## Requirements

- Node.js 18+
- A Google account with a YouTube channel/profile
- YouTube Data API v3 enabled in a Google Cloud project
- A Desktop OAuth client downloaded as `client_secret.json`

Never commit `client_secret.json` or `.youtube-token.json`. They are already included in `.gitignore`.

## 1. Install dependencies

From the project root:

```bash
npm install
```

## 2. Resolve the tracks

```bash
npm run resolve
```

The resolver does not require an API key. It searches the public YouTube results page, extracts video candidates from `ytInitialData`, and scores them using:

- song-title match
- artist match
- film/album match
- preferred official music channels / Topic / VEVO
- sensible song duration
- penalties for covers, slowed/reverb, karaoke, reaction, 8D, mashups, jukeboxes, etc.

It stores both the chosen ID and alternatives in `tracks.json`.

Preview without modifying the JSON:

```bash
npm run resolve:dry
```

Re-resolve existing IDs:

```bash
node scripts/resolve-ids.mjs tracks.json --force
```

## 3. Verify before publishing

```bash
npm run verify
```

This creates:

```text
verification-report.html
```

Open it in a browser. Each row links directly to the selected YouTube item. Yellow rows have a resolver score under 70 and should get extra attention.

If a match is wrong, simply replace that track's `id` manually in `tracks.json`. You can also delete its `id` and run the resolver again.

## 4. Google OAuth setup — once

In Google Cloud Console:

1. Create/select a project.
2. Enable **YouTube Data API v3**.
3. Configure the OAuth consent screen.
4. Create an OAuth client of type **Desktop app**.
5. Download the credentials JSON.
6. Rename it to:

```text
client_secret.json
```

7. Put it in the project root next to `package.json`.

The first sync opens a browser so you can authorize your own YouTube account. Afterward the refresh/access token is saved locally in:

```text
.youtube-token.json
```

That file is private and ignored by Git.

## 5. Create / update the playlist

```bash
npm run sync
```

The script will:

1. Use `playlist.youtubePlaylistId` from `tracks.json` when already known.
2. Otherwise find an existing playlist named **Cyber Cafe 2007**.
3. Create an **Unlisted** playlist if it does not exist.
4. Read all videos already in it.
5. Add only missing tracks.
6. Skip duplicates.
7. Save the playlist ID into `tracks.json`.
8. Generate `playlist.generated.js`.

The website loads `playlist.generated.js` before `config.js`, so no manual playlist copy/paste is needed after sync.

## One-command flow

Once Google OAuth is configured:

```bash
npm run playlist
```

This runs:

```text
resolve → verify → sync
```

The verification report is still generated so you can review the selected recordings. For the very first playlist, the safest workflow is to run the three commands separately and inspect the report before `npm run sync`.

## Updating the playlist later

Add new track objects to `tracks.json`, leaving `id` blank:

```json
{
  "title": "New Song",
  "artist": "Artist",
  "film": "Film or Album",
  "id": ""
}
```

Then run:

```bash
npm run playlist
```

Tracks whose IDs already exist are not searched again, and tracks already in the YouTube playlist are not inserted again.

## Security model

The website itself never receives your OAuth token. OAuth exists only in the local playlist-management scripts. The deployed static website gets only a public/unlisted playlist ID and uses the official YouTube IFrame Player API for playback.
