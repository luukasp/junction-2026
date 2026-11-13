#!/usr/bin/env python3
"""Lossless table extraction plus typed, source-linked demo datasets. No imputation."""
import csv, itertools, json, pathlib, re
from bs4 import BeautifulSoup
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'data/processed'; CAT=ROOT/'data/catalog'; RAW=ROOT/'data/raw'

def clean(x):return re.sub(r'\s+',' ',x).strip()
def write_csv(path,rows,fields=None):
    path.parent.mkdir(parents=True,exist_ok=True)
    if fields is None: fields=list(dict.fromkeys(k for r in rows for k in r))
    with path.open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
def grid(trs):
    cells={}; nrows=0
    for i,tr in enumerate(trs):
        nrows=i+1;j=0
        for td in tr.find_all(['th','td'],recursive=False):
            while (i,j) in cells:j+=1
            text=clean(td.get_text(' ',strip=True))
            for di in range(int(td.get('rowspan',1))):
                for dj in range(int(td.get('colspan',1))):cells[i+di,j+dj]=text
            j+=int(td.get('colspan',1))
    width=max((j for i,j in cells),default=-1)+1
    return [[cells.get((i,j),'') for j in range(width)] for i in range(nrows)]
def extract_tables(path,source_id,url):
    soup=BeautifulSoup(path.read_bytes(),'html.parser'); headings={}; results=[]
    # R DT widgets store full public tables column-wise in application/json scripts.
    # Extract those values directly, rather than scraping only the initially visible rows.
    for script in soup.find_all('script',type='application/json'):
        widget=json.loads(script.string or script.get_text()).get('x',{})
        if not isinstance(widget,dict) or 'container' not in widget or 'data' not in widget:continue
        template=BeautifulSoup(widget['container'],'html.parser').find('table')
        if template is None:continue
        cols=widget['data']
        if not isinstance(cols,list) or not all(isinstance(c,list) for c in cols):continue
        if len({len(c) for c in cols})>1:raise ValueError('Unequal DT column lengths')
        tbody=soup.new_tag('tbody')
        for vals in zip(*cols):
            tr=soup.new_tag('tr')
            for val in vals:
                td=soup.new_tag('td');td.string='' if val is None else str(val);tr.append(td)
            tbody.append(tr)
        template.append(tbody);template['id']=script.get('data-for','')
        script.insert_before(template)
    for el in soup.find_all(['h1','h2','h3','h4','h5','h6','table']):
        if el.name!='table':
            if el.find_parent('table'):continue
            level=int(el.name[1]);headings={k:v for k,v in headings.items() if k<level};headings[level]=clean(el.get_text(' ',strip=True));continue
        # Ignore nested layout tables. Only tables with explicit body data are datasets.
        if el.find_parent('table') or not el.find('tbody'):continue
        body=grid(el.find('tbody').find_all('tr',recursive=False)); head=grid(el.find('thead').find_all('tr',recursive=False)) if el.find('thead') else []
        if not body:continue
        width=max(map(len,body));headers=[]
        for j in range(width):
            pieces=list(dict.fromkeys(row[j] for row in head if j<len(row) and row[j]))
            headers.append(' | '.join(pieces) or f'column_{j+1}')
        # Make duplicate labels unique without discarding original header rows.
        seen={}
        for j,h in enumerate(headers):
            seen[h]=seen.get(h,0)+1
            if seen[h]>1:headers[j]=f'{h} [{seen[h]}]'
        idx=len(results);tid=f'{source_id}_t{idx:03}'
        caption=clean(el.caption.get_text(' ',strip=True)) if el.caption else ''
        anchor=el.get('id')
        if not anchor:
            tag=el.find(id=True);anchor=tag.get('id') if tag else None
        footer=clean(el.tfoot.get_text(' ',strip=True)) if el.tfoot else ''
        rows=[dict(zip(headers,row+['']*(width-len(row)))) for row in body]
        rel=f'tables/{tid}.csv';write_csv(OUT/rel,rows,headers)
        results.append(dict(table_id=tid,source_id=source_id,source_url=url+(('#'+anchor) if anchor else ''),raw_path=str(path.relative_to(ROOT)),heading_path=list(headings.values()),caption=caption,footer=footer,headers=headers,original_header_rows=head,rows=rows,csv_path='data/processed/'+rel))
    # Searchable report text, without scripts or embedded image payloads.
    for el in soup(['script','style']):el.decompose()
    (path.with_suffix('.txt')).write_text(soup.get_text('\n',strip=True),encoding='utf-8')
    return results

def number(x):
    x=x.replace(' ','').replace('\u00a0','')
    return float(x) if re.fullmatch(r'-?\d+(\.\d+)?',x) else None

def parse_interval(x):
    m=re.fullmatch(r'([\d.]+)\s*\(([\d.]+),\s*([\d.]+)\)',x)
    return tuple(map(float,m.groups())) if m else (number(x),None,None)

def run():
    OUT.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((CAT/'downloads.json').read_text());tables=[]
    for key,rec in manifest.items():
        if rec['status']!='downloaded':continue
        if key.startswith(('screening/','cancer/','quality/')) and key.endswith('.html'):
            sid=pathlib.Path(key).stem
            tables.extend(extract_tables(RAW/key,sid,rec['source_url']))
        elif key.startswith('evidence/') and key.endswith('.html'):
            s=BeautifulSoup((RAW/key).read_bytes(),'html.parser')
            for el in s(['script','style']):el.decompose()
            (RAW/key).with_suffix('.txt').write_text(s.get_text('\n',strip=True))
    (CAT/'tables.json').write_text(json.dumps([{k:v for k,v in t.items() if k!='rows'}|{'row_count':len(t['rows'])} for t in tables],ensure_ascii=False,indent=2)+'\n')
    # Wide source tables plus a tidy cell file preserve all source values and dimensions.
    observations=[];regional=[]
    for t in tables:
        hp=t['heading_path']; year=next((int(v) for v in reversed(hp) if re.fullmatch(r'20\d\d',v)),None)
        if t['source_id'] in ['cervix','breast','colorectal'] and year:
            headers=t['headers']; dim=[h for h in headers if not (' | N' in h or ' | %' in h)]
            for ri,row in enumerate(t['rows']):
                dims={h:row[h] for h in dim}
                for h,value in row.items():
                    if h in dim:continue
                    observations.append(dict(program=t['source_id'],year=year,section=' > '.join(hp),dimensions=json.dumps(dims,ensure_ascii=False),metric=h,value=number(value),value_raw=value,table_id=t['table_id'],source_row=ri,source_url=t['source_url']))
        if t['source_id']=='cancer_in_finland_2024' and '15.5 Regional' in ' '.join(hp):
            cap=t['caption'].lower();site='prostate' if 'prostate' in cap else 'breast' if 'breast' in cap else 'colorectal' if 'colorectal' in cap else 'lung'
            sex='female' if 'women' in cap else 'male' if ('men' in cap or site=='prostate') else 'both'
            parent=None
            for ri,row in enumerate(t['rows']):
                vals=list(row.values())
                if len(vals)!=7:raise ValueError(f'Unexpected regional schema {t["table_id"]}')
                area=vals[0]
                iscounty=area not in ['Southern Finland','Western Finland','Eastern Finland','Northern Finland','Central Finland','Whole country','Finland','Total']
                # Central Finland is also a county: identify hierarchy using original indent metadata below.
                raw_soup=BeautifulSoup((ROOT/t['raw_path']).read_bytes(),'html.parser') if ri==0 else raw_soup
                source_table=next(x for x in raw_soup.find_all('table') if x.caption and clean(x.caption.get_text(' ',strip=True))==t['caption']) if ri==0 else source_table
                td=source_table.tbody.find_all('tr',recursive=False)[ri].find(['td','th'])
                iscounty=td.has_attr('indentlevel')
                level='county' if iscounty else 'national' if area.lower() in ['whole country','whole finland','finland','total'] else 'collaboration_area'
                if level=='collaboration_area':parent=area
                rec=dict(cancer=site,sex=sex,area=area,area_level=level,collaboration_area=parent if iscounty else '',incidence_period='2020-2024',survival_diagnosis_period='2020-2024',survival_followup_through='2025-12-31',survival_method='age-standardised to cancer-specific national patient age structure; report section 3.10',prevalence_definition='diagnosed 2020-2024 and alive at end of 2024',incidence_n=number(vals[1]),prevalence_n=number(vals[4]),mortality_n=number(vals[5]),table_id=t['table_id'],source_row=ri,source_url=t['source_url'])
                for stem,value in [('incidence_rate',vals[2]),('relative_survival_5y_pct',vals[3]),('mortality_rate',vals[6])]:
                    val,lo,hi=parse_interval(value);rec.update({stem:val,stem+'_ci_lower':lo,stem+'_ci_upper':hi,stem+'_raw':value})
                regional.append(rec)
    write_csv(OUT/'screening_observations.csv',observations)
    write_csv(OUT/'regional_cancer_outcomes_2024.csv',regional)
    # JSON-stat2 flattening keeps machine codes, labels, nulls, units and status flags.
    stat_counts={}
    for table in ['11ra','11ay','13u5']:
        p=RAW/f'statfin/{table}_data.json'
        if not p.exists():continue
        d=json.loads(p.read_text()); ids=d['id'];sizes=d['size'];dim=d['dimension']; rows=[]
        codes=[]
        for key in ids:
            idx=dim[key]['category']['index'];codes.append(list(idx) if isinstance(idx,list) else sorted(idx,key=idx.get))
        vals=d['value'];statuses=d.get('status',{})
        for i,comb in enumerate(itertools.product(*codes)):
            row={}
            for key,code in zip(ids,comb):
                row[key]=code;row[key+'_label']=dim[key]['category'].get('label',{}).get(code,code)
            row['value']=vals[i] if isinstance(vals,list) else vals.get(str(i))
            row['status']=statuses[i] if isinstance(statuses,list) and i<len(statuses) else statuses.get(str(i),'') if isinstance(statuses,dict) else ''
            row['source_url']=manifest[f'statfin/{table}_data.json']['source_url'];rows.append(row)
        write_csv(OUT/f'statfin_{table}.csv',rows);stat_counts[table]=len(rows)
    summary=dict(tables=len(tables),source_table_rows=sum(len(t['rows']) for t in tables),screening_observations=len(observations),regional_outcome_rows=len(regional),statfin_rows=stat_counts)
    (CAT/'processing_summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
if __name__=='__main__':run()
