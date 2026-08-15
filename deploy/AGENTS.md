# Deployment DOX

## Purpose
- Store production service and reverse-proxy templates for Hello Betty.

## Ownership
- Own systemd units and Caddy snippets that run a release through `/opt/hellobetty/current`.

## Local Contracts
- Bind application services to loopback-only, uncommon ports.
- Keep runtime data and secrets under `/opt/hellobetty/shared`; never commit production secrets or databases.
- Route the public mobile site and API through Caddy over HTTPS.

## Work Guidance
- Keep service templates release-independent by targeting the atomic `current` symlink.
- Validate Caddy and systemd configuration before reloading live services.

## Verification
- Run `systemd-analyze verify` for service units.
- Run `caddy validate --config /etc/caddy/Caddyfile` before reload.

## Child DOX Index

