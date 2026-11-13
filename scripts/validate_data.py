#!/usr/bin/env python3
"""Audit acquisition integrity, identifiers, confidence intervals and real denominators."""
import csv, hashlib, json, math
from collections import Counter
from process_data import ROOT, RAW, CAT, OUT

def rows(p):return list(csv.DictReader(p.open()))
def run():
    checks=[]
    def check(condition,label):
        if not condition:raise AssertionError(label)
        checks.append(label)
    downloads=json.loads((CAT/'downloads.json').read_text())
    for key,r in downloads.items():
        if r['status']!='downloaded':continue
        p=ROOT/r['path'];check(hashlib.sha256(p.read_bytes()).hexdigest()==r['sha256'],'SHA256 '+key)
        if p.suffix=='.pdf':check(p.read_bytes().startswith(b'%PDF'),'PDF signature '+key)
    tables=json.loads((CAT/'tables.json').read_text())
    check(len({x['table_id'] for x in tables})==len(tables),'Unique table identifiers')
    for t in tables:
        rs=rows(ROOT/t['csv_path'])
        check(len(rs)==t['row_count'] and all(None not in r and None not in r.values() for r in rs),'CSV shape '+t['table_id'])
    outcomes=rows(OUT/'regional_cancer_outcomes_2024.csv')
    check(Counter(r['area_level'] for r in outcomes)=={'county':110,'collaboration_area':25,'national':5},'Cancer outcome geography: 22 mainland counties/city, 5 collaborative areas, national, per cancer/sex series')
    for r in outcomes:
        for stem in ['incidence_rate','relative_survival_5y_pct','mortality_rate']:
            if r[stem+'_ci_lower']:
                check(float(r[stem+'_ci_lower'])<=float(r[stem])<=float(r[stem+'_ci_upper']),'Ordered confidence interval '+r['cancer']+' '+r['sex']+' '+r['area']+' '+stem)
    screening=rows(OUT/'county_screening.csv')
    check(all(r['area_code'] for r in screening),'Every county screening observation has an official area code')
    # Audit all available annual colorectal county process totals and participation ratios.
    for t in tables:
        if t['source_id']!='colorectal' or 'Wellbeing services counties' not in t['heading_path'] or 'Screening process' not in t['heading_path']:continue
        rs=rows(ROOT/t['csv_path']);total=next(r for r in rs if r['Wellbeing service county']=='Total');areas=[r for r in rs if r['Wellbeing service county']!='Total']
        for metric in [h for h in t['headers'] if h.endswith(' | N')]:
            check(sum(int(r[metric]) for r in areas)==int(total[metric]),'Colorectal county-to-national total '+t['table_id']+' '+metric)
        for r in rs:
            expected=100*int(r['Attended | N'])/int(r['Picked | N'])
            check(abs(expected-float(r['Attended | %']))<=0.051,'Colorectal participation denominator '+t['table_id']+' '+r['Wellbeing service county'])
    lung=rows(OUT/'county_lung_treatment_2019_2023.csv')
    check(all(r['area_code'] and r['treatment_type_fi'] and r['collaboration_area_fi'] for r in lung),'Lung group headings correctly propagated to actual county observations')
    check(len({(r['area_code'],r['treatment_type_fi']) for r in lung})==len(lung),'Lung treatment keys unique')
    for r in lung:
        check(abs(100*float(r['treatment_n'])/float(r['patients_n'])-float(r['share_pct']))<=0.051,'Lung treatment denominator '+r['area_code']+' '+r['treatment_type_fi'])
    # Reconcile flat StatFin rows to the JSON-stat dimension product, including null cells.
    for table in ['11ra','11ay','13u5']:
        d=json.loads((RAW/f'statfin/{table}_data.json').read_text())
        check(len(rows(OUT/f'statfin_{table}.csv'))==math.prod(d['size']),'StatFin dimension product '+table)
    report=dict(status='passed',checks_passed=len(checks),downloaded_sources=sum(r['status']=='downloaded' for r in downloads.values()),failed_sources=[{'path':k,'source_url':r['source_url'],'error':r['error']} for k,r in downloads.items() if r['status']=='failed'],checks=checks)
    (CAT/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(f"PASS: {len(checks)} checks; {report['downloaded_sources']} downloaded sources; {len(report['failed_sources'])} documented access failures")
if __name__=='__main__':run()
