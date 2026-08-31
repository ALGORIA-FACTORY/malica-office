#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Segmentation des codes en articles — le grain juridique.

Une loi de finances n'écrit pas un texte neuf : elle AMENDE DES ARTICLES. Le grain de
stockage doit donc être l'article, avec une identité stable et des versions successives.

Le découpage est fait par le CODE, sur des frontières typographiques stables (« Article 52 »,
« الفصل 52 »), et chaque article reçoit son empreinte SHA-256. Aucun modèle ne recopie ici
un texte : l'empreinte porte sur ce qui a été découpé, pas sur ce qui aurait été retapé.

Les mentions d'amendement des éditions consolidées de la DGELF — « (Modifié Art 69 LF 2024) » —
sont capturées telles quelles : c'est le seul pont fiable pour reconstituer l'historique.
"""
import os, re, hashlib, time
import psycopg2, psycopg2.extras

DSN = os.environ.get("REGALICA_DSN", "postgres:///regalica_paquet")

# Les codes consolidés écrivent « Article 52 » ; les lois de finances écrivent « Art. 52 - ».
# Un seul motif rate la moitié du corpus : il faut accepter les deux graphies.
RE_ART_FR = re.compile(r"(?m)^[ \t]*(?:Article|Art\.)\s*(\d{1,3}(?:\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies))?)\s*[.:\-–]?\s*", re.I)
RE_ART_AR = re.compile(r"(?m)^[ \t]*(?:الفصل|الفصــل)\s*(\d{1,3})\s*[.:\-–]?\s*")
RE_AMEND  = re.compile(r"\((?:Modifi[ée]|Ajout[ée]|Abrog[ée]|Compl[ée]t[ée])[^)]{0,160}\)", re.I)

def segmenter(txt, langue):
    rx = RE_ART_AR if langue == "ar" else RE_ART_FR
    bornes = [(m.start(), m.end(), re.sub(r"\s+"," ",m.group(1)).strip()) for m in rx.finditer(txt)]
    if len(bornes) < 5:               # découpage non fiable : on ne force pas
        return []
    arts = []
    for i,(d,f,num) in enumerate(bornes):
        fin = bornes[i+1][0] if i+1 < len(bornes) else len(txt)
        corps = txt[d:fin].strip()
        if len(corps) < 30: continue
        arts.append(dict(numero=num, texte=corps,
                         sha=hashlib.sha256(corps.encode("utf-8")).hexdigest(),
                         amendements=[a.strip("()") for a in RE_AMEND.findall(corps)][:6],
                         debut=d, fin=fin))
    return arts

def main():
    cn = psycopg2.connect(DSN); cn.autocommit=False
    cur = cn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
      create table if not exists legal.articles_extraits (
        id           bigserial primary key,
        queue_id     uuid not null references legal.ingestion_queue(id) on delete cascade,
        corpus       text not null,
        edition      int,
        numero       text not null,
        langue       text,
        sha256       char(64) not null,
        caracteres   int not null,
        amendements  text[],
        texte        text not null,
        offset_debut int, offset_fin int,
        -- Un même numéro peut apparaître plusieurs fois dans un document : sommaire, renvoi,
        -- ou sections distinctes d'une loi de finances. Une clé (document, numéro) écraserait
        -- silencieusement les occurrences suivantes — 6 662 fragments avaient ainsi disparu.
        -- La position dans le texte fait partie de l'identité de l'occurrence.
        unique (queue_id, numero, offset_debut)
      );
      comment on table legal.articles_extraits is
        'Un article = une unité juridique autonome. Le découpage est fait par le code sur des '
        'frontières typographiques, et chaque article porte son empreinte SHA-256, calculée sur '
        'le texte découpé. Un modèle qui recopierait le texte et en compterait ensuite les mots '
        'ne prouverait rien : il compterait ce qu''il a produit.';
      truncate legal.articles_extraits restart identity;
    """)
    cur.execute("""select d.queue_id, d.texte, d.langue_mesuree, q.corpus, q.annee, q.type_document
                   from legal.documents d join legal.ingestion_queue q on q.id=d.queue_id
                   where q.type_document in ('CODE_CONSOLIDE','LOI_FINANCES')
                     and d.texte is not null and length(d.texte)>2000""")
    docs = cur.fetchall(); cn.commit()
    print(f"documents à segmenter : {len(docs)}", flush=True)
    t0=time.time(); tot=0; ko=[]
    for d in docs:
        arts = segmenter(d["texte"], d["langue_mesuree"])
        if not arts:
            ko.append((d["corpus"], d["annee"], d["langue_mesuree"])); continue
        psycopg2.extras.execute_values(cur, """insert into legal.articles_extraits
            (queue_id,corpus,edition,numero,langue,sha256,caracteres,amendements,texte,offset_debut,offset_fin)
            values %s on conflict (queue_id,numero,offset_debut) do nothing""",
            [(d["queue_id"], d["corpus"], d["annee"], a["numero"], d["langue_mesuree"], a["sha"],
              len(a["texte"]), a["amendements"], a["texte"], a["debut"], a["fin"]) for a in arts])
        tot += len(arts)
    cn.commit()
    cur.execute("""select count(*) n from (select queue_id, numero from legal.articles_extraits
                   group by 1,2 having count(*)>1) x"""); dbl = cur.fetchone()["n"]
    print(f"terminé : {tot} occurrences d'articles, {time.time()-t0:.0f}s", flush=True)
    print(f"numéros apparaissant plusieurs fois dans un même document : {dbl} "
          f"(sommaires, renvois, sections distinctes — à arbitrer, jamais à écraser)", flush=True)
    if ko:
        print(f"découpage non fiable, laissé de côté plutôt que forcé ({len(ko)}) :", flush=True)
        for c,a,l in ko[:15]: print(f"   {c} {a} ({l})", flush=True)

if __name__ == "__main__":
    main()
