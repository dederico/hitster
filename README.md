# Hitster

Local-first Hitster-style multiplayer game scaffold backed by SQLite.

## Runtime

- `apps/web`: React SPA for room creation, deck management, and round playback
- `apps/server`: Fastify + Socket.IO + SQLite authority for rooms, players, and tracks
- `packages/core`: provider-agnostic room/game helpers
- `packages/provider-sdk`: search/playback provider adapters
- `packages/shared`: shared transport and domain types

## Current flow

1. Create or join a room from the SPA.
2. Add songs to the room deck.
3. Use provider search when available, or add tracks manually with preview/external URLs.
4. Start rounds from the room and play the active track locally.

## Music source model

The app is intentionally provider-agnostic at the game layer:

- `manual`: add title/artist plus optional preview or external URL from anywhere
- `itunes_preview`: unauthenticated search + preview source for quick local testing

This means the room/game logic does not depend on Spotify, Apple Music, Amazon Music, or any one service. If you want a YouTube-based adapter later, it can be added behind `packages/provider-sdk` without changing the SQLite room flow.

## Local run

1. `npm install`
2. `npm run dev:server`
3. `npm run dev:web`

The API listens on `http://localhost:3001` by default and the SPA expects that origin unless `VITE_API_BASE_URL` is set.

## ngrok

Expose the web app and API separately if needed, or keep the SPA local and tunnel only the API. For a tunneled SPA, set:

- `CORS_ORIGIN` on the server to your ngrok web URL
- `VITE_API_BASE_URL` on the web app to your ngrok API URL


codex resume 019d3c14-1db3-76d2-98d5-0e379d67bc41