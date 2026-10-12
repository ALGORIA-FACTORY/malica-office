-- Les règles de famille parlent la langue des vraies factures.
--
-- ================================================================= POURQUOI
--
-- 11 octobre 2026, troisième signalement : « le non classé revient ».
-- Diagnostic fait sur le staging, sur les articles RÉELLEMENT projetés — et la
-- cause n'est pas celle qu'on suppose.
--
-- La règle du mobilier et de l'informatique dit, littéralement :
--
--     (ordinateur|écran|…|chaise|bureau +\(meuble\)|armoire|…)
--
-- `bureau +\(meuble\)` exige les parenthèses DANS le texte de la facture.
-- C'est une règle écrite pour une facture imaginaire : aucun fournisseur
-- n'imprime « Bureau (meuble) ». Il imprime « Bureau opérateur 160x80 plateau
-- mélaminé chêne ». La liste connaît « chaise » et pas « fauteuil »,
-- « ordinateur » et pas « station d'accueil ».
--
-- ================================= POURQUOI LE COMPTE NE SAUVE PAS LA SITUATION
--
-- Le pack porte aussi des règles par préfixe de compte. On pourrait croire
-- qu'un achat trouve sa famille par là : non. Le compte principal des achats
-- du pack tunisien est `601`, et la règle `601 → MARCHANDISES` est CLOSE.
-- C'était juste — imputer tout achat en marchandises serait faux — mais cela
-- laisse la désignation seule, sans filet.
--
-- ============================== POURQUOI CES RÈGLES VALENT DEPUIS LE DÉBUT DU PACK
--
-- Première version de cette migration : `valid_from date '2026-10-11'`. Jouée,
-- et les épreuves sont restées rouges — pour une raison qui vaut d'être
-- écrite.
--
-- La famille se résout à la date de la PIÈCE (`20261005140000`, puis
-- `20261008120000`). Une règle datée d'aujourd'hui ne s'applique donc jamais à
-- une facture de septembre, et le commanditaire aurait vu « non classé » une
-- quatrième fois sur les mêmes pièces.
--
-- Le raisonnement était faux, et il faut nommer l'erreur : un taux de TVA est
-- un fait DATÉ — il change le 1er janvier, et une facture de décembre garde
-- l'ancien. « Le mot fauteuil désigne du mobilier » n'est pas un fait daté :
-- c'est du vocabulaire. Le dater revient à prétendre que le mot n'existait pas
-- avant qu'on y pense.
--
-- Ces règles prennent donc la date d'effet DU PACK, qui est la date depuis
-- laquelle son vocabulaire est censé être compris. R11 est tenu : la date est
-- littérale, et deux bases jouant ce dépôt à deux jours d'écart obtiennent le
-- même référentiel.
--
-- L'ancienne règle est NEUTRALISÉE de la même façon (`valid_to = valid_from`),
-- comme l'avait été `601 → MARCHANDISES`. L'histoire n'est pas perdue :
-- `capture.piece_articles.famille_code` garde ce que la projection a proposé
-- le jour de la lecture, et c'est là qu'on répond à « pourquoi cette pièce
-- était-elle rangée là en octobre » (R7).
--
-- ======================================================= CE QUE CECI N'EST PAS
--
-- Ce n'est pas la correction définitive, et il faut le dire : avec des règles
-- d'expression, il y aura toujours une désignation non prévue. La réponse de
-- fond est la couche par organisation que R10 décrit — qu'une ligne non classée
-- se range à la main, et que ce choix serve la fois suivante. Cette migration
-- donne au référentiel LIVRÉ le vocabulaire des factures qu'on a sous les yeux.
--
-- Et le repli reste : aucune règle attrape-tout. « XZ-42 » doit continuer de
-- tomber au repli, parce qu'un classement faux est pire qu'un « non classé » —
-- celui-ci se voit et se corrige.

-- --- 0. La résolution devient déterministe ------------------------------------------------
--
-- Trouvé en écrivant ceci. `charge_famille_resolve` ordonne par
-- `priority, match_kind` puis prend la première ligne. Deux règles de même
-- priorité ET de même nature — il en existe déjà quatre paires dans le pack —
-- se départagent donc par le plan d'exécution. Deux bases peuvent rendre deux
-- familles différentes pour la même désignation, et c'est exactement ce que
-- R11 interdit.
--
-- Le motif entre dans l'ordre, après la famille : deux règles qui se disputent
-- une désignation sont départagées par un critère écrit, pas par le hasard.

create or replace function public.charge_famille_resolve(
  p_pack uuid,
  p_account text,
  p_designation text,
  p_at date default current_date
)
returns table(famille_code text, famille_source text)
language sql
stable
set search_path = ''
as $$
  with rules as (
    select r.famille_code, r.match_kind, r.pattern, r.priority
      from ref.charge_famille_rules r
     where r.pack_version_id = p_pack
       and r.valid_from <= p_at
       and (r.valid_to is null or r.valid_to >= p_at)
  ),
  hit as (
    select famille_code, match_kind as famille_source, priority
      from rules
     where (match_kind = 'account_prefix'
            and p_account is not null
            and p_account like pattern || '%')
        or (match_kind = 'designation_pattern'
            and p_designation is not null
            and p_designation ~* pattern)
     order by priority, match_kind, famille_code, pattern
     limit 1
  )
  select coalesce((select h.famille_code from hit h),
                  (select f.code from ref.charge_familles f
                    where f.pack_version_id = p_pack and f.is_fallback
                      and f.valid_from <= p_at
                      and (f.valid_to is null or f.valid_to >= p_at)
                    order by f.code limit 1),
                  'NON_CLASSE'),
         coalesce((select h.famille_source from hit h), 'fallback');
$$;

revoke all on function public.charge_famille_resolve(uuid, text, text, date) from public, anon;
grant execute on function public.charge_famille_resolve(uuid, text, text, date)
  to authenticated, service_role;

comment on function public.charge_famille_resolve(uuid, text, text, date) is
  'La famille d''une charge, résolue contre le pack à une date. L''ordre est '
  'priorité, nature, famille, motif — entièrement écrit : deux règles de même '
  'priorité se départageaient par le plan d''exécution, et deux bases pouvaient '
  'rendre deux familles pour la même désignation (R11).';

-- --- 1. Le mobilier et l'informatique ------------------------------------------------------

update ref.charge_famille_rules
   set valid_to = valid_from
 where match_kind = 'designation_pattern'
   and famille_code = 'PETIT_EQUIPEMENT'
   and pattern like '%bureau%meuble%'
   and valid_to is null;

insert into ref.charge_famille_rules
  (pack_version_id, famille_code, match_kind, pattern, priority, valid_from)
select p.id, 'PETIT_EQUIPEMENT', 'designation_pattern',
       -- Informatique : ce qui se branche et ce qui s'emporte.
       '(ordinateur|unit[eé] +centrale|pc +(de +)?bureau|[eé]cran|moniteur|imprimante|'
       || 'multifonction|photocopieur|scanner|clavier|souris|onduleur|disque +dur|ssd|'
       || 'station +d.accueil|dock(ing)?|webcam|casque|routeur|switch|borne +wifi|'
       || 't[eé]l[eé]phone +(portable|fixe|ip)|tablette|vid[eé]oprojecteur|'
       -- Mobilier : les mots que les fournisseurs impriment vraiment.
       || 'chaise|fauteuil|si[eè]ge|bureau +(op[eé]rateur|de +direction|droit|d.angle|individuel)|'
       || 'table +(de +r[eé]union|basse|de +bureau)|armoire|caisson|rayonnage|[eé]tag[eè]re|'
       || 'vestiaire|coffre[- ]?fort|tableau +blanc|paperboard|'
       -- Petit matériel de local et d'atelier.
       || 'climatiseur|ventilateur|chauffage +d.appoint|r[eé]frig[eé]rateur|micro[- ]?ondes|'
       || 'perceuse|meuleuse|visseuse|[eé]chelle|escabeau|aspirateur|'
       || 'أثاث|حاسوب)',
       5, p.effective_from
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN'
   and not exists (
     select 1 from ref.charge_famille_rules r
      where r.pack_version_id = p.id
        and r.famille_code = 'PETIT_EQUIPEMENT'
        and r.pattern like '%station +d.accueil%'
   );

-- --- 2. L'entretien, et ce qui se vend AVEC un équipement ---------------------------------
--
-- « Extension de garantie 3 ans sur site » tombait au repli. C'est un contrat
-- de maintenance vendu avec le matériel : il se range avec l'entretien, et non
-- avec l'équipement — le bien n'est pas la garantie.

insert into ref.charge_famille_rules
  (pack_version_id, famille_code, match_kind, pattern, priority, valid_from)
select p.id, 'ENTRETIEN', 'designation_pattern',
       '(extension +de +garantie|garantie +[eé]tendue|contrat +(de +)?(maintenance|service|'
       || 'd.entretien)|support +technique|assistance +technique|sav|'
       || 'intervention +sur +site|mise +[aà] +jour +(mat[eé]riel|firmware)|'
       || 'صيانة)',
       5, p.effective_from
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN'
   and not exists (
     select 1 from ref.charge_famille_rules r
      where r.pack_version_id = p.id
        and r.famille_code = 'ENTRETIEN'
        and r.pattern like '%extension +de +garantie%'
   );
