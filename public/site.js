// SpeakReady — new site experience: router, landing, solo practice, results, learn.
// The legacy partner video-call flow lives in app.js and is NOT modified here
// (except for a small window.BM bridge appended at the end of app.js).
(function () {
  'use strict';

  var BRAND = window.BRAND || 'SpeakReady';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
  var shuffle = function (a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  var mmss = function (s) { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

  /* ============ Brand ============ */
  document.title = BRAND + ' — Speak with confidence. Improve with evidence.';
  if ($('brandWord')) $('brandWord').textContent = BRAND;
  Array.prototype.forEach.call(document.querySelectorAll('[data-brand]'), function (el) { el.textContent = BRAND; });

  /* ============ Storage ============ */
  var S = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  /* ============ Toast (shared #toast element) ============ */
  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 3500);
  }

  /* ============ Criteria content (original plain-language guides) ============ */
  var CRITERIA = [
    { key: 'fluency', name: 'Fluency & Coherence',
      look: 'Speaking smoothly without too many stops and starts, linking ideas clearly, and developing answers fully instead of stopping after one sentence.',
      help: 'Measures your pace, pauses, filler words and answer length on your device — then shows exactly where you hesitated.',
      drill: { mode: 'part1', label: 'Drill Part 1' } },
    { key: 'lexical', name: 'Lexical Resource',
      look: 'Using vocabulary with range and precision — the right word in the right place. Natural beats rare: forced “big words” don’t help.',
      help: 'Tracks word variety and repetition in your transcript and points to the words you overuse.',
      drill: { mode: 'part3', label: 'Drill Part 3' } },
    { key: 'grammar', name: 'Grammatical Range & Accuracy',
      look: 'Mixing sentence types with control — simple and complex sentences — without frequent errors that block meaning.',
      help: 'Grammar needs careful reading, not guessing: we give you a guided self-check on your own transcript instead of a made-up score.',
      drill: { mode: 'part2', label: 'Drill Part 2' } },
    { key: 'pron', name: 'Pronunciation',
      look: 'Being easy to understand: clear sounds, natural word stress and rhythm. Your accent is never the issue — intelligibility is.',
      help: 'We never judge accents. You get a listening self-check on your own recording.',
      drill: { mode: 'part2', label: 'Drill Part 2' } }
  ];

  function criterionCards(mount, withDrills) {
    var html = CRITERIA.map(function (c) {
      return '<div class="criterion"><h3>' + esc(c.name) + '</h3><p>' + esc(c.look) + '</p>' +
        '<p class="small"><strong>How ' + esc(BRAND) + ' helps:</strong> ' + esc(c.help) + '</p>' +
        (withDrills ? '<a href="#/solo?mode=' + c.drill.mode + '">' + esc(c.drill.label) + ' →</a>' : '') +
        '</div>';
    }).join('');
    $(mount).innerHTML = '<div class="criteria-grid">' + html + '</div>';
  }

  /* ============ Router ============ */
  var LEGACY = ['view-setup', 'view-lobby', 'view-searching', 'view-matched', 'view-call', 'view-review'];
  var NEWVIEWS = {
    home: 'view-home', practice: 'view-practice', solo: 'view-solo', mic: 'view-mic',
    room: 'view-room', results: 'view-results', questions: 'view-questions',
    progress: 'view-progress', learn: 'view-learn', pricing: 'view-pricing',
    privacy: 'view-privacy', terms: 'view-terms'
  };
  var lastRoute = null;

  function hideAllViews() {
    Array.prototype.forEach.call(document.querySelectorAll('#app .view'), function (v) { v.classList.add('hidden'); });
  }
  function parseHash() {
    var h = (location.hash || '#/home').replace(/^#\/?/, '');
    var qi = h.indexOf('?');
    return {
      name: (qi === -1 ? h : h.slice(0, qi)) || 'home',
      params: new URLSearchParams(qi === -1 ? '' : h.slice(qi + 1)),
      raw: location.hash || '#/home'
    };
  }
  function navigate() {
    var p = parseHash(), name = p.name, raw = p.raw;
    // Guard: leaving the partner flow while a call/search is live
    if (lastRoute === '#/partner' && raw !== '#/partner' && window.BM && BM.busy()) {
      if (window.confirm && !window.confirm('Leave your current partner session?')) { location.hash = lastRoute; return; }
      BM.leave();
    }
    hideAllViews();
    if (name === 'partner') {
      document.body.dataset.route = 'partner';
      if (!window.BM) { location.hash = '#/home'; return; }
      BM.show(BM.hasProfile() ? 'view-lobby' : 'view-setup');
      window.scrollTo(0, 0);
      lastRoute = '#/partner';
      return;
    }
    var vid = NEWVIEWS[name];
    if (!vid) { if (raw !== '#/home') location.hash = '#/home'; else { showNew('home'); } return; }
    if (name === 'mic' && !soloCfg) { location.hash = '#/solo'; return; }
    if (name === 'room' && !solo) { location.hash = '#/solo'; return; }
    if (name === 'solo' && p.params.get('mode')) {
      var m = p.params.get('mode');
      if (['part1', 'part2', 'part3', 'full'].indexOf(m) !== -1) { soloCfg = { mode: m }; location.hash = '#/mic'; return; }
    }
    if (name === 'results') renderResults(p.params.get('id'));
    if (name === 'questions') renderQuestions();
    if (name === 'progress') renderProgress();
    if (name === 'home') renderHome();
    if (name === 'solo') renderSoloModes();
    if (name === 'mic') resetMicView();
    if (name === 'room') renderRoomStep();
    showNew(name);
    lastRoute = raw;
  }
  function showNew(name) {
    document.body.dataset.route = name;
    $(NEWVIEWS[name]).classList.remove('hidden');
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', navigate);

  // In-page anchor scrolling (e.g. "See how it works") without tripping the router
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-scroll]');
    if (!a) return;
    var t = document.querySelector(a.getAttribute('href'));
    if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); }
  });

  /* ============ Home dynamic bits ============ */
  function renderHome() {
    criterionCards('homeCriteria', true);
    var topics = Object.keys(window.PROMPTS.part1).slice(0, 8);
    $('homeTopics').innerHTML = topics.map(function (t) {
      var n = window.PROMPTS.part1[t].length;
      return '<div class="topic-card"><h3>' + esc(t) + '</h3><p>' + n + ' Part 1 questions</p>' +
        '<a href="#/questions" class="small" style="color:var(--teal-dark);font-weight:700">Practise →</a></div>';
    }).join('');
  }

  /* ============ Solo setup ============ */
  var soloCfg = null; // {mode, seed?}
  var MODES = [
    { mode: 'part1', name: 'Part 1 · Interview', time: '~4 min', desc: 'Answer 3 timed questions about familiar topics — home, work, hobbies and more.' },
    { mode: 'part2', name: 'Part 2 · Long turn', time: '~4 min', desc: 'Get a cue card, take 1 minute to prepare with private notes, then speak for up to 2 minutes.' },
    { mode: 'part3', name: 'Part 3 · Discussion', time: '~4 min', desc: 'Answer 3 discussion questions that ask for opinions, reasons and examples.' },
    { mode: 'full', name: 'Full mock · Parts 1–3', time: '11–14 min', desc: 'The complete test experience in one sitting, with full feedback at the end.' }
  ];
  function renderSoloModes() {
    $('soloModes').innerHTML = MODES.map(function (m, i) {
      return '<div class="path-card"><h3>' + esc(m.name) + '</h3><p>' + esc(m.desc) + '</p>' +
        '<div class="meta">' + esc(m.time) + ' • analysed on your device</div>' +
        '<button class="btn primary" data-mode="' + m.mode + '">Start</button></div>';
    }).join('');
    Array.prototype.forEach.call($('soloModes').querySelectorAll('[data-mode]'), function (b) {
      b.onclick = function () { soloCfg = { mode: b.getAttribute('data-mode') }; location.hash = '#/mic'; };
    });
  }

  /* ============ Question bank ============ */
  var qFilter = { part: 'all', topic: 'all' };
  function allTopics() {
    var s = {}, P = window.PROMPTS;
    Object.keys(P.part1).forEach(function (t) { s[t] = 1; });
    P.part2.forEach(function (c) { s[c.topic] = 1; });
    Object.keys(P.part3).forEach(function (t) { s[t] = 1; });
    return Object.keys(s).sort();
  }
  function qItems() {
    var P = window.PROMPTS, out = [];
    Object.keys(P.part1).forEach(function (t) { P.part1[t].forEach(function (q) { out.push({ part: 1, topic: t, q: q }); }); });
    P.part2.forEach(function (c) { out.push({ part: 2, topic: c.topic, card: c }); });
    Object.keys(P.part3).forEach(function (t) { P.part3[t].forEach(function (q) { out.push({ part: 3, topic: t, q: q }); }); });
    return out.filter(function (it) {
      return (qFilter.part === 'all' || String(it.part) === qFilter.part) &&
             (qFilter.topic === 'all' || it.topic === qFilter.topic);
    });
  }
  function renderQuestions() {
    var topics = ['all'].concat(allTopics());
    $('qTopics').innerHTML = topics.map(function (t) {
      return '<button class="chip" data-t="' + esc(t) + '" aria-pressed="' + (qFilter.topic === t) + '">' + esc(t === 'all' ? 'All topics' : t) + '</button>';
    }).join('');
    Array.prototype.forEach.call($('qTopics').querySelectorAll('.chip'), function (c) {
      c.onclick = function () { qFilter.topic = c.getAttribute('data-t'); renderQuestions(); };
    });
    var items = qItems();
    var html = items.map(function (it, i) {
      var body;
      if (it.part === 2) {
        body = '<p><strong>“' + esc(it.card.card) + '”</strong></p><ul>' +
          it.card.bullets.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>';
      } else {
        body = '<p>' + esc(it.q) + '</p>';
      }
      return '<div class="q-card"><div class="q-part">Part ' + it.part + ' · ' + esc(it.topic) + '</div>' + body +
        '<button class="btn small" data-qi="' + i + '">Practise this question</button></div>';
    }).join('');
    $('qList').innerHTML = '<p class="muted small">' + items.length + ' questions</p>' + (html || '<div class="empty"><p>No questions match these filters.</p></div>');
    var list = items;
    Array.prototype.forEach.call($('qList').querySelectorAll('[data-qi]'), function (b) {
      b.onclick = function () {
        var it = list[+b.getAttribute('data-qi')];
        var seed = it.part === 2 ? { kind: 'p2', card: it.card } : { kind: 'p' + it.part, topic: it.topic, q: it.q };
        soloCfg = { mode: it.part === 1 ? 'part1' : it.part === 2 ? 'part2' : 'part3', seed: seed };
        location.hash = '#/mic';
      };
    });
  }

  /* ============ Progress ============ */
  function fmtDate(d) { return d.toISOString().slice(0, 10); }
  function allDays() {
    var s = {};
    S.get('bm_history', []).forEach(function (x) { if (x.d) s[x.d] = 1; });
    S.get('sr_attempts', []).forEach(function (x) { if (x.d) s[x.d] = 1; });
    return Object.keys(s).sort().reverse();
  }
  function calcStreak() {
    var days = allDays(); if (!days.length) return 0;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var d = new Date(today), streak = 0;
    if (days[0] !== fmtDate(d)) d.setDate(d.getDate() - 1);
    for (var i = 0; i < days.length; i++) {
      if (days[i] === fmtDate(d)) { streak++; d.setDate(d.getDate() - 1); } else break;
    }
    return streak;
  }
  var CRIT_LABEL = { fluency: 'Fluency & Coherence', lexical: 'Lexical Resource' };
  function renderProgress() {
    var attempts = S.get('sr_attempts', []);
    var hist = S.get('bm_history', []);
    var minutes = Math.round(hist.reduce(function (a, s) { return a + (s.minutes || 0); }, 0) +
      attempts.reduce(function (a, s) { return a + (s.minutes || 0); }, 0));
    var body = $('progressBody');
    var html = '<span class="eyebrow">Progress</span><h1>Your practice so far</h1>';
    if (!attempts.length && !hist.length) {
      html += '<div class="empty"><p>Your first answer is the starting point. Practise one question to create your personal plan.</p>' +
        '<a href="#/practice" class="btn primary">Start practising</a></div>';
      body.innerHTML = html; return;
    }
    html += '<div class="stats">' +
      '<div class="stat"><div class="stat-num">' + (hist.length + attempts.length) + '</div><div class="stat-label">sessions</div></div>' +
      '<div class="stat"><div class="stat-num">' + minutes + '</div><div class="stat-label">minutes spoken</div></div>' +
      '<div class="stat"><div class="stat-num">' + calcStreak() + '</div><div class="stat-label">day streak</div></div></div>';

    // Criterion trend (solo attempts, measured criteria only)
    var withCrit = attempts.filter(function (a) { return a.crit && (a.crit.fluency || a.crit.lexical); }).slice(-6);
    if (withCrit.length) {
      html += '<div class="card"><h2 style="margin-top:0">Criterion trend</h2>';
      ['fluency', 'lexical'].forEach(function (k) {
        var vals = withCrit.map(function (a) { return a.crit[k] ? (a.crit[k].low + a.crit[k].high) / 2 : null; }).filter(function (v) { return v != null; });
        if (!vals.length) return;
        var avg = vals.reduce(function (x, y) { return x + y; }, 0) / vals.length;
        var left = ((avg - 4) / 4) * 100;
        html += '<div class="trend-row"><span class="lbl">' + CRIT_LABEL[k] + '</span>' +
          '<div class="trend-bar"><div class="trend-fill" style="left:0;width:' + clamp(left, 2, 100).toFixed(0) + '%"></div></div>' +
          '<span class="muted small">~' + avg.toFixed(1) + '</span></div>';
      });
      // Weakest-area CTA
      var avgs = {};
      ['fluency', 'lexical'].forEach(function (k) {
        var vals = withCrit.map(function (a) { return a.crit[k] ? (a.crit[k].low + a.crit[k].high) / 2 : null; }).filter(function (v) { return v != null; });
        if (vals.length) avgs[k] = vals.reduce(function (x, y) { return x + y; }, 0) / vals.length;
      });
      var keys = Object.keys(avgs);
      if (keys.length) {
        var weak = keys.sort(function (a, b) { return avgs[a] - avgs[b]; })[0];
        var drillMode = weak === 'fluency' ? 'part1' : 'part3';
        html += '<div class="next-action" style="margin-bottom:0"><h3>Your priority</h3><p>' + CRIT_LABEL[weak] +
          ' is your weakest measured area. Practise it next.</p>' +
          '<a href="#/solo?mode=' + drillMode + '" class="btn primary" style="margin-top:12px">Practise ' + CRIT_LABEL[weak] + '</a></div>';
      }
      html += '</div>';
    }

    if (attempts.length) {
      html += '<div class="card"><h2 style="margin-top:0">Solo attempts</h2>';
      attempts.slice().reverse().slice(0, 10).forEach(function (a) {
        var est = a.estLow != null ? a.estLow.toFixed(1) + '–' + a.estHigh.toFixed(1) : '—';
        html += '<div class="history-item"><span>' + esc(a.d) + ' · ' + esc(modeName(a.mode)) + '</span>' +
          '<span class="muted">' + (a.minutes || 0) + ' min · est. ' + est +
          ' <a href="#/results?id=' + a.id + '" style="color:var(--teal-dark);font-weight:700">View</a></span></div>';
      });
      html += '</div>';
    }
    html += '<button class="btn danger-outline" id="btnWipe">Delete all my data</button>' +
      '<p class="muted small">Removes your profile, history, attempts and recordings stored in this browser. This cannot be undone.</p>';
    body.innerHTML = html;
    $('btnWipe').onclick = function () {
      if (!window.confirm('Delete everything stored in this browser — profile, history, attempts, recordings? This cannot be undone.')) return;
      ['bm_profile', 'bm_history', 'sr_attempts', 'sr_reports'].forEach(function (k) { S.del(k); });
      Object.keys(sessionAudio).forEach(function (k) {
        try { if (window.URL && URL.revokeObjectURL) URL.revokeObjectURL(sessionAudio[k]); } catch (e) {}
        delete sessionAudio[k];
      });
      toast('All your data has been deleted.');
      renderProgress();
    };
  }
  function modeName(m) { return { part1: 'Part 1 drill', part2: 'Part 2 drill', part3: 'Part 3 drill', full: 'Full mock' }[m] || m; }

  /* ============ Learn ============ */
  function renderLearn() { criterionCards('learnCriteria', true); }

  /* ============ Pricing ============ */
  function bindPricing() {
    var b = $('btnProNotify');
    if (b) b.onclick = function () { toast("Thanks — we'll announce Pro here when it's ready."); };
  }

  /* ============ Mic check ============ */
  var micStream = null, micRAF = 0, micAnalyser = null, micCtx = null;
  var SR_OK = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  function resetMicView() {
    stopMicMeter();
    $('micMeterWrap').classList.add('hidden');
    $('micError').classList.add('hidden');
    $('btnMicStart').disabled = true;
    $('btnMicEnable').disabled = false;
    $('srNote').className = 'notice' + (SR_OK ? '' : ' warn');
    $('srNote').textContent = SR_OK
      ? 'Live transcription is available in this browser — you will see your words as you speak.'
      : "Transcription isn't supported in this browser — you'll still get timing, recording and pace analysis.";
  }
  function stopMicMeter() {
    cancelAnimationFrame(micRAF);
    if (micCtx) { try { micCtx.close(); } catch (e) {} micCtx = null; }
  }
  function bindMic() {
    $('btnMicEnable').onclick = function () {
      $('micError').classList.add('hidden');
      var constraints = { audio: true };
      var devId = $('selMicDevice') && $('selMicDevice').value;
      if (devId) constraints = { audio: { deviceId: { exact: devId } } };
      navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
        micStream = stream;
        $('btnMicEnable').disabled = true;
        $('micMeterWrap').classList.remove('hidden');
        $('btnMicStart').disabled = false;
        // Device selector
        return navigator.mediaDevices.enumerateDevices().then(function (devs) {
          var ins = devs.filter(function (d) { return d.kind === 'audioinput'; });
          if (ins.length > 1) {
            $('micDeviceWrap').classList.remove('hidden');
            $('selMicDevice').innerHTML = ins.map(function (d, i) {
              return '<option value="' + esc(d.deviceId) + '">' + esc(d.label || 'Microphone ' + (i + 1)) + '</option>';
            }).join('');
          }
        }).catch(function () {});
      }).then(startMicMeter).catch(function (e) {
        var m = $('micError');
        m.textContent = 'Microphone blocked. Allow access in your browser’s site settings, then try again.';
        m.classList.remove('hidden');
      });
    };
    var devSel = $('selMicDevice');
    if (devSel) devSel.onchange = function () {
      if (micStream) micStream.getTracks().forEach(function (t) { t.stop(); });
      stopMicMeter(); resetMicView();
      $('btnMicEnable').click();
    };
    $('btnMicStart').onclick = function () {
      if (!micStream) { toast('Enable the microphone first.'); return; }
      solo = newSolo(soloCfg);
      location.hash = '#/room';
    };
  }
  function startMicMeter() {
    try {
      micCtx = new (window.AudioContext || window.webkitAudioContext)();
      var src = micCtx.createMediaStreamSource(micStream);
      micAnalyser = micCtx.createAnalyser();
      micAnalyser.fftSize = 256;
      src.connect(micAnalyser);
      var bars = $('micMeter').children;
      var data = new Uint8Array(micAnalyser.frequencyBinCount);
      var heard = false;
      (function loop() {
        micRAF = requestAnimationFrame(loop);
        micAnalyser.getByteFrequencyData(data);
        var sum = 0;
        for (var i = 0; i < bars.length; i++) {
          var v = data[Math.floor(i * data.length / bars.length)] / 255;
          sum += v;
          bars[i].style.height = Math.max(6, v * 100) + '%';
        }
        if (!heard && sum / bars.length > 0.04) {
          heard = true;
          $('micStatus').textContent = '✓ Microphone is working — I can see my voice.';
        }
      })();
    } catch (e) {
      $('micStatus').textContent = 'Microphone enabled. (Live level meter unavailable.)';
    }
  }

  /* ============ Solo practice engine ============ */
  var solo = null;

  function newSolo(cfg) {
    return {
      cfg: cfg, steps: buildSteps(cfg), idx: -1,
      stream: micStream, mr: null, chunks: [],
      audioURL: null, recT0: 0, recActive: false,
      sr: null, segments: [], // {t, text} t = seconds since recT0
      tickIv: 0, meterRAF: 0, analyser: null, actx: null,
      stepT0: 0, stepEndsAt: 0, stepState: 'idle',
      results: []
    };
  }

  function buildSteps(cfg) {
    var P = window.PROMPTS, steps = [], mode = cfg.mode, seed = cfg.seed;
    var p1qs = function () {
      if (seed && seed.kind === 'p1') return [{ topic: seed.topic, q: seed.q }];
      var ts = Object.keys(P.part1), t = pick(ts);
      return shuffle(P.part1[t]).slice(0, 3).map(function (q) { return { topic: t, q: q }; });
    };
    var p2card = function () { return (seed && seed.kind === 'p2') ? seed.card : pick(P.part2); };
    var p3qs = function () {
      if (seed && seed.kind === 'p3') return [{ topic: seed.topic, q: seed.q }];
      var ts = Object.keys(P.part3), t = pick(ts);
      return shuffle(P.part3[t]).slice(0, 3).map(function (q) { return { topic: t, q: q }; });
    };
    if (mode === 'part1' || mode === 'full') p1qs().forEach(function (o) {
      steps.push({ kind: 'answer', part: 1, topic: o.topic, question: o.q, targetSec: 35, maxSec: 60 });
    });
    if (mode === 'part2' || mode === 'full') {
      var c = p2card();
      steps.push({ kind: 'prep', part: 2, card: c, prepSec: 60 });
      steps.push({ kind: 'record', part: 2, card: c, targetSec: 90, maxSec: 120 });
    }
    if (mode === 'part3' || mode === 'full') p3qs().forEach(function (o) {
      steps.push({ kind: 'answer', part: 3, topic: o.topic, question: o.q, targetSec: 45, maxSec: 75 });
    });
    return steps;
  }

  function stopSoloMedia() {
    if (!solo) return;
    clearInterval(solo.tickIv);
    cancelAnimationFrame(solo.meterRAF);
    try { if (solo.sr) { solo.sr.onend = null; solo.sr.stop(); } } catch (e) {}
    solo.sr = null;
    try { if (solo.mr && solo.mr.state !== 'inactive') solo.mr.stop(); } catch (e) {}
    if (solo.actx) { try { solo.actx.close(); } catch (e) {} solo.actx = null; }
  }
  function endSolo() {
    stopSoloMedia();
    if (solo && solo.stream) { solo.stream.getTracks().forEach(function (t) { t.stop(); }); }
    micStream = null;
    solo = null;
  }

  function bindRoom() {
    $('btnRoomExit').onclick = function () {
      if (!window.confirm('Exit this practice session? Your progress in this session will be lost.')) return;
      endSolo();
      location.hash = '#/practice';
    };
    $('btnRoomHelp').onclick = function () {
      toast('Answer naturally under the timer. Your recording and transcript stay on this device.');
    };
  }

  function renderRoomStep() {
    if (!solo) { location.hash = '#/solo'; return; }
    if (solo.idx === -1) nextStep();
    else paintStep();
  }

  function nextStep() {
    solo.idx++;
    if (solo.idx >= solo.steps.length) { finishSolo(); return; }
    var st = solo.steps[solo.idx];
    st.segments = [];
    solo.stepState = st.kind === 'prep' ? 'prep' : 'ready';
    solo.stepT0 = Date.now();
    paintStep();
  }

  function partLabel(st) {
    return 'Part ' + st.part + ' of 3 · Step ' + (solo.idx + 1) + ' of ' + solo.steps.length;
  }

  function paintStep() {
    var st = solo.steps[solo.idx];
    $('roomStage').textContent = partLabel(st);
    var body = $('roomBody'), act = $('roomActions');
    clearInterval(solo.tickIv);

    if (solo.stepState === 'ready') {
      // Answer step, pre-recording
      body.innerHTML =
        '<span class="eyebrow">' + (st.part === 1 ? 'Part 1 · Interview' : st.part === 3 ? 'Part 3 · Discussion' : 'Speaking') + '</span>' +
        '<p class="room-q">' + esc(st.question) + '</p>' +
        '<div class="notice">Aim for about ' + st.targetSec + ' seconds. Speak naturally. Aim to develop your ideas, not to use memorised language.</div>';
      act.innerHTML = '<button class="btn primary big" id="btnBegin">🎤 Begin speaking</button>';
      $('roomTimer').textContent = mmss(st.targetSec);
      $('roomTimer').classList.remove('low');
      $('btnBegin').onclick = function () {
        solo.stepState = 'recording';
        solo.stepT0 = Date.now();
        beginRecording();
      };
    } else if (solo.stepState === 'prep') {
      // Part 2 preparation
      body.innerHTML =
        '<span class="eyebrow">Part 2 · Prepare</span>' +
        '<div class="cuecard"><div class="cue-k">Cue card · ' + esc(st.card.topic) + '</div>' +
        '<p class="big">“' + esc(st.card.card) + '”</p>' +
        '<p class="small muted">You should say:</p><ul>' +
        st.card.bullets.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul></div>' +
        '<div class="prep-wrap"><div class="ring-wrap">' +
        '<svg class="ring" width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">' +
        '<circle class="bg" cx="48" cy="48" r="42" fill="none" stroke-width="10"/>' +
        '<circle class="fg" id="prepRing" cx="48" cy="48" r="42" fill="none" stroke-width="10" stroke-dasharray="264" stroke-dashoffset="0"/>' +
        '</svg>' +
        '<div><div class="room-timer" id="prepTimer" role="timer">01:00</div><div class="small muted">Preparation</div></div>' +
        '</div>' +
        '<div><label>Your notes <span class="muted small">(private — only you see these)</span>' +
        '<textarea id="prepNotes" placeholder="Jot down ideas…"></textarea></label></div></div>' +
        '<p class="small" style="margin-top:12px">You have one minute to make notes. Your notes are private.</p>';
      act.innerHTML = '<button class="btn primary big" id="btnPrepGo">🎤 Start speaking</button>';
      var remain = st.prepSec;
      solo.stepEndsAt = Date.now() + remain * 1000;
      var ring = $('prepRing');
      solo.tickIv = setInterval(function () {
        remain = Math.max(0, Math.round((solo.stepEndsAt - Date.now()) / 1000));
        $('prepTimer').textContent = mmss(remain);
        if (ring) ring.setAttribute('stroke-dashoffset', String(264 * (1 - remain / st.prepSec)));
        if (remain <= 0) { clearInterval(solo.tickIv); advanceFromPrep(); }
      }, 250);
      $('btnPrepGo').onclick = function () { clearInterval(solo.tickIv); advanceFromPrep(); };
    } else if (solo.stepState === 'recording') {
      paintRecording(st);
    }
  }

  function advanceFromPrep() {
    // move from prep step to its record step
    solo.idx++;
    var st = solo.steps[solo.idx];
    st.segments = [];
    solo.stepState = 'recording';
    solo.stepT0 = Date.now();
    beginRecording();
  }

  function ensureSessionRecorder() {
    // One MediaRecorder for the whole session => one audio file, one timeline.
    if (solo.recActive) return;
    try {
      var mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      solo.mr = new MediaRecorder(solo.stream, mime ? { mimeType: mime } : undefined);
    } catch (e) { solo.mr = new MediaRecorder(solo.stream); }
    solo.chunks = [];
    solo.mr.ondataavailable = function (e) { if (e.data && e.data.size) solo.chunks.push(e.data); };
    solo.recT0 = Date.now();
    solo.mr.start(250);
    solo.recActive = true;
  }

  function ensureSpeechRecognition() {
    if (solo.sr || !SR_OK) return;
    try {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      var r = new SR();
      r.lang = 'en-US'; r.continuous = true; r.interimResults = true;
      r.onresult = function (e) {
        for (var i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            var seg = { t: (Date.now() - solo.recT0) / 1000, text: e.results[i][0].transcript.trim() };
            solo.segments.push(seg);
            var st = solo.steps[solo.idx];
            if (st && solo.stepState === 'recording') { st.segments = st.segments || []; st.segments.push(seg); }
          }
        }
      };
      r.onerror = function () {};
      r.onend = function () { if (solo && solo.recActive) { try { r.start(); } catch (e) {} } };
      solo.sr = r;
      r.start();
    } catch (e) { solo.sr = null; }
  }

  function beginRecording() {
    // Begins (or resumes) capture for the current step, which must already be
    // the recording step with stepState === 'recording'.
    if (!solo.stream) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        solo.stream = s; startCapture(); paintRecording(solo.steps[solo.idx]);
      }).catch(function () { toast('Microphone blocked — cannot record.'); });
      return;
    }
    startCapture();
    paintRecording(solo.steps[solo.idx]);
  }

  function startCapture() {
    ensureSessionRecorder();
    ensureSpeechRecognition();
    startRoomMeter();
  }

  function startRoomMeter() {
    try {
      if (!solo.actx) {
        solo.actx = new (window.AudioContext || window.webkitAudioContext)();
        var src = solo.actx.createMediaStreamSource(solo.stream);
        solo.analyser = solo.actx.createAnalyser();
        solo.analyser.fftSize = 256;
        src.connect(solo.analyser);
      }
      var bars = document.querySelectorAll('#roomMeter i');
      var data = new Uint8Array(solo.analyser.frequencyBinCount);
      cancelAnimationFrame(solo.meterRAF);
      (function loop() {
        if (!solo) return;
        solo.meterRAF = requestAnimationFrame(loop);
        solo.analyser.getByteFrequencyData(data);
        for (var i = 0; i < bars.length; i++) {
          var v = data[Math.floor(i * data.length / bars.length)] / 255;
          bars[i].style.height = Math.max(6, v * 100) + '%';
        }
      })();
    } catch (e) {}
  }

  function paintRecording(st) {
    var isPart2 = st.kind === 'record';
    var q = isPart2 ? '“' + st.card.card + '”' : st.question;
    var kicker = st.part === 1 ? 'Part 1 · Interview' : st.part === 2 ? 'Part 2 · Long turn' : 'Part 3 · Discussion';
    $('roomBody').innerHTML =
      '<span class="eyebrow">' + kicker + '</span>' +
      '<p class="room-q">' + esc(q) + '</p>' +
      (isPart2 ? '<div class="cuecard"><div class="cue-k">Your cue card</div><ul>' +
        st.card.bullets.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<div class="rec-live" role="status" aria-live="polite"><span class="rec-dot" aria-hidden="true"></span> Recording</div>' +
      '<div class="meter" id="roomMeter" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
      '<div class="notice">Speak naturally. Aim to develop your ideas, not to use memorised language.</div>' +
      (!SR_OK ? '<div class="notice warn">Transcription isn’t supported in this browser — timing and recording analysis still work.</div>' : '');
    $('roomActions').innerHTML = '<button class="btn primary big" id="btnStopStep">⏹ Stop &amp; review</button>';
    $('btnStopStep').onclick = stopStep;
    var timer = $('roomTimer');
    clearInterval(solo.tickIv);
    solo.stepEndsAt = Date.now() + st.maxSec * 1000;
    solo.tickIv = setInterval(function () {
      var el = Math.floor((Date.now() - solo.stepT0) / 1000);
      var left = Math.max(0, Math.round((solo.stepEndsAt - Date.now()) / 1000));
      timer.textContent = mmss(el);
      timer.classList.toggle('low', left <= 10);
      if (left <= 0) stopStep();
    }, 250);
  }

  function stopStep() {
    clearInterval(solo.tickIv);
    var st = solo.steps[solo.idx];
    st.durationSec = Math.max(1, Math.round((Date.now() - solo.stepT0) / 1000));
    st.offset = (solo.stepT0 - solo.recT0) / 1000;
    nextStep();
  }

  function finishSolo() {
    stopSoloMedia();
    var attempt = analyzeSolo(solo);
    // Finalize the single session recording
    var done = function () {
      try {
        var blob = new Blob(solo.chunks, { type: (solo.mr && solo.mr.mimeType) || 'audio/webm' });
        if (blob.size > 0) sessionAudio[attempt.id] = URL.createObjectURL(blob);
      } catch (e) {}
      delete attempt._m; // transient metrics, never persisted
      var arr = S.get('sr_attempts', []);
      arr.push(attempt);
      S.set('sr_attempts', arr.slice(-100));
      var id = attempt.id;
      endSolo();
      location.hash = '#/results?id=' + id;
    };
    if (solo.mr && solo.mr.state !== 'inactive') {
      var to = setTimeout(done, 1500);
      try {
        solo.mr.onstop = function () { clearTimeout(to); done(); };
        solo.mr.stop();
      } catch (e) { clearTimeout(to); done(); }
    } else { done(); }
  }



  function analyzeSolo(s) {
    var steps = s.steps.filter(function (st) { return st.kind !== 'prep'; });
    var m = SRAnalysis.computeMetrics(steps);
    var sc = SRAnalysis.scoreAll(m, SR_OK);
    var att = {
      id: 'sr' + Date.now(), d: fmtDate(new Date()), ts: Date.now(),
      mode: s.cfg.mode, minutes: Math.max(1, Math.round(m.totalDur / 60)),
      totalSec: Math.round(m.totalDur),
      words: m.words, wpm: m.wpm, pauses: m.pauses,
      fillerTotal: m.fillerTotal, uniqueRatio: Math.round(m.uniqueRatio * 100) / 100,
      steps: steps.map(function (st) {
        return { part: st.part, topic: st.topic || (st.card && st.card.topic) || '', question: st.question || (st.card && st.card.card) || '', durationSec: st.durationSec || 0, targetSec: st.targetSec || 0, segments: (st.segments || []).map(function (g) { return { t: Math.round(g.t * 10) / 10, text: g.text }; }) };
      })
    };
    if (sc.noEstimate) { att.noEstimate = true; att.conf = 'low'; }
    else {
      att.estLow = sc.low; att.estHigh = sc.high; att.conf = sc.conf;
      att.crit = { fluency: sc.fluR, lexical: sc.lexR };
      att.fb = SRAnalysis.buildFeedback(m, sc, steps);
    }
    att._m = m; // transient, stripped before save
    return att;
  }

  // In-memory registry of session audio (blob URLs die on reload — never trust stored ones)
  var sessionAudio = {};
  function audioURLFor(att) { return sessionAudio[att.id] || null; }

  function recomputeFromTranscript(att) {
    var m = SRAnalysis.computeMetrics(att.steps);
    var sc = SRAnalysis.scoreAll(m, SR_OK);
    att.words = m.words; att.wpm = m.wpm; att.pauses = m.pauses;
    att.fillerTotal = m.fillerTotal; att.uniqueRatio = Math.round(m.uniqueRatio * 100) / 100;
    if (sc.noEstimate) { att.noEstimate = true; delete att.estLow; delete att.estHigh; delete att.fb; delete att.crit; }
    else {
      att.noEstimate = false; att.estLow = sc.low; att.estHigh = sc.high; att.conf = sc.conf;
      att.crit = { fluency: sc.fluR, lexical: sc.lexR };
      att.fb = SRAnalysis.buildFeedback(m, sc, att.steps);
    }
    var arr = S.get('sr_attempts', []);
    for (var i = 0; i < arr.length; i++) if (arr[i].id === att.id) { arr[i] = att; break; }
    var clean = JSON.parse(JSON.stringify(arr));
    clean.forEach(function (a) { delete a._m; });
    S.set('sr_attempts', clean);
  }

  /* ============ Results page ============ */
  var resultsAtt = null, editingTranscript = false;

  function renderResults(id) {
    var attempts = S.get('sr_attempts', []);
    resultsAtt = id ? attempts.filter(function (a) { return a.id === id; })[0] : attempts[attempts.length - 1];
    editingTranscript = false;
    var body = $('resultsBody');
    if (!resultsAtt) {
      body.innerHTML = '<div class="empty"><p>Your first answer is the starting point. Practise one question to create your personal plan.</p>' +
        '<a href="#/practice" class="btn primary">Start practising</a></div>';
      return;
    }
    paintResults();
  }

  function evHtml(ev) {
    return ev.map(function (e) {
      return '<div class="evidence">' + (e.t != null ? '<span class="t">' + mmss(e.t) + '</span> ' : '') + esc(e.text) + '</div>';
    }).join('');
  }

  function fbCard(title, rangeText, fb, retryMode, retryLabel, unmeasuredNote) {
    var h = '<div class="fb-card"><h3>' + esc(title) + '</h3>';
    h += rangeText ? '<div class="rng">Practice estimate: ' + rangeText + '</div>' : '<div class="rng" style="color:var(--gold)">Not scored on-device</div>';
    if (unmeasuredNote) {
      h += '<div class="unmeasured">' + unmeasuredNote + '</div>';
    } else {
      h += '<h4>What worked</h4><p>' + esc(fb.worked) + '</p>';
      h += '<h4>Evidence from your answer</h4>' + evHtml(fb.evidence);
      h += '<h4>Highest-impact change</h4><p><strong>' + esc(fb.change) + '</strong></p>';
    }
    h += '<button class="btn small" data-retry="' + retryMode + '">' + esc(retryLabel) + '</button></div>';
    return h;
  }

  function paintResults() {
    var a = resultsAtt, body = $('resultsBody');
    var audioURL = audioURLFor(a);
    var h = '<span class="eyebrow">Results</span><h1>Your practice report</h1>' +
      '<p class="muted small">' + esc(a.d) + ' · ' + esc(modeName(a.mode)) + ' · ' + (a.minutes || 0) + ' min speaking</p>';

    if (a.noEstimate) {
      h += '<div class="card"><h2>Not enough speech to estimate</h2>' +
        '<p class="muted">We need at least ~25 words and 15 seconds of speech for a meaningful estimate. ' +
        (SR_OK ? 'Speak a little longer next time.' : 'Transcription isn’t supported in this browser, so we couldn’t analyse your words — timing and recording still work.') + '</p>' +
        '<button class="btn primary" data-retry="' + a.mode + '">Try again</button></div>';
    } else {
      h += '<div class="result-hero"><div class="est-range">Your practice estimate: ' + a.estLow.toFixed(1) + '–' + a.estHigh.toFixed(1) + '</div>' +
        '<div><span class="conf-pill">' + esc(a.conf) + ' confidence</span></div></div>';
      h += '<div class="disclaimer">This is a practice estimate based on this recording. It is not an official IELTS result, and only a qualified IELTS examiner can award an official band score.</div>';
      h += '<div class="next-action"><h3>Best next action</h3><p>' + esc(a.fb.nextAction) + '</p></div>';

      var weakMode = a.fb.weak === 'lexical' ? 'part3' : 'part1';
      h += '<div class="fb-grid">';
      h += fbCard('Fluency & Coherence', a.crit.fluency ? a.crit.fluency.low.toFixed(1) + '–' + a.crit.fluency.high.toFixed(1) : null, a.fb.flu, weakMode, 'Practise my priority →');
      h += fbCard('Lexical Resource', a.crit.lexical ? a.crit.lexical.low.toFixed(1) + '–' + a.crit.lexical.high.toFixed(1) : null, a.fb.lex, weakMode, 'Practise my priority →');
      h += fbCard('Grammatical Range & Accuracy', null, null, 'part2', 'Drill Part 2 →',
        'We can’t assess grammar reliably from audio on this device — and we won’t guess. <strong>Self-check:</strong> read your transcript below, pick one sentence, and ask: past, present or future? Fix the verb if needed, then re-record the answer.');
      h += fbCard('Pronunciation', null, null, 'part2', 'Drill Part 2 →',
        'We never judge accents — intelligibility is what matters, and that needs human ears. <strong>Self-check:</strong> play your recording. Could a stranger understand every word? Note any word you mumble and say it three times slowly.');
      h += '</div>';
    }

    // Metrics
    h += '<div class="card"><h2 style="margin-top:0">What we measured</h2><div class="metric-grid">' +
      '<div class="metric"><div class="n">' + a.words + '</div><div class="l">words spoken</div></div>' +
      '<div class="metric"><div class="n">' + a.wpm + '</div><div class="l">words / minute</div></div>' +
      '<div class="metric"><div class="n">' + a.pauses + '</div><div class="l">long pauses</div></div>' +
      '<div class="metric"><div class="n">' + a.fillerTotal + '</div><div class="l">filler words</div></div></div>' +
      '<p class="muted small">Measured on your device from the recording and transcript. Nothing was uploaded.</p></div>';

    // Transcript
    h += '<div class="card"><h2 style="margin-top:0">Transcript</h2>';
    if (a.recordingDeleted) {
      h += '<p class="muted">Recording and transcript deleted.</p>';
    } else {
      var allSegs = [];
      a.steps.forEach(function (st) { (st.segments || []).forEach(function (g) { allSegs.push(g); }); });
      if (!allSegs.length) {
        h += '<p class="muted">' + (SR_OK ? 'No speech was transcribed — check the microphone and try again.' : 'Transcription isn’t supported in this browser.') + '</p>';
      } else if (editingTranscript) {
        h += '<textarea id="transEdit" style="min-height:200px">' + esc(allSegs.map(function (g) { return g.text; }).join('\n')) + '</textarea>' +
          '<div class="row"><button class="btn primary" id="btnTransSave">Save &amp; re-analyse</button>' +
          '<button class="btn ghost" id="btnTransCancel">Cancel</button></div>' +
          '<p class="muted small">Timings are kept from the original recording; word counts and feedback refresh.</p>';
      } else {
        if (audioURL) h += '<p class="muted small">Tap a line to hear that moment in your recording.</p>';
        h += '<div class="seg-list">' + allSegs.map(function (g, i) {
          return '<button class="seg-btn" data-seg="' + i + '"><span class="t">' + mmss(g.t) + '</span>' + esc(g.text) + '</button>';
        }).join('') + '</div>';
        h += '<button class="btn small" id="btnTransEdit">Edit transcript</button>';
      }
    }
    h += '</div>';

    // Recording management
    h += '<div class="card"><h2 style="margin-top:0">Recording</h2>';
    if (audioURL && !a.recordingDeleted) {
      h += '<audio controls src="' + audioURL + '" style="width:100%"></audio>' +
        '<div class="row"><a class="btn" id="btnAudioDl" href="' + audioURL + '" download="speakready-practice.webm">Download</a>' +
        '<button class="btn danger-outline" id="btnAudioDel">Delete recording permanently</button></div>' +
        '<p class="muted small">This removes the audio and associated transcript from your account. This cannot be undone.</p>';
    } else {
      h += '<p class="muted small">' + (a.recordingDeleted ? 'Recording deleted.' : 'The audio file is only available right after practice, in this browser session.') + '</p>';
    }
    h += '</div>';

    // Actions
    h += '<div class="row"><button class="btn primary big" data-retry="' + a.mode + '">↻ Retry this drill</button>' +
      '<a href="#/progress" class="btn big">View progress</a></div>';

    // Report feedback problem
    h += '<div class="report-box"><details><summary style="cursor:pointer;font-weight:700;min-height:44px;display:flex;align-items:center">Report a feedback problem</summary>' +
      '<div style="margin-top:8px"><label>What went wrong?' +
      '<select id="repReason"><option>Bad transcript</option><option>Wrong interpretation</option><option>Unclear advice</option><option>Felt unfair or biased</option><option>Other</option></select></label>' +
      '<label>Details (optional)<input type="text" id="repNote" maxlength="300" placeholder="What should we know?"></label>' +
      '<button class="btn" id="btnRepSend">Send report</button></div></details></div>';

    body.innerHTML = h;
    bindResults(audioURL);
  }

  function bindResults(audioURL) {
    var a = resultsAtt;
    Array.prototype.forEach.call($('resultsBody').querySelectorAll('[data-retry]'), function (b) {
      b.onclick = function () { soloCfg = { mode: b.getAttribute('data-retry') }; location.hash = '#/mic'; };
    });
    Array.prototype.forEach.call($('resultsBody').querySelectorAll('[data-seg]'), function (b) {
      b.onclick = function () {
        var aud = $('resultsBody').querySelector('audio');
        if (!aud) return;
        var allSegs = [];
        a.steps.forEach(function (st) { (st.segments || []).forEach(function (g) { allSegs.push(g); }); });
        var g = allSegs[+b.getAttribute('data-seg')];
        if (g) { try { aud.currentTime = Math.max(0, g.t - 0.3); aud.play(); } catch (e) {} }
      };
    });
    var be = $('btnTransEdit');
    if (be) be.onclick = function () { editingTranscript = true; paintResults(); };
    var bc = $('btnTransCancel');
    if (bc) bc.onclick = function () { editingTranscript = false; paintResults(); };
    var bs = $('btnTransSave');
    if (bs) bs.onclick = function () {
      var lines = $('transEdit').value.split('\n');
      var allSegs = [];
      a.steps.forEach(function (st) { (st.segments || []).forEach(function (g) { allSegs.push(g); }); });
      for (var i = 0; i < allSegs.length && i < lines.length; i++) {
        if (lines[i].trim()) allSegs[i].text = lines[i].trim();
      }
      recomputeFromTranscript(a);
      editingTranscript = false;
      paintResults();
      toast('Transcript updated — analysis refreshed.');
    };
    var bd = $('btnAudioDel');
    if (bd) bd.onclick = function () {
      if (!window.confirm('Delete recording permanently?\n\nThis removes the audio and associated transcript from this browser. This cannot be undone.')) return;
      var url = sessionAudio[a.id];
      delete sessionAudio[a.id];
      try { if (url && window.URL && URL.revokeObjectURL) URL.revokeObjectURL(url); } catch (e) {}
      a.steps.forEach(function (st) { st.segments = []; });
      a.recordingDeleted = true; a.words = 0;
      var arr = S.get('sr_attempts', []);
      for (var i = 0; i < arr.length; i++) if (arr[i].id === a.id) { arr[i] = a; break; }
      var clean = JSON.parse(JSON.stringify(arr)); clean.forEach(function (x) { delete x._m; });
      S.set('sr_attempts', clean);
      paintResults();
      toast('Recording deleted.');
    };
    var br = $('btnRepSend');
    if (br) br.onclick = function () {
      var reps = S.get('sr_reports', []);
      reps.push({ attemptId: a.id, reason: $('repReason').value, note: $('repNote').value.trim(), ts: Date.now() });
      S.set('sr_reports', reps.slice(-100));
      toast('Thanks — your report was saved for review.');
    };
  }

  /* ============ Boot ============ */
  renderHome();
  renderLearn();
  bindMic();
  bindRoom();
  bindPricing();
  $('qPart').onchange = function () { qFilter.part = this.value; renderQuestions(); };
  navigate();
})();
