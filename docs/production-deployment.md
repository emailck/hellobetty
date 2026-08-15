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

