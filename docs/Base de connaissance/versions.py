#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construction de l'historique des articles — identité stable, versions successives.

C'est le défaut de modélisation le plus coûteux qu'un moteur juridique puisse avoir :
traiter « article 52 » comme UNE chose. L'article 52 du code de l'IRPP a connu une dizaine
de rédactions ; une arête de graphe qui pointe « l'article 52 » pointe une cible mouvante.

Deux objets, donc : l'IDENTITÉ de l'article, stable, et ses VERSIONS, datées.
Les versions se déduisent des empreintes : deux éditions qui portent le même SHA-256 pour
un article sont la même version. Aucune interprétation, seulement de l'arithmétique.
"""
import os, time
import psycopg2, psycopg2.extras
DSN = os.environ.get("MALICA_DSN", "postgres:///malica_paquet")

def main():
    cn = psycopg2.connect(DSN); cn.autocommit=False
    cur = cn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
      truncate legal.article_versions, legal.articles restart identity cascade;
      alter table legal.articles add column if not exists jurisdiction text not null default 'TN';
      alter table legal.article_versions add column if not exists edition_min int;
      alter table legal.article_versions add column if not exists edition_max int;
      alter table legal.article_versions add column if not exists amendements text[];
      alter table legal.article_versions alter column source_url drop not null;
    """)
    # une identité par (corpus, numéro)
    cur.execute("""
      -- IDENTITÉ : pour un CODE, l'article 52 traverse les éditions — une seule identité,
      -- plusieurs versions. Pour une LOI DE FINANCES, chaque loi est un texte distinct :
      -- l'article 10 de la LF 1995 et celui de la LF 2026 n'ont rien en commun. Les
      -- confondre produisait un « article 10 » à 24 versions qui n'existe pas.
      insert into legal.articles (jurisdiction, corpus, numero)
      select distinct 'TN',
             case when corpus in ('LF','LFC','DECRET_LOI_FINANCES')
                  then corpus || '-' || edition else corpus end,
             numero
      from legal.articles_extraits where edition is not null
      on conflict (jurisdiction, corpus, numero) do nothing;
    """)
    # une version par empreinte distincte, bornée par les éditions où elle apparaît
    cur.execute("""
      with canonique as (
        -- Un numéro peut apparaître plusieurs fois dans une édition : une ligne de sommaire,
        -- un renvoi, et le corps de l'article. Le corps est le plus long — c'est une
        -- HEURISTIQUE, assumée comme telle, et les autres occurrences restent conservées
        -- dans articles_extraits pour arbitrage.
        select distinct on (corpus, numero, edition) *
        from legal.articles_extraits where edition is not null
        order by corpus, numero, edition, caracteres desc
      ), v as (
        select case when a.corpus in ('LF','LFC','DECRET_LOI_FINANCES')
                    then a.corpus || '-' || a.edition else a.corpus end as corpus,
               a.numero, a.sha256, min(a.edition) e_min, max(a.edition) e_max,
               (array_agg(a.texte order by a.edition))[1] txt,
               (array_agg(a.langue order by a.edition))[1] lang,
               (array_agg(a.amendements[1] order by a.edition) filter (where a.amendements[1] is not null))[1] amd
        from canonique a
        group by 1,2,3
      ), n as (
        select v.*, row_number() over (partition by corpus, numero order by e_min, e_max) rn
        from v
      )
      insert into legal.article_versions
        (article_id, version_num, texte_fr, texte_ar, langue_faisant_foi, source_url,
         source_sha256, modifie_par, valid_from, valid_to, extraction_confiance,
         edition_min, edition_max, amendements)
      select art.id, n.rn,
             case when n.lang <> 'ar' then n.txt end,
             case when n.lang = 'ar' then n.txt end,
             'ar', null, n.sha256,
             n.amd,
             make_date(n.e_min,1,1),
             case when n.e_max < (select max(edition) from legal.articles_extraits
                                  where corpus=n.corpus and edition is not null)
                  then make_date(n.e_max+1,1,1) end,
             'verbatim', n.e_min, n.e_max, null
      from n join legal.articles art
        on art.corpus=n.corpus and art.numero=n.numero and art.jurisdiction='TN';
    """)
    cn.commit()
    cur.execute("""select
      (select count(*) from legal.articles) identites,
      (select count(*) from legal.article_versions) versions,
      (select count(*) from (select article_id from legal.article_versions
         group by 1 having count(*)>1) x) articles_plusieurs_versions,
      (select max(n) from (select count(*) n from legal.article_versions group by article_id) y) max_versions""")
    r=cur.fetchone()
    print(f"identités d'articles          : {r['identites']}")
    print(f"versions distinctes           : {r['versions']}")
    print(f"articles à plusieurs versions : {r['articles_plusieurs_versions']}")
    print(f"nombre maximal de versions    : {r['max_versions']}")

if __name__ == "__main__":
    main()
