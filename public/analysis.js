// SpeakReady — on-device speech analysis engine.
// Pure deterministic functions: no DOM, no network, no AI. Unit-testable.
var SRAnalysis = (function () {
'use strict';
function mmss(s) { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
/* ============ On-device analysis (deterministic — no AI, no uploads) ============ */
var FILLERS = ['um', 'uh', 'erm', 'ah', 'like', 'you know', 'basically', 'actually', 'well', 'i mean', 'sort of', 'kind of'];
var STOPW = {};
'the,a,an,and,or,but,if,then,so,to,of,in,on,at,for,with,that,this,it,is,are,was,were,be,been,i,you,he,she,we,they,my,your,his,her,our,their,as,by,from,not,no,yes,do,does,did,have,has,had,will,would,can,could,should,very,more,most,also,just,about,into,than,too,up,out,there,here,when,what,which,who,how,why,because,think,people,really'.split(',').forEach(function (w) { STOPW[w] = 1; });

function wordsOf(text) {
  return String(text || '').toLowerCase().replace(/[^a-z'\s]/g, ' ').split(/\s+/).filter(Boolean);
}
function countFillers(words) {
  var lower = ' ' + words.join(' ') + ' ', counts = {}, total = 0;
  FILLERS.forEach(function (f) {
    var m = lower.match(new RegExp('\\b' + f.replace(/\?/g, '\\?') + '\\b', 'g'));
    if (m) { counts[f] = m.length; total += m.length; }
  });
  return { counts: counts, total: total };
}

// metrics: ONLY from real measurements (durations, transcript words, timings)
function computeMetrics(steps) {
  var words = [], pauses = 0, totalDur = 0, targetSum = 0, completeN = 0, recSteps = 0, wpms = [];
  steps.forEach(function (st) {
    if (st.kind === 'prep') return;
    recSteps++;
    totalDur += st.durationSec || 0;
    targetSum += st.targetSec || 0;
    if ((st.durationSec || 0) >= (st.targetSec || 0) * 0.7) completeN++;
    var segs = st.segments || [];
    var w = wordsOf(segs.map(function (s) { return s.text; }).join(' '));
    st._words = w.length;
    words = words.concat(w);
    if (w.length >= 5 && (st.durationSec || 0) >= 5) wpms.push(w.length / ((st.durationSec || 1) / 60));
    for (var i = 1; i < segs.length; i++) { if (segs[i].t - segs[i - 1].t > 2.5) pauses++; }
  });
  var fillers = countFillers(words);
  var freq = {};
  words.forEach(function (w) { if (w.length > 3 && !STOPW[w]) freq[w] = (freq[w] || 0) + 1; });
  var repeats = Object.keys(freq).map(function (w) { return [w, freq[w]]; })
    .filter(function (e) { return e[1] > 2; })
    .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5);
  return {
    words: words.length,
    wpm: wpms.length ? Math.round(wpms.reduce(function (a, b) { return a + b; }, 0) / wpms.length) : 0,
    pauses: pauses,
    fillerTotal: fillers.total, fillerCounts: fillers.counts,
    uniqueRatio: words.length ? new Set(words).size / words.length : 0,
    repeats: repeats,
    totalDur: totalDur, completeness: recSteps ? completeN / recSteps : 0,
    hasTranscript: words.length > 0
  };
}

function scoreFluency(m) {
  var s = 6.0;
  if (m.wpm >= 120 && m.wpm <= 170) s += 0.5;
  else if (m.wpm > 0 && m.wpm < 95) s -= 0.75;
  else if (m.wpm > 185) s -= 0.5;
  if (m.pauses <= 2) s += 0.25; else if (m.pauses > 6) s -= 0.75;
  if (m.fillerTotal <= 3) s += 0.25; else if (m.fillerTotal > 9) s -= 0.5;
  if (m.completeness >= 0.8) s += 0.5; else if (m.completeness < 0.4) s -= 0.5;
  return clamp(Math.round(s * 4) / 4, 4, 8);
}
function scoreLexical(m) {
  if (m.words < 40) return null; // not enough evidence — say so, don't guess
  var s = 6.0;
  if (m.uniqueRatio >= 0.55) s += 0.5; else if (m.uniqueRatio < 0.45) s -= 0.5;
  if (m.repeats.length && m.repeats[0][1] > 4) s -= 0.25;
  if (m.words > 200) s += 0.25;
  return clamp(Math.round(s * 4) / 4, 4, 8);
}
function toRange(s) { var lo = Math.floor(s * 2) / 2; return { low: lo, high: Math.round((lo + 0.5) * 10) / 10 }; }

function scoreAll(m, srOK) {
  if (!m.hasTranscript || m.words < 25 || m.totalDur < 15) return { noEstimate: true };
  var flu = scoreFluency(m), lex = scoreLexical(m);
  var subs = [flu, lex].filter(function (v) { return v != null; });
  if (!subs.length) return { noEstimate: true };
  var overall = subs.reduce(function (a, b) { return a + b; }, 0) / subs.length;
  var range = toRange(overall);
  var conf = (srOK && m.words >= 150) ? 'high' : (srOK && m.words >= 40) ? 'medium' : 'low';
  return {
    noEstimate: false, flu: flu, lex: lex,
    fluR: toRange(flu), lexR: lex == null ? null : toRange(lex),
    low: range.low, high: range.high, conf: conf
  };
}

function findSegWith(steps, word) {
  for (var i = 0; i < steps.length; i++) {
    var segs = steps[i].segments || [];
    for (var j = 0; j < segs.length; j++) {
      if ((' ' + segs[j].text.toLowerCase() + ' ').indexOf(' ' + word + ' ') !== -1) return segs[j];
    }
  }
  return null;
}

function buildFeedback(m, sc, steps) {
  // Fluency
  var fluWorked, fluChange, fluEv = [];
  if (m.wpm >= 120 && m.wpm <= 170) fluWorked = 'Steady, natural pace of ' + m.wpm + ' words per minute.';
  else if (m.pauses <= 2 && m.fillerTotal <= 3) fluWorked = 'Very few hesitations — ' + m.fillerTotal + ' filler words and ' + m.pauses + ' long pauses in total.';
  else if (m.completeness >= 0.8) fluWorked = 'You developed your answers well instead of stopping early.';
  else fluWorked = 'You kept speaking for ' + mmss(m.totalDur) + ' in total — every minute builds fluency.';
  if (m.fillerTotal > 0) {
    var topF = Object.keys(m.fillerCounts).sort(function (a, b) { return m.fillerCounts[b] - m.fillerCounts[a]; })[0];
    var seg = findSegWith(steps, topF);
    if (seg) fluEv.push({ t: seg.t, text: '“' + seg.text.slice(0, 110) + '”' });
    fluEv.push({ t: null, text: m.fillerTotal + ' filler words in total (' + Object.keys(m.fillerCounts).slice(0, 3).join(', ') + ').' });
  }
  if (m.pauses > 0) fluEv.push({ t: null, text: m.pauses + ' pauses longer than 2.5 seconds detected in your transcript.' });
  if (!fluEv.length) fluEv.push({ t: null, text: 'Pace and pausing stayed steady across your answers.' });
  if (m.pauses > 4) fluChange = 'Bridge thinking time with words: say “That’s an interesting question…” instead of going silent.';
  else if (m.fillerTotal > 6) fluChange = 'Swap “um / uh” for a short silent pause — it sounds more confident.';
  else if (m.wpm > 0 && m.wpm < 110) fluChange = 'Push your pace toward 130–160 words per minute — slightly quicker delivery of the same ideas.';
  else if (m.wpm > 180) fluChange = 'Slow down a touch so every word lands — aim for 130–160 words per minute.';
  else if (m.completeness < 0.7) fluChange = 'Develop each answer before you stop: opinion → reason → example.';
  else fluChange = 'Stretch your Part 2 answers past 90 seconds — fluency grows with sustained speech.';

  // Lexical
  var lexWorked, lexChange, lexEv = [];
  if (m.uniqueRatio >= 0.5) lexWorked = Math.round(m.uniqueRatio * 100) + '% of your words were unique — good variety.';
  else if (m.words > 150) lexWorked = m.words + ' words of speech — a solid sample of your vocabulary.';
  else lexWorked = 'You produced ' + m.words + ' words to work with.';
  if (m.repeats.length) {
    var r = m.repeats[0], rseg = findSegWith(steps, r[0]);
    lexEv.push({ t: rseg ? rseg.t : null, text: 'You said “' + r[0] + '” ' + r[1] + ' times' + (rseg ? ' — e.g. at ' + mmss(rseg.t) + ': “' + rseg.text.slice(0, 90) + '”' : '.') });
  } else lexEv.push({ t: null, text: 'No single word dominated your answers.' });
  if (m.repeats.length && m.repeats[0][1] > 3) lexChange = 'You said “' + m.repeats[0][0] + '” ' + m.repeats[0][1] + ' times — learn one synonym and retry the same question using it.';
  else if (m.uniqueRatio < 0.45) lexChange = 'Vary your vocabulary: replace repeated everyday words with more precise ones.';
  else lexChange = 'Add one precise detail per answer (a name, a number, a specific example) to sharpen precision.';

  var weak = 'fluency', nextAction = fluChange;
  if (sc.lex != null && sc.flu != null && sc.lex < sc.flu) { weak = 'lexical'; nextAction = lexChange; }
  return {
    flu: { worked: fluWorked, evidence: fluEv, change: fluChange },
    lex: { worked: lexWorked, evidence: lexEv, change: lexChange },
    weak: weak, nextAction: nextAction
  };
}
return { wordsOf: wordsOf, countFillers: countFillers, computeMetrics: computeMetrics, scoreFluency: scoreFluency, scoreLexical: scoreLexical, toRange: toRange, scoreAll: scoreAll, findSegWith: findSegWith, buildFeedback: buildFeedback };
})();
if (typeof window !== 'undefined') window.SRAnalysis = SRAnalysis;
if (typeof module !== 'undefined' && module.exports) module.exports = SRAnalysis;
