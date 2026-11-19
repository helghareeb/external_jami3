# Desktop app (Windows, macOS, Linux)

`desktop/` is «الجامع» as an installed program, built with Electron and electron-builder. It exists because the
browser-installed app (PWA) keeps the 1.6 GB offline database in browser storage, which browsers can evict
(Safari most of all), which private windows and «clear browsing data» wipe, and which has per-browser quotas.
A desktop app keeps it as ordinary files in its own folder.

## Stages

1. **Now — the site in a window, with automatic updates.** `main.js` opens https://hadith.dev in a sandboxed
   window (no Node in the page; links to other sites open in the user's browser). With no connection it shows
   `pages/no-connection.html`, which retries.
2. **Next — offline (after the PWA work is finished, since the PWA is the reference).** The app downloads the
   offline edition from `https://files.hadith.dev/offline/` (the same `manifest.json` and chunks as the PWA,
   see [publishing.md](publishing.md)) into `app.getPath('userData')` and serves the offline build of the site
   from there, with PGlite running in Node on those files (`scripts/offline/build-offline-app.mjs --node`).

## Files

| Path | What |
|---|---|
| `desktop/package.json` | Version (the app's version, used by updates), Electron and electron-builder pinned |
| `desktop/electron-builder.yml` | Installers and update settings. **`appId: dev.hadith.desktop` must never change after the first release.** |
| `desktop/main.js` / `preload.js` | The window, link handling, updates. The page only learns `window.hadithDesktop = {isDesktop, platform, version}` |
| `desktop/scripts/write-latest-json.mjs` | Writes `latest.json` (the download links for hadith.dev/offline) |
| `.github/workflows/desktop.yml` | Builds on Windows, macOS and Linux runners and publishes on a `desktop-v*` tag |
| `app/offline/DesktopApps.tsx` | «الجامع لسطح المكتب» on /offline: the user's platform first; «قريبًا» until the first release; hidden inside the app |
| `.claude/skills/electron-builder/` | Reference skill for electron-builder (MIT, pedronauck/skills) |

## Installers

| Platform | Files | Updates itself |
|---|---|---|
| Windows | `hadith-X.Y.Z-win-x64.exe` (one-click, per-user, no admin; also runs on Windows on ARM) | Yes |
| macOS | `hadith-X.Y.Z-mac-arm64.dmg` (Apple silicon), `…-mac-x64.dmg` (Intel), plus `.zip` for updates | **Only once signed** (see below) |
| Linux | `hadith-X.Y.Z-linux-x86_64.AppImage`, `hadith-X.Y.Z-linux-amd64.deb` | AppImage yes; .deb by downloading the new one |

Unsigned for now: Windows shows SmartScreen («More info» → «Run anyway»), macOS needs right-click → Open the
first time. /offline tells users both.

## Releasing a version

1. Set `"version"` in `desktop/package.json` (e.g. `0.2.0`) and merge to master.
2. Tag and push: `git tag desktop-v0.2.0 && git push Hadith desktop-v0.2.0`.
3. The **Desktop app** workflow builds the three platforms (about 15 minutes), then:
   - creates the GitHub Release `desktop-v0.2.0` with all installers;
   - uploads them to R2 `desktop/` — installers first, then `latest.yml`, `latest-mac.yml`, `latest-linux.yml`
     and `latest.json` last, so no app or page points at a file that isn't there yet.
4. Running apps find the update within 6 hours (and at every start), download it in the background and offer
   «أعد التشغيل الآن»; otherwise it installs when the app is closed. /offline shows the new links at once.

The workflow refuses a tag that doesn't match `desktop/package.json`. **Run workflow** (manual) builds without
publishing — use it to test a change. Locally: `cd desktop && npm ci && npm run build:win` (or `npm start` to run
it unpackaged).

Data editions are separate: publishing a new offline edition (publishing.md) needs no new installer.

## One-time setup still to do

- **Repository secrets** `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (GitHub → Settings → Secrets and
  variables → Actions) with the R2 token from `.env.r2`. Without them a release goes to GitHub only and running
  apps don't see it.
- **macOS signing** (when ready): an Apple Developer account ($99/year), then the signing certificate and
  notarization credentials as secrets — see `.claude/skills/electron-builder/references/code-signing.md` — and
  remove `identity: null` from `electron-builder.yml`. Then macOS updates itself like the others.
- **Windows signing** (optional): Azure Trusted Signing removes the SmartScreen warning; same reference.

## Microsoft Store (v2)

Planned for the offline version (stage 2): Store policy rejects apps that are mainly a website in a window.
Account: Partner Center, publisher **Hadith.dev** (set up 2026-11-19). Product reserved as an MSIX app:

| Value | |
|---|---|
| Name reserved | الجامع موسوعة الحديث |
| Store ID | `9N4K0S7PR212` |
| Package/Identity/Name | `Hadith.dev.301807AF58428` |
| Package/Identity/Publisher | `CN=1158820C-79CC-43D8-A05D-31DB3A1E5674` |
| PublisherDisplayName | `Hadith.dev` |
| Package Family Name | `Hadith.dev.301807AF58428_5gn76ewfqd8e4` |

To do for v2: an `appx` target in `electron-builder.yml` with these values (identityName, publisher,
publisherDisplayName, languages ar-SA + en-US); turn electron-updater off in the Store build (`process.windowsStore`),
since the Store updates it; listing text, screenshots, Store logos, age rating, privacy policy page, and the
`runFullTrust` justification; then the upload step in the release workflow. Microsoft signs the package.
