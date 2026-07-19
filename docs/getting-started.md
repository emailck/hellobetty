# Getting Started

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer

## First run

```bash
npm install
npm run db:seed -w @hellobetty/api
npm run dev:api
npm run dev:admin
npm run web -w @hellobetty/mobile -- --port 8083
```

Start the three commands in separate terminals. Default local addresses:

- API health check: `http://localhost:4100/health`
- Web management console: `http://localhost:3000/login`
- Mobile web preview: `http://localhost:8083`

When a default port is occupied, choose another free port such as `3001` for the admin console and `8083` for the mobile preview.

## Local administrator

The seed command creates or updates the administrator defined by these optional API environment variables:

- `ADMIN_PHONE`, default `13800000000`
- `ADMIN_PASSWORD`, default `HelloBetty2026!`
- `ADMIN_NAME`, default `Hello Betty 管理员`

Copy `services/api/.env.example` to `services/api/.env` before running outside local development. Set a strong `JWT_SECRET` before deployment.

## Verification

```bash
npm run typecheck
npm test
npm run build
```
