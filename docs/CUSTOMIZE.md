# Customize Cyber Cafe 2007

## Music
Set `defaultPlaylistId` in `config.js`, or paste a playlist URL in the website's Cafe Settings.

## Price and session
Edit `hourlyRate` and `startingMinutes` in `config.js`.

## Random events
Edit the `EVENTS` array near the top of `app.js`.

## Suggested next additions
- MSN Messenger
- LimeWire fake downloads
- Nokia PC Suite
- Online-form-filling mini game
- Printer/scanner mini game
- Cafe-owner “Bhaiya” character
- Public visitor counter using a tiny serverless datastore
- Guestbook
- Custom domain such as `cybercafe2007.fun`

## Automated playlist config

The preferred setup is now to leave `config.js` alone and run:

```bash
npm run sync
```

The sync script creates/updates `playlist.generated.js`. `index.html` loads that file before `config.js`, so the website picks up the synced playlist automatically.

See `PLAYLIST_AUTOMATION.md` for the full setup.
