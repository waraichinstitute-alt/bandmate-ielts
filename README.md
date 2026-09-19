# BandMate IELTS 🎙️

**The daily speaking gym for IELTS.** Get randomly matched with another learner for a structured, timed video speaking session — warm-up, Part 1, Part 2 cue card, Part 3 discussion — then swap roles and get automated speaking feedback plus peer ratings.

This is the **MVP** from the product spec:
1. ✅ Profile setup with current + target band
2. ✅ Random pairing of two online users (level-aware: prefers ±1.5 bands)
3. ✅ Real peer-to-peer video calls (WebRTC) with mute, camera, leave, report, block
4. ✅ Built-in IELTS Part 1/2/3 prompts with synchronized timers and examiner scripts
5. ✅ Peer ratings after each call (clarity, idea development, best phrase)
6. ✅ Session history + practice streak
7. ✅ Live transcript (Chrome) with filler-word, pause, pace and vocabulary analysis

## Run it

Requires Node.js 18+.

```bash
cd bandmate
npm install
npm start
```

Open **http://localhost:3000** in two browser windows (or two devices on the same network, using your machine's LAN IP). Click "Find a speaking partner" in both — you'll be matched in seconds.

Notes:
- Camera/mic need a secure context: `localhost` works, or serve over HTTPS.
- Two tabs on the same machine share one camera — for a real test use two devices, or one tab can join audio-only.
- If calls fail across certain networks (symmetric NAT), add a TURN server (e.g. coturn) to `rtcConfig` in `public/app.js`.

## How it works

- `server.js` — Express static server + WebSocket signaling (`/ws`). Handles the matchmaking queue (prefers partners within ~1.5 bands, broadens after 20s, respects block lists) and relays SDP/ICE, stage sync, ratings and stats. No database yet — reports are logged in memory.
- `public/app.js` — the whole client: profile, matchmaking, WebRTC peer connection, the session state machine (the waiting partner is session leader and drives stage changes; both clients stay in sync via the server), live transcription via the Web Speech API, and the feedback engine.
- `public/prompts.js` — the IELTS prompt bank (10 Part 1 topics, 12 Part 2 cue cards, Part 3 follow-ups per topic).
- History, streak and block list live in `localStorage`.

## What's intentionally not in the MVP

Accounts/auth, cloud database, advanced AI scoring, recordings, payments, tutor marketplace, moderation pipeline, mobile apps. The session flow, matching and feedback loop are the core to validate first.

## Next steps

- Deploy the server somewhere public (Render/Fly.io/Railway) so anyone can match.
- Add real accounts + Postgres for history, ratings and reputation.
- TURN server for reliable NAT traversal.
- Wrap the web client with Capacitor for iOS/Android apps.
