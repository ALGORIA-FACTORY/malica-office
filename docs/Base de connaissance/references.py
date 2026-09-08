#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extraction du graphe des références juridiques — par analyse déterministe.

Ce que le master prompt appelait knowledge_graph_relations se construit ici SANS modèle :
les citations juridiques suivent des formes stables, en français comme en arabe, et une
expression régulière les trouve avec une fiabilité qu'aucun modèle n'égale — et surtout
sans jamais en inventer une.

Un modèle sert à COMPRENDRE ce qu'un texte veut dire. Il ne sert pas à repérer
« article 52 du code de l'IRPP » : ça, c'est du code, et le code ne se trompe pas de numéro.
"""
import os, re, sys, time
import psycopg2, psycopg2.extras

DSN = os.environ.get("MALICA_DSN", "postgres:///malica_paquet")

CORPUS_ALIAS = [
 (r"(?:code|مجلة)[^.;\n]{0,60}?(?:imp[oô]t sur le revenu|IRPP|الضريبة على دخل)", "CIRPPIS"),
 (r"\bC\.?I\.?R\.?P\.?P\.?", "CIRPPIS"),
 (r"(?:code|مجلة)[^.;\n]{0,40}?(?:taxe sur la valeur ajout|TVA|الأداء على القيمة المضافة)", "CTVA"),
 (r"(?:code|مجلة)[^.;\n]{0,60}?(?:droits et (?:des )?proc[ée]dures fiscaux|الحقوق والإجراءات الجبائية)", "CDPF"),
 (r"\bC\.?D\.?P\.?F\.?", "CDPF"),
 (r"(?:code|مجلة)[^.;\n]{0,60}?(?:enregistrement et (?:du|de) timbre|التسجيل والطابع)", "CDET"),
 (r"(?:code|مجلة)[^.;\n]{0,50}?(?:fiscalit[ée] locale|الجباية المحلية)", "CFL"),
 (r"(?:code|مجلة)[^.;\n]{0,40}?(?:soci[ée]t[ée]s commerciales|الشركات التجارية)", "CSC"),
 (r"(?:code|مجلة)[^.;\n]{0,30}?(?:douanes?|الديوانة)", "CODE_DOUANES"),
 (r"(?:code|مجلة)[^.;\n]{0,30}?(?:travail|الشغل)", "CODE_TRAVAIL"),
 (r"(?:code|مجلة)[^.;\n]{0,40}?(?:incitations? aux investissements|تشجيع الاستثمارات)", "CII"),
]
# « article 52 », « articles 12 et 13 », « art. 44 ter », « الفصل 52 »
RE_ART   = re.compile(r"(?:articles?|art\.|الفصل|الفصول)\s*(\d{1,3}(?:\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies))?)", re.I)
# « loi n° 2025-17 du 12 décembre 2025 », « loi de finances pour l'année 2026 »
RE_LOI   = re.compile(r"loi\s*(?:organique\s*)?n[°ºo]?\s*(\d{2,4})\s*[-–]\s*(\d{1,3})", re.I)
RE_LF    = re.compile(r"loi\s+de\s+finances[^.;\n]{0,40}?(?:pour\s+l['’]ann[ée]e\s+|de\s+)(\d{4})", re.I)
RE_LF_AR = re.compile(r"قانون\s+المالية\s+لسنة\s+(\d{4})")
RE_DL    = re.compile(r"d[ée]cret[-\s]?loi\s*n[°ºo]?\s*(\d{4})\s*[-–]\s*(\d{1,3})", re.I)
RE_DECR  = re.compile(r"d[ée]cret\s*(?:gouvernemental\s*)?n[°ºo]?\s*(\d{2,4})\s*[-–]\s*(\d{1,4})", re.I)
RE_NC    = re.compile(r"note\s+commune\s*n[°ºo]?\s*(\d{1,3})[^\d]{0,12}(\d{4})", re.I)
RE_NC_AR = re.compile(r"المذكرة\s+العامة\s+عدد\s*(\d{1,3})[^\d]{0,12}(\d{4})")
RE_NCT   = re.compile(r"norme\s+comptable\s*(?:n[°ºo]?\s*)?(\d{1,2})", re.I)

def corpus_du_contexte(txt, pos, fenetre=180):
    """Le corpus d'un article se lit dans son voisinage : « article 52 du code de l'IRPP ».
    Sans voisinage identifiable, on ne devine pas — la référence reste non rattachée."""
    ctx = txt[pos:pos+fenetre]
    for motif, code in CORPUS_ALIAS:
        if re.search(motif, ctx, re.I): return code
    ctx2 = txt[max(0,pos-120):pos]
    for motif, code in CORPUS_ALIAS:
        if re.search(motif, ctx2, re.I): return code
    return None

def extraire(txt):
    refs = set()
    for m in RE_ART.finditer(txt):
        num = re.sub(r"\s+", " ", m.group(1)).strip()
        code = corpus_du_contexte(txt, m.end())
        refs.add(("ARTICLE", code or "NON_RATTACHE", num))
    for m in RE_LOI.finditer(txt):  refs.add(("LOI", "LOI", f"{m.group(1)}-{m.group(2)}"))
    for m in RE_DL.finditer(txt):   refs.add(("DECRET_LOI", "DECRET_LOI", f"{m.group(1)}-{m.group(2)}"))
    for m in RE_DECR.finditer(txt): refs.add(("DECRET", "DECRET", f"{m.group(1)}-{m.group(2)}"))
    for m in RE_LF.finditer(txt):   refs.add(("LOI_FINANCES", "LF", m.group(1)))
    for m in RE_LF_AR.finditer(txt):refs.add(("LOI_FINANCES", "LF", m.group(1)))
    for m in RE_NC.finditer(txt):   refs.add(("NOTE_COMMUNE", "NC", f"{int(m.group(1))}/{m.group(2)}"))
    for m in RE_NC_AR.finditer(txt):refs.add(("NOTE_COMMUNE", "NC", f"{int(m.group(1))}/{m.group(2)}"))
    for m in RE_NCT.finditer(txt):  refs.add(("NORME_COMPTABLE", "NCT", m.group(1).zfill(2)))
    return refs

def main():
    cn = psycopg2.connect(DSN); cn.autocommit = False
    cur = cn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
      create table if not exists legal.references_extraites (
        queue_id   uuid not null references legal.ingestion_queue(id) on delete cascade,
        type_ref   text not null,
        corpus_ref text not null,
        reference  text not null,
        primary key (queue_id, type_ref, corpus_ref, reference)
      );
      comment on table legal.references_extraites is
        'Arêtes du graphe de connaissances, extraites PAR EXPRESSION RÉGULIÈRE et non par un '
        'modèle : une citation juridique a une forme stable, et le code ne se trompe pas de numéro. '
        'corpus_ref = NON_RATTACHE quand le voisinage ne permet pas d''identifier le code visé — '
        'on ne devine pas.';
      truncate legal.references_extraites;
    """)
    cur.execute("select queue_id, texte from legal.documents where texte is not null and length(texte)>200")
    docs = cur.fetchall(); cn.commit()
    print(f"documents à analyser : {len(docs)}", flush=True)
    t0=time.time(); total=0
    for i,d in enumerate(docs,1):
        refs = extraire(d["texte"])
        if refs:
            psycopg2.extras.execute_values(cur,
              "insert into legal.references_extraites (queue_id,type_ref,corpus_ref,reference) values %s on conflict do nothing",
              [(d["queue_id"],t,c,r) for t,c,r in refs])
            total += len(refs)
        if i % 100 == 0: cn.commit(); print(f"  {i}/{len(docs)}  {total} références  {time.time()-t0:.0f}s", flush=True)
    cn.commit()
    print(f"terminé : {total} références sur {len(docs)} documents, {time.time()-t0:.0f}s", flush=True)

if __name__ == "__main__":
    main()
