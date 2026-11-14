#!/usr/bin/env python3
"""Create retrieval-ready text chunks with document and page provenance."""
import hashlib, json, pathlib, re, unicodedata
from urllib.parse import unquote
from process_data import ROOT, RAW, CAT, OUT

def run():
    docs=[];manifest=json.loads((CAT/'downloads.json').read_text())
    for key,r in manifest.items():
        p=ROOT/r['path']
        text=p.with_suffix('.txt')
        if r['status']=='downloaded' and text.exists():
            docs.append((key,text,r['path'],r['source_url'],p.suffix=='.pdf'))
    # Challenge-provided PDFs are published at the URLs listed in challenge.md.
    provided_urls={unicodedata.normalize('NFC',unquote(u.rsplit('/',1)[-1])):u for u in re.findall(r'https://files\.hackjunction\.app/resources/\S+?\.pdf',(ROOT/'challenge.md').read_text())}
    for p in ROOT.glob('*.pdf'):
        text=RAW/'provided'/f'{p.stem}.txt'
        if text.exists():docs.append((p.name,text,p.name,provided_urls.get(unicodedata.normalize('NFC',p.name)),True))
    docs.append(('challenge.md',ROOT/'challenge.md','challenge.md',None,False))
    chunks=[]
    for key,path,original,url,is_pdf in docs:
        pages=path.read_text().split('\f') if is_pdf else [path.read_text()]
        for page_no,page in enumerate(pages,1):
            start=0
            while start<len(page):
                end=min(start+1800,len(page));content=page[start:end]
                if content.strip():
                    cid=hashlib.sha256(f'{key}:{page_no}:{start}'.encode()).hexdigest()[:20]
                    chunks.append(dict(chunk_id=cid,document_id=key,source_path=original,text_path=str(path.relative_to(ROOT)),source_url=url,pdf_page=page_no if is_pdf else None,char_start_on_page=start,char_end_on_page=end,text=content))
                if end==len(page):break
                start=end-150
    with (OUT/'evidence_chunks.jsonl').open('w') as f:
        for r in chunks:f.write(json.dumps(r,ensure_ascii=False)+'\n')
    summary={'documents':len(docs),'chunks':len(chunks),'chunk_char_limit':1800,'overlap_chars':150,'note':'Retrieval corpus only. Contains contextual prose and source numbers; curated CSVs remain the analysis layer.'}
    (CAT/'evidence_index_summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))
if __name__=='__main__':run()
