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
    yta_by_code = {}
    for r in lung:
        iid = LT[r['treatment_type_fi']][0]
        n, d = num(r['treatment_n']), num(r['patients_n'])
        src = dict(table=r['table_id'], url=r['source_url'])
        V[iid][LUNG_PERIOD][r['area_code']] = prop(n, d, src)
        by[r['area_code']][iid] = (n, d, src)
        tot[iid][0] += n
        tot[iid][1] += d
        if r.get('collaboration_area_fi'):
            yta_by_code[r['area_code']] = r['collaboration_area_fi']
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

    # ---- Mortality trend: StatFin 13u5 (malignant neoplasms 04-21, 2020–2025) ----
    mort_trend = collections.defaultdict(dict)
    for r in read('statfin_13u5.csv'):
        a, yr = r['alue_23_20260101'], r['timeperiod_y']
        if r['kuolinsyyt_1_20210101'] == '04-21' and yr >= '2020' and (a in codes or a == 'SSS'):
            v = num(r['value'])
            if v is not None:
                entry = mort_trend[a].setdefault(yr, {'year': int(yr)})
                if r['contentscode'] == 'ksyylkm':
                    entry['deaths'] = int(round(v))
                elif r['contentscode'] == 'ksyycdr':
                    entry['crude_rate'] = round(v, 1)
    mort_series = {a: [mort_trend[a][y] for y in sorted(mort_trend[a])] for a in mort_trend}
    return regions, V, dict(context), year, su, yta_by_code, mort_series


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
    'pathway_equity_monitoring': dict(query='yhdenvertaisuus kieli kuukausittain seulontarekisteri vertaisarviointi laaturekisteri equity language monthly reporting',
                                      docs=['toimeenpanon_tiekartta', 'manual_', 'syopastrategia_2026_2035']),
}

YTA_MAP = {
    'Etelä-Suomen yhteistyöalue': ('YTA1', 'Southern Finland (FICAN South / HUS)'),
    'Länsi-Suomen yhteistyöalue': ('YTA2', 'Western Finland (FICAN West / TYKS)'),
    'Sisä-Suomen yhteistyöalue': ('YTA3', 'Inland Finland (FICAN Mid / TAYS)'),
    'Itä-Suomen yhteistyöalue': ('YTA4', 'Eastern Finland (FICAN East / KYS)'),
    'Pohjois-Suomen yhteistyöalue': ('YTA5', 'Northern Finland (FICAN North / OYS)'),
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


def fmt_eur(x):
    return f"€{int(round(x / 100.0) * 100):,}"


def compute_resources(pb, gap_n):
    rule = pb.get('resource_rule')
    if not rule:
        return {}
    cases = float(gap_n or 0)
    var_h = cases * rule.get('unit_hours', 0.0)
    fix_h = float(rule.get('fixed_hours', 0.0))
    tot_h = round(var_h + fix_h)
    fte = round(tot_h / 1600.0, 2)
    lo = round(cases * rule.get('unit_cost_lo', 0.0) + rule.get('fixed_cost_lo', 0.0))
    hi = round(cases * rule.get('unit_cost_hi', 0.0) + rule.get('fixed_cost_hi', 0.0))
    slots = round(cases * rule.get('capacity_per_case', 0.0))
    cap_unit = rule.get('capacity_unit', 'units / yr')
    fte_txt = f"≈{fte:.2f} FTE" if fte >= 0.05 else f"≈{tot_h:,} staff h/yr"
    slot_txt = f" · ≈{fmt_n(slots)} {cap_unit}" if slots > 0 else f" · {cap_unit}"
    return dict(
        staff_hours=tot_h,
        fte_estimate=fte,
        capacity_slots=slots,
        capacity_unit=cap_unit,
        cost_eur_lo=lo,
        cost_eur_hi=hi,
        resource_summary=f"{fte_txt} ({fmt_n(tot_h)} h/yr){slot_txt}",
        cost_estimate=f"{fmt_eur(lo)}–{fmt_eur(hi)} / yr (operational planning estimate)",
        cost_basis=rule.get('basis', ''),
        unit_hours=rule.get('unit_hours', 0.0),
        fixed_hours=fix_h,
        unit_cost_lo=rule.get('unit_cost_lo', 0.0),
        unit_cost_hi=rule.get('unit_cost_hi', 0.0),
        fixed_cost_lo=rule.get('fixed_cost_lo', 0.0),
        fixed_cost_hi=rule.get('fixed_cost_hi', 0.0),
        capacity_per_case=rule.get('capacity_per_case', 0.0),
    )


def local_tailoring_note(ctx, stage):
    if not ctx:
        return None
    notes = []
    foreign = ctx.get('ctx_foreign')
    swedish = ctx.get('ctx_swedish')
    rural = ctx.get('ctx_rural')
    age65 = ctx.get('ctx_65')
    density = ctx.get('ctx_density')
    if foreign is not None and foreign >= 10.0:
        notes.append(f"{foreign:.1f}% foreign-language residents (nationally screening uptake is 20–22 pp lower in non-domestic language groups): prioritise multilingual Suomi.fi/postal invitations and community outreach")
    if swedish is not None and swedish >= 8.0:
        notes.append(f"{swedish:.1f}% Swedish-speaking population: ensure bilingual Finnish/Swedish invitations, nurse call-backs and pathway navigation")
    if (rural is not None and rural >= 33.0) or (density is not None and density < 10.0):
        r_txt = f"{rural:.1f}% rural residents" if rural is not None else f"{density:.1f} inhab./km²"
        if stage in ('detection', 'referral', 'followup'):
            notes.append(f"high travel distance ({r_txt}): pair mobile screening / mail-in FIT & HPV self-sampling with bundled regional endoscopy/colposcopy appointments")
        else:
            notes.append(f"long hospital travel distances ({r_txt}): bundle CT, biopsy and specialist review into single-visit diagnostic days and remote YTA MDT slots")
    if age65 is not None and age65 >= 27.0:
        notes.append(f"older age profile ({age65:.1f}% aged 65+): keep paper/phone invitation fallbacks alongside Suomi.fi and document frailty/supportive-care decisions explicitly at MDT")
    return '; '.join(notes[:2]).capitalize() + '.' if notes else None


def build_actions(E, playbooks, code, names, su):
    F = {f['id']: f for f in E.findings(code)}
    ctx = E.context.get(code, {})
    actions = []
    for pb in playbooks:
        if pb.get('fallback_only'):
            continue
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
        # Keep action pathway_stage aligned with the stage that actually triggered Act/Verify
        stage = pb['pathway_stage']
        if pb['id'] == 'pathway_coordination' and not any(h['id'] == 'lung_curative' and h['verdict'] == 'act' for h in hits):
            stage = E.IND[top['id']]['stage']
        res = compute_resources(pb, gap_n)
        tailoring = local_tailoring_note(ctx, stage)
        fill = dict(comparator=pe.fmt(f['comparator'], i['unit']), value=pe.fmt(f['x']['v'], i['unit']),
                    short=i['short'], comparator_name=comparator_name(f),
                    stage_unknown=f"{su['pct']}% ({fmt_n(su['n'])} of {fmt_n(su['d'])}, {su['period']})",
                    gap_per_year=fmt_n(gap_n) if gap_n is not None else 'an estimated number of')
        act = dict(
            playbook_id=pb['id'], title=pb['title'], pathway_stage=stage, owner=pb['owner'],
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
            local_tailoring=tailoring,
            **res,
        )
        if pb['id'] == 'outcome_peer_review':
            bp = E.best_peer(f['id'], code)
            if bp:
                act['peer'] = dict(code=bp['code'], name=names[bp['code']], v=bp['x']['v'])
                act['concrete_steps'][0] += f" Suggested peer: {names[bp['code']]} ({i['short']} {pe.fmt(bp['x']['v'], i['unit'])})."
        actions.append(act)

    # Preventive/equity governance action when a county has 0 Act/Verify triggers (e.g. HVA02, HVA17, HVA91)
    if not actions:
        fb = next((pb for pb in playbooks if pb.get('fallback_only')), None)
        if fb:
            avail = [F[t] for t in fb['triggers'] if t in F and F[t]['x'] and F[t]['comparator'] is not None]
            if not avail:
                avail = [v for v in F.values() if v['x'] and v['comparator'] is not None]
            if avail:
                avail.sort(key=lambda x: (0 if x['verdict'] == 'monitor' else 1, -abs(x.get('z') or 0)))
                f = avail[0]
                i = E.IND[f['id']]
                gap_n, vol = volume(E, fb, f, code)
                stage = i['stage']
                res = compute_resources(fb, gap_n)
                tailoring = local_tailoring_note(ctx, stage)
                fill = dict(comparator=pe.fmt(f['comparator'], i['unit']), value=pe.fmt(f['x']['v'], i['unit']),
                            short=i['short'], comparator_name=comparator_name(f),
                            stage_unknown=f"{su['pct']}% ({fmt_n(su['n'])} of {fmt_n(su['d'])}, {su['period']})",
                            gap_per_year=fmt_n(gap_n) if gap_n is not None else 'an estimated number of')
                actions.append(dict(
                    playbook_id=fb['id'], title=fb['title'], pathway_stage=stage, owner=fb['owner'],
                    baseline=baseline_text(E, f), target=fb['target'].format(**fill), annual_volume=vol,
                    timeline=fb['timeline'], first_90_days=list(fb['first_90_days']),
                    concrete_steps=[s.format(**fill) for s in fb['concrete_steps']], escalation=fb['escalation'],
                    citations=fb['citations'],
                    verdict=f['verdict'], reason=f['reason'] or 'Headline indicators are in line; maintain sub-county equity and timestamp readiness.',
                    annual_volume_n=gap_n, primary_indicator=f['id'],
                    triggered_by=[dict(id=f['id'], verdict=f['verdict'], v=f['x']['v'], comparator=round(f['comparator'], 3),
                                       comparator_kind=f['comparator_kind'])],
                    evidence_status=fb['evidence_status'], goal=fb['goal'], strategy_actions=fb.get('strategy_actions', []),
                    evidence_excerpts=fb['retrieved'],
                    local_tailoring=tailoring,
                    **res,
                ))
            else:
                # Area outside mainland screening/lung tables (e.g. HVA91 in latest year): use latest historical series or register linkage
                res = compute_resources(fb, 0)
                actions.append(dict(
                    playbook_id=fb['id'],
                    title='Establish cross-register cancer pathway linkage for Åland',
                    pathway_stage='diagnosis',
                    owner=fb['owner'],
                    baseline='Mainland lung quality (2019–2023) and 2024 screening tables omit Åland; historical breast/cervical screening and StatFin cancer mortality are published.',
                    target='Publish annual screening follow-up and clinical cancer notification completeness incl. TNM stage ≥90% (roadmap 3.2.1)',
                    annual_volume='≈70–90 annual cancer deaths in StatFin context; connect regional EHR notifications to national quality reporting',
                    timeline=fb['timeline'],
                    first_90_days=list(fb['first_90_days']),
                    concrete_steps=[
                        'Confirm clinical cancer notification (kliininen syöpäilmoitus) and TNM stage delivery from Åland Health and Medical Care (ÅHS) to the Finnish Cancer Registry.',
                        'Align mammography, cervical and colorectal screening reporting fields with the 2026 FICAN quality manuals so annual indicators are comparable.',
                        'Track the four cancer-pathway timestamps (referral, first specialist visit, diagnosis, treatment start) for patients treated locally and via TYKS/university hospitals.',
                    ],
                    escalation=fb['escalation'],
                    citations=fb['citations'],
                    verdict='verify',
                    reason='Published mainland lung and 2024 regional outcome tables exclude Åland; verify cross-border TYKS/ÅHS registry linkage.',
                    annual_volume_n=0,
                    primary_indicator='lung_noinfo',
                    triggered_by=[],
                    evidence_status=fb['evidence_status'],
                    goal=fb['goal'],
                    strategy_actions=fb.get('strategy_actions', []),
                    evidence_excerpts=fb['retrieved'],
                    local_tailoring=local_tailoring_note(ctx, 'diagnosis'),
                    **res,
                ))

    actions.sort(key=lambda a: (pe.VERDICTS[a['verdict']]['rank'],
                                -max([abs(F[t['id']].get('z') or 0) for t in a['triggered_by']] or [0])))
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
        if len(i['periods']) > 1:
            hist = []
            for p in i['periods']:
                px = E.get(i['id'], p, code)
                pc, _ = E.comparator(i['id'], p, code)
                if px and px.get('v') is not None:
                    hist.append(dict(period=p, v=r3(px['v']), lo=r3(px.get('lo')), hi=r3(px.get('hi')), comparator=r3(pc)))
            if hist:
                vals[i['id']]['series'] = hist
        for extra in ('num', 'den', 'cases'):
            if x.get(extra) is not None:
                vals[i['id']][extra] = x[extra]
        if x.get('src'):
            vals[i['id']]['source'] = x['src']
    return vals


def build_equity_strata():
    """Extract verified 2024 national screening equity gaps by native language, education and sex."""
    rows = [r for r in read('screening_observations.csv')
            if r['year'] == '2024' and ('Population groups' in r['section'] or 'Whole country' in r['section'])]
    out = []
    specs = [
        ('breast', 'Breast screening attendance', 'Native language', 'Attended (of invited) | %', {'Domestic': 'Domestic (FI/SV/Sámi)', 'Other/missing': 'Other language'}, {}),
        ('cervix', 'Cervical screening attendance', 'Native language', 'Attended (of invited) | %', {'Domestic': 'Domestic (FI/SV/Sámi)', 'Other/missing': 'Other language'}, {}),
        ('colorectal', 'Colorectal screening attendance', 'Native language', 'Attended | %', {'Domestic': 'Domestic (FI/SV/Sámi)', 'Other/missing': 'Other language'}, {'Sex': 'Total'}),
        ('cervix', 'Cervical referral → colposcopy', 'Native language', 'Attended colposcopy (of those referred) | %', {'Domestic': 'Domestic (FI/SV/Sámi)', 'Other/missing': 'Other language'}, {}),
        ('colorectal', 'Colorectal FIT+ → colonoscopy', 'Native language', 'Attended colonoscopy (of test positives) | %', {'Domestic': 'Domestic (FI/SV/Sámi)', 'Other/missing': 'Other language'}, {'Sex': 'Total'}),
        ('breast', 'Breast screening attendance', 'Education', 'Attended (of invited) | %', {'Tertiary/higher education': 'Tertiary', 'Intermediate/secondary': 'Secondary', 'Primary education/unknown': 'Primary / unknown'}, {}),
        ('cervix', 'Cervical screening attendance', 'Education', 'Attended (of invited) | %', {'Tertiary/higher education': 'Tertiary', 'Intermediate/secondary': 'Secondary', 'Primary education/unknown': 'Primary / unknown'}, {}),
        ('colorectal', 'Colorectal screening attendance', 'Education', 'Attended | %', {'Tertiary/higher education': 'Tertiary', 'Intermediate/secondary': 'Secondary', 'Primary education/unknown': 'Primary / unknown'}, {'Sex': 'Total'}),
        ('colorectal', 'Colorectal FIT+ → colonoscopy', 'Sex', 'Attended colonoscopy (of test positives) | %', {'Women': 'Women', 'Men': 'Men'}, {}),
    ]
    for prog, label, dim_key, metric, groups_map, extra_filter in specs:
        found, url = {}, ''
        for r in rows:
            if r['program'] != prog or r['metric'] != metric:
                continue
            dims = json.loads(r['dimensions']) if r.get('dimensions') else {}
            if dim_key not in dims:
                continue
            if any(dims.get(k) != v for k, v in extra_filter.items()):
                continue
            raw_g = dims[dim_key]
            if raw_g in groups_map and num(r['value']) is not None:
                found[groups_map[raw_g]] = round(num(r['value']), 1)
                url = r['source_url']
        if len(found) >= 2:
            vals = list(found.values())
            out.append(dict(
                program=prog, label=label, dimension=dim_key, year='2024', unit='%',
                groups=[dict(group=g, v=found[g]) for g in groups_map.values() if g in found],
                gap_pp=round(max(vals) - min(vals), 1),
                stage='referral' if ('colonoscopy' in label or 'colposcopy' in label) else 'detection',
                source_url=url,
            ))
    return out


def build_national_actions(counties, playbooks, su):
    """Aggregate county playbooks into a national 2026–2031 implementation roadmap."""
    pb_map = {pb['id']: pb for pb in playbooks}
    by_pb = collections.defaultdict(list)
    for c in counties:
        for a in c['actions']:
            by_pb[a['playbook_id']].append((c, a))
    specs = [
        ('stage_mdt_completeness', 'National EHR-to-Registry Automation & HILMO WZC15/WZC20 Coding Fix',
         'THL, Finnish Cancer Registry (FCR), Regional Cancer Centres (FICAN) & 21 HVA CIOs',
         f"Eliminate the 27.4% missing lung treatment-record blind spot and cut missing TNM stage from {su['pct']}% toward ≤10% (≥90% automated clinical notifications by 2030, Roadmap 3.2.1)."),
        ('pathway_coordination', 'National Fast-Track Lung Pathway & 4-Timestamp Referral Pilot',
         'Ministry of Social Affairs and Health (STM), FICAN Thoracic Oncology Groups & County Pathway Leads',
         'Standardise direct GP-to-chest-CT routes (Roadmap 2.5.2) and establish the missing national primary-to-specialist referral-to-treatment timestamp series (Roadmap 3.1.2).'),
        ('screening_reminders', 'Mandatory FICAN Quality-Manual Reminders & Multilingual Outreach in Procurement',
         'National Cancer Screening Steering Group, FCR Mass Screening Registry & County Procurement Leads',
         'Enforce 6-week automated reminders, Suomi.fi multilingual invitations and HPV self-sampling in every county contract (Roadmap 2.4.1 & 2.4.5), targeting the 20–22 pp non-domestic language gap.'),
        ('positive_fit_followup', 'Closed-Loop Positive-Screen Follow-Up & Monthly Endoscopy/Colposcopy Reporting',
         'FCR Screening Register, YTA Endoscopy & Gynaecology Leads',
         'Mandate 2-week screening-nurse callbacks (§11.2.1) and monthly colonoscopy/colposcopy outcome feeds (§12.5, Roadmap 2.4.5) so screen-positive patients never drop out across municipal/HVA moves.'),
        ('outcome_peer_review', 'Annual National YTA Demographic-Peer Benchmarking & Response Mechanism',
         'National Cancer Centre (FICAN) & 5 University-Hospital Collaboration Areas (YTA)',
         'Institutionalise annual demographic-peer reviews of survival/mortality outliers (Roadmap 3.2.2) with binding pathway-escalation plans after two releases (Roadmap 3.2.3).'),
    ]
    out = []
    for pid, title, national_owner, national_target in specs:
        items = by_pb.get(pid, [])
        if pid == 'positive_fit_followup':
            items = items + by_pb.get('colposcopy_followup', [])
        if not items or pid not in pb_map:
            continue
        pb = pb_map[pid]
        area_names = sorted({c['name'] for c, _ in items})
        vol_sum = sum(a.get('annual_volume_n') or 0 for _, a in items)
        lo_sum = sum(a.get('cost_eur_lo') or 0 for _, a in items)
        hi_sum = sum(a.get('cost_eur_hi') or 0 for _, a in items)
        hrs_sum = sum(a.get('staff_hours') or 0 for _, a in items)
        out.append(dict(
            id=f'national_{pid}',
            playbook_id=pid,
            title=title,
            pathway_stage=pb['pathway_stage'],
            owner=national_owner,
            counties_affected=len(area_names),
            county_names=area_names,
            annual_volume_n=round(vol_sum),
            annual_volume=f"≈{fmt_n(vol_sum)} {pb['volume_rule']['unit']} across {len(area_names)} areas",
            staff_hours=round(hrs_sum),
            cost_estimate=f"{fmt_eur(lo_sum)}–{fmt_eur(hi_sum)} / yr aggregated across {len(area_names)} areas",
            target=national_target,
            timeline=pb['timeline'],
            strategy_actions=pb.get('strategy_actions', []),
            goal=pb['goal'],
            citations=pb['citations'],
        ))
    return out


def national_headline(E, regions_reporting, counties):
    nat = E.get('lung_noinfo', LUNG_PERIOD, 'SSS')
    vs = [E.get('lung_noinfo', LUNG_PERIOD, c)['v'] for c in regions_reporting if E.get('lung_noinfo', LUNG_PERIOD, c)]
    act_n = sum(1 for c in counties if 'act' in c['stage_verdicts'].values())
    return (f"{act_n} of {len(counties)} areas have an actionable cancer-pathway gap, while "
            f"{fmt_n(nat['n'])} of {fmt_n(nat['d'])} lung cancer patients ({pe.fmt(nat['v'], '%')}, "
            f"{pe.fmt(min(vs), '%')} to {pe.fmt(max(vs), '%')} by county, {LUNG_PERIOD}) lack a 12-month treatment record "
            f"— separating where to change care now from where to audit records first.")


def run():
    t0 = datetime.datetime.now()
    pre = validate_data.collect(include_snapshot=False)  # source integrity + analytical checks on processed data
    regions, V, context, ctx_year, su, yta_by_code, mort_series = build_values()
    E = pe.Engine(INDICATORS, V, context=context, stage_unknown=su)
    playbooks = load_playbooks()
    names = {r['area_code']: r['area_name_en'] for r in regions}
    counties = []
    for r in regions:
        code = r['area_code']
        raw_yta = yta_by_code.get(code)
        yta_code, yta_name = YTA_MAP.get(raw_yta, ('YTA_AX', 'Autonomous Åland') if code == 'HVA91' else ('YTA0', 'Unassigned'))
        counties.append(dict(
            code=code, name=r['area_name_en'], name_fi=r['area_name_fi'],
            yta_code=yta_code, yta_name=yta_name,
            headline=pe.headline(E, code, r['area_name_en']),
            stage_verdicts=E.stage_verdicts(code),
            values=county_values(E, code),
            actions=build_actions(E, playbooks, code, names, su),
            peers=[dict(code=p['code'], name=names[p['code']], distance=p['dist']) for p in E.peers(code)],
            context={k: v for k, v in context.get(code, {}).items()},
            context_rates={i['id']: E.get(i['id'], i['periods'][-1], code)['v'] for i in INDICATORS
                           if i['kind'] == 'context' and i['periods'] and E.get(i['id'], i['periods'][-1], code)},
            mortality_trend=mort_series.get(code, []),
        ))
    nat = {}
    for i in INDICATORS:
        if i['kind'] == 'context':
            continue
        x = E.get(i['id'], i['periods'][-1], 'SSS')
        if x:
            nat[i['id']] = dict(v=r3(x['v']), lo=r3(x.get('lo')), hi=r3(x.get('hi')), n=x.get('n'), d=x.get('d'))
            if len(i['periods']) > 1:
                nat[i['id']]['series'] = [
                    dict(period=p, v=r3(E.get(i['id'], p, 'SSS')['v']),
                         lo=r3(E.get(i['id'], p, 'SSS').get('lo')), hi=r3(E.get(i['id'], p, 'SSS').get('hi')))
                    for p in i['periods'] if E.get(i['id'], p, 'SSS') and E.get(i['id'], p, 'SSS').get('v') is not None
                ]
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
    equity_strata = build_equity_strata()
    national_actions = build_national_actions(counties, playbooks, su)
    snap = dict(
        built=t0.isoformat(timespec='seconds'),
        national_headline=national_headline(E, reporting, counties),
        stages=pe.STAGES,
        indicators=indicators,
        national=nat,
        national_mortality_trend=mort_series.get('SSS', []),
        equity_strata=equity_strata,
        national_actions=national_actions,
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
