#!/usr/bin/env python3
"""Add official region crosswalks and convenient, source-linked demo views."""
import csv, hashlib, json, pathlib, re
from process_data import ROOT, RAW, CAT, OUT, number, write_csv

def read(path):return list(csv.DictReader(path.open()))
def run():
    meta=json.loads((RAW/'statfin/13u5_metadata.json').read_text())
    mf=json.loads((RAW/'statfin/13u5_metadata_fi.json').read_text())
    v=next(v for v in meta['variables'] if v['code'].startswith('alue'))
    vf=next(v for v in mf['variables'] if v['code'].startswith('alue'))
    fi=dict(zip(vf['values'],vf['valueTexts']));cross=[]
    for code,en in zip(v['values'],v['valueTexts']):
        if not code.startswith('HVA'):continue
        name=re.sub(r'^HVA\d+ ','',en).removesuffix(' wellbeing services county')
        cross.append(dict(area_code=code,area_name_en=name,area_name_fi=re.sub(r'^HVA\d+ ','',fi[code]),screening_mainland_coverage=code!='HVA91',source_url='https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/ksyyt/13u5.px',geography_reference='2026-01-01'))
    write_csv(OUT/'regions.csv',cross);codes={r['area_name_en']:r['area_code'] for r in cross};codes['Total']='SSS';codes['Whole Finland']='SSS'
    ficodes={r['area_name_fi']:r['area_code'] for r in cross}
    tables=json.loads((CAT/'tables.json').read_text());county=[];lung=[]
    for t in tables:
        if t['source_id'] in ['breast','cervix','colorectal'] and 'Wellbeing services counties' in t['heading_path']:
            year=next((int(v) for v in reversed(t['heading_path']) if re.fullmatch(r'20\d\d',v)),None)
            if not year:continue
            for i,row in enumerate(read(ROOT/t['csv_path'])):
                area=row.get('Wellbeing service county')
                if area is None:continue
                dims={k:v for k,v in row.items() if ' | N' not in k and ' | %' not in k and k!='Wellbeing service county'}
                for metric,value in row.items():
                    if ' | N' not in metric and ' | %' not in metric:continue
                    county.append(dict(program=t['source_id'],year=year,area=area,area_code=codes.get(area,''),section=' > '.join(t['heading_path'][1:-1]),strata=json.dumps(dims,ensure_ascii=False),metric=metric,value=number(value),value_raw=value,unit='percent' if ' | %' in metric else 'count',table_id=t['table_id'],source_row=i,source_url=t['source_url']))
        if t['source_id']=='lung_2019_2023' and 'Hyvinvointialue' in t['headers'] and 'Hoitomuoto' in t['headers']:
            treatment=None; collaboration=None
            for i,row in enumerate(read(ROOT/t['csv_path'])):
                if row['Hoitomuoto']:
                    treatment=row['Hoitomuoto'];continue
                if row['Yhteistyöalue']:
                    collaboration=row['Yhteistyöalue'];continue
                area=row['Hyvinvointialue']
                if area not in ficodes:continue
                lung.append(dict(area_fi=area,area_code=ficodes.get(area,''),collaboration_area_fi=collaboration,treatment_type_fi=treatment,treatment_n=number(row['Lukumäärä']),patients_n=number(row['Yhteensä']),share_pct=number(row['Osuus (%)']),diagnosis_period='2019-2023',observation_window='12 months from registry-defined follow-up start',warning='Treatment categories overlap; missing records do not prove absence of treatment; not risk-adjusted',table_id=t['table_id'],source_row=i,source_url=t['source_url']))
    write_csv(OUT/'county_screening.csv',county)
    write_csv(OUT/'county_lung_treatment_2019_2023.csv',lung)
    # Append official area codes to typed cancer outcomes.
    path=OUT/'regional_cancer_outcomes_2024.csv';rows=read(path)
    for r in rows:r['area_code']=codes.get(r['area'],'')
    write_csv(path,rows)
    # Inventory and checksum the supplied documents without moving or rewriting them.
    inputs=[]
    for p in sorted(ROOT.glob('*.pdf')):
        inputs.append(dict(path=p.name,bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),origin='user-provided challenge resource'))
    p=ROOT/'challenge.md';inputs.append(dict(path=p.name,bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),origin='user-provided challenge brief'))
    (CAT/'provided_files.json').write_text(json.dumps(inputs,ensure_ascii=False,indent=2)+'\n')
    summary=json.loads((CAT/'processing_summary.json').read_text())
    summary.update(county_screening_observations=len(county),county_lung_treatment_rows=len(lung),region_crosswalk_rows=len(cross))
    (CAT/'processing_summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))
if __name__=='__main__':run()
