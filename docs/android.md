# Android app (`dev.hadith.app`)

`android/` is «الجامع» for Android, built with Kotlin, Material 3, and Android `WebView` around `https://hadith.dev`. It runs independently of Chrome (supporting devices without Chrome or GMS), isolates site cookies and storage from the user's browser, and adds native Android ergonomics: splash screen, RTL bottom navigation, pull-to-refresh, fullscreen video, file imports, system downloads, deep links, and offline retry handling.

## Architecture & Key Files

| Path | Role |
|---|---|
| `android/app/build.gradle.kts` | App config (`applicationId = "dev.hadith.app"`, `minSdk = 26`, `compileSdk = 36`, `targetSdk = 36`), R8 shrinking, optional `keystore.properties` release signing |
| `android/app/src/main/AndroidManifest.xml` | Internet/network permissions, launcher shortcuts, and HTTPS App Links for `hadith.dev` / `www.hadith.dev` |
| `android/app/src/main/kotlin/dev/hadith/app/MainActivity.kt` | WebView configuration (Service Worker + DOM/OPFS storage + cookies), edge-to-edge & IME keyboard insets, Material 3 bottom nav, "المزيد" bottom sheet, pull-to-refresh, offline retry overlay, fullscreen video, and file chooser |
| `android/app/src/main/kotlin/dev/hadith/app/HadithUrls.kt` | Pure URL routing, download/graph route detection, bottom tab mapping, and deep-link sanitization |
| `android/app/src/main/kotlin/dev/hadith/app/HadithJsBridge.kt` | `window.hadithAndroid` bridge (`isAndroid`, `getVersionName`, `getVersionCode`, `share`, `copyText`, `setKeepScreenOn`, `onThemeChanged`), restricted to `https://hadith.dev` / `www.hadith.dev` |
| `android/app/src/main/res/xml/shortcuts.xml` | Launcher long-press shortcuts (`/search`, `/books`, `/narrators`, `/offline`) |
| `android/app/src/test/kotlin/dev/hadith/app/HadithUrlsTest.kt` | JVM unit tests for URL validation, download routing, graph detection, tab mapping, and deep-link sanitization |
| `android/scripts/stage-release.mjs` | Stages `out/android/hadith-<version>-android.apk` and `out/android/latest.json` (with size & SHA-256) for `/offline` |
| `app/offline/AndroidApp.tsx`, `lib/androidApp.ts` | «الجامع للأندرويد» download/update section on `/offline` fed by `https://files.hadith.dev/android/latest.json` |

## Building & Testing Locally

From `android/`:

```powershell
# Run JVM unit tests, build debug APK, and run Android Lint
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug

# Build Play Store App Bundle (requires release keystore for Play upload)
.\gradlew.bat bundleRelease
```

Outputs:
- Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- Release AAB: `android/app/build/outputs/bundle/release/app-release.aab`
- Release APK: `android/app/build/outputs/apk/release/app-release.apk` (`.\gradlew.bat assembleRelease`)

To install and launch on a USB-connected phone with USB debugging enabled:

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
adb shell am start -n dev.hadith.app/.MainActivity
```

## Release Signing (Keep Out of Git)

Create a private upload keystore (once) outside version control:

```powershell
keytool -genkeypair -v `
  -keystore android/hadith-upload.jks `
  -alias hadith `
  -keyalg RSA -keysize 2048 -validity 10000
```

Create `android/keystore.properties` (git-ignored):

```properties
storeFile=hadith-upload.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=hadith
keyPassword=YOUR_KEY_PASSWORD
```

Never commit `*.jks`, `*.keystore`, `keystore.properties`, or `local.properties`. Back up `android/hadith-release.jks` and `android/keystore.properties` securely — future APK updates and Google Play releases must be signed with the same key.

## Publishing APK Updates to `/offline` (Cloudflare R2)

Direct APK downloads on `https://hadith.dev/offline` are served from `https://files.hadith.dev/android/`:

1. Bump `versionCode` and `versionName` in `android/app/build.gradle.kts`.
2. Build and verify the signed release APK (from `android/`):
   ```powershell
   .\gradlew.bat testDebugUnitTest assembleRelease
   ```
3. Stage the release APK and `latest.json` into `out/android/` (from repo root):
   ```powershell
   node android/scripts/stage-release.mjs
   ```
4. Upload to R2 (uploads the `.apk` first with `application/vnd.android.package-archive`, and `latest.json` last with `no-cache`):
   ```powershell
   python scripts/r2-upload.py out/android android/
   ```
   Running `dev.hadith.app` builds detect newer `versionCode` values from `latest.json` on `/offline` and offer an in-page update download link.

## Google Play Store Checklist

1. **Play App Signing & Digital Asset Links (`/.well-known/assetlinks.json`):**
   - Upload the signed `.aab` (`.\gradlew.bat bundleRelease`) in Google Play Console.
   - Copy the **App signing key certificate SHA-256 fingerprint** from Play Console → *App integrity* → *App signing*.
   - Serve `https://hadith.dev/.well-known/assetlinks.json` containing package `dev.hadith.app` and that SHA-256 fingerprint so Android verifies App Links (`android:autoVerify="true"`) and opens `https://hadith.dev/*` links directly inside the app.
2. **Privacy Policy & Data Safety:** Publish a Privacy Policy URL on `hadith.dev` and complete the Data Safety questionnaire in Play Console.
3. **Account Deletion URL:** Because the site offers optional accounts (`/login`, `/account`), Play Console requires a public web URL and an in-app path explaining how users can delete their account and associated library data.
4. **Closed Testing (personal Play accounts):** Newer personal developer accounts require a 14-day closed test with at least 12 opted-in testers before requesting production access.
