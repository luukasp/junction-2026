#!/usr/bin/env python3
"""Evidence-check engine for the cancer pathway snapshot.

Pure functions over an in-memory dataset (no file I/O), so the logic can be unit-tested.
Ported from the former static dashboard (dashboard/engine.js) with these changes:

* Comparators are leave-one-out ("rest of Finland") wherever counts are published:
  (national n − county n) / (national d − county d). Rates without counts
  (age-standardised survival, mortality) fall back to the published national value.
* Lung treatment indicators are no longer automatically down-graded by a case-mix
  "fail": a significantly low curative share is routed to "verify" only when the
  county's no-treatment-record share is above its comparator; otherwise it is an
  "act" signal (likely treatment-access or late-detection gap).
* Verdicts are collapsed to five: act, verify, monitor, ok, nodata.
* The referral stage is populated with clearly labelled proxies.

Dataset shape expected by :class:`Engine`:
    indicators: list of indicator dicts (id, stage, unit, polarity (+1/-1/0), kind, periods, value_type, ...)
    values:     {indicator_id: {period: {area_code: {v, lo, hi, n, d, ...}}}}; national row uses code 'SSS'
    context:    {area_code: {feature: value}} for demographic peer matching
"""
import math

NATIONAL = 'SSS'

STAGES = [
    dict(id='detection', label='Detection', hint='Screening participation (who is found early)'),
    dict(id='followup', label='Follow-up', hint='Screen result resolved and recorded'),
    dict(id='referral', label='Referral', hint='Hand-off to specialist diagnostics; proxies only, no national referral-delay series exists'),
    dict(id='diagnosis', label='Diagnosis & records', hint='Treatment, stage and MDT recording completeness'),
    dict(id='treatment', label='Treatment', hint='Recorded lung cancer treatment mix within 12 months'),
    dict(id='outcome', label='Outcome', hint='Five-year relative survival and mortality'),
]
STAGE_ORDER = [s['id'] for s in STAGES]

VERDICTS = {
    'act': dict(label='Act', rank=0,
                desc='Adverse and outside the county 95% interval versus the rest of Finland, with no major data-quality flag. '
                     'Start the linked playbook; local clinical validation is still required.'),
    'verify': dict(label='Verify data', rank=1,
                   desc='Adverse signal outside the interval, but recording completeness or other quality checks could explain it. '
                        'Audit the records before changing care.'),
    'monitor': dict(label='Monitor', rank=2,
                    desc='Adverse direction but the comparator lies inside the county interval, or a clear difference where '
                         'higher or lower is not inherently better. Re-check with the next data release.'),
    'ok': dict(label='In line', rank=3,
               desc='Comparator inside the county interval, or better than the rest of Finland. This does not establish equivalence.'),
    'nodata': dict(label='No data', rank=4, desc='Not published for this area.'),
}

POLARITY_TEXT = {1: 'higher_better', -1: 'lower_better', 0: 'neutral'}

# Related indicators used for the corroboration check.
RELATED = {
    'lung_curative': ['surv_lung_male', 'surv_lung_female', 'mort_lung_male', 'mort_lung_female'],
    'lung_cur_ratio': ['lung_curative', 'surv_lung_male', 'surv_lung_female'],
    'surv_lung_male': ['lung_curative', 'mort_lung_male', 'surv_lung_female'],
    'surv_lung_female': ['lung_curative', 'mort_lung_female', 'surv_lung_male'],
    'mort_lung_male': ['surv_lung_male', 'lung_curative'], 'mort_lung_female': ['surv_lung_female', 'lung_curative'],
    'surv_breast_female': ['scr_breast_att', 'mort_breast_female'], 'mort_breast_female': ['surv_breast_female', 'scr_breast_att'],
    'surv_colorectal_both': ['scr_crc_att', 'scr_crc_colo', 'mort_colorectal_both'],
    'mort_colorectal_both': ['surv_colorectal_both', 'scr_crc_colo'],
    'surv_prostate_male': ['mort_prostate_male'], 'mort_prostate_male': ['surv_prostate_male'],
    'scr_breast_att': ['surv_breast_female'], 'scr_cervix_att': ['scr_cervix_colpo'],
    'scr_crc_att': ['scr_crc_colo', 'surv_colorectal_both'], 'scr_crc_colo': ['scr_crc_att', 'surv_colorectal_both'],
    'scr_cervix_colpo': ['scr_cervix_att'],
}

LUNG_TREAT = ['lung_curative', 'lung_lifeprolong', 'lung_symptomatic', 'lung_cur_ratio']
# Lung treatment signals whose verdict depends on recording completeness (task b).
LUNG_CURATIVE_SIGNALS = ['lung_curative', 'lung_cur_ratio']
QUALITY_CHECKS = ['precision', 'complete', 'casemix', 'persist', 'plausible']
FLAG_TEXT = {
    'precision': 'wide confidence interval (small sample)',
    'persist': 'not yet persistent across ≥3 annual releases',
    'complete': 'incomplete or delayed register feed',
    'casemix': 'unadjusted age/stage/population mix',
    'plausible': 'implausibly large gap (likely register artefact)',
}
# Heuristic thresholds (documented in docs/DATA_GUIDE.md).
MATERIAL_PP = 2.0        # adverse gaps smaller than this (percentage points) are 'monitor', not action
IMPLAUSIBLE_PP = 25.0    # gaps larger than this are treated as likely register artefacts
IMPLAUSIBLE_RATIO = 2.0  # same for non-percentage indicators (value/comparator outside 1/2..2)


def fmt(v, unit='', digits=None):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return '–'
    if unit in ('', None) and digits is None and float(v).is_integer():
        return f'{int(v):,}'
    d = digits if digits is not None else (0 if abs(v) >= 100 else (2 if unit == 'ratio' else 1))
    s = f'{v:,.{d}f}'
    if unit == '%':
        return s + '%'
    if unit in ('', 'ratio'):
        return s
    return f'{s} {unit}'


def fmt_n(x):
    return f'{int(round(x)):,}'


class Engine:
    def __init__(self, indicators, values, context=None, stage_unknown=None):
        self.indicators = indicators
        self.IND = {i['id']: i for i in indicators}
        self.V = values
        self.context = context or {}
        self.stage_unknown = stage_unknown  # dict(n, d, pct) from the lung quality report
        self._cache = {}

    # ------------------------------------------------------------------ basics
    def latest(self, iid):
        return self.IND[iid]['periods'][-1] if self.IND[iid]['periods'] else None

    def get(self, iid, period, code):
        return ((self.V.get(iid) or {}).get(period) or {}).get(code)

    def comparator(self, iid, period, code):
        """Leave-one-out ("rest of Finland") comparator when counts allow; else national value."""
        ind, x, nat = self.IND[iid], self.get(iid, period, code), self.get(iid, period, NATIONAL)
        if not nat:
            return None, None
        vt = ind.get('value_type')
        if x and vt in ('proportion', 'ratio'):
            nn, dd = (('n', 'd') if vt == 'proportion' else ('num', 'den'))
            if nat.get(nn) is not None and x.get(nn) is not None and nat.get(dd) and x.get(dd) is not None:
                rn, rd = nat[nn] - x[nn], nat[dd] - x[dd]
                if rd > 0 and rn >= 0:
                    return (100 * rn / rd if vt == 'proportion' else rn / rd), 'leave_one_out'
        return nat['v'], 'national'

    def _distinct(self, x, comp):
        return x is not None and comp is not None and x.get('lo') is not None and (x['lo'] > comp or x['hi'] < comp)

    def side(self, iid, period, code):
        """-1 worse, +1 better, 0 similar, 2 different (neutral polarity), None no data."""
        ind, x = self.IND[iid], self.get(iid, period, code)
        comp, _ = self.comparator(iid, period, code)
        if not x or comp is None:
            return None
        if not self._distinct(x, comp):
            return 0
        if not ind['polarity']:
            return 2
        return int(math.copysign(1, (x['v'] - comp) * ind['polarity']))

    # ------------------------------------------------------------------ assessment
    def assess(self, iid, code, period=None):
        period = period or self.latest(iid)
        key = (iid, code, period)
        if key in self._cache:
            return self._cache[key]
        ind, x = self.IND[iid], self.get(iid, period, code)
        nat = self.get(iid, period, NATIONAL)
        r = dict(id=iid, code=code, period=period, x=x, nat=nat, checks=[], verdict='nodata', score=None,
                 comparator=None, comparator_kind=None, reason=None)
        self._cache[key] = r
        if not x or not nat:
            r['reason'] = 'Not published for this area.' if not x else 'No national comparator.'
            return r
        comp, ckind = self.comparator(iid, period, code)
        r['comparator'], r['comparator_kind'] = comp, ckind
        unit, pol = ind['unit'], ind['polarity']
        r['diff'] = x['v'] - comp
        se = (x['hi'] - x['lo']) / 3.92 if x.get('lo') is not None else None
        r['z'] = r['diff'] / se if se else 0.0
        r['distinct'] = self._distinct(x, comp)
        if not pol:
            r['dir'] = 'higher' if r['diff'] > 0 else 'lower'
        else:
            r['dir'] = 'worse' if r['diff'] * pol < 0 else 'better'
        pct = unit == '%'
        cname = 'rest of Finland' if ckind == 'leave_one_out' else 'national'
        if iid == 'lung_mdt':
            cname = 'other reporting counties'

        def C(cid, label, status, detail):
            r['checks'].append(dict(id=cid, label=label, status=status, detail=detail))

        # 1. Precision of the estimate
        if x.get('lo') is None:
            C('precision', 'Precise estimate', 'warn', 'No confidence interval published.')
        else:
            hw = (x['hi'] - x['lo']) / 2
            rel = hw / max(abs(x['v']), 1e-9)
            ok, meh = (hw <= 5, hw <= 10) if pct else (rel <= 0.15, rel <= 0.3)
            where = (f"n = {fmt_n(x['d'])}" if x.get('d') else f"{fmt_n(x['n'])} cases" if x.get('n') else '')
            spread = f'±{hw:.1f} pp' if pct else f'±{round(rel * 100)}%'
            C('precision', 'Precise estimate', 'pass' if ok else 'warn' if meh else 'fail',
              f"95% CI {fmt(x['lo'], unit)} – {fmt(x['hi'], unit)} ({spread}){', ' + where if where else ''}.")

        # 2. Comparator outside the county interval
        if x.get('lo') is None:
            C('chance', 'Comparator outside interval', 'na', 'No interval available; comparison not assessed.')
        else:
            inside = 'outside' if r['distinct'] else 'inside'
            C('chance', 'Comparator outside interval', 'pass' if r['distinct'] else 'warn',
              f"{cname[0].upper() + cname[1:]} comparator {fmt(comp, unit)} lies {inside} the county's 95% CI.")

        # 3. Persistence over time
        if len(ind['periods']) > 1:
            history = [p for p in ind['periods'] if p <= period]
            sides = [s for s in (self.side(iid, p, code) for p in history) if s is not None]
            want = int(math.copysign(1, r['diff'] * (pol or 1))) if pol else 2
            same = sum(1 for s in sides if s != 0 and s == want)
            need = min(3, len(sides))
            status = 'na' if len(sides) < 2 else 'pass' if same >= need else 'warn' if same >= 2 else 'fail'
            C('persist', 'Persistent over time', status,
              'Fewer than two annual observations; persistence not assessed.' if len(sides) < 2 else
              f'Comparator outside the interval in the same direction in {same} of {len(sides)} years ({history[0]}–{history[-1]}).')
        else:
            C('persist', 'Persistent over time', 'na', f'Only one pooled period ({period}); persistence cannot be assessed.')

        # 4. Recording completeness
        if iid in LUNG_TREAT:
            m = self.get('lung_noinfo', '2019–2023', code)
            mc, _ = self.comparator('lung_noinfo', '2019–2023', code)
            r['noinfo'], r['noinfo_comparator'] = (m['v'] if m else None), mc
            st = 'warn' if not m else 'pass' if m['v'] <= mc else 'warn' if m['v'] <= mc + 5 else 'fail'
            C('complete', 'Records complete enough', st,
              f"{fmt(m['v'], '%')} of patients have no treatment record (rest of Finland {fmt(mc, '%')})." if m
              else 'Completeness not reported.')
        elif iid == 'lung_mdt':
            v = x['v']
            C('complete', 'Records complete enough', 'fail' if v < 2 else 'warn' if v < 10 else 'pass',
              f'Only {fmt(v, "%")} carry an MDT code (WZC15/WZC20): recording and actual practice cannot be distinguished.'
              if v < 2 else f'{fmt(v, "%")} carry an MDT code; only direct patient contacts reach HILMO.')
        elif iid in ('scr_crc_colo', 'scr_cervix_colpo'):
            C('complete', 'Records complete enough', 'warn',
              'Diagnostic tests done outside the programme or registered late may be absent from programme records.')
        elif ind['kind'] == 'outcome':
            C('complete', 'Records complete enough', 'pass', 'Population-based Finnish Cancer Registry data.')
        elif ind['kind'] == 'data_quality':
            C('complete', 'Records complete enough', 'na', 'This indicator measures completeness itself.')
        else:
            C('complete', 'Records complete enough', 'pass', 'Programme register with an invitation-based denominator.')

        # 5. Case-mix adjustment
        if ind['kind'] == 'outcome':
            C('casemix', 'Case-mix adjustment', 'warn',
              'Age-standardised, but stage, comorbidity and other clinical differences remain. Mortality also reflects '
              'incidence; differences cannot be attributed to care alone.')
        elif iid in LUNG_TREAT:
            su = self.stage_unknown
            extra = (f"stage is missing for {fmt(su['pct'], '%')} ({fmt_n(su['n'])} of {fmt_n(su['d'])}) of lung cancers "
                     f"nationally 2019–2023 (lung quality report, table 4)") if su else 'stage completeness unknown'
            C('casemix', 'Case-mix adjustment', 'warn', f'Not adjusted for stage, age or comorbidity; {extra}.')
        elif ind['kind'] == 'data_quality':
            C('casemix', 'Case-mix adjustment', 'na', 'Not applicable to a recording measure.')
        else:
            C('casemix', 'Case-mix adjustment', 'warn', 'Defined programme age band; population and language mix are not adjusted.')

        # 6. Corroboration by a related indicator
        rel = [q for q in RELATED.get(iid, []) if q in self.IND]
        if not rel or ind['kind'] == 'data_quality' or not pol:
            C('corrob', 'Corroborated elsewhere', 'na', 'No related indicator defined.')
        else:
            want = r['dir']
            hits, strong = [], []
            for rid in rel:
                rps = [p for p in self.IND[rid]['periods'] if p <= period] or self.IND[rid]['periods'][-1:]
                rp = rps[-1] if rps else None
                rx = rp and self.get(rid, rp, code)
                rc, _ = self.comparator(rid, rp, code) if rp else (None, None)
                if not rx or rc is None or not self.IND[rid]['polarity']:
                    continue
                d = 'worse' if (rx['v'] - rc) * self.IND[rid]['polarity'] < 0 else 'better'
                if d == want:
                    hits.append(rid)
                    if self._distinct(rx, rc):
                        strong.append(rid)
            short = lambda ids: ', '.join(self.IND[q]['short'] for q in ids)
            C('corrob', 'Corroborated elsewhere', 'pass' if strong else 'warn' if hits else 'fail',
              f'Also {want} outside the county interval: {short(strong)}.' if strong else
              f'Points the same way (comparator within interval): {short(hits)}.' if hits else
              f'No related indicator points the same way ({short(rel)}).')
        # 7. Plausibility: extreme gaps are more often register artefacts than care differences
        if ind['kind'] != 'data_quality' and pol:
            if pct:
                bad = abs(r['diff']) > IMPLAUSIBLE_PP
                lim = f'{IMPLAUSIBLE_PP:g} percentage points'
            else:
                q = x['v'] / comp if comp else 1
                bad = not (1 / IMPLAUSIBLE_RATIO <= q <= IMPLAUSIBLE_RATIO)
                lim = f'a factor of {IMPLAUSIBLE_RATIO:g}'
            C('plausible', 'Plausible size of gap', 'fail' if bad else 'pass',
              f'Differs from the comparator by more than {lim}: check the register feed before reading it as care.' if bad
              else f'Gap within {lim} of the comparator.')

        scored = [c for c in r['checks'] if c['status'] != 'na']
        r['score'] = round(100 * sum(1 if c['status'] == 'pass' else 0.5 if c['status'] == 'warn' else 0 for c in scored)
                           / len(scored)) if scored else None
        quality = [c for c in r['checks'] if c['id'] in QUALITY_CHECKS]
        fails = sum(c['status'] == 'fail' for c in quality)
        warns = sum(c['status'] == 'warn' for c in quality)
        persist_pass = any(c['id'] == 'persist' and c['status'] == 'pass' for c in quality)
        r['flags'] = [FLAG_TEXT.get(c['id'], c['label']) for c in r['checks'] if c['status'] == 'fail' and c['id'] != 'chance']

        # ---- verdict
        if not pol:
            r['verdict'] = 'monitor' if r['distinct'] else 'ok'
            r['reason'] = ('Differs from the comparator, but higher or lower is not inherently better.' if r['distinct']
                           else 'Comparator inside the county interval.')
        elif not r['distinct']:
            r['verdict'] = 'monitor' if r['dir'] == 'worse' else 'ok'
            r['reason'] = 'Adverse direction, but the comparator lies inside the county interval.' if r['dir'] == 'worse' \
                else 'Comparator inside the county interval.'
        elif r['dir'] == 'better':
            r['verdict'], r['favourable'] = 'ok', True
            r['reason'] = 'Better than the comparator, outside the county interval (possible learning signal; check recording first).'
        elif pct and abs(r['diff']) < MATERIAL_PP:
            r['verdict'] = 'monitor'
            r['reason'] = (f'Statistically clear but small: {abs(r["diff"]):.1f} percentage points from the comparator '
                           f'(materiality threshold {MATERIAL_PP:g} pp).')
        elif ind['kind'] == 'data_quality':
            r['verdict'] = 'verify'
            r['reason'] = 'Recording gap: fix or explain the records before judging care.'
        elif iid in LUNG_CURATIVE_SIGNALS:
            noinfo, nc = r.get('noinfo'), r.get('noinfo_comparator')
            if noinfo is None or nc is None or noinfo > nc:
                r['verdict'] = 'verify'
                r['reason'] = (f"Low curative share, but {fmt(noinfo, '%')} of patients lack any treatment record "
                               f"(rest of Finland {fmt(nc, '%')}): missing records may explain part of the gap."
                               if noinfo is not None else 'Low curative share; treatment-record completeness not reported.')
            else:
                r['verdict'] = 'act'
                r['reason'] = (f"Low curative share while treatment records are at least as complete as elsewhere "
                               f"({fmt(noinfo, '%')} without a record vs {fmt(nc, '%')}): likely treatment-access or "
                               f"late-detection gap.")
        elif fails == 0 and (warns <= 1 or (persist_pass and warns <= 2)):
            r['verdict'] = 'act'
            r['reason'] = 'Adverse, outside the county interval, and no major data-quality flag.'
        else:
            r['verdict'] = 'verify'
            r['reason'] = 'Adverse and outside the interval, but quality checks flag: ' + \
                ', '.join(FLAG_TEXT.get(c['id'], c['label'].lower()) for c in quality if c['status'] in ('fail', 'warn')) + '.'
        return r

    # ------------------------------------------------------------------ aggregation
    def findings(self, code):
        out = [self.assess(i['id'], code) for i in self.indicators if i['kind'] != 'context']
        return sorted(out, key=lambda f: (VERDICTS[f['verdict']]['rank'], -abs(f.get('z') or 0)))

    def stage_verdicts(self, code):
        res = {}
        F = self.findings(code)
        for s in STAGE_ORDER:
            live = [f for f in F if self.IND[f['id']]['stage'] == s and f['verdict'] != 'nodata']
            res[s] = live[0]['verdict'] if live else 'nodata'
        return res

    def peers(self, code, k=3):
        """Nearest counties on population context (z-scored)."""
        feats = ['ctx_65', 'ctx_rural', 'ctx_density', 'ctx_foreign', 'ctx_swedish']

        def vec(c):
            row = self.context.get(c, {})
            vals = [row.get(f) for f in feats]
            if any(v is None for v in vals):
                return None
            return [math.log(max(v, 0.001)) if f == 'ctx_density' else v for f, v in zip(feats, vals)]
        codes = [c for c in self.context if c != NATIONAL and c != 'HVA91' and vec(c)]
        if code not in codes:
            return []
        allv = [vec(c) for c in codes]
        dims = len(feats)
        mu = [sum(v[j] for v in allv) / len(allv) for j in range(dims)]
        sd = [math.sqrt(sum((v[j] - mu[j]) ** 2 for v in allv) / len(allv)) or 1 for j in range(dims)]
        me = [(v - mu[j]) / sd[j] for j, v in enumerate(vec(code))]
        out = []
        for c in codes:
            if c == code:
                continue
            v = [(x - mu[j]) / sd[j] for j, x in enumerate(vec(c))]
            out.append(dict(code=c, dist=round(math.sqrt(sum((a - b) ** 2 for a, b in zip(v, me))), 3)))
        return sorted(out, key=lambda p: p['dist'])[:k]

    def best_peer(self, iid, code):
        pol = self.IND[iid]['polarity']
        if not pol:
            return None
        me = self.assess(iid, code)
        if not me['x']:
            return None
        P = [self.assess(iid, p['code']) for p in self.peers(code, 4)]
        P = [a for a in P if a['x']]
        P.sort(key=lambda a: -(a['x']['v'] * pol))
        return P[0] if P and (P[0]['x']['v'] - me['x']['v']) * pol > 0 else None


# ---------------------------------------------------------------------- narrative
INTERPRET = {
    'detection': 'detection gap: fewer invited people are screened than elsewhere',
    'referral': 'hand-off gap: screen-positive people are not reaching specialist diagnostics as often as elsewhere',
    'followup': 'follow-up records gap: screening outcomes are missing from the register',
    'diagnosis': 'recording gap: verify treatment and MDT records before judging care',
    'outcome': 'outcome gap without an identified upstream cause: peer review the pathway',
}


def phrase(engine, f):
    ind = engine.IND[f['id']]
    adj = 'high' if f['diff'] > 0 else 'low'
    return f"{adj} {ind['phrase']} ({fmt(f['x']['v'], ind['unit'])} vs {fmt(f['comparator'], ind['unit'])})"


VERIFY_TEXT = {
    'lung_noinfo': 'recording gap: reconcile treatment records before judging lung care',
    'lung_mdt': 'MDT meetings are probably held but not coded: check WZC15/WZC20 coding',
    'scr_breast_missing': 'screening register is missing final diagnoses: send outcomes back to the register',
    'scr_crc_colo': 'check for colonoscopies done outside the programme before acting',
    'scr_cervix_colpo': 'check for colposcopies missing from the programme register before acting',
    'detection': 'check invitation delivery and cohort mix before acting',
    'followup': 'check register completeness before acting',
    'referral': 'check register completeness before acting',
    'diagnosis': 'check records before acting',
    'treatment': 'check records before acting',
    'outcome': 'uncertain outcome signal: re-check with the next release before peer review',
}

UPSTREAM = {'lung': ['lung_curative', 'lung_cur_ratio'], 'breast': ['scr_breast_att'],
            'colorectal': ['scr_crc_colo', 'scr_crc_att'], 'prostate': []}


def headline(engine, code, name):
    """One sentence: where in the pathway the gap emerges and what it most likely is."""
    F = [f for f in engine.findings(code) if f['verdict'] != 'nodata']
    if not F:
        return f'{name}: no published pathway indicators for this area.'
    by_id = {f['id']: f for f in F}
    stage_rank = {s: i for i, s in enumerate(STAGE_ORDER)}
    key = lambda f: (stage_rank[engine.IND[f['id']]['stage']], -abs(f['z']))
    act = sorted([f for f in F if f['verdict'] == 'act'], key=key)
    ver = sorted([f for f in F if f['verdict'] == 'verify'], key=key)
    adverse = lambda f: f.get('dir') == 'worse' and f['verdict'] in ('act', 'verify', 'monitor')

    lung_act = sorted([f for f in act if f['id'] in LUNG_CURATIVE_SIGNALS], key=lambda f: LUNG_CURATIVE_SIGNALS.index(f['id']))
    if lung_act:
        f = lung_act[0]
        out = sorted([g for g in F if g['id'].startswith(('mort_lung', 'surv_lung')) and adverse(g)],
                     key=lambda g: (VERDICTS[g['verdict']]['rank'], -abs(g['z'])))
        if out:
            return (f'{name}: {phrase(engine, f)} and {phrase(engine, out[0])} '
                    f'→ likely treatment-access or late-detection gap in lung cancer.')
        return (f'{name}: {phrase(engine, f)} although treatment records are as complete as elsewhere '
                f'→ likely treatment-access or late-detection gap in lung cancer.')
    if act:
        f = act[0]
        stage = engine.IND[f['id']]['stage']
        if stage == 'outcome':
            ups = [by_id[u] for u in UPSTREAM.get(engine.IND[f['id']].get('cancer'), []) if u in by_id and adverse(by_id[u])]
            if ups:
                up = ups[0]
                if up['verdict'] == 'verify' and up['id'] in LUNG_CURATIVE_SIGNALS:
                    return (f"{name}: {phrase(engine, f)} and {phrase(engine, up)} → possible lung treatment-access gap, "
                            f"but {fmt(up.get('noinfo'), '%')} of lung patients lack any treatment record "
                            f"(rest of Finland {fmt(up.get('noinfo_comparator'), '%')}): verify records first.")
                up_stage = next(s['label'] for s in STAGES if s['id'] == engine.IND[up['id']]['stage'])
                return f'{name}: {phrase(engine, f)} with {phrase(engine, up)} upstream → the gap likely emerges at {up_stage.lower()}.'
        others = [g for g in act[1:] if engine.IND[g['id']]['stage'] != stage]
        tail = f'; also {phrase(engine, others[0])}' if others else ''
        return f"{name}: {phrase(engine, f)} → {INTERPRET.get(stage, 'gap')}{tail}."
    if ver:
        prio = lambda f: (0 if f['id'] in LUNG_CURATIVE_SIGNALS else 1 if f['id'] == 'lung_noinfo' else 2,) + key(f)
        f = sorted(ver, key=prio)[0]
        if f['id'] in LUNG_CURATIVE_SIGNALS:
            return (f"{name}: {phrase(engine, f)}, but the share of lung patients without any treatment record "
                    f"({fmt(f.get('noinfo'), '%')}) is above the rest of Finland ({fmt(f.get('noinfo_comparator'), '%')}) "
                    f"→ verify records before judging lung care.")
        return f"{name}: {phrase(engine, f)} → {VERIFY_TEXT.get(f['id'], VERIFY_TEXT[engine.IND[f['id']]['stage']])}."
    mon = sorted([f for f in F if f['verdict'] == 'monitor' and f.get('dir') == 'worse'], key=lambda f: -abs(f['z']))
    if mon:
        return (f"{name}: no pathway stage is clearly below the rest of Finland; monitor "
                f"{' and '.join(engine.IND[f['id']]['phrase'] for f in mon[:2])}.")
    return f'{name}: in line with the rest of Finland across all reported pathway stages.'
