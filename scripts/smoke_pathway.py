#!/usr/bin/env python3
"""Smoke test for data/processed/pathway_snapshot.json and data/catalog/recommendations.json.

Checks the schema the backend and frontend rely on, that all 23 areas are present, that every
action carries at least one citation with a URL, and that the referral stage is populated.
Exits non-zero on any failure (used by `make check-data`). Rebuild with:
    python scripts/build_pathway_snapshot.py
"""
import csv, datetime, json, pathlib, sys, traceback

ROOT = pathlib.Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / 'data/processed/pathway_snapshot.json'
RECS = ROOT / 'data/catalog/recommendations.json'
REGIONS = ROOT / 'data/processed/regions.csv'
STAGES = ['detection', 'followup', 'referral', 'diagnosis', 'treatment', 'outcome']
VERDICTS = ['act', 'verify', 'monitor', 'ok', 'nodata']
NUM = (int, float, type(None))

errors = []


def need(cond, msg):
    if not cond:
        errors.append(msg)
    return bool(cond)


def is_url(u):
    return isinstance(u, str) and u.startswith(('http://', 'https://'))


def check_snapshot(s):
    for k, t in [('built', str), ('national_headline', str), ('stages', list), ('indicators', list),
                 ('national', dict), ('verdicts', dict), ('counties', list)]:
        need(isinstance(s.get(k), t), f'top-level {k} must be {t.__name__}')
    try:
        datetime.datetime.fromisoformat(s['built'])
    except Exception:
        errors.append('built is not an ISO timestamp')
    need(bool(s.get('national_headline', '').strip()), 'national_headline is empty')
    need([x.get('id') for x in s['stages']] == STAGES, f'stage ids must be {STAGES}')
    for st in s['stages']:
        need(all(isinstance(st.get(k), str) and st.get(k) for k in ('id', 'label', 'hint')), f'stage {st} incomplete')
    need(sorted(s['verdicts']) == sorted(VERDICTS), 'verdicts must be act/verify/monitor/ok/nodata')
    for k, v in s['verdicts'].items():
        need(isinstance(v.get('label'), str) and isinstance(v.get('desc'), str) and v['desc'], f'verdict {k} needs label and desc')

    ind = {}
    for i in s['indicators']:
        for k in ('id', 'label', 'short', 'stage', 'unit', 'polarity', 'kind', 'period', 'source_url'):
            need(isinstance(i.get(k), str), f"indicator {i.get('id')}: {k} must be a string")
        need(isinstance(i.get('is_proxy'), bool), f"indicator {i.get('id')}: is_proxy must be bool")
        need(i.get('stage') in STAGES, f"indicator {i.get('id')}: unknown stage {i.get('stage')}")
        need(is_url(i.get('source_url')), f"indicator {i.get('id')}: source_url must be a URL")
        ind[i['id']] = i
    need(len(ind) == len(s['indicators']), 'duplicate indicator ids')
    need(any(i['is_proxy'] and i['stage'] == 'referral' for i in ind.values()), 'no referral proxy indicators')
    for iid, v in s['national'].items():
        need(iid in ind, f'national value for unknown indicator {iid}')
        need(all(k in v and isinstance(v[k], NUM) for k in ('v', 'lo', 'hi', 'n', 'd')), f'national {iid} needs v/lo/hi/n/d')

    with REGIONS.open(encoding='utf-8') as f:
        codes = {r['area_code'] for r in csv.DictReader(f)}
    need(len(codes) == 23, 'regions.csv should list 23 areas')
    got = [c.get('code') for c in s['counties']]
    need(len(got) == 23 and set(got) == codes, f'counties must be exactly the 23 areas; missing {sorted(codes - set(got))}')
    for c in s['counties']:
        cid = c.get('code')
        need(isinstance(c.get('name'), str) and c['name'], f'{cid}: name')
        need(isinstance(c.get('headline'), str) and c['headline'].strip(), f'{cid}: headline')
        sv = c.get('stage_verdicts', {})
        need(sorted(sv) == sorted(STAGES) and all(v in VERDICTS for v in sv.values()), f'{cid}: stage_verdicts incomplete or invalid')
        for iid, v in c.get('values', {}).items():
            need(iid in ind, f'{cid}: value for unknown indicator {iid}')
            need(all(k in v and isinstance(v[k], NUM) for k in ('v', 'lo', 'hi', 'n', 'd', 'comparator')), f'{cid}/{iid}: numeric fields')
            need(v.get('verdict') in VERDICTS, f'{cid}/{iid}: verdict')
            if v.get('v') is not None and v.get('lo') is not None:
                need(v['lo'] <= v['v'] <= v['hi'], f'{cid}/{iid}: CI not ordered')
        for a in c.get('actions', []):
            pid = f"{cid}/{a.get('playbook_id')}"
            for k in ('playbook_id', 'title', 'pathway_stage', 'owner', 'baseline', 'target', 'annual_volume', 'timeline', 'escalation'):
                need(isinstance(a.get(k), str) and a[k].strip(), f'{pid}: {k} must be a non-empty string')
            need('{' not in a.get('target', '') and not any('{' in x for x in a.get('concrete_steps', [])), f'{pid}: unfilled template')
            need(a.get('pathway_stage') in STAGES, f'{pid}: pathway_stage')
            need(isinstance(a.get('first_90_days'), list) and a['first_90_days'] and all(isinstance(x, str) for x in a['first_90_days']),
                 f'{pid}: first_90_days')
            need(isinstance(a.get('concrete_steps'), list) and 3 <= len(a['concrete_steps']) <= 6, f'{pid}: 3–6 concrete_steps')
            cits = a.get('citations') or []
            need(cits and all(isinstance(x.get('label'), str) and is_url(x.get('url')) for x in cits), f'{pid}: citations need label and URL')
    need(any(c['stage_verdicts'].get('referral') != 'nodata' for c in s['counties']), 'referral stage is nodata everywhere')
    need(any(c.get('actions') for c in s['counties']), 'no county has any action')
    val = s.get('validation', {})
    need(val.get('passed') is True and val.get('source_integrity', 0) > 0 and val.get('analytical', 0) > 0,
         'validation block missing or not passed')


def check_recommendations(recs):
    ids = [r.get('id') for r in recs]
    need(len(ids) == len(set(ids)), 'duplicate playbook ids')
    for r in recs:
        for k in ('id', 'title', 'pathway_stage', 'trigger', 'proposal', 'owner', 'target', 'timeline', 'escalation', 'goal', 'evidence_status'):
            need(isinstance(r.get(k), str) and r[k], f"playbook {r.get('id')}: {k}")
        need(r.get('pathway_stage') in STAGES, f"playbook {r['id']}: pathway_stage")
        need(isinstance(r.get('triggers'), list) and r['triggers'], f"playbook {r['id']}: triggers")
        need(3 <= len(r.get('concrete_steps', [])) <= 6, f"playbook {r['id']}: 3–6 concrete_steps")
        need(r.get('first_90_days'), f"playbook {r['id']}: first_90_days")
        need(isinstance(r.get('volume_rule'), dict) and r['volume_rule'].get('method'), f"playbook {r['id']}: volume_rule")
        need(any(is_url(e.get('url')) for e in r.get('evidence', [])), f"playbook {r['id']}: needs ≥1 citation with URL")


def main():
    try:
        need(SNAPSHOT.exists(), f'{SNAPSHOT} missing; run python scripts/build_pathway_snapshot.py')
        if SNAPSHOT.exists():
            check_snapshot(json.loads(SNAPSHOT.read_text(encoding='utf-8')))
        check_recommendations(json.loads(RECS.read_text(encoding='utf-8')))
    except Exception:
        traceback.print_exc()
        errors.append('exception during smoke test')
    if errors:
        print(f'FAIL: {len(errors)} problem(s)')
        for e in errors[:50]:
            print(' -', e)
        return 1
    s = json.loads(SNAPSHOT.read_text(encoding='utf-8'))
    n_actions = sum(len(c['actions']) for c in s['counties'])
    print(f"PASS: pathway snapshot built {s['built']}: {len(s['counties'])} areas, {len(s['indicators'])} indicators, "
          f"{n_actions} cited actions; validation {s['validation']['source_integrity']} source-integrity + "
          f"{s['validation']['analytical']} analytical checks")
    return 0


if __name__ == '__main__':
    sys.exit(main())
