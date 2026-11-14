#!/usr/bin/env python3
"""Build dashboard/data.js: county geometry, indicators, playbooks and retrieved evidence.

The output is a plain JS file (window.DASHBOARD_DATA = {...}) so the dashboard
opens straight from disk without a web server. Every value keeps a pointer to
its source table so the UI can show provenance.
"""
import csv, json, math, re, collections, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROC = ROOT / 'data/processed'
CAT = ROOT / 'data/catalog'
GEO = ROOT / 'data/raw/geo/hyvinvointialue1000k_2025_epsg3067.json'
GEO_URL = ('https://geo.stat.fi/geoserver/tilastointialueet/wfs?service=WFS&version=2.0.0&request=GetFeature'
           '&typeName=tilastointialueet:hyvinvointialue1000k_2025&outputFormat=json&srsName=EPSG:3067')
OUT = ROOT / 'dashboard/data.js'


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


# --------------------------------------------------------------------------- geometry
def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy) or 1e-9
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        x0, y0 = pts[i]
        d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
    return [pts[0], pts[-1]]


def ring_area(r):
    return abs(sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1))) / 2


def geometry():
    g = json.loads(GEO.read_text())
    out = {}
    for f in g['features']:
        code = 'HVA' + f['properties']['hyvinvointialue']
        polys = f['geometry']['coordinates'] if f['geometry']['type'] == 'MultiPolygon' else [f['geometry']['coordinates']]
        rings = []
        for poly in polys:
            outer = poly[0]  # holes (lakes) are not drawn in a choropleth
            if ring_area(outer) < 8e6:  # drop islets < 8 km²
                continue
            pts = [tuple(p) for p in outer]
            mid = len(pts) // 2  # closed ring: simplify both halves so endpoints differ
            s = rdp(pts[:mid + 1], 450)[:-1] + rdp(pts[mid:], 450)
            if len(s) >= 4:
                rings.append([[round(x / 100), round(y / 100)] for x, y in s])  # 100 m units
        out[code] = rings
    return out


# --------------------------------------------------------------------------- indicators
INDICATORS = []


def ind(**k):
    k.setdefault('polarity', 0)
    k.setdefault('kind', 'process')
    INDICATORS.append(k)
    return k['id']


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
            tid = int(r['table_id'].split('_t')[1])
            first_tab[k] = min(first_tab.get(k, 10**9), tid)
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

    screening(ind(id='scr_breast_att', label='Breast screening attendance', short='Breast screening', stage='detection',
                  unit='%', polarity=1, kind='process', group='Screening',
                  desc='Attended mammography screening, % of invited women aged 50–69 (age-group programme).',
                  caveat='Invitation coverage and cohort composition differ between counties; private mammography is not counted.'),
              'breast', 'Screening process', 'Attended (of invited) | N', 'Invited | N')
    screening(ind(id='scr_cervix_att', label='Cervical screening attendance', short='Cervical screening', stage='detection',
                  unit='%', polarity=1, group='Screening',
                  desc='Attended cervical screening, % of invited (age-group programme).',
                  caveat='Opportunistic tests outside the programme are not counted as attendance.'),
              'cervix', 'Screening process', 'Attended (of invited) | N', 'Invited | N')
    screening(ind(id='scr_crc_att', label='Colorectal screening attendance', short='Bowel screening', stage='detection',
                  unit='%', polarity=1, group='Screening',
                  desc='Returned a FIT kit, % of persons picked for the programme (programme launched 2022).',
                  caveat='Programme is being rolled out by birth cohort; early years cover the youngest cohorts only.'),
              'colorectal', 'Screening process', 'Attended | N', 'Picked | N')
    screening(ind(id='scr_crc_colo', label='Colonoscopy after positive FIT', short='FIT → colonoscopy', stage='followup',
                  unit='%', polarity=1, group='Screening follow-up',
                  desc='Attended colonoscopy, % of screening test positives.',
                  caveat='Clinical exclusions, colonoscopies outside the programme and late registrations count as non-attendance.'),
              'colorectal', 'Screening process', 'Attended colonoscopy (of test positives) | N', 'Test positives | N')
    screening(ind(id='scr_cervix_colpo', label='Colposcopy after referral', short='Referral → colposcopy', stage='followup',
                  unit='%', polarity=1, group='Screening follow-up',
                  desc='Attended colposcopy, % of those referred from age-group cervical screening.',
                  caveat='Small denominators in some counties; colposcopies done outside programme may be missing.'),
              'cervix', 'Screening process', 'Attended colposcopy (of those referred) | N',
              'Referral to colposcopy (of those who participated) | N')
    screening(ind(id='scr_breast_missing', label='Missing outcome after breast referral', short='Breast referral outcome missing',
                  stage='followup', unit='%', polarity=-1, kind='data_quality', group='Data completeness',
                  desc='Referred to specialist care after screening, but final diagnosis missing in the screening register (%).',
                  caveat='Measures register completeness, not clinical care.'),
              'breast', 'Screening results', 'Missing information (of referred) | N', 'Referral to specialized healthcare (of examined) | N')

    # ---- Lung cancer quality report 2019–2023 (county treatment patterns) --------
    lung = read('county_lung_treatment_2019_2023.csv')
    LT = {'Parantava': ('lung_curative', 'Lung: curative treatment', 'Curative lung treatment', 'treatment', 1, 'process',
                        'Patients with recorded curative treatment (surgery, chemoradiation or stereotactic RT) within 12 months, %.',
                        'Not adjusted for stage, age or comorbidity; 47.7 % of lung cancers nationally lack stage information.'),
          'Jarruttava': ('lung_lifeprolong', 'Lung: life-prolonging treatment', 'Life-prolonging lung treatment', 'treatment', 0, 'process',
                         'Patients with recorded life-prolonging (non-curative) drug or radiotherapy within 12 months, %.',
                         'Higher or lower is not inherently better without stage information.'),
          'Oireenmukainen': ('lung_symptomatic', 'Lung: symptomatic care', 'Symptomatic lung care', 'treatment', 0, 'process',
                             'Patients with recorded symptomatic care, %. Categories overlap.',
                             'Interpretation depends on stage and frailty, which are not adjusted for.'),
          'Ei hoitotietoa': ('lung_noinfo', 'Lung: no treatment record', 'No lung treatment record', 'diagnosis', -1, 'data_quality',
                             'Patients with no recorded treatment of any kind within 12 months of diagnosis, %.',
                             'Missing records do not prove absence of treatment; mixes untreated patients and recording gaps.'),
          'MDT-käsittely': ('lung_mdt', 'Lung: MDT discussion recorded', 'MDT recorded', 'diagnosis', 1, 'data_quality',
                            'Patients with a recorded multidisciplinary team (MDT) meeting code, %.',
                            'Near-zero values cannot distinguish low recording from actual MDT practice. Not reported for 4 counties.')}
    for k, (iid, label, short, stage, pol, kind, desc, cav) in LT.items():
        ind(id=iid, label=label, short=short, stage=stage, unit='%', polarity=pol, kind=kind, group='Lung cancer 2019–2023',
            desc=desc, caveat=cav)
    tot = collections.defaultdict(lambda: [0, 0])
    for r in lung:
        iid = LT[r['treatment_type_fi']][0]
        n, d = num(r['treatment_n']), num(r['patients_n'])
        V[iid]['2019–2023'][r['area_code']] = prop(n, d, dict(table=r['table_id'], url=r['source_url']))
        tot[iid][0] += n
        tot[iid][1] += d
    for iid, (n, d) in tot.items():
        # national comparator for MDT uses only reporting counties
        V[iid]['2019–2023']['SSS'] = prop(n, d, dict(table='sum of reported counties', url=lung[0]['source_url']))

    # ---- Cancer in Finland 2024: survival, mortality, incidence ------------------
    out = read('regional_cancer_outcomes_2024.csv')
    collab = {}
    CAN = [('lung', 'male', 'Lung (men)'), ('lung', 'female', 'Lung (women)'), ('breast', 'female', 'Breast'),
           ('colorectal', 'both', 'Colorectal'), ('prostate', 'male', 'Prostate')]
    for cancer, sex, name in CAN:
        key = f'{cancer}_{sex}'
        ind(id=f'surv_{key}', label=f'5-yr relative survival: {name}', short=f'{name} survival', stage='outcome', unit='%',
            polarity=1, kind='outcome', group='Outcomes 2020–2024', cancer=cancer,
            desc=f'Age-standardised 5-year relative survival, {name.lower()} cancer, diagnosed 2020–2024 (period method).',
            caveat='Wide intervals in small counties; reflects stage at diagnosis as well as treatment.')
        ind(id=f'mort_{key}', label=f'Mortality: {name}', short=f'{name} mortality', stage='outcome', unit='/100k',
            polarity=-1, kind='outcome', group='Outcomes 2020–2024', cancer=cancer,
            desc=f'Age-standardised cancer mortality per 100 000, {name.lower()}, 2020–2024.',
            caveat='Driven by incidence (e.g. smoking history) as well as care quality.')
        ind(id=f'inc_{key}', label=f'Incidence: {name}', short=f'{name} incidence', stage='context', unit='/100k',
            polarity=0, kind='context', group='Outcomes 2020–2024', cancer=cancer,
            desc=f'Age-standardised incidence per 100 000, {name.lower()}, 2020–2024.',
            caveat='Context only: higher incidence can reflect risk factors or more active detection.')
        for r in out:
            if r['cancer'] != cancer or r['sex'] != sex:
                continue
            code = r['area_code'] if r['area_level'] != 'national' else 'SSS'
            if not code:
                continue
            if r['area_level'] == 'county':
                collab[code] = r['collaboration_area']
            src = dict(table=r['table_id'], url=r['source_url'])
            for pref, col, ncol in [('surv', 'relative_survival_5y_pct', 'incidence_n'), ('mort', 'mortality_rate', 'mortality_n'),
                                    ('inc', 'incidence_rate', 'incidence_n')]:
                v = num(r[col])
                if v is None:
                    continue
                V[f'{pref}_{key}']['2020–2024'][code] = dict(v=v, lo=num(r[col + '_ci_lower']), hi=num(r[col + '_ci_upper']),
                                                             n=int(num(r[ncol]) or 0), src=src)

    # ---- Context: Statistics Finland 11ra, latest year -------------------------
    pop = read('statfin_11ra.csv')
    year = max(r['timeperiod_y'] for r in pop)
    CTX = [('vaerak-vaesto', 'ctx_pop', 'Population', 'Population', ''),
           ('vaesto_yli64_p', 'ctx_65', 'Population aged 65+', 'Aged 65+', '%'),
           ('vaesto_ms_p', 'ctx_rural', 'Population in rural areas', 'Rural share', '%'),
           ('vaerak-vaesto_maa_pa', 'ctx_density', 'Population density', 'Density', '/km²'),
           ('vaesto_kieli_ulk_p', 'ctx_foreign', 'Foreign-language speakers', 'Foreign-language', '%'),
           ('vaesto_kieli_sv_p', 'ctx_swedish', 'Swedish speakers', 'Swedish-speaking', '%')]
    for code_s, iid, label, short, unit in CTX:
        ind(id=iid, label=label, short=short, stage='context', unit=unit, kind='context', group=f'Population {year}',
            desc=f'{label}, Statistics Finland table 11ra, {year}.', caveat='Context for peer matching; not a care indicator.')
    m = {c[0]: c[1] for c in CTX}
    for r in pop:
        if r['timeperiod_y'] == year and r['contentscode'] in m and (r['alue_23_20260101'] in codes or r['alue_23_20260101'] == 'SSS'):
            v = num(r['value'])
            if v is not None:
                V[m[r['contentscode']]][year][r['alue_23_20260101']] = dict(v=v, src=dict(table='StatFin 11ra', url=r['source_url']))

    for i in INDICATORS:
        i['periods'] = sorted(V[i['id']].keys())
    return regions, collab, V


# --------------------------------------------------------------------------- evidence retrieval
PLAYBOOKS = [
    dict(id='screening_reminders', title='Raise screening participation',
         triggers=['scr_breast_att', 'scr_cervix_att', 'scr_crc_att'],
         query='muistutus muistutuskirje kutsu osallistuminen osallistumisaste kieli kieliversio reminder invitation participation',
         docs=['manual_', 'colorectal_screening_quality_manual', 'toimeenpanon_tiekartta'],
         strategy='2.4.1 / 2.4.5'),
    dict(id='positive_fit_followup', title='Close the loop after a positive FIT',
         triggers=['scr_crc_colo'],
         query='kolonoskopia jatkotutkimus positiivinen seulontahoitaja yhteydenotto colonoscopy follow-up positive',
         docs=['Suolistosyovan', 'colorectal_screening_quality_manual'], strategy='2.4.1'),
    dict(id='colposcopy_followup', title='Close the loop after a colposcopy referral',
         triggers=['scr_cervix_colpo'],
         query='kolposkopia jatkotutkimus lähete seuranta poisjääneet colposcopy referral follow-up',
         docs=['Kohdunkaulan'], strategy='2.4.1',
         base=dict(proposal='Track every referred woman to a colposcopy result: reminder and re-booking for non-attenders, '
                            'check whether colposcopies done outside the programme reach the screening register, then fix verified gaps',
                   owner='County cervical screening and gynaecology leads',
                   measure=['colposcopy attended within programme window', 'referred with no recorded colposcopy', 'register linkage completeness'],
                   goal='Detection-to-diagnosis; Goal 2 screening quality with Goal 3 pathway relevance',
                   evidence_status='Guidance-supported proposal; local benefit unestimated; requires clinical validation')),
    dict(id='stage_mdt_completeness', title='Verify recording before judging care',
         triggers=['lung_noinfo', 'lung_mdt', 'lung_curative', 'lung_lifeprolong', 'lung_symptomatic', 'scr_breast_missing'],
         query='laaturekisteri kattavuus kirjaaminen levinneisyys tieto puuttuu moniammatillinen kliininen ilmoitus registry completeness stage MDT',
         docs=['toimeenpanon_tiekartta', 'lung_2019_2023', 'lung_quality', 'registry_quality', 'clinical_notifications'],
         strategy='3.2.1 / 3.2.2'),
    dict(id='outcome_peer_review', title='Peer review of a survival gap',
         triggers=['surv_lung_male', 'surv_lung_female', 'surv_breast_female', 'surv_colorectal_both', 'surv_prostate_male',
                   'mort_lung_male', 'mort_lung_female', 'mort_breast_female', 'mort_colorectal_both', 'mort_prostate_male'],
         query='vertaiskehittäminen vertaisarviointi laaturekisteri alueelliset erot eloonjäämisennuste peer review regional differences survival',
         docs=['toimeenpanon_tiekartta', 'syopastrategia_2026_2035', 'oecd_finland'], strategy='3.2.2 / 3.2.3 / 3.1.4',
         base=dict(proposal='Run a structured peer review with a comparable county that has better outcomes: compare stage at diagnosis, '
                            'diagnostic route and treatment mix, agree one pathway change, and re-measure annually',
                   owner='County cancer centre lead with the collaboration-area (YTA) quality group',
                   measure=['stage distribution at diagnosis', 'share diagnosed via emergency route', '5-year relative survival trend'],
                   goal='Goal 3.2.2 peer development and 3.2.3 response mechanisms',
                   evidence_status='Strategy-supported process; causal drivers unverified; requires clinical review')),
    dict(id='pathway_coordination', title='Measure and coordinate the pathway',
         triggers=['__referral_gap__'],
         query='hoitoketju lähetekriteerit viive odotusaika koordinaattori standardoitu pathway delay waiting time coordinator',
         docs=['toimeenpanon_tiekartta', 'sweden_svf', 'delay_meta_analysis'], strategy='2.5.2 / 3.1.2 / 3.1.4'),
]


def tokens(t):
    return re.findall(r'[a-zåäö0-9]{3,}', t.lower())


def retrieve(chunks, pb, k=3):
    pool = [c for c in chunks if any(d in c['document_id'] for d in pb['docs'])]
    if not pool:
        return []
    q = set(tokens(pb['query']))
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
            # prefix match catches Finnish inflections (kolonoskopia → kolonoskopiaan)
            f = sum(v for x, v in tf.items() if x.startswith(w[:7]))
            if f:
                dfw = sum(v for x, v in df.items() if x.startswith(w[:7]))
                idf = math.log(1 + (N - dfw + .5) / (dfw + .5))
                s += idf * f * 2.2 / (f + 1.2 * (.25 + .75 * len(t) / avg))
        return s

    ranked = sorted(zip(pool, toks), key=lambda x: -score(x[1]))
    picked, seen = [], set()
    for c, t in ranked:  # first pass: one chunk per document (diversify sources)
        if c['document_id'] not in seen and len(picked) < k:
            seen.add(c['document_id'])
            picked.append((c, t))
    for c, t in ranked:  # fill remaining slots
        if len(picked) >= k:
            break
        if all(c is not p[0] for p in picked):
            picked.append((c, t))
    picked.sort(key=lambda x: -score(x[1]))
    res = []
    for c, t in picked:
        text = re.sub(r'\s+', ' ', c['text']).strip()
        # take the densest 420-char window
        best, bi = -1, 0
        for i in range(0, max(1, len(text) - 420), 40):
            w = text[i:i + 420].lower()
            sc = sum(w.count(x[:7]) for x in q)
            if sc > best:
                best, bi = sc, i
        snip = text[bi:bi + 420]
        if bi > 0:
            snip = '…' + snip[snip.find(' ') + 1:]
        if bi + 420 < len(text):
            snip = snip[:snip.rfind(' ')] + '…'
        doc = c['document_id']
        local = c['source_path'] if c['source_path'] else doc
        res.append(dict(doc=doc, page=c['pdf_page'], url=c['source_url'] or '', local=local, text=snip,
                        score=round(score(t), 2), chunk=c['chunk_id']))
        if len(res) >= k:
            break
    return res


def playbooks():
    cat = {r['id']: r for r in json.loads((CAT / 'recommendations.json').read_text())}
    chunks = [json.loads(l) for l in open(PROC / 'evidence_chunks.jsonl', encoding='utf-8')]
    out = []
    for pb in PLAYBOOKS:
        base = dict(cat.get(pb['id'], {}))
        base.update(pb.get('base', {}))
        out.append(dict(id=pb['id'], title=pb['title'], triggers=pb['triggers'], strategy=pb['strategy'],
                        proposal=base['proposal'], owner=base['owner'], measure=base['measure'], goal=base['goal'],
                        evidence_status=base['evidence_status'], citations=base.get('evidence', []),
                        retrieved=retrieve(chunks, pb)))
    return out


def run():
    regions, collab, V = build_values()
    geo = geometry()
    val = json.loads((CAT / 'validation.json').read_text())
    data = dict(
        built=datetime.datetime.now().isoformat(timespec='seconds'),
        regions=[dict(code=r['area_code'], name=r['area_name_en'], name_fi=r['area_name_fi'],
                      collab=collab.get(r['area_code'], ''), mainland=r['screening_mainland_coverage'] == 'True') for r in regions],
        geometry=geo, geometry_source=GEO_URL,
        indicators=INDICATORS, values=V, playbooks=playbooks(),
        gaps=[dict(stage='referral', what='Primary → specialist referral and waiting-time data',
                   why='THL Sotkanet and specialist waiting-time endpoints returned HTTP 403; cancer-specific referral timestamps are unavailable in this collected bundle.',
                   sources=[f['source_url'] for f in val['failed_sources']]),
              dict(stage='diagnosis', what='Stage at diagnosis by county',
                   why='47.7 % of lung cancers 2019–2023 lack stage information nationally (lung quality report, table 4.1.3).',
                   sources=['https://cancerregistry.fi/assets/themes/ssy3/factsheets/keuhkosyoparaportti.html'])],
        validation=dict(status=val['status'], checks=val['checks_passed'], sources=val['downloaded_sources']),
    )
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text('// Generated by scripts/build_dashboard_data.py — do not edit.\nwindow.DASHBOARD_DATA = '
                   + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    n = sum(len(c) for p in V.values() for c in p.values())
    print(json.dumps(dict(indicators=len(INDICATORS), values=n, areas=len(geo), playbooks=len(data['playbooks']),
                          kb=round(OUT.stat().st_size / 1024)), indent=2))


if __name__ == '__main__':
    run()
