// BandMate IELTS — client: signaling, WebRTC calls, session engine, speech feedback
(function () {
  'use strict';

  /* ================= Store ================= */
  const store = {
    get profile() {
      try { return JSON.parse(localStorage.getItem('bm_profile')) || null; } catch (e) { return null; }
    },
    set profile(p) { localStorage.setItem('bm_profile', JSON.stringify(p)); },
    get history() {
      try { return JSON.parse(localStorage.getItem('bm_history')) || []; } catch (e) { return []; }
    },
    addSession(s) {
      const h = store.history; h.unshift(s);
      localStorage.setItem('bm_history', JSON.stringify(h.slice(0, 100)));
    },
    updateLast(patch) {
      const h = store.history; if (!h.length) return;
      Object.assign(h[0], patch);
      localStorage.setItem('bm_history', JSON.stringify(h));
    },
    streak() {
      const days = [...new Set(store.history.map(s => s.d))].sort().reverse();
      if (!days.length) return 0;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let streak = 0; const d = new Date(today);
      // allow streak to start yesterday if nothing today yet
      if (days[0] !== fmtDate(d)) d.setDate(d.getDate() - 1);
      for (const day of days) {
        if (day === fmtDate(d)) { streak++; d.setDate(d.getDate() - 1); }
        else break;
      }
      return streak;
    },
  };
  function fmtDate(d) { return d.toISOString().slice(0, 10); }
  function todayStr() { return fmtDate(new Date()); }

  /* ================= UI helpers ================= */
  const $ = id => document.getElementById(id);
  const views = ['view-setup', 'view-lobby', 'view-searching', 'view-matched', 'view-call', 'view-review'];
  function show(viewId) {
    views.forEach(v => $(v).classList.toggle('hidden', v !== viewId));
    window.scrollTo(0, 0);
  }
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 3500);
  }
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  /* ================= Setup / lobby ================= */
  function bandOptions(sel, def) {
    for (let b = 4; b <= 8.5; b += 0.5) {
      const o = document.createElement('option');
      o.value = b.toFixed(1); o.textContent = 'Band ' + b.toFixed(1);
      if (b.toFixed(1) === def) o.selected = true;
      sel.appendChild(o);
    }
  }
  bandOptions($('selBand'), '6.0');
  bandOptions($('selTarget'), '7.0');

  function renderLobby() {
    const p = store.profile;
    if (p) {
      $('lobbyHello').textContent = 'Ready to practice, ' + p.name + '?';
      $('selBand').value = p.band; $('selTarget').value = p.targetBand;
    }
    const h = store.history;
    const mins = Math.round(h.reduce((a, s) => a + (s.minutes || 0), 0));
    $('statSessions').textContent = h.length;
    $('statMinutes').textContent = mins;
    $('statStreak').textContent = store.streak();
    $('streakCount').textContent = store.streak();
    $('streakBadge').classList.toggle('hidden', store.streak() === 0);
    const list = $('historyList');
    if (!h.length) { list.innerHTML = '<p class="muted">No sessions yet. Your first partner is waiting!</p>'; return; }
    list.innerHTML = '';
    h.slice(0, 8).forEach(s => {
      const div = document.createElement('div');
      div.className = 'history-item';
      const r = s.clearReceived ? ` · ★${((s.clearReceived + (s.developReceived || 0)) / 2).toFixed(1)}` : '';
      div.innerHTML = `<span>${esc(s.d)} — ${esc(s.partner || 'Partner')}</span><span class="muted">${s.minutes || 0} min${r}</span>`;
      list.appendChild(div);
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function boot() {
    const p = store.profile;
    if (p) { $('inpName').value = p.name || ''; renderLobby(); show('view-lobby'); }
    else show('view-setup');
  }

  $('btnSaveProfile').onclick = () => {
    const name = $('inpName').value.trim() || 'Learner';
    store.profile = {
      name, band: $('selBand').value, targetBand: $('selTarget').value,
      block: (store.profile && store.profile.block) || [],
    };
    renderLobby(); show('view-lobby');
  };
  $('btnEditProfile').onclick = () => { $('inpName').value = store.profile.name || ''; show('view-setup'); };
  const draftProfile = () => store.profile || { name: $('inpName').value.trim() || 'Learner', block: [] };
  $('selBand').onchange = e => { const p = draftProfile(); p.band = e.target.value; store.profile = p; };
  $('selTarget').onchange = e => { const p = draftProfile(); p.targetBand = e.target.value; store.profile = p; };

  /* ================= Signaling ================= */
  let ws = null, myId = null, peerId = null, partner = null;
  let isLeader = false, isInitiator = false, sessionMode = 'full', sessionTopic = 'any';

  function connect() {
    return new Promise((resolve, reject) => {
      if (ws && ws.readyState === WebSocket.OPEN) return resolve();
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(proto + '://' + location.host + '/ws');
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('connection failed'));
      ws.onmessage = onMessage;
      ws.onclose = () => { ws = null; };
    });
  }
  function send(type, extra) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(Object.assign({ type }, extra || {})));
  }

  function onMessage(ev) {
    let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    switch (msg.type) {
      case 'registered': myId = msg.id; break;
      case 'queued': break;
      case 'matched': onMatched(msg); break;
      case 'signal': onSignal(msg.data); break;
      case 'session': onSessionMsg(msg.data); break;
      case 'stats': onPeerStats(msg.data); break;
      case 'rating': onPeerRating(msg.data); break;
      case 'peer-left': onPeerLeft(); break;
      case 'cancelled': break;
      default: break;
    }
  }

  /* ================= Matchmaking ================= */
  $('btnFind').onclick = async () => {
    try {
      await connect();
      show('view-searching');
      const p = store.profile;
      send('register', { profile: { name: p.name, band: p.band, targetBand: p.targetBand, mode: $('selMode').value, topic: $('selTopic').value, block: p.block || [] } });
      const t0 = Date.now();
      const iv = setInterval(() => {
        if ($('view-searching').classList.contains('hidden')) { clearInterval(iv); return; }
        const s = Math.floor((Date.now() - t0) / 1000);
        $('searchStatus').textContent = s < 20
          ? 'Looking for a learner near your level…'
          : 'Broadening the search to more partners…';
      }, 1000);
    } catch (e) { toast('Could not reach the server. Is it running?'); }
  };
  $('btnCancelSearch').onclick = () => { send('cancel'); show('view-lobby'); };

  const MODE_PLAN = {
    full: ['Warm-up (1 min)', 'You: Parts 1–3', 'Partner: Parts 1–3', 'Review'],
    quick: ['Warm-up (1 min)', 'You: Parts 2–3', 'Partner: Parts 2–3', 'Review'],
    part1: ['Warm-up (1 min)', 'You: Part 1', 'Partner: Part 1', 'Review'],
  };

  function onMatched(msg) {
    peerId = msg.peerId; partner = msg.peer;
    isLeader = msg.leader; isInitiator = msg.initiator;
    sessionMode = msg.mode || 'full'; sessionTopic = msg.topic || 'any';
    $('matchName').textContent = 'You matched with ' + partner.name + '!';
    $('matchMeta').textContent = 'Level: Band ' + partner.band + ' · Target: Band ' + (partner.targetBand || '?');
    $('matchPlan').innerHTML = (MODE_PLAN[sessionMode] || MODE_PLAN.full).map(s => '<div>✓ ' + esc(s) + '</div>').join('');
    show('view-matched');
  }
  $('btnSkipPartner').onclick = () => {
    // Skip + block this partner so we are not re-matched
    const p = store.profile; p.block = p.block || [];
    if (peerId && !p.block.includes(peerId)) p.block.push(peerId);
    store.profile = p;
    send('leave'); peerId = null;
    show('view-lobby');
  };

  /* ================= WebRTC ================= */
  let pc = null, localStream = null, pendingIce = [];
  const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  async function startMedia(audioOnly) {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: !audioOnly });
    $('localVideo').srcObject = localStream;
    if (audioOnly) setCameraUI(false);
  }

  async function createPeerConnection() {
    pc = new RTCPeerConnection(rtcConfig);
    pc.onicecandidate = e => { if (e.candidate) send('signal', { to: peerId, data: { ice: e.candidate } }); };
    pc.ontrack = e => {
      $('remoteVideo').srcObject = e.streams[0];
      $('remoteAvatar').classList.add('hidden');
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') toast('Connection failed — a TURN server may be needed on this network.');
    };
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send('signal', { to: peerId, data: { sdp: pc.localDescription } });
    }
  }

  async function onSignal(data) {
    if (!pc) return;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        for (const c of pendingIce) await pc.addIceCandidate(new RTCIceCandidate(c));
        pendingIce = [];
        if (data.sdp.type === 'offer') {
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          send('signal', { to: peerId, data: { sdp: pc.localDescription } });
        }
      } else if (data.ice) {
        if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(data.ice));
        else pendingIce.push(data.ice);
      }
    } catch (e) { console.warn('signal error', e); }
  }

  /* ================= Session engine ================= */
  const STAGE_DEFS = {
    warmup:   { label: 'Warm-up', dur: 60, cand: null },
    part1:    { label: 'Part 1 · Interview', dur: 300, cand: 'C' },
    part2prep:{ label: 'Part 2 · Prepare', dur: 60, cand: 'C' },
    part2:    { label: 'Part 2 · Long turn', dur: 120, cand: 'C' },
    part3:    { label: 'Part 3 · Discussion', dur: 300, cand: 'C' },
  };
  let session = null; // { stages, idx, endsAt, tickIv, startedAt, myWords, peerStats, finished }

  function halfStages(cand) {
    if (sessionMode === 'part1') return [{ key: 'part1', cand }];
    if (sessionMode === 'quick') return [{ key: 'part2prep', cand }, { key: 'part2', cand }, { key: 'part3', cand }];
    return [{ key: 'part1', cand }, { key: 'part2prep', cand }, { key: 'part2', cand }, { key: 'part3', cand }];
  }

  function buildPrompt(key, cand) {
    const P = window.PROMPTS;
    const topicPref = sessionTopic !== 'any' ? sessionTopic : null;
    if (key === 'warmup') {
      const q = pick(P.warmup);
      return { candidateText: 'Icebreaker — take turns:\n' + q, examinerText: 'Take turns answering:\n' + q };
    }
    if (key === 'part1') {
      const topics = Object.keys(P.part1);
      const topic = (topicPref && P.part1[topicPref]) ? topicPref : pick(topics);
      const qs = P.part1[topic];
      const txt = 'Topic: ' + topic + '\n' + qs.map((q, i) => (i + 1) + '. ' + q).join('\n');
      return { candidateText: 'Answer each question in 2–4 sentences:\n' + txt, examinerText: 'Ask these one by one. Follow up naturally:\n' + txt };
    }
    if (key === 'part2prep' || key === 'part2') {
      let cards = P.part2;
      if (topicPref) { const f = cards.filter(c => c.topic === topicPref); if (f.length) cards = f; }
      const card = pick(cards);
      const txt = 'Cue card (' + card.topic + '):\n“' + card.card + '”\n\nYou should say:\n• ' + card.bullets.join('\n• ');
      if (key === 'part2prep') return { candidateText: txt + '\n\n⏳ You have 1 minute to prepare. You may take notes.', examinerText: 'Your partner is preparing. Please stay quiet.', card };
      return { candidateText: txt + '\n\n🎤 Speak for up to 2 minutes.', examinerText: 'Listen and keep time. Do not interrupt.', card };
    }
    if (key === 'part3') {
      const lastCard = session && session.lastCard;
      const topic = (lastCard && lastCard.topic) || topicPref || 'General';
      const qs = P.part3[topic] || P.part3.General;
      const txt = 'Discussion — ' + topic + ':\n' + qs.map((q, i) => (i + 1) + '. ' + q).join('\n');
      return { candidateText: txt + '\n\nDevelop each answer: opinion → reason → example.', examinerText: 'Lead the discussion with these questions:\n' + txt };
    }
    return { candidateText: '', examinerText: '' };
  }

  function leaderBroadcastStage(idx) {
    const def = session.stages[idx];
    const base = STAGE_DEFS[def.key];
    const prompt = buildPrompt(def.key, def.cand);
    if (def.key === 'part2prep' && prompt.card) session.lastCard = prompt.card;
    const stage = {
      idx, key: def.key, label: base.label, dur: base.dur, cand: def.cand,
      prompt, at: Date.now(),
    };
    send('session', { to: peerId, data: { action: 'stage', stage } });
    applyStage(stage);
  }

  function applyStage(stage) {
    stopRec();
    session.idx = stage.idx;
    const myTurn = stage.cand && ((stage.cand === 'A') === isLeader);
    const examiner = stage.cand && !myTurn;

    $('stageKicker').textContent = 'Stage ' + (stage.idx + 1) + ' of ' + session.stages.length;
    $('stageTitle').textContent = stage.label + (stage.cand ? (myTurn ? ' — you answer' : ' — partner answers') : '');
    const pill = $('rolePill');
    if (!stage.cand) { pill.textContent = 'Both speak'; pill.className = 'role-pill neutral'; }
    else if (myTurn) { pill.textContent = '🎤 You are the candidate'; pill.className = 'role-pill'; }
    else { pill.textContent = '📋 You are the examiner'; pill.className = 'role-pill examiner'; }

    $('promptCard').innerHTML = esc(stage.cand ? (myTurn ? stage.prompt.candidateText : stage.prompt.examinerText) : stage.prompt.candidateText)
      .replace(/\n/g, '<br>');
    $('remoteLabel').textContent = partner ? partner.name : 'Partner';

    $('btnNextStage').classList.toggle('hidden', !isLeader);
    $('stageHint').textContent = isLeader ? 'You control the stages.' : 'Your partner advances the stages.';
    $('liveTranscript').classList.add('hidden');
    $('liveTranscript').textContent = '';

    if (myTurn && ['part1', 'part2', 'part3'].includes(stage.key)) startRec();

    session.endsAt = stage.at + stage.dur * 1000;
    clearInterval(session.tickIv);
    session.tickIv = setInterval(tick, 250);
    tick();
  }

  function tick() {
    const remain = Math.max(0, session.endsAt - Date.now());
    const s = Math.ceil(remain / 1000);
    const t = $('timer');
    t.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    t.classList.toggle('low', s <= 30);
    const total = session.stages[session.idx] ? 1 : 1;
    const def = STAGE_DEFS[session.stages[session.idx].key];
    const elapsed = def.dur * 1000 - remain;
    $('progressBar').style.width = Math.min(100, (elapsed / (def.dur * 1000)) * 100) + '%';
    if (remain <= 0) {
      clearInterval(session.tickIv);
      if (isLeader && !session.finished) leaderNext();
    }
  }

  function leaderNext() {
    stopRec();
    if (session.idx + 1 >= session.stages.length) {
      send('session', { to: peerId, data: { action: 'end' } });
      finishSession();
    } else {
      leaderBroadcastStage(session.idx + 1);
    }
  }

  $('btnNextStage').onclick = () => { if (isLeader && !session.finished) leaderNext(); };

  function onSessionMsg(data) {
    if (!session || session.finished) return;
    if (data.action === 'stage') applyStage(data.stage);
    else if (data.action === 'end') finishSession();
  }

  /* ================= Speech recognition + analysis ================= */
  let rec = null, recActive = false;
  let segments = []; // { t, text } final segments with arrival timestamps

  function startRec() {
    segments = [];
    $('liveTranscript').classList.remove('hidden');
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { $('liveTranscript').textContent = 'Live transcription not supported in this browser (Chrome works best).'; return; }
    try {
      rec = new SR();
      rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
      rec.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) segments.push({ t: Date.now(), text: r[0].transcript.trim() });
          else interim += r[0].transcript;
        }
        const finals = segments.map(s => s.text).join(' ');
        $('liveTranscript').textContent = (finals + ' ' + interim).slice(-400) || 'Listening…';
      };
      rec.onerror = () => {};
      rec.onend = () => { if (recActive) { try { rec.start(); } catch (e) {} } };
      recActive = true;
      rec.start();
    } catch (e) { $('liveTranscript').textContent = 'Could not start transcription.'; }
  }
  function stopRec() {
    recActive = false;
    if (rec) { try { rec.onend = null; rec.stop(); } catch (e) {} rec = null; }
  }

  const FILLERS = ['um', 'uh', 'erm', 'ah', 'like', 'you know', 'basically', 'actually', 'well,', 'i mean', 'sort of', 'kind of', 'right?'];
  const STOP = new Set('the,a,an,and,or,but,if,then,so,to,of,in,on,at,for,with,that,this,it,is,are,was,were,be,been,i,you,he,she,we,they,my,your,his,her,our,their,as,by,from,not,no,yes,do,does,did,have,has,had,will,would,can,could,should,very,more,most,also,just,about,into,than,too,up,out,there,here,when,what,which,who,how,why,because,think,people,really'.split(','));

  function analyze() {
    const text = segments.map(s => s.text).join(' ').trim();
    const words = text ? text.toLowerCase().replace(/[^a-z'\s]/g, ' ').split(/\s+/).filter(Boolean) : [];
    const lower = ' ' + words.join(' ') + ' ';
    const fillerCounts = {};
    FILLERS.forEach(f => {
      const re = new RegExp('\\b' + f.replace(/[?]/g, '\\?') + '\\b', 'g');
      const m = lower.match(re);
      if (m) fillerCounts[f] = m.length;
    });
    const fillerTotal = Object.values(fillerCounts).reduce((a, b) => a + b, 0);

    let pauses = 0, longestPause = 0;
    for (let i = 1; i < segments.length; i++) {
      const gap = (segments[i].t - segments[i - 1].t) / 1000;
      if (gap > 2) { pauses++; longestPause = Math.max(longestPause, gap); }
    }
    const speakSec = segments.length > 1 ? (segments[segments.length - 1].t - segments[0].t) / 1000 : 0;
    const wpm = speakSec > 5 ? Math.round(words.length / (speakSec / 60)) : 0;

    const freq = {};
    words.forEach(w => { if (w.length > 3 && !STOP.has(w)) freq[w] = (freq[w] || 0) + 1; });
    const repeated = Object.entries(freq).filter(([, c]) => c > 2).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const uniqueRatio = words.length ? new Set(words).size / words.length : 0;

    const feedback = [];
    if (!words.length) {
      feedback.push('No speech was transcribed during your candidate turns — check mic permission and try Chrome for live transcription.');
    } else {
      if (wpm > 0 && wpm < 110) feedback.push('Pace is a little slow (' + wpm + ' wpm). Aim for 130–160 wpm with natural pauses.');
      else if (wpm > 180) feedback.push('Pace is quite fast (' + wpm + ' wpm). Slow down slightly so the examiner catches every word.');
      else if (wpm > 0) feedback.push('Good natural pace (' + wpm + ' wpm).');
      if (pauses > 6) feedback.push(pauses + " long pauses detected. Try bridging with phrases like \u201cThat is an interesting question\u2026\u201d while you think.");
      else if (pauses > 0) feedback.push(pauses + ' noticeable pause(s) — normal, but keep them under 2 seconds.');
      if (fillerTotal > 8) feedback.push(fillerTotal + ' filler words (' + Object.keys(fillerCounts).slice(0, 3).join(', ') + '). Replace “um” with a silent pause — it sounds more confident.');
      else if (fillerTotal > 0) feedback.push('Only ' + fillerTotal + ' filler words — nicely controlled.');
      if (uniqueRatio > 0 && uniqueRatio < 0.45) feedback.push('Vocabulary repeats a lot — try synonyms and specific examples instead of reusing the same words.');
      else if (uniqueRatio > 0) feedback.push('Good vocabulary variety.');
      repeated.forEach(([w, c]) => feedback.push('You said “' + w + '” ' + c + ' times — find one alternative and practise it.'));
      feedback.push('Next challenge: open each answer with one concrete example in the first 30 seconds.');
    }
    return { words: words.length, wpm, pauses, longestPause: Math.round(longestPause), fillerTotal, fillerCounts, uniqueRatio, repeated, feedback, speakSec: Math.round(speakSec) };
  }

  /* ================= Review ================= */
  let peerStatsReceived = null, ratingSent = { clear: 0, develop: 0 };

  function finishSession() {
    if (!session || session.finished) return;
    session.finished = true;
    clearInterval(session.tickIv);
    stopRec();
    const stats = analyze();
    session.myStats = stats;
    send('stats', { to: peerId, data: { stats, name: store.profile.name } });
    session.startedAt = session.startedAt || Date.now();
    const minutes = Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));
    store.addSession({
      d: todayStr(), partner: partner ? partner.name : 'Partner',
      band: partner ? partner.band : '?', mode: sessionMode,
      minutes, words: stats.words, wpm: stats.wpm, fillers: stats.fillerTotal,
    });
    // Show review once peer stats arrive, or after 4s
    setTimeout(() => { if (!session.reviewShown) { session.reviewShown = true; showReview(); } }, 4000);
  }

  function onPeerStats(data) {
    peerStatsReceived = data;
    if (session && session.finished && !session.reviewShown) { session.reviewShown = true; showReview(); }
  }

  function onPeerRating(data) {
    store.updateLast({ clearReceived: data.clear, developReceived: data.develop, phraseReceived: data.phrase });
    const n = $('partnerRatingNote');
    n.textContent = 'Your partner rated you: clarity ' + data.clear + '/5, idea development ' + data.develop + '/5' +
      (data.phrase ? ' · “' + data.phrase + '”' : '');
    toast('Your partner rated you ⭐');
  }

  function metric(n, l) { return '<div class="metric"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }

  function showReview() {
    const s = session.myStats || {};
    const minutes = store.history[0] ? store.history[0].minutes : 0;
    $('reviewSummary').textContent = 'You practised with ' + (partner ? partner.name : 'your partner') +
      ' for about ' + minutes + ' minutes. Estimates only — not an official IELTS score.';
    let html = '<div class="feedback"><h3>Your speaking analysis (beta)</h3><div class="metric-grid">';
    html += metric(s.words || 0, 'words spoken');
    html += metric(s.wpm || 0, 'words / minute');
    html += metric(s.pauses || 0, 'long pauses');
    html += metric(s.fillerTotal || 0, 'filler words');
    html += '</div>';
    if (peerStatsReceived && peerStatsReceived.stats) {
      const ps = peerStatsReceived.stats;
      html += '<p class="muted small">Partner’s numbers: ' + ps.words + ' words, ' + ps.wpm + ' wpm, ' + ps.fillerTotal + ' fillers.</p>';
    }
    html += '<ul>' + (s.feedback || []).map(f => '<li>' + esc(f) + '</li>').join('') + '</ul></div>';
    $('feedbackBox').innerHTML = html;
    cleanupCall();
    renderLobby();
    show('view-review');
  }

  document.querySelectorAll('.seg').forEach(seg => {
    seg.addEventListener('click', e => {
      if (e.target.tagName !== 'BUTTON') return;
      seg.querySelectorAll('button').forEach(b => b.classList.remove('sel'));
      e.target.classList.add('sel');
      ratingSent[seg.id === 'rateClear' ? 'clear' : 'develop'] = parseInt(e.target.dataset.v, 10);
    });
  });
  $('btnSendRating').onclick = () => {
    if (!ratingSent.clear || !ratingSent.develop) { toast('Please tap a 1–5 score for both questions.'); return; }
    send('rating', { to: peerId, data: { clear: ratingSent.clear, develop: ratingSent.develop, phrase: $('ratePhrase').value.trim() } });
    store.updateLast({ clearGiven: ratingSent.clear, developGiven: ratingSent.develop });
    $('btnSendRating').disabled = true;
    toast('Rating sent — thank you!');
  };
  $('btnNewSession').onclick = () => {
    peerId = null; partner = null; peerStatsReceived = null;
    ratingSent = { clear: 0, develop: 0 };
    $('btnSendRating').disabled = false;
    document.querySelectorAll('.seg button').forEach(b => b.classList.remove('sel'));
    $('ratePhrase').value = ''; $('partnerRatingNote').textContent = '';
    show('view-lobby');
  };

  /* ================= Call controls ================= */
  function setMuteUI(muted) { $('btnMute').classList.toggle('off', muted); $('btnMute').textContent = muted ? '🔇' : '🎤'; }
  function setCameraUI(on) { $('btnCamera').classList.toggle('off', !on); }

  $('btnMute').onclick = () => {
    if (!localStream) return;
    const t = localStream.getAudioTracks()[0];
    if (t) { t.enabled = !t.enabled; setMuteUI(!t.enabled); }
  };
  $('btnCamera').onclick = () => {
    if (!localStream) return;
    const t = localStream.getVideoTracks()[0];
    if (t) { t.enabled = !t.enabled; setCameraUI(t.enabled); }
  };
  $('btnLeave').onclick = () => {
    send('leave');
    if (session && !session.finished) finishSession();
    else { cleanupCall(); show('view-lobby'); }
  };

  $('btnReport').onclick = () => $('reportModal').classList.remove('hidden');
  $('btnReportCancel').onclick = () => $('reportModal').classList.add('hidden');
  document.querySelectorAll('.report-reasons button').forEach(b => {
    b.onclick = () => {
      const reason = b.dataset.r;
      send('report', { peerId, reason });
      const p = store.profile; p.block = p.block || [];
      if (peerId && !p.block.includes(peerId)) p.block.push(peerId);
      store.profile = p;
      $('reportModal').classList.add('hidden');
      toast('Reported. You will never be matched with this person again.');
      if (session && !session.finished) finishSession();
      else { cleanupCall(); show('view-lobby'); }
    };
  });

  function onPeerLeft() {
    toast('Your partner left the session.');
    if (session && !session.finished) finishSession();
    else { cleanupCall(); show('view-lobby'); }
  }

  function cleanupCall() {
    stopRec();
    if (session) { clearInterval(session.tickIv); session = null; }
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    $('remoteVideo').srcObject = null; $('localVideo').srcObject = null;
    $('remoteAvatar').classList.remove('hidden');
    setMuteUI(false); setCameraUI(true);
    send('leave');
  }

  /* ================= Join call ================= */
  $('btnJoinCall').onclick = async () => {
    const audioOnly = $('chkAudioOnly').checked;
    try {
      await startMedia(audioOnly);
    } catch (e) {
      toast('Camera/mic blocked. Please allow access and try again.');
      return;
    }
    show('view-call');
    $('remoteLabel').textContent = partner ? partner.name : 'Partner';
    if (audioOnly) $('remoteAvatar').classList.remove('hidden');
    try { await createPeerConnection(); }
    catch (e) { toast('Could not start the call.'); return; }
    session = { stages: [{ key: 'warmup', cand: null }, ...halfStages('A'), ...halfStages('B')], idx: -1, finished: false, reviewShown: false, startedAt: Date.now(), lastCard: null };
    if (isLeader) {
      $('stageHint').textContent = 'Starting in a moment…';
      setTimeout(() => { if (session && !session.finished && session.idx === -1) leaderBroadcastStage(0); }, 2500);
    } else {
      $('stageTitle').textContent = 'Connecting…';
      $('stageHint').textContent = 'Waiting for your partner to start the session.';
    }
  };

  /* ============ Bridge for the site router (additive; video-call logic above untouched) ============ */
  window.BM = {
    show: show,
    hasProfile: function () { return !!store.profile; },
    busy: function () { return !!(session || peerId); },
    leave: function () {
      if (session) { $('btnLeave').click(); }
      else if (!$('view-searching').classList.contains('hidden')) { $('btnCancelSearch').click(); }
      else if (peerId) { send('leave'); peerId = null; partner = null; show('view-lobby'); }
    }
  };

  boot();
})();
