#!/usr/bin/env python3
"""Collect public aggregate challenge evidence. Cached, hashed, with request provenance."""
import argparse, concurrent.futures, datetime, hashlib, json, pathlib, subprocess, threading
from urllib.parse import urlparse
import requests
from bs4 import BeautifulSoup
ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/raw'
CAT = ROOT / 'data/catalog'
LOCK = threading.Lock()
MANIFEST = CAT / 'downloads.json'
records = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}

def fetch(key, url, kind='html', payload=None, refresh=False):
    dest = RAW / key
    if key in records and records[key].get('status') == 'downloaded' and dest.exists() and records[key].get('query') == payload and not refresh:
        return dest
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    rec = dict(source_url=url, retrieved_at=now, path=str(dest.relative_to(ROOT)), method='POST' if payload else 'GET', license='See publisher terms; no blanket license assumed')
    if payload: rec['query'] = payload
    try:
        r = requests.post(url, json=payload, timeout=90) if payload else requests.get(url, timeout=60)
        rec.update(http_status=r.status_code, resolved_url=r.url, content_type=r.headers.get('Content-Type'), last_modified=r.headers.get('Last-Modified'))
        r.raise_for_status()
        if kind == 'pdf' and not r.content.startswith(b'%PDF'): raise ValueError('Response is not a PDF')
        if kind == 'json': r.json()
        if kind == 'html' and b'<html' not in r.content[:10000].lower(): raise ValueError('Response is not HTML')
        dest.parent.mkdir(parents=True,exist_ok=True); dest.write_bytes(r.content)
        rec.update(status='downloaded', bytes=len(r.content), sha256=hashlib.sha256(r.content).hexdigest())
        if kind == 'pdf':
            subprocess.run(['pdftotext','-layout',str(dest),str(dest.with_suffix('.txt'))],check=True, capture_output=True)
    except Exception as e:
        rec.update(status='failed', error=str(e))
        dest = None
    with LOCK:
        records[key] = rec
        CAT.mkdir(parents=True,exist_ok=True)
        MANIFEST.write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
    print(rec['status'],key,flush=True)
    return dest

def collect(refresh=False):
    jobs = []
    def add(key,url,kind='html'): jobs.append((key,url,kind,None,refresh))
    for program in ['cervix','breast','colorectal']:
        add(f'screening/{program}.html',f'https://stats.cancerregistry.fi/joukkistilastot/{program}.html')
    for year in range(2020,2025):
        add(f'cancer/cancer_in_finland_{year}.html',f'https://cancerregistry.fi/assets/themes/ssy3/factsheets/cancer_in_finland_{year}.html')
    for program in ['cervical','breast','colorectal']:
        for year,folder in [(2022,'2024/12'),(2023,'2026/01'),(2024,'2026/10')]:
            add(f'reports/{program}_screening_{year}.pdf',f'https://cancerregistry.fi/assets/files/{folder}/Annual-report-on-{program}-cancer-screening-{year}.pdf','pdf')
    add('quality/lung_2019_2023.html','https://cancerregistry.fi/assets/themes/ssy3/factsheets/keuhkosyoparaportti.html')
    add('quality/myeloma_2019_2023.html','https://cancerregistry.fi/assets/themes/ssy3/factsheets/myeloma.html')
    add('reports/lung_quality_2018_2022.pdf','https://cancerregistry.fi/assets/files/2024/12/Keuhkosyopa_Suomessa.pdf','pdf')
    pages = {
      'quality_registry':'https://cancerregistry.fi/raportit-ja-katsaukset/syovan-laaturekisterihanke/',
      'fican_quality_registry_overview':'https://fican.fi/toiminta/arviointi-ja-seuranta/syopien-laaturekisterit/',
      'clinical_notifications':'https://cancerregistry.fi/tilastot/kliinisten-ilmoitusten-tilasto/',
      'registry_quality':'https://cancerregistry.fi/statistics/statistical-descriptions-quality-reports/',
      'registry_information_requests':'https://cancerregistry.fi/services/information-requests/',
      'registry_cancer_statistics':'https://cancerregistry.fi/statistics/cancer-statistics/',
      'registry_screening_statistics':'https://cancerregistry.fi/statistics/screening-statistics/',
      'registry_annual_reports':'https://cancerregistry.fi/reports-and-publications/annual-report-on-cancer-in-finland/',
      'screening_annual_reports':'https://cancerregistry.fi/reports-and-publications/annual-reports-of-cancer-screening-programmes/',
      'screening_quality_manuals':'https://fican.fi/en/what-we-do/cancer-screening/qualitymanuals/',
      'fican_quality_registry':'https://fican.fi/syopien-hoitotulosten-seuranta-laajenee-suolisto-eturauhas-ja-rintasyopaan/',
      'sweden_svf_colorectal':'https://kunskapsbanken.cancercentrum.se/diagnoser/tjock-och-andtarmscancer/vardforlopp/',
      'sweden_svf_faq':'https://cancercentrum.se/diagnosbehandling/vardforloppsvf/fragorochsvar.7395.html',
      'delay_meta_analysis':'https://pmc.ncbi.nlm.nih.gov/articles/PMC7610021/',
    }
    for key,url in pages.items(): add('evidence/'+key+'.html',url)
    add('evidence/colorectal_screening_quality_manual_2024.pdf','https://cancerregistry.fi/assets/files/2024/12/Quality-manual-for-colorectal-cancer-screening.pdf','pdf')
    add('evidence/oecd_finland_cancer_profile_2025.pdf','https://www.oecd.org/content/dam/oecd/en/publications/reports/2025/02/eu-country-cancer-profile-finland-2025_1e1aebcf/1b14100d-en.pdf','pdf')
    add('evidence/eco_finland_2025.pdf','https://fican.fi/wp-content/uploads/2025/11/ECO_CountryFactsheet_November2025_Finland_EN_FINAL.pdf','pdf')
    add('reports/cancer_in_finland_2023.pdf','https://cancerregistry.fi/assets/files/2025/06/Syopa_2023_en.pdf','pdf')
    add('thl/sotkanet_indicators.json','https://sotkanet.fi/rest/1.1/indicators','json')
    add('thl/sotkanet_regions.json','https://sotkanet.fi/rest/1.1/regions','json')
    add('thl/sampo_specialist_waiting_times.html','https://sampo.thl.fi/pivot/prod/en/eshjono')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda args: fetch(*args),jobs))
    fetch('statfin/13u5_metadata_fi.json','https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/ksyyt/13u5.px','json',refresh=refresh)
    # StatFin: official table metadata and exact POST queries retained alongside responses.
    for dataset,table in [('vaerak','11ra'),('ksyyt','11ay'),('ksyyt','13u5')]:
        url=f'https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/{dataset}/{table}.px'
        p=fetch(f'statfin/{table}_metadata.json',url,'json',refresh=refresh)
        if not p: continue
        meta=json.loads(p.read_text()); query=[]
        for v in meta['variables']:
            vals=v['values'];code=v['code']
            if code.startswith('timeperiod'): vals=[x for x in vals if int(x)>=2010]
            elif code.startswith('kuolinsyyt'):
                vals=[x for x,label in zip(vals,v['valueTexts']) if x=='SSS' or x in ['04-22','04-21'] or (x.isdigit() and 4<=int(x)<=22)]
            elif code.startswith('alue') and dataset=='vaerak':
                vals=[x for x in vals if x=='SSS' or x.startswith('HVA') or x in ['KU091','MA1','MA2']]
            query.append({'code':code,'selection':{'filter':'item','values':vals}})
        payload={'query':query,'response':{'format':'json-stat2'}}
        (CAT/f'statfin_{table}_query.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
        fetch(f'statfin/{table}_data.json',url,'json',payload,refresh)
    # Download official manuals linked on FICAN page, preserving exact link provenance.
    p=RAW/'evidence/screening_quality_manuals.html'
    if p.exists():
        s=BeautifulSoup(p.read_bytes(),'html.parser')
        for i,a in enumerate(s.find_all('a',href=True)):
            u=a['href']
            if '.pdf' in u.lower():
                u=u.replace('https://syoparekisteri.fi/','https://cancerregistry.fi/')
                fetch('evidence/manual_'+pathlib.PurePosixPath(urlparse(u).path).name,u,'pdf',refresh=refresh)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--refresh',action='store_true');args=ap.parse_args();collect(args.refresh)
