/* Evidence-check engine (idea 3 "BlindSpot") + action-planner logic (idea 1).
 * Pure functions over window.DASHBOARD_DATA; no DOM access, so it can be unit-tested in Node.
 */
(function (root) {
  'use strict';

  const STAGES = [
    { id: 'detection', label: 'Detection', hint: 'Screening participation' },
    { id: 'followup', label: 'Follow-up', hint: 'Screen-positive → diagnostic test' },
    { id: 'referral', label: 'Referral', hint: 'Primary → specialist care' },
    { id: 'diagnosis', label: 'Diagnosis & records', hint: 'Recording completeness' },
    { id: 'treatment', label: 'Treatment', hint: 'Lung cancer treatment mix' },
    { id: 'outcome', label: 'Outcome', hint: 'Survival & mortality' },
  ];

  const VERDICTS = {
    act: { label: 'Review action', rank: 0, desc: 'Review signal with fewer heuristic flags; local validation is required.' },
    datagap: { label: 'Data gap', rank: 1, desc: 'The finding is a recording gap; fix the data before judging care.' },
    verify: { label: 'Verify first', rank: 2, desc: 'Comparator lies outside the county interval, with evidence limitations. Audit before acting.' },
    variation: { label: 'Unexplained variation', rank: 3, desc: 'Differs from national, but higher is not clearly better or worse.' },
    watch: { label: 'Watch', rank: 4, desc: 'Adverse direction; county interval includes the comparator.' },
    ok: { label: 'In line', rank: 5, desc: 'County interval includes the comparator; this does not establish equivalence.' },
    better: { label: 'Learning signal', rank: 6, desc: 'Favourable direction outside the county interval; explore recording and case mix before peer learning.' },
    context: { label: 'Context', rank: 7, desc: 'Context indicator.' },
    nodata: { label: 'No data', rank: 8, desc: 'Not reported for this area.' },
  };

  // Related indicators used for the corroboration check.
  const RELATED = {
    lung_curative: ['surv_lung_male', 'surv_lung_female'],
    lung_symptomatic: ['surv_lung_male', 'surv_lung_female'],
    lung_lifeprolong: ['surv_lung_male', 'surv_lung_female'],
    surv_lung_male: ['lung_curative', 'mort_lung_male', 'surv_lung_female'],
    surv_lung_female: ['lung_curative', 'mort_lung_female', 'surv_lung_male'],
    mort_lung_male: ['surv_lung_male'], mort_lung_female: ['surv_lung_female'],
    surv_breast_female: ['scr_breast_att', 'mort_breast_female'], mort_breast_female: ['surv_breast_female', 'scr_breast_att'],
    surv_colorectal_both: ['scr_crc_att', 'scr_crc_colo', 'mort_colorectal_both'],
    mort_colorectal_both: ['surv_colorectal_both', 'scr_crc_colo'],
    surv_prostate_male: ['mort_prostate_male'], mort_prostate_male: ['surv_prostate_male'],
    scr_breast_att: ['surv_breast_female'], scr_cervix_att: ['scr_cervix_colpo'],
    scr_crc_att: ['scr_crc_colo', 'surv_colorectal_both'], scr_crc_colo: ['scr_crc_att', 'surv_colorectal_both'],
    scr_cervix_colpo: ['scr_cervix_att'],
  };

  const LUNG_TREAT = ['lung_curative', 'lung_lifeprolong', 'lung_symptomatic'];

  function create(D) {
    const IND = Object.fromEntries(D.indicators.map((i) => [i.id, i]));
    const REG = Object.fromEntries(D.regions.map((r) => [r.code, r]));
    const cache = new Map();

    const latest = (id) => IND[id].periods[IND[id].periods.length - 1];
    const get = (id, period, code) => ((D.values[id] || {})[period] || {})[code];

    function fmt(v, unit, digits) {
      if (v == null || isNaN(v)) return '–';
      if (unit === '' || unit === undefined) return Math.round(v).toLocaleString('en-GB');
      const d = digits != null ? digits : Math.abs(v) >= 100 ? 0 : 1;
      return v.toFixed(d) + (unit === '%' ? ' %' : unit ? ' ' + unit : '');
    }

    function side(id, period, code) {
      // -1 worse, +1 better, 0 similar (CI overlaps national), null no data
      const ind = IND[id], x = get(id, period, code), n = get(id, period, 'SSS');
      if (!x || !n) return null;
      const distinct = x.lo != null ? x.lo > n.v || x.hi < n.v : false;
      if (!distinct) return 0;
      if (!ind.polarity) return 2;
      return Math.sign(x.v - n.v) * ind.polarity;
    }

    function assess(id, code, period) {
      period = period || latest(id);
      const key = id + '|' + code + '|' + period;
      if (cache.has(key)) return cache.get(key);
      const ind = IND[id], x = get(id, period, code), nat = get(id, period, 'SSS');
      const r = { id, code, period, ind, x, nat, checks: [], verdict: 'nodata', score: null };
      cache.set(key, r);
      if (!x) return r;
      if (!nat) { r.verdict = 'context'; return r; }

      r.diff = x.v - nat.v;
      const se = x.lo != null ? (x.hi - x.lo) / 3.92 : null;
      r.z = se ? r.diff / se : 0;
      r.distinct = x.lo != null && (x.lo > nat.v || x.hi < nat.v);
      r.dir = !ind.polarity ? (r.diff > 0 ? 'higher' : 'lower') : Math.sign(r.diff) * ind.polarity < 0 ? 'worse' : 'better';
      if (ind.kind === 'context') { r.verdict = 'context'; return r; }
      const pct = ind.unit === '%';
      const C = (cid, label, status, detail) => r.checks.push({ id: cid, label, status, detail });

      // 1. Precision of the estimate
      if (x.lo == null) C('precision', 'Precise estimate', 'warn', 'No confidence interval published.');
      else {
        const hw = (x.hi - x.lo) / 2, rel = hw / Math.max(Math.abs(x.v), 1e-9);
        const ok = pct ? hw <= 5 : rel <= 0.15, meh = pct ? hw <= 10 : rel <= 0.3;
        const where = x.d ? `n = ${x.d.toLocaleString('en-GB')}` : x.n ? `${x.n.toLocaleString('en-GB')} cases` : '';
        C('precision', 'Precise estimate', ok ? 'pass' : meh ? 'warn' : 'fail',
          `95 % CI ${fmt(x.lo, ind.unit)} – ${fmt(x.hi, ind.unit)} (±${pct ? hw.toFixed(1) + ' pp' : Math.round(rel * 100) + ' %'})${where ? ', ' + where : ''}.`);
      }

      // 2. Beyond chance vs national
      C('chance', 'Comparator outside interval', x.lo == null ? 'na' : r.distinct ? 'pass' : 'warn',
        x.lo == null ? 'No interval available; comparison not assessed.' : r.distinct ? `Comparator ${fmt(nat.v, ind.unit)} lies outside the county's 95 % CI.`
          : `Comparator ${fmt(nat.v, ind.unit)} lies inside the county's 95 % CI.`);

      // 3. Persistence over time
      if (ind.periods.length > 1) {
        const history = ind.periods.filter((p) => p <= period);
        const sides = history.map((p) => side(id, p, code)).filter((s) => s !== null);
        const sameDir = sides.filter((s) => s !== 0 && s === Math.sign(r.diff) * (ind.polarity || 1)).length;
        const need = Math.min(3, sides.length);
        const status = sides.length < 2 ? 'na' : sameDir >= need ? 'pass' : sameDir >= 2 ? 'warn' : 'fail';
        C('persist', 'Persistent over time', status,
          sides.length < 2 ? 'Fewer than two annual observations through the selected period; persistence not assessed.' : `Comparator outside interval in the same direction in ${sameDir} of ${sides.length} years (${history[0]}–${history[history.length - 1]}).`);
      } else {
        C('persist', 'Persistent over time', 'na', `Only one pooled period (${period}); persistence cannot be assessed.`);
      }

      // 4. Recording completeness
      if (LUNG_TREAT.includes(id)) {
        const m = get('lung_noinfo', '2019–2023', code), mn = get('lung_noinfo', '2019–2023', 'SSS');
        const st = !m ? 'warn' : m.v <= mn.v ? 'pass' : m.v <= mn.v + 5 ? 'warn' : 'fail';
        C('complete', 'Records complete enough', st,
          m ? `${fmt(m.v, '%')} of patients have no treatment record (pooled reporting counties ${fmt(mn.v, '%')}).` : 'Completeness not reported.');
      } else if (id === 'lung_mdt') {
        C('complete', 'Records complete enough', x.v < 2 ? 'fail' : x.v < 10 ? 'warn' : 'pass',
          x.v < 2 ? `Only ${fmt(x.v, '%')} carry an MDT code: recording and actual practice cannot be distinguished.` : `${fmt(x.v, '%')} carry an MDT code.`);
      } else if (id === 'scr_crc_colo' || id === 'scr_cervix_colpo') {
        C('complete', 'Records complete enough', 'warn',
          'Diagnostic tests done outside the programme or registered late may be absent from programme records.');
      } else if (ind.kind === 'outcome') {
        C('complete', 'Records complete enough', 'pass', 'Population-based Finnish Cancer Registry data.');
      } else if (ind.kind === 'data_quality') {
        C('complete', 'Records complete enough', 'na', 'This indicator measures completeness itself.');
      } else {
        C('complete', 'Records complete enough', 'pass', 'Programme register with an invitation-based denominator.');
      }

      // 5. Case-mix adjustment
      if (ind.kind === 'outcome') C('casemix', 'Case-mix adjustment', 'warn', 'Age-standardised, but stage, comorbidity and other clinical differences remain. Mortality also reflects incidence; differences cannot be attributed to care.');
      else if (id.startsWith('lung_') && ind.kind !== 'data_quality')
        C('casemix', 'Case-mix adjustment', 'fail', 'Not adjusted for stage, age or comorbidity; 47.7 % of lung cancers lack stage nationally.');
      else if (ind.kind === 'data_quality') C('casemix', 'Case-mix adjustment', 'na', 'Not applicable to a recording measure.');
      else C('casemix', 'Case-mix adjustment', 'warn', 'Defined programme age band; population and language mix are not adjusted.');

      // 6. Corroboration by a related indicator
      const rel = RELATED[id] || [];
      if (!rel.length || ind.kind === 'data_quality') C('corrob', 'Corroborated elsewhere', 'na', 'No related indicator defined.');
      else {
        const want = !ind.polarity ? null : r.dir;
        const hits = rel.map((rid) => {
          const rp = IND[rid].periods.filter(p => p <= period).pop();
          const rx = rp && get(rid, rp, code), rn = rp && get(rid, rp, 'SSS');
          const dir = rx && rn && IND[rid].polarity ? ((rx.v-rn.v)*IND[rid].polarity < 0 ? 'worse' : 'better') : null;
          return {rid, a:{x:rx, dir, distinct:rx && rn && rx.lo != null && (rx.lo > rn.v || rx.hi < rn.v)}};
        }).filter(h => h.a.x && h.a.dir === want && want !== null);
        const strong = hits.filter((h) => h.a.distinct);
        C('corrob', 'Corroborated elsewhere', strong.length ? 'pass' : hits.length ? 'warn' : 'fail',
          strong.length ? `Also ${want} outside the county interval: ${strong.map((h) => IND[h.rid].short).join(', ')}.`
            : hits.length ? `Points the same way (comparator within interval): ${hits.map((h) => IND[h.rid].short).join(', ')}.`
              : `No related indicator points the same way (${rel.map((q) => IND[q].short).join(', ')}).`);
      }

      const scored = r.checks.filter((c) => c.status !== 'na');
      r.score = Math.round((100 * scored.reduce((a, c) => a + (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0)) / scored.length);
      const quality = r.checks.filter((c) => ['precision', 'complete', 'casemix', 'persist'].includes(c.id));
      const fails = quality.filter((c) => c.status === 'fail').length, warns = quality.filter((c) => c.status === 'warn').length;
      r.failed = r.checks.filter((c) => c.status === 'fail' && c.id !== 'chance').map((c) => c.label);

      if (!ind.polarity) r.verdict = r.distinct ? 'variation' : 'ok';
      else if (!r.distinct) r.verdict = r.dir === 'worse' ? 'watch' : 'ok';
      else if (r.dir === 'better') r.verdict = 'better';
      else if (ind.kind === 'data_quality') r.verdict = 'datagap';
      else r.verdict = fails === 0 && warns <= 1 ? 'act' : 'verify';
      return r;
    }

    function findings(code) {
      return D.indicators.filter((i) => i.kind !== 'context').map((i) => assess(i.id, code))
        .sort((a, b) => VERDICTS[a.verdict].rank - VERDICTS[b.verdict].rank || Math.abs(b.z || 0) - Math.abs(a.z || 0));
    }

    function stageStatus(code) {
      const F = findings(code);
      return STAGES.map((s) => {
        if (s.id === 'referral') return { ...s, verdict: 'blind', items: [] };
        const items = F.filter((f) => f.ind.stage === s.id);
        const live = items.filter((f) => f.verdict !== 'nodata');
        const v = live.length ? live[0].verdict : 'nodata';
        return { ...s, verdict: v, items };
      });
    }

    // Action cards: group actionable findings by playbook, ordered by best finding.
    function actions(code) {
      const F = findings(code).filter((f) => ['act', 'datagap', 'verify', 'variation'].includes(f.verdict));
      const cards = [];
      for (const pb of D.playbooks) {
        const hit = F.filter((f) => pb.triggers.includes(f.id));
        if (hit.length) cards.push({ pb, findings: hit, verdict: hit[0].verdict, rank: VERDICTS[hit[0].verdict].rank, z: Math.abs(hit[0].z || 0) });
      }
      cards.sort((a, b) => a.rank - b.rank || b.z - a.z);
      return cards;
    }

    // Peers: nearest counties on population context (z-scored).
    function peers(code, k) {
      const feats = ['ctx_65', 'ctx_rural', 'ctx_density', 'ctx_foreign', 'ctx_swedish'];
      const codes = D.regions.filter((r) => r.mainland).map((r) => r.code);
      const vec = (c) => feats.map((f) => { const x = get(f, latest(f), c); return x ? (f === 'ctx_density' ? Math.log(Math.max(x.v, 0.001)) : x.v) : null; });
      const completeCodes = codes.filter(c => vec(c).every(v => v !== null));
      if (!completeCodes.includes(code)) return [];
      const all = completeCodes.map(vec), dims = feats.length;
      const mu = [...Array(dims)].map((_, j) => all.reduce((a, v) => a + v[j], 0) / all.length);
      const sd = [...Array(dims)].map((_, j) => Math.sqrt(all.reduce((a, v) => a + (v[j] - mu[j]) ** 2, 0) / all.length) || 1);
      const me = vec(code).map((v, j) => (v - mu[j]) / sd[j]);
      return completeCodes.filter((c) => c !== code).map((c) => {
        const v = vec(c).map((x, j) => (x - mu[j]) / sd[j]);
        return { code: c, dist: Math.sqrt(v.reduce((a, x, j) => a + (x - me[j]) ** 2, 0)) };
      }).sort((a, b) => a.dist - b.dist).slice(0, k || 3);
    }

    function bestPeer(id, code) {
      const ind = IND[id];
      if (!ind.polarity) return null;
      const P = peers(code, 4).map((p) => assess(id, p.code)).filter((a) => a.x);
      P.sort((a, b) => (b.x.v - a.x.v) * ind.polarity);
      const me = assess(id, code);
      return P.length && me.x && (P[0].x.v - me.x.v) * ind.polarity > 0 ? P[0] : null;
    }

    return { IND, REG, STAGES, VERDICTS, latest, get, fmt, assess, findings, stageStatus, actions, peers, bestPeer };
  }

  root.CareEngine = { create, STAGES, VERDICTS };
  if (typeof module !== 'undefined') module.exports = root.CareEngine;
})(typeof window !== 'undefined' ? window : globalThis);
