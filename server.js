// BandMate IELTS — signaling + matchmaking server
// Serves the web client and relays WebRTC signaling, session sync, ratings.
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// id -> { ws, profile, peerId, sessionId, joinedAt }
const clients = new Map();
const queue = []; // ids of clients waiting for a partner
const sessions = new Map(); // sessionId -> { a, b, startedAt }
const reports = [];

let nextId = 1;

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }
}

function clientById(id) { return clients.get(id); }

function bandOf(p) { const b = parseFloat(p && p.band); return isNaN(b) ? 6 : b; }

function blockedEither(a, b) {
  const pa = a.profile || {}, pb = b.profile || {};
  return (pa.block || []).includes(b.id) || (pb.block || []).includes(a.id);
}

function tryMatch(client) {
  // Prefer a partner within ~1 band; broaden to anyone after 20s waiting.
  const waitingLong = Date.now() - client.joinedAt > 20000;
  for (let i = 0; i < queue.length; i++) {
    const other = clientById(queue[i]);
    if (!other || other.id === client.id) continue;
    if (blockedEither(client, other)) continue;
    const diff = Math.abs(bandOf(client.profile) - bandOf(other.profile));
    if (!waitingLong && diff > 1.5) continue;
    queue.splice(i, 1);
    return other;
  }
  return null;
}

function startSession(a, b) {
  // a = the user who was waiting (becomes session leader / Player A)
  const sessionId = 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  sessions.set(sessionId, { a: a.id, b: b.id, startedAt: Date.now() });
  a.sessionId = sessionId; a.peerId = b.id;
  b.sessionId = sessionId; b.peerId = a.id;

  send(a.ws, {
    type: 'matched',
    sessionId,
    peerId: b.id,
    peer: publicProfile(b),
    leader: true,
    initiator: true,
    // The leader's mode/topic drives the session
    mode: a.profile.mode,
    topic: a.profile.topic,
  });
  send(b.ws, {
    type: 'matched',
    sessionId,
    peerId: a.id,
    peer: publicProfile(a),
    leader: false,
    initiator: false,
    mode: a.profile.mode,
    topic: a.profile.topic,
  });
}

function publicProfile(c) {
  const p = c.profile || {};
  return { name: p.name || 'Partner', band: p.band, targetBand: p.targetBand };
}

function endSession(client, notifyPeer) {
  const sid = client.sessionId;
  if (!sid) return;
  const peer = clientById(client.peerId);
  if (peer) {
    peer.sessionId = null; peer.peerId = null;
    if (notifyPeer) send(peer.ws, { type: 'peer-left' });
  }
  sessions.delete(sid);
  client.sessionId = null; client.peerId = null;
}

wss.on('connection', (ws) => {
  const id = 'u' + (nextId++);
  const client = { id, ws, profile: null, peerId: null, sessionId: null, joinedAt: Date.now() };
  clients.set(id, client);

  send(ws, { type: 'registered', id });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    handleMessage(client, msg);
  });

  ws.on('close', () => {
    const qi = queue.indexOf(id);
    if (qi >= 0) queue.splice(qi, 1);
    endSession(client, true);
    clients.delete(id);
  });
});

function handleMessage(client, msg) {
  const ws = client.ws;
  switch (msg.type) {
    case 'register': {
      client.profile = {
        name: String((msg.profile && msg.profile.name) || 'Learner').slice(0, 40),
        band: (msg.profile && msg.profile.band) || '6.0',
        targetBand: (msg.profile && msg.profile.targetBand) || '7.0',
        mode: (msg.profile && msg.profile.mode) || 'full',
        topic: (msg.profile && msg.profile.topic) || 'any',
        block: Array.isArray(msg.profile && msg.profile.block) ? msg.profile.block.slice(0, 500) : [],
      };
      client.joinedAt = Date.now();
      const partner = tryMatch(client);
      if (partner) startSession(partner, client); // waiting user becomes leader (Player A)
      else if (!queue.includes(client.id)) queue.push(client.id);
      send(ws, { type: 'queued' });
      break;
    }
    case 'cancel': {
      const qi = queue.indexOf(client.id);
      if (qi >= 0) queue.splice(qi, 1);
      send(ws, { type: 'cancelled' });
      break;
    }
    case 'signal':
    case 'session':
    case 'rating':
    case 'stats': {
      // Relay to the matched peer
      const peer = clientById(msg.to || client.peerId);
      if (peer) send(peer.ws, { type: msg.type, from: client.id, data: msg.data });
      break;
    }
    case 'leave': {
      endSession(client, true);
      send(ws, { type: 'left' });
      break;
    }
    case 'report': {
      reports.push({
        at: new Date().toISOString(),
        reporter: client.id,
        reported: msg.peerId || client.peerId,
        reason: String(msg.reason || '').slice(0, 200),
      });
      if (reports.length > 1000) reports.shift();
      endSession(client, true);
      send(ws, { type: 'reported' });
      break;
    }
    default:
      break;
  }
}

// Simple health endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true, waiting: queue.length, activeSessions: sessions.size });
});

server.listen(PORT, () => {
  console.log(`BandMate server listening on http://localhost:${PORT}`);
});
