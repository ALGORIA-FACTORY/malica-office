-- Deux objets, et il ne faut surtout pas les confondre.
--
-- ============================================================ LE JEU DE SONDAGE
--
-- `legal.sondages` : des milliers de questions dont L'ARTICLE ATTENDU EST CONNU
-- PAR CONSTRUCTION. Aucune n'a demande le jugement d'un expert, et aucune ne
-- porte de reponse redigee. Il mesure UNE chose, la seule qui se mesure sans
-- expert : est-ce que la recherche ramene le bon article ?
--
-- C'est ce qui permet d'arbitrer un reglage de recherche — type de tache,
-- en-tete de contexte, hybride, top-K, reclassement — en une commande, sur des
-- milliers de cas, gratuitement. Le volume est ici honnete precisement parce
-- que rien n'y est invente.
--
-- Deux familles, deux sources, aucune ecriture de notre part :
--
--   identite  « article 52 — code de la taxe sur la valeur ajoutee ». La
--             maniere dont un praticien designe un texte. Eprouve la moitie
--             LEXICALE de la recherche.
--   objet     l'objet de chaque note commune, tel que la DGELF l'ecrit
--             elle-meme sur son portail, prive de son numero pour qu'il reste
--             une question et non une reference. Eprouve la moitie SEMANTIQUE :
--             la question n'a presque aucun mot en commun avec le texte.
--
-- ============================================================ LA BANQUE DE CAS
--
-- `legal.banque_cas` : le thermometre du METIER. Elle ne se remplit pas toute
-- seule, et c'est structurel — si une machine savait decider la bonne reponse a
-- une question fiscale nouvelle, la banque n'aurait pas de raison d'etre. Un
-- cas n'entre validé que s'il porte les DEUX : la reponse attendue ET l'article
-- attendu. C'est la distinction de l'etude de Stanford : une reponse juste
-- appuyee sur le mauvais article compte comme une erreur, parce que c'est celle
-- qui se defend le plus mal devant un verificateur.
--
-- Elle est amorcee avec les 688 objets de notes communes : la question est
-- ecrite par l'administration, l'article attendu est etabli, il ne manque que
-- la reponse — et elle se lit dans la note elle-meme. C'est le chemin le moins
-- couteux vers les premieres dizaines de cas validés.

begin;

create table legal.sondages (
  id            uuid primary key default gen_random_uuid(),
  famille       text not null check (famille in ('identite', 'objet')),
  question      text not null check (length(btrim(question)) >= 10),
  corpus_attendu text not null,
  numero_attendu text not null,
  langue_attendue text,
  origine       text not null,
  created_at    timestamptz not null default now(),
  unique (famille, question, corpus_attendu, numero_attendu)
);

comment on table legal.sondages is
  'Questions dont l''article attendu est connu par construction. Mesure la recherche, jamais la réponse. Rejouable par db/corpus/sonder.mjs.';

create table legal.banque_cas (
  id             uuid primary key default gen_random_uuid(),
  question       text not null,
  categorie      text not null check (categorie in
                   ('courante', 'piege', 'datee', 'sans_reponse')),
  reponse_attendue text,
  corpus_attendu text,
  numero_attendu text,
  vaut_au        date,
  validee_par    text,
  validee_le     date,
  commentaire    text,
  created_at     timestamptz not null default now(),
  -- Un cas validé porte les DEUX axes, ou il n'est pas validé. Sauf le cas
  -- « sans_reponse », dont la bonne reponse EST l'abstention : il n'a pas
  -- d'article attendu, et c'est le seul.
  constraint banque_cas_deux_axes check (
    validee_le is null
    or (categorie = 'sans_reponse' and reponse_attendue is not null)
    or (reponse_attendue is not null and corpus_attendu is not null and numero_attendu is not null)
  ),
  constraint banque_cas_validation_signee check (
    (validee_le is null) = (validee_par is null)
  )
);

comment on table legal.banque_cas is
  'Le jeu de référence du métier : question, réponse attendue, article attendu, date à laquelle la réponse est vraie. Se remplit à la main, se valide par une personne nommée.';

-- ---------------------------------------------------------------- le sondage
--
-- Famille « identite ». On ecrit « article 52 — code de la TVA » plutot que
-- « article 52 du code de la TVA » : « du/de la/de l' » demanderait de deviner
-- le genre de chaque intitule, et une question mal accordee n'eprouve plus rien.
insert into legal.sondages (famille, question, corpus_attendu, numero_attendu, origine)
select 'identite',
       case when n.famille = 'doctrine'
            then 'note commune n° ' || a.numero
                 || coalesce(' de ' || substring(a.corpus from '\d{4}$'), '')
            else 'article ' || a.numero || ' — ' || coalesce(n.nom_fr, a.corpus)
       end,
       a.corpus, a.numero,
       'identité composée à partir de legal.corpus_noms'
  from legal.articles a
  join legal.corpus_noms n on n.code = a.corpus
on conflict do nothing;

-- Famille « objet ». Le titre du portail porte « NC 14/2003 - Note Commune
-- numéro 14 : <objet> » ; on ne garde que l'objet. Le numero doit partir :
-- sinon la question contient sa propre reponse et la mesure ne vaut rien.
insert into legal.sondages (famille, question, corpus_attendu, numero_attendu, langue_attendue, origine)
select distinct 'objet',
       btrim(regexp_replace(q.titre,
             '^NC\s*\d+\s*/\s*\d{4}\s*[-–—]\s*Note\s+Commune\s*(?:numéro|[Nn]\s*[°o]?)?\s*\d*\s*:?\s*',
             '', 'i')),
       a.corpus, a.numero, v.langue_faisant_foi,
       'objet de la note, écrit par la DGELF'
  from legal.ingestion_queue q
  join legal.article_versions v on v.source_url = q.url_fichier
  join legal.articles a on a.id = v.article_id
 where q.type_document = 'NOTE_COMMUNE'
   and q.statut = 'ingere'
   and length(btrim(regexp_replace(q.titre,
             '^NC\s*\d+\s*/\s*\d{4}\s*[-–—]\s*Note\s+Commune\s*(?:numéro|[Nn]\s*[°o]?)?\s*\d*\s*:?\s*',
             '', 'i'))) >= 10
on conflict do nothing;

-- ------------------------------------------------------- l'amorce de la banque
--
-- Les memes objets, mais cette fois comme des CAS a valider : la question est
-- posee, l'article attendu est etabli, la reponse reste a ecrire. Aucun de ces
-- cas n'est validé : `validee_le` est nul, et la contrainte ci-dessus interdit
-- qu'il cesse de l'etre sans reponse.
insert into legal.banque_cas (question, categorie, corpus_attendu, numero_attendu, vaut_au, commentaire)
select s.question, 'courante', s.corpus_attendu, s.numero_attendu,
       make_date(substring(s.corpus_attendu from '\d{4}$')::int, 12, 31),
       'amorce : objet de note commune, réponse à écrire par l''expert'
  from legal.sondages s
 where s.famille = 'objet';

commit;
