#!/usr/bin/env python3
"""Validate the data bundle in two separately reported groups.

* Source integrity: the archived files are what the catalog says they are (hashes, PDF
  signatures, extracted CSV shapes, StatFin flattening). These prove provenance, not correctness.
* Analytical: the numbers used for decisions are internally consistent (confidence-interval
  ordering, numerators within denominators, county sums equal published national totals,
  published percentages reproduce from counts, snapshot completeness and comparator arithmetic).

Run standalone to (re)write data/catalog/validation.json; build_pathway_snapshot.py calls the
same functions and stores the counts in the snapshot. Raises AssertionError on the first failure.
"""
import collections, csv, hashlib, json, math, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/processed'
CAT = ROOT / 'data/catalog'
RAW = ROOT / 'data/raw'
SNAPSHOT = OUT / 'pathway_snapshot.json'
STAGES = ['detection', 'followup', 'referral', 'diagnosis', 'treatment', 'outcome']
VERDICTS = {'act', 'verify', 'monitor', 'ok', 'nodata'}


def rows(p):
    with p.open(newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


class Checks(list):
    def __call__(self, condition, label):
        if not condition:
            raise AssertionError(label)
        self.append(label)


def source_integrity():
    check = Checks()
    downloads = json.loads((CAT / 'downloads.json').read_text())
    for key, r in downloads.items():
        if r['status'] != 'downloaded':
            continue
        p = ROOT / r['path']
        check(hashlib.sha256(p.read_bytes()).hexdigest() == r['sha256'], 'SHA256: ' + key)
        if p.suffix == '.pdf':
            check(p.read_bytes().startswith(b'%PDF'), 'PDF signature: ' + key)
    for f in json.loads((CAT / 'provided_files.json').read_text()):
        p = ROOT / f['path']
        check(p.exists() and hashlib.sha256(p.read_bytes()).hexdigest() == f['sha256'], 'SHA256 provided: ' + f['path'])
    tables = json.loads((CAT / 'tables.json').read_text())
    check(len({x['table_id'] for x in tables}) == len(tables), 'Table catalog: unique table identifiers')
    for t in tables:
        rs = rows(ROOT / t['csv_path'])
        check(len(rs) == t['row_count'] and all(None not in r and None not in r.values() for r in rs), 'CSV shape: ' + t['table_id'])
    for table in ['11ra', '11ay', '13u5']:
        d = json.loads((RAW / f'statfin/{table}_data.json').read_text())
        check(len(rows(OUT / f'statfin_{table}.csv')) == math.prod(d['size']), 'StatFin dimension product: ' + table)
    return list(check)


def analytical():
    check = Checks()
    tables = json.loads((CAT / 'tables.json').read_text())
    regions = rows(OUT / 'regions.csv')
    check(len(regions) == 23 and len({r['area_code'] for r in regions}) == 23, 'Regions: 23 unique HVA areas')

    outcomes = rows(OUT / 'regional_cancer_outcomes_2024.csv')
    check(collections.Counter(r['area_level'] for r in outcomes) == {'county': 110, 'collaboration_area': 25, 'national': 5},
          'Outcome geography: 22 mainland counties/city, 5 collaboration areas, national, per cancer/sex series')
    for r in outcomes:
        for stem in ['incidence_rate', 'relative_survival_5y_pct', 'mortality_rate']:
            if r[stem + '_ci_lower']:
                check(float(r[stem + '_ci_lower']) <= float(r[stem]) <= float(r[stem + '_ci_upper']),
                      f"CI ordering: {r['cancer']} {r['sex']} {r['area']} {stem}")

    screening = rows(OUT / 'county_screening.csv')
    check(all(r['area_code'] for r in screening), 'Screening: every county observation has an official area code')
    sums = collections.defaultdict(lambda: collections.defaultdict(float))
    for r in screening:
        if r['strata'] == '{}' and r['metric'].endswith('| N') and r['value'] != '':
            sums[(r['table_id'], r['section'], r['metric'])][r['area_code']] += float(r['value'])
    for k, m in sums.items():
        if 'SSS' in m:
            check(abs(sum(v for c, v in m.items() if c != 'SSS') - m['SSS']) < 0.5, 'County sum = national: ' + ' '.join(k))
    # Numerator within denominator for every screening indicator used by the snapshot.
    pairs = [('Attended (of invited) | N', 'Invited | N'), ('Attended | N', 'Picked | N'),
             ('Attended colonoscopy (of test positives) | N', 'Test positives | N'),
             ('Attended colposcopy (of those referred) | N', 'Referral to colposcopy (of those who participated) | N'),
             ('Missing information (of referred) | N', 'Referral to specialized healthcare (of examined) | N')]
    cell = collections.defaultdict(dict)
    for r in screening:
        if r['strata'] == '{}' and r['value'] != '':
            cell[(r['table_id'], r['area_code'])][r['metric']] = float(r['value'])
    for (tid, code), m in cell.items():
        for n, d in pairs:
            if n in m and d in m:
                check(0 <= m[n] <= m[d], f'Numerator ≤ denominator: {tid} {code} {n}')
    for t in tables:
        if t['source_id'] != 'colorectal' or 'Wellbeing services counties' not in t['heading_path'] or 'Screening process' not in t['heading_path']:
            continue
        for r in rows(ROOT / t['csv_path']):
            check(abs(100 * int(r['Attended | N']) / int(r['Picked | N']) - float(r['Attended | %'])) <= 0.051,
                  f"Published % reproduces from counts: {t['table_id']} {r['Wellbeing service county']}")

    lung = rows(OUT / 'county_lung_treatment_2019_2023.csv')
    check(all(r['area_code'] and r['treatment_type_fi'] and r['collaboration_area_fi'] for r in lung),
          'Lung: group headings propagated to county observations')
    check(len({(r['area_code'], r['treatment_type_fi']) for r in lung}) == len(lung), 'Lung: treatment keys unique')
    for r in lung:
        check(abs(100 * float(r['treatment_n']) / float(r['patients_n']) - float(r['share_pct'])) <= 0.051,
              f"Published % reproduces from counts: lung {r['area_code']} {r['treatment_type_fi']}")
        check(0 <= float(r['treatment_n']) <= float(r['patients_n']), f"Numerator ≤ denominator: lung {r['area_code']} {r['treatment_type_fi']}")
    den = collections.defaultdict(set)
    for r in lung:
        if r['treatment_type_fi'] != 'MDT-käsittely':
            den[r['area_code']].add(r['patients_n'])
    for code, s in den.items():
        check(len(s) == 1, f'Lung: one patient denominator across treatment categories {code}')
    text = (RAW / 'quality/lung_2019_2023.txt').read_text(encoding='utf-8')
    m = re.search(r'Taulukko\s4:\sKeuhkosyöpäpotilaiden\slevinneisyysluokitus.*?Ei tietoa\s+(\d+)\s+([\d.]+)\s+Yhteensä\s+(\d+)', text, re.S)
    check(m is not None, 'Lung stage table: stage-unknown row present')
    check(abs(100 * int(m.group(1)) / int(m.group(3)) - float(m.group(2))) <= 0.051, 'Lung stage table: unknown share reproduces from counts')
    county_patients = sum(float(next(iter(s))) for s in den.values())
    check(county_patients <= int(m.group(3)), 'Lung: county patient sum does not exceed the national report total')
    return list(check)


def snapshot_checks(s):
    """Completeness and arithmetic checks on a built snapshot (dict)."""
    check = Checks()
    for k in ['built', 'national_headline', 'stages', 'indicators', 'national', 'verdicts', 'counties']:
        check(k in s, f'Snapshot: top-level key {k}')
    check([x['id'] for x in s['stages']] == STAGES, 'Snapshot: six pathway stages in order')
    check(set(s['verdicts']) == VERDICTS, 'Snapshot: five verdicts defined')
    check(len(s['counties']) == 23 and len({c['code'] for c in s['counties']}) == 23, 'Snapshot: 23 areas')
    ind = {i['id']: i for i in s['indicators']}
    check(all(i['stage'] in STAGES for i in ind.values()), 'Snapshot: every indicator mapped to a pathway stage')
    for c in s['counties']:
        check(set(c['stage_verdicts']) == set(STAGES) and set(c['stage_verdicts'].values()) <= VERDICTS,
              f"Snapshot: stage verdicts complete {c['code']}")
        check(bool(c['headline']), f"Snapshot: headline {c['code']}")
        for iid, v in c['values'].items():
            check(iid in ind and v['verdict'] in VERDICTS, f'Snapshot: known indicator and verdict {c["code"]} {iid}')
            if v['v'] is not None and v.get('lo') is not None:
                check(v['lo'] <= v['v'] <= v['hi'], f"CI ordering: snapshot {c['code']} {iid}")
            if v.get('n') is not None:
                check(0 <= v['n'] <= v['d'], f"Numerator ≤ denominator: snapshot {c['code']} {iid}")
            nat = s['national'].get(iid)
            if v.get('comparator_kind') == 'leave_one_out' and nat and v.get('n') is not None:
                exp = 100 * (nat['n'] - v['n']) / (nat['d'] - v['d'])
                check(abs(exp - v['comparator']) < 1e-3, f"Leave-one-out comparator arithmetic: {c['code']} {iid}")
            if v['v'] is None:
                check(v['verdict'] == 'nodata', f"Snapshot: missing value is nodata {c['code']} {iid}")
        for a in c['actions']:
            check(a['citations'] and all(x.get('url') for x in a['citations']), f"Snapshot: cited action {c['code']} {a['playbook_id']}")
    for iid, nat in s['national'].items():
        if ind[iid].get('value_type') == 'proportion' and iid.startswith('lung_'):
            tot = [sum(c['values'][iid][k] for c in s['counties'] if c['values'][iid]['v'] is not None) for k in ('n', 'd')]
            check(tot == [nat['n'], nat['d']], f'County sum = national: snapshot {iid}')
    check(any(c['stage_verdicts']['referral'] != 'nodata' for c in s['counties']), 'Snapshot: referral stage populated by proxies')
    return list(check)


def collect(include_snapshot=True):
    res = dict(source_integrity=source_integrity(), analytical=analytical())
    if include_snapshot and SNAPSHOT.exists():
        res['analytical'] += snapshot_checks(json.loads(SNAPSHOT.read_text(encoding='utf-8')))
    return res


def write_report(source, analytic):
    downloads = json.loads((CAT / 'downloads.json').read_text())
    report = dict(
        status='passed', checks_passed=len(source) + len(analytic),
        source_integrity=dict(count=len(source), checks=source),
        analytical=dict(count=len(analytic), groups=dict(collections.Counter(c.split(':')[0] for c in analytic)), checks=analytic),
        downloaded_sources=sum(r['status'] == 'downloaded' for r in downloads.values()),
        failed_sources=[{'path': k, 'source_url': r['source_url'], 'error': r['error']} for k, r in downloads.items() if r['status'] == 'failed'],
    )
    (CAT / 'validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    return report


def run():
    res = collect()
    report = write_report(res['source_integrity'], res['analytical'])
    print(f"PASS: {len(res['source_integrity'])} source-integrity checks; {len(res['analytical'])} analytical checks; "
          f"{report['downloaded_sources']} downloaded sources; {len(report['failed_sources'])} documented access failures")


if __name__ == '__main__':
    run()
