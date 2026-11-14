#!/usr/bin/env python3
"""Build data/processed/pathway_snapshot.json: county pathway verdicts, headlines and action plans.

Inputs (all already in the repository; nothing is fetched):
  data/processed/*.csv                 curated county indicators
  data/processed/evidence_chunks.jsonl retrieval corpus for evidence excerpts
  data/raw/quality/lung_2019_2023.txt  lung quality report text (stage-unknown share)
  data/catalog/recommendations.json    playbooks: the single source of truth for actions

The snapshot is served unchanged by the backend (GET /api/v1/pathway) and bundled by the
frontend (npm run snapshot). Evidence-check logic lives in scripts/pathway_engine.py.
"""
import collections, csv, datetime, json, math, pathlib, re, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pathway_engine as pe  # noqa: E402
import validate_data  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROC = ROOT / 'data/processed'
CAT = ROOT / 'data/catalog'
RAW = ROOT / 'data/raw'
OUT = PROC / 'pathway_snapshot.json'
LUNG_URL = 'https://cancerregistry.fi/assets/themes/ssy3/factsheets/keuhkosyoparaportti.html'
LUNG_PERIOD = '2019–2023'
LUNG_YEARS = 5
OUTCOME_YEARS = 5


def read(name):
    with open(PROC / name, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def num(v):
    try:
        x = float(v)
        return None if math.isnan(x) else x
    except (TypeError, ValueError):
        return None


def wilson(n, d, z=1.96):
    if not d:
        return None, None
    p = n / d
    den = 1 + z * z / d
    c = (p + z * z / (2 * d)) / den
    h = z * math.sqrt(p * (1 - p) / d + z * z / (4 * d * d)) / den
    return round(100 * (c - h), 2), round(100 * (c + h), 2)


def prop(n, d, src):
    lo, hi = wilson(n, d)
    return dict(v=round(100 * n / d, 2), lo=lo, hi=hi, n=int(n), d=int(d), src=src)


def ratio(a, b, src):
    """Ratio a/b with an approximate log-scale 95% CI (Katz: se = sqrt(1/a + 1/b))."""
    r = a / b
    se = math.sqrt(1 / a + 1 / b)
    return dict(v=round(r, 3), lo=round(r * math.exp(-1.96 * se), 3), hi=round(r * math.exp(1.96 * se), 3),
                n=None, d=None, num=int(a), den=int(b), src=src)


# --------------------------------------------------------------------------- indicators
INDICATORS = []


def ind(**k):
    k.setdefault('polarity', 0)
    k.setdefault('kind', 'process')
    k.setdefault('is_proxy', False)
    k.setdefault('value_type', 'proportion')
    k.setdefault('phrase', k['short'].lower())
    INDICATORS.append(k)
    return k['id']


def stage_unknown():
    """Lung cancers without stage information, 2019–2023, from the lung quality report (Taulukko 4)."""
    text = (RAW / 'quality/lung_2019_2023.txt').read_text(encoding='utf-8')
    m = re.search(r'Taulukko\s4:\sKeuhkosyöpäpotilaiden\slevinneisyysluokitus.*?Ei tietoa\s+(\d+)\s+([\d.,]+)\s+Yhteensä\s+(\d+)',
                  text, re.S)
    if not m:
        raise ValueError('Stage-unknown row (Taulukko 4, "Ei tietoa") not found in lung_2019_2023.txt')
    n, pct, d = int(m.group(1)), float(m.group(2).replace(',', '.')), int(m.group(3))
    return dict(n=n, d=d, pct=pct, period=LUNG_PERIOD, table='Taulukko 4 (section 4.1.3)', url=LUNG_URL,
                source_path='data/raw/quality/lung_2019_2023.txt')


def build_values():
    regions = read('regions.csv')
    codes = [r['area_code'] for r in regions]
    V = collections.defaultdict(lambda: collections.defaultdict(dict))  # id -> period -> code -> value

    # ---- Screening (Finnish Cancer Registry, programme statistics) -------------
    scr = [r for r in read('county_screening.csv') if r['strata'] == '{}' and r['area_code']]
    # Cervix has two county tables per year: age-group screening (first) and risk-group screening.
    first_tab = {}
    for r in scr:
        if r['program'] == 'cervix':
            k = (r['year'], r['section'])
            first_tab[k] = min(first_tab.get(k, 10 ** 9), int(r['table_id'].split('_t')[1]))
    cell = collections.defaultdict(dict)
    for r in scr:
        if r['program'] == 'cervix' and int(r['table_id'].split('_t')[1]) != first_tab[(r['year'], r['section'])]:
            continue
        cell[(r['program'], r['year'], r['area_code'], r['section'].split(' > ')[-1])][r['metric']] = (num(r['value']), r)

    def screening(iid, program, section, num_m, den_m):
        for (p, y, code, sec), m in cell.items():
            if p != program or sec != section or num_m not in m or den_m not in m:
                continue
            n, d = m[num_m][0], m[den_m][0]
            if n is None or not d:
                continue
            row = m[num_m][1]
            V[iid][y][code] = prop(n, d, dict(table=row['table_id'], url=row['source_url']))

    screening(ind(id='scr_breast_att', label='Breast screening attendance', short='Breast screening',
                  phrase='breast screening attendance', stage='detection', unit='%', polarity=1, group='Screening',
                  desc='Attended mammography screening, % of invited women (age-group programme).',
                  caveat='Invitation coverage and cohort composition differ between counties; private mammography is not counted.'),
              'breast', 'Screening process', 'Attended (of invited) | N', 'Invited | N')
    screening(ind(id='scr_cervix_att', label='Cervical screening attendance', short='Cervical screening',
                  phrase='cervical screening attendance', stage='detection', unit='%', polarity=1, group='Screening',
                  desc='Attended cervical screening, % of invited (age-group programme).',
                  caveat='Opportunistic tests outside the programme are not counted as attendance.'),
              'cervix', 'Screening process', 'Attended (of invited) | N', 'Invited | N')
    screening(ind(id='scr_crc_att', label='Colorectal screening attendance', short='Bowel screening',
                  phrase='bowel screening attendance', stage='detection', unit='%', polarity=1, group='Screening',
                  desc='Returned a FIT kit, % of persons picked for the programme (programme launched 2022).',
                  caveat='Programme is being rolled out by birth cohort; early years cover the youngest cohorts only.'),
              'colorectal', 'Screening process', 'Attended | N', 'Picked | N')
    screening(ind(id='scr_breast_missing', label='Missing outcome after breast referral', short='Breast referral outcome missing',
                  phrase='missing breast referral outcomes', stage='followup', unit='%', polarity=-1, kind='data_quality',
                  group='Data completeness',
                  desc='Referred to specialist care after screening, but final diagnosis missing in the screening register (%).',
                  caveat='Measures register completeness, not clinical care.'),
              'breast', 'Screening results', 'Missing information (of referred) | N',
              'Referral to specialized healthcare (of examined) | N')
    # Referral-stage proxies: hand-off from a screen-positive result to specialist diagnostics.
    screening(ind(id='scr_crc_colo', label='Colonoscopy after positive FIT (referral proxy)', short='FIT+ → colonoscopy',
                  phrase='colonoscopy completion after a positive FIT', stage='referral', unit='%', polarity=1, is_proxy=True,
                  proxy_for='Primary/screening → specialist hand-off', group='Referral proxies',
                  desc='Attended colonoscopy, % of screening test positives. Proxy for completed referral to specialist '
                       'diagnostics; it does not measure referral delay.',
                  caveat='Clinical exclusions, colonoscopies outside the programme and late registrations count as non-attendance.'),
              'colorectal', 'Screening process', 'Attended colonoscopy (of test positives) | N', 'Test positives | N')
    screening(ind(id='scr_cervix_colpo', label='Colposcopy after referral (referral proxy)', short='Referral → colposcopy',
                  phrase='colposcopy attendance after referral', stage='referral', unit='%', polarity=1, is_proxy=True,
                  proxy_for='Primary/screening → specialist hand-off', group='Referral proxies',
                  desc='Attended colposcopy, % of those referred from age-group cervical screening. Proxy for completed '
                       'referral to specialist diagnostics.',
                  caveat='Small denominators in some counties; colposcopies done outside the programme may be missing.'),
              'cervix', 'Screening process', 'Attended colposcopy (of those referred) | N',
              'Referral to colposcopy (of those who participated) | N')

    # ---- Lung cancer quality report 2019–2023 (county treatment patterns) --------
    su = stage_unknown()
    lung = read('county_lung_treatment_2019_2023.csv')
    LT = {'Parantava': ('lung_curative', 'Lung: curative treatment', 'Curative lung treatment', 'curative lung treatment',
                        'treatment', 1, 'process',
                        'Patients with recorded curative treatment (surgery, chemoradiation or stereotactic RT) within 12 months, %.',
                        f"Not adjusted for stage, age or comorbidity; {su['pct']}% of lung cancers nationally lack stage information."),
          'Jarruttava': ('lung_lifeprolong', 'Lung: life-prolonging treatment', 'Life-prolonging lung treatment',
                         'life-prolonging lung treatment', 'treatment', 0, 'process',
                         'Patients with recorded life-prolonging (non-curative) drug or radiotherapy within 12 months, %.',
                         'Higher or lower is not inherently better without stage information.'),
          'Oireenmukainen': ('lung_symptomatic', 'Lung: symptomatic care', 'Symptomatic lung care', 'symptomatic lung care',
                             'treatment', 0, 'process',
                             'Patients with recorded symptomatic care, %. Categories overlap.',
                             'Interpretation depends on stage and frailty, which are not adjusted for.'),
          'Ei hoitotietoa': ('lung_noinfo', 'Lung: no treatment record', 'No lung treatment record',
                             'share of lung patients with no treatment record', 'diagnosis', -1, 'data_quality',
                             'Patients with no recorded treatment of any kind within 12 months of diagnosis, %.',
                             'Missing records do not prove absence of treatment; mixes untreated patients and recording gaps.'),
          'MDT-käsittely': ('lung_mdt', 'Lung: MDT discussion recorded', 'MDT recorded', 'recorded MDT discussion',
                            'diagnosis', 1, 'data_quality',
                            'Patients with a recorded multidisciplinary team (MDT) meeting code (WZC15/WZC20), %.',
                            'Near-zero values cannot distinguish low recording from actual MDT practice. Not published for 4 '
                            'counties; the comparator covers reporting counties only.')}
    for k, (iid, label, short, phrase, stage, pol, kind, desc, cav) in LT.items():
        ind(id=iid, label=label, short=short, phrase=phrase, stage=stage, unit='%', polarity=pol, kind=kind,
            group='Lung cancer 2019–2023', desc=desc, caveat=cav)
    ind(id='lung_cur_ratio', label='Lung: curative vs symptomatic-care ratio (referral proxy)', short='Curative : symptomatic',
        phrase='curative-to-symptomatic lung care ratio', stage='referral', unit='ratio', polarity=1, is_proxy=True,
        value_type='ratio', proxy_for='Timeliness of referral (patients reaching specialist care while still curable)',
        group='Referral proxies',
        desc='Patients with recorded curative treatment per patient with recorded symptomatic care, lung cancer 2019–2023. '
             'A low ratio suggests patients reach specialist care late (late detection or referral) or lack treatment access.',
        caveat='Categories overlap (a patient can have both); not stage-adjusted; approximate CI ignores the overlap.')
    tot = collections.defaultdict(lambda: [0, 0])
    by = collections.defaultdict(dict)
    for r in lung:
        iid = LT[r['treatment_type_fi']][0]
        n, d = num(r['treatment_n']), num(r['patients_n'])
        src = dict(table=r['table_id'], url=r['source_url'])
        V[iid][LUNG_PERIOD][r['area_code']] = prop(n, d, src)
        by[r['area_code']][iid] = (n, d, src)
        tot[iid][0] += n
        tot[iid][1] += d
    for iid, (n, d) in tot.items():
        # National comparator = sum of published counties (MDT: reporting counties only).
        V[iid][LUNG_PERIOD]['SSS'] = prop(n, d, dict(table='sum of published counties', url=LUNG_URL))
    for code, m in by.items():
        if 'lung_curative' in m and 'lung_symptomatic' in m and m['lung_symptomatic'][0]:
            V['lung_cur_ratio'][LUNG_PERIOD][code] = ratio(m['lung_curative'][0], m['lung_symptomatic'][0], m['lung_curative'][2])
    V['lung_cur_ratio'][LUNG_PERIOD]['SSS'] = ratio(tot['lung_curative'][0], tot['lung_symptomatic'][0],
                                                    dict(table='sum of published counties', url=LUNG_URL))

    # ---- Cancer in Finland 2024: survival, mortality, incidence ------------------
    out = read('regional_cancer_outcomes_2024.csv')
    CAN = [('lung', 'male', 'Lung (men)', 'lung cancer'), ('lung', 'female', 'Lung (women)', 'lung cancer'),
           ('breast', 'female', 'Breast', 'breast cancer'), ('colorectal', 'both', 'Colorectal', 'colorectal cancer'),
           ('prostate', 'male', 'Prostate', 'prostate cancer')]
    for cancer, sex, name, cname in CAN:
        key = f'{cancer}_{sex}'
        who = {'male': ' (men)', 'female': ' (women)'}.get(sex, '') if cancer == 'lung' else ''
        ind(id=f'surv_{key}', label=f'5-yr relative survival: {name}', short=f'{name} survival',
            phrase=f'{cname} survival{who}', stage='outcome', unit='%', polarity=1, kind='outcome', value_type='rate',
            group='Outcomes 2020–2024', cancer=cancer,
            desc=f'Age-standardised 5-year relative survival, {name.lower()} cancer, diagnosed 2020–2024 (period method).',
            caveat='Wide intervals in small counties; reflects stage at diagnosis as well as treatment. Compared with the '
                   'national value (counts needed for a leave-one-out comparator are not published).')
        ind(id=f'mort_{key}', label=f'Mortality: {name}', short=f'{name} mortality', phrase=f'{cname} mortality{who}',
            stage='outcome', unit='/100k', polarity=-1, kind='outcome', value_type='rate', group='Outcomes 2020–2024',
            cancer=cancer,
            desc=f'Age-standardised cancer mortality per 100 000, {name.lower()}, 2020–2024.',
            caveat='Driven by incidence (e.g. smoking history) as well as care quality. Compared with the national value.')
        ind(id=f'inc_{key}', label=f'Incidence: {name}', short=f'{name} incidence', stage='context', unit='/100k',
            kind='context', value_type='rate', group='Outcomes 2020–2024', cancer=cancer,
            desc=f'Age-standardised incidence per 100 000, {name.lower()}, 2020–2024.',
            caveat='Context only: higher incidence can reflect risk factors or more active detection.')
        for r in out:
            if r['cancer'] != cancer or r['sex'] != sex:
                continue
            code = r['area_code'] if r['area_level'] != 'national' else 'SSS'
            if not code:
                continue
            src = dict(table=r['table_id'], url=r['source_url'])
            for pref, col, ncol in [('surv', 'relative_survival_5y_pct', 'incidence_n'), ('mort', 'mortality_rate', 'mortality_n'),
                                    ('inc', 'incidence_rate', 'incidence_n')]:
                v = num(r[col])
                if v is None:
                    continue
                V[f'{pref}_{key}']['2020–2024'][code] = dict(v=v, lo=num(r[col + '_ci_lower']), hi=num(r[col + '_ci_upper']),
                                                             n=None, d=None, cases=int(num(r[ncol]) or 0), src=src)

    # ---- Context: Statistics Finland 11ra, latest year (peer matching only) ---------
    pop = read('statfin_11ra.csv')
    year = max(r['timeperiod_y'] for r in pop)
    CTX = {'vaerak-vaesto': 'ctx_pop', 'vaesto_yli64_p': 'ctx_65', 'vaesto_ms_p': 'ctx_rural',
           'vaerak-vaesto_maa_pa': 'ctx_density', 'vaesto_kieli_ulk_p': 'ctx_foreign', 'vaesto_kieli_sv_p': 'ctx_swedish'}
    context = collections.defaultdict(dict)
    for r in pop:
        a = r['alue_23_20260101']
        if r['timeperiod_y'] == year and r['contentscode'] in CTX and (a in codes or a == 'SSS'):
            v = num(r['value'])
            if v is not None:
                context[a][CTX[r['contentscode']]] = v
    for i in INDICATORS:
        i['periods'] = sorted(V[i['id']].keys())
        first = next((x for p in V[i['id']].values() for x in p.values()), None)
        i['source_url'] = first['src']['url'] if first else ''
    return regions, V, dict(context), year, su


# --------------------------------------------------------------------------- evidence
RETRIEVAL = {
    'screening_reminders': dict(query='muistutus muistutuskirje kutsu osallistuminen osallistumisaste kieli kieliversio reminder invitation participation',
                                docs=['manual_', 'colorectal_screening_quality_manual', 'toimeenpanon_tiekartta']),
    'positive_fit_followup': dict(query='kolonoskopia jatkotutkimus positiivinen seulontahoitaja yhteydenotto colonoscopy follow-up positive',
                                  docs=['Suolistosyovan', 'colorectal_screening_quality_manual']),
    'colposcopy_followup': dict(query='kolposkopia jatkotutkimus lähete seuranta kiireellisyys colposcopy referral follow-up',
                                docs=['Kohdunkaulan']),
    'stage_mdt_completeness': dict(query='laaturekisteri kattavuus kirjaaminen levinneisyys tieto puuttuu moniammatillinen kliininen ilmoitus registry completeness stage MDT',
                                   docs=['toimeenpanon_tiekartta', 'lung_2019_2023', 'lung_quality', 'registry_quality', 'clinical_notifications']),
    'pathway_coordination': dict(query='hoitoketju lähetekriteerit viive odotusaika koordinaattori standardoitu tutkimusreitit pathway delay waiting time coordinator',
                                 docs=['toimeenpanon_tiekartta', 'sweden_svf', 'delay_meta_analysis', 'lung_2019_2023']),
    'outcome_peer_review': dict(query='vertaiskehittäminen vertaisarviointi laaturekisteri alueelliset erot eloonjäämisennuste peer review regional differences survival',
                                docs=['toimeenpanon_tiekartta', 'syopastrategia_2026_2035', 'oecd_finland']),
}


def tokens(t):
    return re.findall(r'[a-zåäö0-9]{3,}', t.lower())


def retrieve(chunks, spec, k=3):
    """BM25-style retrieval with Finnish prefix matching; only chunks with a source URL are eligible."""
    pool = [c for c in chunks if c.get('source_url') and any(d in c['document_id'] for d in spec['docs'])]
    if not pool:
        return []
    q = set(tokens(spec['query']))
    df = collections.Counter()
    toks = []
    for c in pool:
        t = tokens(c['text'])
        toks.append(t)
        df.update(set(t))
    N, avg = len(pool), sum(len(t) for t in toks) / len(pool)

    def score(t):
        tf = collections.Counter(t)
        s = 0
        for w in q:
            f = sum(v for x, v in tf.items() if x.startswith(w[:7]))
            if f:
                dfw = sum(v for x, v in df.items() if x.startswith(w[:7]))
                s += math.log(1 + (N - dfw + .5) / (dfw + .5)) * f * 2.2 / (f + 1.2 * (.25 + .75 * len(t) / avg))
        return s

    ranked = sorted(zip(pool, toks), key=lambda x: -score(x[1]))
    picked, seen = [], set()
    for c, t in ranked:
        if c['document_id'] not in seen and len(picked) < k:
            seen.add(c['document_id'])
            picked.append((c, t))
    picked.sort(key=lambda x: -score(x[1]))
    res = []
    for c, t in picked:
        text = re.sub(r'\s+', ' ', c['text']).strip()
        best, bi = -1, 0
        for i in range(0, max(1, len(text) - 420), 40):
            sc = sum(text[i:i + 420].lower().count(x[:7]) for x in q)
            if sc > best:
                best, bi = sc, i
        snip = text[bi:bi + 420]
        if bi > 0:
            snip = '…' + snip[snip.find(' ') + 1:]
        if bi + 420 < len(text):
            snip = snip[:snip.rfind(' ')] + '…'
        url = c['source_url'] + (f"#page={c['pdf_page']}" if c.get('pdf_page') and '.pdf' in c['source_url'] else '')
        res.append(dict(label=c['document_id'] + (f", p. {c['pdf_page']}" if c.get('pdf_page') else ''), url=url,
                        text=snip, chunk_id=c['chunk_id'], score=round(score(t), 2)))
    return res


def _norm(s):
    s = re.sub(r'-\s*\n\s*', '', s)
    return re.sub(r'\s+', ' ', s).lower()


def verify_citation(e):
    """Confirm the quoted phrase occurs in the archived source text (and on the cited PDF page)."""
    if not e.get('quote'):
        return None
    p = pathlib.Path(e['path'])
    txt = (RAW / 'provided' / (p.stem + '.txt')) if len(p.parts) == 1 else (ROOT / p).with_suffix('.txt')
    if not txt.exists():
        return False
    pages = txt.read_text(encoding='utf-8').split('\f')
    q = _norm(e['quote'])
    if e.get('pdf_page'):
        return 0 < e['pdf_page'] <= len(pages) and q in _norm(pages[e['pdf_page'] - 1])
    return any(q in _norm(pg) for pg in pages)


def load_playbooks():
    pbs = json.loads((CAT / 'recommendations.json').read_text(encoding='utf-8'))
    chunks = [json.loads(line) for line in open(PROC / 'evidence_chunks.jsonl', encoding='utf-8')]
    for pb in pbs:
        for e in pb['evidence']:
            e['verified'] = verify_citation(e)
        pb['citations'] = [dict(label=e['label'], url=e['url']) for e in pb['evidence'] if e.get('url')]
        pb['retrieved'] = retrieve(chunks, RETRIEVAL[pb['id']]) if pb['id'] in RETRIEVAL else []
    return pbs


# --------------------------------------------------------------------------- actions
def comparator_name(f):
    return 'rest of Finland' if f['comparator_kind'] == 'leave_one_out' else 'national'


def baseline_text(E, f):
    i, x = E.IND[f['id']], f['x']
    unit = i['unit']
    if i['value_type'] == 'proportion':
        cnt = f" ({fmt_n(x['n'])} of {fmt_n(x['d'])})"
    elif i['value_type'] == 'ratio':
        cnt = f" ({fmt_n(x['num'])} curative vs {fmt_n(x['den'])} symptomatic-care patients)"
    else:
        cnt = f" (95% CI {pe.fmt(x['lo'], unit)}–{pe.fmt(x['hi'], unit)})" if x.get('lo') is not None else ''
    return f"{i['label']}: {pe.fmt(x['v'], unit)}{cnt}, {f['period']}; {comparator_name(f)} {pe.fmt(f['comparator'], unit)}"


PHRASE_CASES = {'lung_noinfo': 'patients without a treatment record', 'lung_mdt': 'patients without an MDT code',
                'scr_breast_missing': 'breast referrals with a missing outcome'}


def volume(E, pb, f, code):
    rule = pb['volume_rule']
    method, unit = rule['method'], rule['unit']
    x = f['x']
    if method == 'shortfall_latest_year' and x.get('d') is not None:
        n = x['d'] - x['n']
        return n, f"≈{fmt_n(n)} {unit} in {f['period']} ({fmt_n(x['d'])} − {fmt_n(x['n'])})"
    if method == 'numerator_per_year' and x.get('n') is not None:
        years = LUNG_YEARS if f['period'] == LUNG_PERIOD else 1
        adverse = x['n'] if E.IND[f['id']]['polarity'] < 0 else x['d'] - x['n']
        n = adverse / years
        span = f'over {years} years, ' if years > 1 else ''
        return round(n), f"≈{fmt_n(n)} {unit} a year ({fmt_n(adverse)} {PHRASE_CASES.get(f['id'], 'adverse cases')} {span}{f['period']})"
    if method == 'gap_to_comparator_per_year':
        g = E.assess('lung_curative', code)  # express the gap in patients even when the ratio triggered
        gx = g['x']
        if gx and g['comparator'] is not None:
            gap = max(0.0, (g['comparator'] - gx['v']) / 100 * gx['d'] / LUNG_YEARS)
            return round(gap), (f"≈{fmt_n(gap)} {unit} ({gx['d'] / LUNG_YEARS:,.0f} lung cancer patients a year × "
                                f"{g['comparator'] - gx['v']:.1f} pp gap)")
    if method == 'cases_per_year' and x.get('cases'):
        n = x['cases'] / OUTCOME_YEARS
        what = 'cancer deaths' if f['id'].startswith('mort_') else 'new diagnoses'
        return round(n), f"≈{fmt_n(n)} {what} a year in scope ({fmt_n(x['cases'])} over {OUTCOME_YEARS} years, {f['period']})"
    return None, 'Not estimable from published aggregates'


def fmt_n(x):
    return pe.fmt_n(x)


def build_actions(E, playbooks, code, names, su):
    F = {f['id']: f for f in E.findings(code)}
    actions = []
    for pb in playbooks:
        tv = pb.get('trigger_verdicts', {})
        hits = [F[t] for t in pb['triggers'] if t in F and F[t]['verdict'] in tv.get(t, ['act', 'verify'])]
        if not hits:
            continue
        hits.sort(key=lambda f: (pe.VERDICTS[f['verdict']]['rank'], -abs(f.get('z') or 0)))
        f = top = hits[0]
        if pb.get('primary_indicator'):  # e.g. always audit the no-record count, whichever lung signal triggered
            pf = E.assess(pb['primary_indicator'], code)
            if pf['x'] and pf['comparator'] is not None and pf.get('dir') == 'worse':
                f = pf
        i = E.IND[f['id']]
        gap_n, vol = volume(E, pb, f, code)
        fill = dict(comparator=pe.fmt(f['comparator'], i['unit']), value=pe.fmt(f['x']['v'], i['unit']),
                    short=i['short'], comparator_name=comparator_name(f),
                    stage_unknown=f"{su['pct']}% ({fmt_n(su['n'])} of {fmt_n(su['d'])}, {su['period']})",
                    gap_per_year=fmt_n(gap_n) if gap_n is not None else 'an estimated number of')
        act = dict(
            playbook_id=pb['id'], title=pb['title'], pathway_stage=pb['pathway_stage'], owner=pb['owner'],
            baseline=baseline_text(E, f) + ''.join(
                f"; also {E.IND[h['id']]['short']} {pe.fmt(h['x']['v'], E.IND[h['id']]['unit'])} vs "
                f"{pe.fmt(h['comparator'], E.IND[h['id']]['unit'])}" for h in hits if h['id'] != f['id'])[:400], target=pb['target'].format(**fill), annual_volume=vol,
            timeline=pb['timeline'], first_90_days=list(pb['first_90_days']),
            concrete_steps=[s.format(**fill) for s in pb['concrete_steps']], escalation=pb['escalation'],
            citations=pb['citations'],
            # extras
            verdict=top['verdict'], reason=top['reason'], annual_volume_n=gap_n, primary_indicator=f['id'],
            triggered_by=[dict(id=h['id'], verdict=h['verdict'], v=h['x']['v'], comparator=round(h['comparator'], 3),
                               comparator_kind=h['comparator_kind']) for h in hits],
            evidence_status=pb['evidence_status'], goal=pb['goal'], strategy_actions=pb.get('strategy_actions', []),
            evidence_excerpts=pb['retrieved'],
        )
        if pb['id'] == 'outcome_peer_review':
            bp = E.best_peer(f['id'], code)
            if bp:
                act['peer'] = dict(code=bp['code'], name=names[bp['code']], v=bp['x']['v'])
                act['concrete_steps'][0] += f" Suggested peer: {names[bp['code']]} ({i['short']} {pe.fmt(bp['x']['v'], i['unit'])})."
        actions.append(act)
    actions.sort(key=lambda a: (pe.VERDICTS[a['verdict']]['rank'], -max(abs(F[t['id']].get('z') or 0) for t in a['triggered_by'])))
    return actions


# --------------------------------------------------------------------------- snapshot
def r3(v):
    return None if v is None else round(v, 3)


def county_values(E, code):
    vals = {}
    for i in E.indicators:
        if i['kind'] == 'context':
            continue
        f = E.assess(i['id'], code)
        x = f['x'] or {}
        vals[i['id']] = dict(v=r3(x.get('v')), lo=r3(x.get('lo')), hi=r3(x.get('hi')), n=x.get('n'), d=x.get('d'),
                             comparator=r3(f['comparator']), verdict=f['verdict'],
                             comparator_kind=f['comparator_kind'], period=f['period'], reason=f['reason'],
                             direction=f.get('dir'), distinct=f.get('distinct'), score=f['score'], checks=f['checks'])
        for extra in ('num', 'den', 'cases'):
            if x.get(extra) is not None:
                vals[i['id']][extra] = x[extra]
        if x.get('src'):
            vals[i['id']]['source'] = x['src']
    return vals


def national_headline(E, regions_reporting):
    nat = E.get('lung_noinfo', LUNG_PERIOD, 'SSS')
    vs = [E.get('lung_noinfo', LUNG_PERIOD, c)['v'] for c in regions_reporting if E.get('lung_noinfo', LUNG_PERIOD, c)]
    return (f"{fmt_n(nat['n'])} of {fmt_n(nat['d'])} lung cancer patients ({pe.fmt(nat['v'], '%')}) have no recorded "
            f"treatment within 12 months — {pe.fmt(min(vs), '%')} to {pe.fmt(max(vs), '%')} by county ({LUNG_PERIOD}).")


def run():
    t0 = datetime.datetime.now()
    pre = validate_data.collect(include_snapshot=False)  # source integrity + analytical checks on processed data
    regions, V, context, ctx_year, su = build_values()
    E = pe.Engine(INDICATORS, V, context=context, stage_unknown=su)
    playbooks = load_playbooks()
    names = {r['area_code']: r['area_name_en'] for r in regions}
    counties = []
    for r in regions:
        code = r['area_code']
        counties.append(dict(
            code=code, name=r['area_name_en'], name_fi=r['area_name_fi'],
            headline=pe.headline(E, code, r['area_name_en']),
            stage_verdicts=E.stage_verdicts(code),
            values=county_values(E, code),
            actions=build_actions(E, playbooks, code, names, su),
            peers=[dict(code=p['code'], name=names[p['code']], distance=p['dist']) for p in E.peers(code)],
            context={k: v for k, v in context.get(code, {}).items()},
            context_rates={i['id']: E.get(i['id'], i['periods'][-1], code)['v'] for i in INDICATORS
                           if i['kind'] == 'context' and i['periods'] and E.get(i['id'], i['periods'][-1], code)},
        ))
    nat = {}
    for i in INDICATORS:
        if i['kind'] == 'context':
            continue
        x = E.get(i['id'], i['periods'][-1], 'SSS')
        if x:
            nat[i['id']] = dict(v=r3(x['v']), lo=r3(x.get('lo')), hi=r3(x.get('hi')), n=x.get('n'), d=x.get('d'))
            for extra in ('num', 'den', 'cases'):
                if x.get(extra) is not None:
                    nat[i['id']][extra] = x[extra]
    reporting = [c for c in names if E.get('lung_noinfo', LUNG_PERIOD, c)]
    indicators = [dict(id=i['id'], label=i['label'], short=i['short'], stage=i['stage'], unit=i['unit'],
                       polarity=pe.POLARITY_TEXT[i['polarity']], kind=i['kind'], period=i['periods'][-1],
                       source_url=i['source_url'], is_proxy=i['is_proxy'],
                       periods=i['periods'], desc=i['desc'], caveat=i['caveat'], group=i['group'],
                       value_type=i['value_type'], proxy_for=i.get('proxy_for'))
                  for i in INDICATORS if i['kind'] != 'context']
    snap = dict(
        built=t0.isoformat(timespec='seconds'),
        national_headline=national_headline(E, reporting),
        stages=pe.STAGES,
        indicators=indicators,
        national=nat,
        verdicts={k: dict(label=v['label'], desc=v['desc']) for k, v in pe.VERDICTS.items()},
        counties=counties,
        # ---- extras (documented in docs/DATA_GUIDE.md)
        method=dict(
            comparator='Leave-one-out ("rest of Finland"): (national n − county n) / (national d − county d) for every '
                       'indicator with published counts; age-standardised survival and mortality use the published national value. '
                       'Lung comparators pool published counties; the MDT comparator covers the 18 reporting counties only.',
            signal='A county is flagged when the comparator lies outside the county 95% interval (Wilson for proportions, '
                   'published CI for rates, log-scale Katz CI for the curative:symptomatic ratio). Exploratory rule; '
                   'comparator uncertainty and multiple comparisons are not modelled.',
            lung_rule='Low curative lung treatment is "verify" when the county no-record share is above its comparator, '
                      'otherwise "act" (likely treatment-access or late-detection gap).',
            act_rule='Other adverse signals are "act" when no quality check fails and at most one warns (two if the signal '
                     'persisted across at least three annual releases); otherwise "verify". Recording indicators are always "verify".',
            context_year=ctx_year,
        ),
        stage_unknown=su,
        context_indicators=[dict(id=i['id'], label=i['label'], unit=i['unit'], period=i['periods'][-1],
                                 source_url=i['source_url']) for i in INDICATORS if i['kind'] == 'context'],
        playbooks=[{k: v for k, v in pb.items() if k not in ('retrieved',)} for pb in playbooks],
        data_gaps=[
            dict(stage='referral', what='Primary → specialist referral timestamps and waiting times',
                 why='No cancer-specific referral-delay series is published by county; THL Sotkanet and the specialist '
                     'waiting-time endpoint returned HTTP 403 during collection. The referral stage uses proxies only.',
                 sources=[f['source_url'] for f in json.loads((CAT / 'validation.json').read_text()).get('failed_sources', [])]),
            dict(stage='diagnosis', what='Stage at diagnosis by county',
                 why=f"Stage is missing for {su['pct']}% of lung cancers {su['period']} nationally (lung quality report, "
                     f"{su['table']}); county stage tables are published only as images.", sources=[LUNG_URL]),
        ],
        limitations=[
            'Aggregate, observational data: verdicts are triage signals, not proof of cause or of care quality.',
            'Missing treatment records do not prove absence of treatment.',
            'Lung treatment categories overlap; no stage, age or comorbidity adjustment.',
            'Survival and mortality are age-standardised only and compared with the national value (the county is included).',
            'Referral-stage indicators are proxies; no referral-delay measure exists in public data.',
            'Åland (HVA91) is outside the published lung and outcome tables and is covered by screening only in some years.',
        ],
    )
    post = validate_data.snapshot_checks(snap)
    a_checks = pre['analytical'] + post
    snap['validation'] = dict(source_integrity=len(pre['source_integrity']), analytical=len(a_checks), passed=True,
                              citations_verified=sum(1 for pb in playbooks for e in pb['evidence'] if e.get('verified')),
                              citations_total=sum(len(pb['evidence']) for pb in playbooks))
    snap['analytical_checks'] = dict(count=len(a_checks), sample=a_checks[:20],
                                     groups=dict(collections.Counter(c.split(':')[0] for c in a_checks)))
    validate_data.write_report(pre['source_integrity'], a_checks)
    OUT.write_text(json.dumps(snap, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    verdicts = collections.Counter(v for c in counties for v in c['stage_verdicts'].values())
    print(json.dumps(dict(out=str(OUT.relative_to(ROOT)), indicators=len(indicators), areas=len(counties),
                          actions=sum(len(c['actions']) for c in counties), stage_verdicts=verdicts,
                          validation=snap['validation'], kb=round(OUT.stat().st_size / 1024)), indent=2, ensure_ascii=False))
    print(snap['national_headline'])


if __name__ == '__main__':
    run()
