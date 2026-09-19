// BandMate IELTS — signaling + matchmaking as a Cloudflare Durable Object.
// A single global instance ("bandmate-global") holds all lobby/session state.
// Uses the WebSocket Hibernation API so connections survive isolate eviction.

function publicProfile(c) {
  const p = c.profile || {};
  return { name: p.name || 'Partner', band: p.band, targetBand: p.targetBand };
}

function bandOf(p) {
  const b = parseFloat(p && p.band);
  return isNaN(b) ? 6 : b;
}

export class BandMateHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sockets = new Map(); // id -> live server WebSocket
    this.clients = new Map(); // id -> { id, profile, peerId, sessionId, joinedAt }
    this.queue = [];          // ids waiting for a partner
    this.sessions = new Map();// sessionId -> { a, b, startedAt }
    this.reports = [];
    this.nextId = 1;

    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const data = await this.ctx.storage.get(['queue', 'sessions', 'reports', 'nextId', 'clients']);
      if (Array.isArray(data.get('queue'))) this.queue = data.get('queue');
      const s = data.get('sessions');
      if (Array.isArray(s)) this.sessions = new Map(s);
      if (Array.isArray(data.get('reports'))) this.reports = data.get('reports');
      if (typeof data.get('nextId') === 'number') this.nextId = data.get('nextId');
      const c = data.get('clients');
      if (Array.isArray(c)) this.clients = new Map(c);
      // Drop stale entries left over from a previous isolate lifetime.
      this.queue = this.queue.filter((id) => this.clients.has(id));
      for (const [sid, sess] of this.sessions) {
        if (!this.clients.has(sess.a) || !this.clients.has(sess.b)) this.sessions.delete(sid);
      }
    });
  }

  async persist() {
    await this.ctx.storage.put({
      queue: this.queue,
      sessions: [...this.sessions],
      reports: this.reports,
      nextId: this.nextId,
      clients: [...this.clients],
    });
  }

  send(id, obj) {
    const ws = this.sockets.get(id);
    if (!ws) return;
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) { /* socket dead; cleanup happens on close */ }
  }

  clientById(id) { return this.clients.get(id); }

  blockedEither(a, b) {
    const pa = a.profile || {}, pb = b.profile || {};
    return (pa.block || []).includes(b.id) || (pb.block || []).includes(a.id);
  }

  tryMatch(client) {
    // Prefer a partner within ~1 band; broaden to anyone after 20s waiting.
    const waitingLong = Date.now() - client.joinedAt > 20000;
    for (let i = 0; i < this.queue.length; i++) {
      const other = this.clientById(this.queue[i]);
      if (!other || other.id === client.id) continue;
      if (this.blockedEither(client, other)) continue;
      const diff = Math.abs(bandOf(client.profile) - bandOf(other.profile));
      if (!waitingLong && diff > 1.5) continue;
      this.queue.splice(i, 1);
      return other;
    }
    return null;
  }

  startSession(a, b) {
    // a = the user who was waiting (becomes session leader / Player A)
    const sessionId = 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    this.sessions.set(sessionId, { a: a.id, b: b.id, startedAt: Date.now() });
    a.sessionId = sessionId; a.peerId = b.id;
    b.sessionId = sessionId; b.peerId = a.id;

    this.send(a.id, {
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
    this.send(b.id, {
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

  endSession(client, notifyPeer) {
    const sid = client.sessionId;
    if (!sid) return;
    const peer = this.clientById(client.peerId);
    if (peer) {
      peer.sessionId = null; peer.peerId = null;
      if (notifyPeer) this.send(peer.id, { type: 'peer-left' });
    }
    this.sessions.delete(sid);
    client.sessionId = null; client.peerId = null;
  }

  async handleMessage(client, msg) {
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
        const partner = this.tryMatch(client);
        if (partner) this.startSession(partner, client); // waiting user becomes leader (Player A)
        else if (!this.queue.includes(client.id)) this.queue.push(client.id);
        this.send(client.id, { type: 'queued' });
        await this.persist();
        break;
      }
      case 'cancel': {
        const qi = this.queue.indexOf(client.id);
        if (qi >= 0) this.queue.splice(qi, 1);
        this.send(client.id, { type: 'cancelled' });
        await this.persist();
        break;
      }
      case 'signal':
      case 'session':
      case 'rating':
      case 'stats': {
        // Relay to the matched peer
        const peer = this.clientById(msg.to || client.peerId);
        if (peer) this.send(peer.id, { type: msg.type, from: client.id, data: msg.data });
        break;
      }
      case 'leave': {
        this.endSession(client, true);
        this.send(client.id, { type: 'left' });
        await this.persist();
        break;
      }
      case 'report': {
        this.reports.push({
          at: new Date().toISOString(),
          reporter: client.id,
          reported: msg.peerId || client.peerId,
          reason: String(msg.reason || '').slice(0, 200),
        });
        if (this.reports.length > 1000) this.reports.shift();
        this.endSession(client, true);
        this.send(client.id, { type: 'reported' });
        await this.persist();
        break;
      }
      default:
        break;
    }
  }

  async handleDisconnect(id) {
    await this.ready;
    const client = this.clients.get(id);
    this.sockets.delete(id);
    if (!client) return;
    const qi = this.queue.indexOf(id);
    if (qi >= 0) this.queue.splice(qi, 1);
    this.endSession(client, true);
    this.clients.delete(id);
    await this.persist();
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, waiting: this.queue.length, activeSessions: this.sessions.size });
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const pair = new WebSocketPair();
      const [clientSocket, serverSocket] = Object.values(pair);
      const id = 'u' + (this.nextId++);
      this.ctx.acceptWebSocket(serverSocket);
      serverSocket.serializeAttachment({ id });
      this.clients.set(id, { id, profile: null, peerId: null, sessionId: null, joinedAt: Date.now() });
      this.sockets.set(id, serverSocket);
      this.send(id, { type: 'registered', id });
      await this.persist();
      return new Response(null, { status: 101, webSocket: clientSocket });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws, message) {
    await this.ready;
    let att = null;
    try { att = ws.deserializeAttachment(); } catch (e) { return; }
    const client = att && this.clients.get(att.id);
    if (!client) return;
    this.sockets.set(client.id, ws);
    let msg;
    try { msg = JSON.parse(message); } catch (e) { return; }
    await this.handleMessage(client, msg);
  }

  async webSocketClose(ws, code, reason, wasClean) {
    let att = null;
    try { att = ws.deserializeAttachment(); } catch (e) { /* ignore */ }
    if (att && att.id) await this.handleDisconnect(att.id);
  }

  async webSocketError(ws, error) {
    let att = null;
    try { att = ws.deserializeAttachment(); } catch (e) { /* ignore */ }
    if (att && att.id) await this.handleDisconnect(att.id);
  }
}
