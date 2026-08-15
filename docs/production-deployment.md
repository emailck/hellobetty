# Production Deployment

## Layout

- Releases: `/opt/hellobetty/releases/<release>`
- Active release: `/opt/hellobetty/current`
- Persistent database and uploads: `/opt/hellobetty/shared/data`
- Production API environment: `/opt/hellobetty/shared/api.env`

The API, admin console, and mobile Web export bind only to uncommon loopback ports:

- API: `127.0.0.1:23841`
- Admin console: `127.0.0.1:23842`
- Mobile Web: `127.0.0.1:23843`

`betty.oai-gpt.com` serves the mobile Web application. Caddy forwards `/api/*`, `/uploads/*`, and `/health` to the API and all other paths to the static Web service. The admin service stays on its loopback port until a dedicated hostname is configured.

## Build

Build API and admin code from the release root:

```bash
npm ci --no-audit --no-fund
NEXT_TELEMETRY_DISABLED=1 npm run build
```

Export mobile Web from `apps/mobile` with the public same-origin API URL:

```bash
EXPO_PUBLIC_API_URL=https://betty.oai-gpt.com \
  npx expo export --platform web --output-dir dist-web-prod
```

Build the Android release with the same public API URL and dedicated release-signing credentials. `apps/mobile/android/app/build.gradle` reads the four `HELLOBETTY_RELEASE_*` environment variables or the ignored root `.secrets/android/release-signing.properties` file with `storeFile`, `storePassword`, `keyAlias`, and `keyPassword` keys. A relative `storeFile` in that properties file resolves from `.secrets/android/`; use an absolute path for the environment variable.

```bash
cd android
NODE_ENV=production \
EXPO_PUBLIC_API_URL=https://betty.oai-gpt.com \
  ./gradlew app:assembleRelease
$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs \
  app/build/outputs/apk/release/app-release.apk
cd ..
mkdir -p dist-web-prod/downloads
cp android/app/build/outputs/apk/release/app-release.apk \
  dist-web-prod/downloads/hellobetty.apk
```

The signature check must report the dedicated `hellobetty` release certificate rather than `Android Debug`. The signed-out Web homepage links to `/downloads/hellobetty.apk`. Caddy marks that response as an attachment and requires caches to revalidate the fixed download URL. The APK display name is `hellobetty` and its Android application ID is `com.hellobetty`.

Expo Updates is intentionally disabled in the current native release. Enabling JavaScript hot updates requires a configured Expo/EAS project ID, update URL, runtime-version policy, and release credentials; native dependency, permission, and application-ID changes still require a new APK.

## Activation

Install the three `deploy/*.service` units in `/etc/systemd/system`, install `deploy/betty.caddy` in `/etc/caddy/conf.d`, and ensure the main Caddyfile imports `/etc/caddy/conf.d/*.caddy`. Validate before activation:

```bash
sudo systemd-analyze verify /etc/systemd/system/hellobetty-*.service
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable --now hellobetty-api hellobetty-admin hellobetty-web
sudo systemctl reload caddy
```

Switch releases atomically by replacing `/opt/hellobetty/current`, then restart the three Hello Betty units. Roll back by pointing `current` at the preceding release and restarting the same units. Never replace `/opt/hellobetty/shared` during a code rollout.
