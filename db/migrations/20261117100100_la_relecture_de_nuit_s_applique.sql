-- ======================================================================
--  La relecture de nuit s'applique (17 novembre 2026).
--
--  LA MESURE. Staging, 1er novembre 2026, 18 factures fictives d'une page :
--  19,4 s médianes par lecture, dont ~4 s de lecture (OCR + désignation) et
--  ~13 à 15 s de RATTRAPAGE synchrone par le modèle de vision. Il part dès que
--  `qualiteDeLecture < 3` — très souvent, le contrat sortant « partiel » pour
--  des prix TTC unitaires qu'aucune facture n'imprime — et sa lecture est le
--  plus souvent écartée. Le client attend quinze secondes pour rien.
--
--  LA DÉCISION DU DIRIGEANT. La lecture lourde passe en différé : « la nuit,
--  si ni le client ni le cabinet n'a corrigé ». Les deux réglages existaient,
--  ENREGISTRÉS et non appliqués (20261115110000) ; ce fichier les applique.
--
--    `lecture.relecture_nuit` = `coupee` (défaut) : RIEN ne change, le
--      rattrapage reste synchrone.
--    `lecture.relecture_nuit` = `active` : la première lecture est persistée
--      et rendue tout de suite ; si elle n'est pas parfaite (même déclencheur,
--      même « autre lecteur »), un travail `relecture_piece` est inscrit, à ne
--      pas prendre avant la lecture + `lecture.relecture_delai_heures`.
--
--  ============================== CE QUE LA CHAÎNE DE LECTURE DOIT ACCEPTER (R2, R7)
--
--  Une relecture retenue est une LECTURE NOUVELLE, jamais une réécriture (R7).
--  Or le plan de jetons et les citations étaient tenus par PIÈCE : `unique
--  (piece_id, page, ordinal)`. Une seconde lecture ne pouvait donc pas porter
--  son propre plan — et ses citations doivent pointer dans LE SIEN (R2).
--
--    1. `capture.token_plan` et `capture.citations` nomment leur lecture
--       (`extraction_id`). Les lignes déjà inscrites la reçoivent (une seule
--       lecture par pièce jusqu'ici : la porte refusait la seconde), garde R7
--       suspendue le temps de cette migration seulement (précédents :
--       20261022490000, 20261115110000) ;
--    2. `token_plan_v` et `citations_v` ne montrent que le plan de la lecture
--       qui fait foi — la plus récente, la règle que tous les lecteurs de
--       `capture.extractions` suivent déjà (`order by created_at desc`) ;
--    3. le corps de `capture_read_persist` passe dans `capture.lecture_inscrire`,
--       qu'elle appelle après SON refus (`piece_deja_lue`, inchangé) ; la
--       relecture a SA porte (`capture_relecture_persist`), qui exige un
--       travail de relecture PRIS, une lecture qui fait encore foi, et aucune
--       correction humaine depuis.
--
--  =================================================== LA CORRECTION HUMAINE
--
--  `app.piece_corrigee_depuis` dit la première trace d'un geste humain sur la
--  pièce depuis sa lecture : une précision (le client ou le cabinet a donné
--  un type, une date), un retour du cabinet, un rattachement, un avoir lié —
--  et, quelle que soit leur date, une écriture, une décision du cabinet ou un
--  exemple qualifié pour la fabrique. Une pièce VUE n'est pas une pièce
--  corrigée : `capture.vues` n'y est pas.
--
--  REJEU (R11) : aucune horloge n'écrit dans `ref` ; les réglages passent
--  « appliqué » et leurs libellés disent ce qui reste.
-- ======================================================================

-- Le lanceur (db/migrer.mjs) ouvre déjà la transaction : on n'en ouvre pas une seconde.

-- ------------------------------------------- 1. Le plan de jetons nomme sa lecture

alter table capture.token_plan
  add column if not exists extraction_id uuid references capture.extractions (id) on delete cascade;
alter table capture.citations
  add column if not exists extraction_id uuid references capture.extractions (id) on delete cascade;

comment on column capture.token_plan.extraction_id is
  'La lecture dont ce jeton fait partie. Une relecture porte son propre plan : ses citations '
  'pointent dans le sien (R2), et la lecture d''avant reste telle qu''elle était (R7).';
comment on column capture.citations.extraction_id is
  'La lecture que cette citation justifie ; son jeton appartient au plan de la même lecture.';

alter table capture.token_plan disable trigger capture_token_plan_no_upd;
alter table capture.citations disable trigger capture_citations_no_upd;

-- Une seule lecture par pièce jusqu'ici (`capture_read_persist` refusait la
-- seconde) : la plus récente, par sûreté, si une base en portait deux.
update capture.token_plan t
   set extraction_id = x.id
  from (select distinct on (e.piece_id) e.piece_id, e.id
          from capture.extractions e
         order by e.piece_id, e.created_at desc, e.id desc) x
 where x.piece_id = t.piece_id and t.extraction_id is null;

update capture.citations c
   set extraction_id = x.id
  from (select distinct on (e.piece_id) e.piece_id, e.id
          from capture.extractions e
         order by e.piece_id, e.created_at desc, e.id desc) x
 where x.piece_id = c.piece_id and c.extraction_id is null;

alter table capture.token_plan enable trigger capture_token_plan_no_upd;
alter table capture.citations enable trigger capture_citations_no_upd;

-- L'unicité passe de la pièce à la lecture. Un plan sans lecture (banc
-- d'essai, `db/verification/banc_essai.sql`) garde l'ancienne garantie.
alter table capture.token_plan drop constraint if exists token_plan_piece_id_page_ordinal_key;
create unique index if not exists token_plan_extraction_page_ordinal_ux
  on capture.token_plan (extraction_id, page, ordinal);
create unique index if not exists token_plan_piece_page_ordinal_sans_lecture_ux
  on capture.token_plan (piece_id, page, ordinal) where extraction_id is null;
create index if not exists citations_extraction_id_fk_idx
  on capture.citations (extraction_id);

-- ------------------------------------------------ 2. Les vues : la lecture qui fait foi

create or replace view public.token_plan_v with (security_invoker = true) as
select t.id, t.tenant_id, t.piece_id, t.page, t.ordinal, t.text, t.x0, t.y0, t.x1, t.y1,
       t.confidence, t.created_at, t.extraction_id
  from capture.token_plan t
 where t.extraction_id is null
    or t.extraction_id = (select x.id from capture.extractions x
                           where x.piece_id = t.piece_id
                           order by x.created_at desc, x.id desc limit 1);

create or replace view public.citations_v with (security_invoker = true) as
select c.id, c.tenant_id, c.piece_id, c.field, c.token_id, c.page, c.bbox, c.zone, c.ui_field,
       c.ui_role, c.created_at, c.ordinal_end, c.extraction_id
  from capture.citations c
 where c.extraction_id is null
    or c.extraction_id = (select x.id from capture.extractions x
                           where x.piece_id = c.piece_id
                           order by x.created_at desc, x.id desc limit 1);

comment on view public.token_plan_v is
  'Le plan de jetons de la lecture qui fait foi (la plus récente). Une relecture ne mêle pas '
  'son plan à celui d''avant.';
comment on view public.citations_v is
  'Les citations de la lecture qui fait foi (la plus récente).';

-- ------------------------------------------- 3. Inscrire une lecture : un corps, deux portes

/*
 * Le corps de la persistance d'une lecture, tel que `capture_read_persist` le
 * portait (20261110090100), à trois différences près : la lecture s'inscrit
 * D'ABORD (son identifiant nomme les jetons et les citations), les citations
 * se cherchent dans le plan de CETTE lecture, et l'audit dit s'il s'agit
 * d'une relecture. Aucun client ne l'appelle : seules les deux portes
 * ci-dessous, qui décident chacune de ce qu'elles autorisent. Comme toute
 * fonction du portier, elle est `security definer` au chemin vide ; personne
 * d'autre que lui n'a le droit de l'exécuter.
 */
create or replace function capture.lecture_inscrire(
  p_piece uuid, p_tokens jsonb, p_contract text, p_extract jsonb, p_citations jsonb,
  p_flags jsonb, p_mode text, p_confiance jsonb, p_relecture uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant uuid;
  v_tok jsonb;
  v_cit jsonb;
  v_token_id uuid;
  v_count int := 0;
  v_kind text;
  v_extraction uuid;
  v_page smallint;
  v_ordinal int;
  v_fin int;
begin
  select tenant_id into v_tenant from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  insert into capture.extractions (tenant_id, piece_id, contract, payload, flags,
                                   mode_lecture, confiance_par_champ)
  values (v_tenant, p_piece, p_contract, p_extract, coalesce(p_flags, '[]'::jsonb),
          nullif(trim(coalesce(p_mode, '')), ''), coalesce(p_confiance, '{}'::jsonb))
  returning id into v_extraction;

  for v_tok in select * from jsonb_array_elements(p_tokens)
  loop
    insert into capture.token_plan (tenant_id, piece_id, extraction_id, page, ordinal, text,
                                    x0, y0, x1, y1, confidence)
    values (v_tenant, p_piece, v_extraction,
            (v_tok->>'page')::smallint, (v_tok->>'ordinal')::int, v_tok->>'text',
            (v_tok->>'x0')::numeric, (v_tok->>'y0')::numeric,
            (v_tok->>'x1')::numeric, (v_tok->>'y1')::numeric,
            nullif(v_tok->>'confidence','')::numeric);
  end loop;
  for v_cit in select * from jsonb_array_elements(p_citations)
  loop
    v_page := (v_cit->>'page')::smallint;
    v_ordinal := (v_cit->>'ordinal')::int;
    -- La clé arrive en camelCase : c'est le nom du champ TypeScript
    -- (`TokenRef.ordinalEnd`), sérialisé tel quel, comme l'est déjà `bbox`.
    v_fin := nullif(v_cit->>'ordinalEnd', '')::int;
    if v_fin is not null and v_fin <= v_ordinal then
      v_fin := null;
    end if;

    select t.id into v_token_id
      from capture.token_plan t
     where t.extraction_id = v_extraction
       and t.page = v_page
       and t.ordinal = v_ordinal;
    if v_token_id is null then
      raise exception '%', app.refus_avec_valeurs('refus.lecture.citation_orpheline', 'champ', (v_cit->>'field')::text) using errcode = 'check_violation';
    end if;

    -- Une fin de plage qui ne désigne aucun jeton élargirait le cadre cité
    -- sans rien derrière : c'est le même défaut que la citation orpheline.
    if v_fin is not null and not exists (
      select 1 from capture.token_plan t
       where t.extraction_id = v_extraction and t.page = v_page and t.ordinal = v_fin
    ) then
      raise exception '%', app.refus_avec_valeurs('refus.lecture.citation_orpheline', 'champ', (v_cit->>'field')::text) using errcode = 'check_violation';
    end if;

    -- Le cadre est l'union des jetons cités. Pour un jeton seul, c'est le sien.
    insert into capture.citations (tenant_id, piece_id, extraction_id, field, token_id, page,
                                   ordinal_end, bbox, zone, ui_field, ui_role, bbox_page_px)
    select v_tenant, p_piece, v_extraction, v_cit->>'field', v_token_id, v_page, v_fin,
           jsonb_build_object('x0', min(t.x0), 'y0', min(t.y0),
                              'x1', max(t.x1), 'y1', max(t.y1)),
           nullif(v_cit->>'zone',''),
           nullif(v_cit->>'ui_field',''),
           nullif(v_cit->>'ui_role',''),
           case when v_cit ? 'bbox' then v_cit->'bbox' else null end
      from capture.token_plan t
     where t.extraction_id = v_extraction
       and t.page = v_page
       and t.ordinal between v_ordinal and coalesce(v_fin, v_ordinal);
    v_count := v_count + 1;
  end loop;

  -- Le type lu, s'il fait partie du vocabulaire, monte sur la pièce : lu,
  -- pas encore confirmé. Un type déjà confirmé par la personne n'est jamais
  -- écrasé par une lecture.
  select t.code into v_kind
    from ref.document_types t
   where t.code = p_extract->>'document_kind';

  update capture.pieces
     set status = case when status = 'capturee' then 'lue' else status end,
         document_kind = case when document_kind_statut = 'confirme' then document_kind
                              else coalesce(v_kind, document_kind) end,
         document_kind_statut = case when document_kind_statut = 'confirme' then 'confirme'
                                     when v_kind is not null then 'a_confirmer'
                                     else document_kind_statut end,
         updated_at = now()
   where id = p_piece;

  -- Qui a lu quoi, comment : l'audit de la lecture. Une relecture nomme son travail.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.read', 'capture', 'extractions', v_extraction,
          jsonb_build_object('piece', p_piece, 'contract', p_contract,
                             'mode', nullif(trim(coalesce(p_mode, '')), ''),
                             'citations', v_count,
                             'flags', jsonb_array_length(coalesce(p_flags, '[]'::jsonb)))
          || case when p_relecture is null then '{}'::jsonb
                  else jsonb_build_object('relecture', p_relecture) end);

  return jsonb_build_object('piece_id', p_piece, 'citations', v_count,
                            'document_kind', v_kind, 'extraction_id', v_extraction);
end
$function$;

alter function capture.lecture_inscrire(uuid, jsonb, text, jsonb, jsonb, jsonb, text, jsonb, uuid)
  owner to portier;
revoke all on function capture.lecture_inscrire(uuid, jsonb, text, jsonb, jsonb, jsonb, text, jsonb, uuid)
  from public, anon, authenticated;

comment on function capture.lecture_inscrire(uuid, jsonb, text, jsonb, jsonb, jsonb, text, jsonb, uuid) is
  'Le corps de la persistance d''une lecture : la lecture, son plan de jetons, ses citations, '
  'le type lu, l''audit. Appelée par ses deux portes seulement (capture_read_persist, '
  'capture_relecture_persist), qui décident de ce qu''elles autorisent.';

-- La première lecture : SON refus, inchangé, puis le corps.
create or replace function public.capture_read_persist(
  p_piece uuid, p_tokens jsonb, p_contract text, p_extract jsonb, p_citations jsonb,
  p_flags jsonb default '[]'::jsonb, p_mode text default null::text,
  p_confiance jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (select 1 from capture.pieces where id = p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  -- R7 : une lecture est un fait. On ne la remplace pas.
  if exists (select 1 from capture.extractions where piece_id = p_piece) then
    raise exception 'R7 : cette piece a deja ete lue — rephotographiez-la pour en creer une nouvelle'
      using errcode = 'restrict_violation';
  end if;
  return capture.lecture_inscrire(p_piece, p_tokens, p_contract, p_extract, p_citations,
                                  p_flags, p_mode, p_confiance, null);
end
$function$;

-- ------------------------------------------------------- 4. La correction humaine

/*
 * La première trace d'un geste humain sur la pièce depuis `p_depuis` (la
 * lecture que l'on voudrait relire), ou nul. L'ordre est celui de la sortie,
 * pas une hiérarchie : une seule trace suffit à s'abstenir.
 *
 * `security definer` : une écriture du cabinet ou sa décision peut échapper à
 * la vue d'un membre de la PME, et une trace qu'on ne voit pas serait une
 * relecture par-dessus un geste humain. Elle ne rend qu'un code, pour une
 * pièce que l'appelant peut modifier.
 */
create or replace function app.piece_corrigee_depuis(p_piece uuid, p_depuis timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_piece is null or p_depuis is null or not app.piece_modifiable(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  return case
    when exists (select 1 from capture.precisions x
                  where x.piece_id = p_piece and x.decided_at > p_depuis) then 'precision'
    when exists (select 1 from socle.ecritures x where x.piece_id = p_piece) then 'ecriture'
    when exists (select 1 from capture.conformite x where x.piece_id = p_piece) then 'decision'
    when exists (select 1 from capture.circuit x
                  where x.piece_id = p_piece and x.fait = 'retournee' and x.le > p_depuis)
      then 'retour'
    when exists (select 1 from capture.rattachements x
                  where (x.piece_id = p_piece or x.piece_liee_id = p_piece)
                    and x.created_at > p_depuis) then 'rattachement'
    when exists (select 1 from capture.avoirs_rattaches x
                  where (x.piece_id = p_piece or x.facture_piece_id = p_piece)
                    and x.decide_le > p_depuis) then 'avoir'
    when exists (select 1 from fabrique.exemples x where x.piece_id = p_piece) then 'exemple'
  end;
end
$function$;

revoke all on function app.piece_corrigee_depuis(uuid, timestamptz) from public, anon;
grant execute on function app.piece_corrigee_depuis(uuid, timestamptz) to authenticated;

comment on function app.piece_corrigee_depuis(uuid, timestamptz) is
  'La trace d''une correction ou d''une validation humaine depuis une lecture : precision, '
  'ecriture, decision, retour, rattachement, avoir, exemple ; nul s''il n''y en a aucune. Une '
  'pièce vue n''est pas une pièce corrigée.';

-- ------------------------------------------------------ 5. Le réglage, lu par la base

/*
 * Le délai de la relecture de nuit pour ce dossier, en heures, si elle est
 * ACTIVE ; nul si elle est coupée, ou si le pack de sa juridiction ne porte
 * pas ce réglage (comme un pack sans seuil d'immobilisation : rien ne
 * s'applique). Résolu par `app.reglage_comptable` — le dossier, son cabinet,
 * le pack — au jour où l'on décide, c'est-à-dire aujourd'hui. Une valeur que
 * la base ne connaît pas lève : elle ne devine pas (R4).
 */
create or replace function app.relecture_de_nuit(p_dossier uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_pack uuid;
  v_nuit text;
  v_delai text;
  v_heures numeric;
begin
  select j.id into v_pack
    from identity.organizations o
    join ref.jurisdiction_packs j on j.jurisdiction = o.jurisdiction
   where o.id = p_dossier
     and j.effective_from <= current_date
     and (j.effective_to is null or j.effective_to >= current_date)
   order by j.effective_from desc
   limit 1;
  if v_pack is null then
    raise exception 'refus.referentiel.pack_absent' using errcode = 'no_data_found';
  end if;

  select max(r.valeur) filter (where r.code = 'lecture.relecture_nuit'),
         max(r.valeur) filter (where r.code = 'lecture.relecture_delai_heures')
    into v_nuit, v_delai
    from app.reglage_comptable(p_dossier, v_pack, current_date) r
   where r.code in ('lecture.relecture_nuit', 'lecture.relecture_delai_heures');

  if v_nuit is null or v_nuit = 'coupee' then
    return null;
  end if;
  if v_nuit <> 'active' or v_delai is null or v_delai !~ '^[0-9]+([.][0-9]+)?$' then
    raise exception 'refus.relecture.reglage_illisible' using errcode = '22023';
  end if;
  v_heures := v_delai::numeric;
  return v_heures;
end
$function$;

revoke all on function app.relecture_de_nuit(uuid) from public, anon;
grant execute on function app.relecture_de_nuit(uuid) to authenticated;

comment on function app.relecture_de_nuit(uuid) is
  'Le délai (heures) de la relecture de nuit si elle est active pour ce dossier, nul sinon. '
  'Réglages `lecture.relecture_nuit` et `lecture.relecture_delai_heures` (R10).';

-- ------------------------------------------------- 6. La file : « pas avant », et la consigne

alter table fabrique.travaux
  add column if not exists pas_avant timestamptz,
  add column if not exists extraction_id uuid references capture.extractions (id) on delete cascade,
  add column if not exists consigne jsonb;

comment on column fabrique.travaux.pas_avant is
  'Le travail n''est pas prenable avant cette heure. Une relecture : la lecture + le délai du '
  'dossier (`lecture.relecture_delai_heures`).';
comment on column fabrique.travaux.extraction_id is
  'La lecture qu''une relecture relit. Si une autre l''a remplacée entre-temps, la relecture '
  's''abstient.';
comment on column fabrique.travaux.consigne is
  'Ce que l''exécution doit savoir de la première lecture pour choisir un AUTRE lecteur : '
  '{"lecteur": …, "paddleTente": …}. Le nom du modèle ne le dit pas, et ne doit pas le dire.';

alter table fabrique.travaux
  add constraint travaux_relecture_complete check (
    (nature = 'relecture_piece')
      = (extraction_id is not null and pas_avant is not null and consigne is not null)),
  add constraint travaux_consigne_objet check (
    consigne is null
    or (jsonb_typeof(consigne) = 'object'
        and jsonb_typeof(consigne -> 'lecteur') = 'string'
        and jsonb_typeof(consigne -> 'paddleTente') = 'boolean'));

create index if not exists travaux_extraction_id_fk_idx on fabrique.travaux (extraction_id);

create or replace view fabrique.etat_des_travaux_v with (security_invoker = true) as
with livres as (
  select distinct on (s.code) s.code, s.value_num
    from ref.socle_params s
   where s.code like 'fabrique.seuil.travail.%'
     and s.valid_from <= current_date
     and (s.valid_to is null or s.valid_to >= current_date)
   order by s.code, s.valid_from desc
)
select t.id                              as travail_id,
       t.tenant_id,
       t.piece_id,
       t.nature,
       t.priorite,
       t.demande_le,
       coalesce(c.tentatives, 0)::smallint as tentatives,
       b.tentatives_max,
       d.nature                          as dernier_fait,
       d.motif                           as dernier_motif,
       d.inscrit_le                      as dernier_le,
       e.etat,
       e.prenable_a,
       (e.prenable_a is not null and e.prenable_a <= now()) as prenable,
       t.pas_avant
  from fabrique.travaux t
  left join lateral (
    select f.nature, f.motif, f.tentative, f.inscrit_le
      from fabrique.travail_faits f
     where f.travail_id = t.id
     order by f.ordre desc
     limit 1
  ) d on true
  left join lateral (
    select count(*) filter (where f.nature = 'pris') as tentatives
      from fabrique.travail_faits f
     where f.travail_id = t.id
  ) c on true
  cross join lateral (
    select
      max(coalesce(o.value_num, l.value_num))
        filter (where l.code = 'fabrique.seuil.travail.tentatives_max') as tentatives_max,
      max(coalesce(o.value_num, l.value_num))
        filter (where l.code = 'fabrique.seuil.travail.abandon_s')      as abandon_s,
      max(coalesce(o.value_num, l.value_num))
        filter (where l.code = 'fabrique.seuil.travail.repli_s')        as repli_s
      from livres l
      left join parametrage.fabrique_seuils o
        on o.tenant_id = t.tenant_id and o.code = l.code
  ) b
  cross join lateral (
    -- L'ORDRE DE CES BRANCHES EST LA REGLE, et il se lit de haut en bas.
    select case
      when d.nature = 'termine'             then 'termine'
      -- Une pièce remplacée ne se lit plus (`lecture_autorisee`) : son travail
      -- est refusé, quel que soit le dernier fait — rien ne le reprend.
      when exists (select 1 from capture.remplacements r where r.piece_id = t.piece_id)
                                            then 'refuse'
      when d.nature is null                 then 'a_faire'
      when d.nature = 'refus_metier'        then 'refuse'
      when d.nature = 'erreur_technique'    then 'en_erreur'
      -- Une prise encore fraiche : quelqu'un travaille.
      when d.nature = 'pris'
       and now() <= d.inscrit_le + make_interval(secs => b.abandon_s::double precision) then 'en_cours'
      -- Au-dela, le preneur est repute mort. Reste a savoir s'il reste des
      -- tentatives : la borne passe avant la reprise.
      when coalesce(c.tentatives, 0) >= b.tentatives_max then 'epuise'
      when d.nature = 'pris'                then 'abandonne'
      else                                       'en_panne'
    end as etat
  ) e0
  cross join lateral (
    select e0.etat,
           case e0.etat
             -- Jamais pris : prenable depuis sa demande, et pas avant son heure.
             when 'a_faire'   then greatest(t.demande_le, t.pas_avant)
             when 'abandonne' then d.inscrit_le + make_interval(secs => b.abandon_s::double precision)
             when 'en_panne'  then d.inscrit_le + make_interval(secs => b.repli_s::double precision)
             else null
           end as prenable_a
  ) e;

comment on view fabrique.etat_des_travaux_v is
  'Ou en est chaque travail, d''apres ses faits : a_faire, en_cours, '
  'abandonne, en_panne, epuise, termine, refuse, en_erreur. Un travail a faire '
  'n''est prenable qu''a partir de son « pas avant » (une relecture de nuit). Le '
  'travail d''une piece remplacee est refuse : sa lecture ne s''inscrirait nulle '
  'part. Une borne absente du referentiel rend « prenable » faux — elle refuse, '
  'elle ne devine pas ; la fonction de prise, elle, leve et le dit.';

-- ------------------------------------------- 7. Inscrire une relecture : sa porte

/*
 * Le serveur seul, après avoir persisté la première lecture. La base décide
 * de l'heure : la lecture qui fait foi + le délai du dossier ; et elle refuse
 * si la relecture de nuit est coupée — l'application ne l'inscrit pas à sa
 * place. Idempotente par la lecture relue : une lecture, une relecture.
 * Elle passe APRÈS toute lecture en attente (priorité 9).
 */
create or replace function fabrique.relecture_inscrire(p_piece uuid, p_consigne jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant uuid;
  v_extraction uuid;
  v_lue_le timestamptz;
  v_heures numeric;
  v_id uuid;
  v_pas_avant timestamptz;
begin
  if coalesce(current_setting('malica.origine', true), '') <> 'serveur' then
    raise exception 'refus.reserve.serveur' using errcode = '42501';
  end if;
  select p.tenant_id into v_tenant from capture.pieces p where p.id = p_piece;
  if v_tenant is null or not app.piece_modifiable(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if p_consigne is null or jsonb_typeof(p_consigne) <> 'object'
     or jsonb_typeof(p_consigne -> 'lecteur') is distinct from 'string'
     or jsonb_typeof(p_consigne -> 'paddleTente') is distinct from 'boolean' then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;

  select x.id, x.created_at into v_extraction, v_lue_le
    from capture.extractions x
   where x.piece_id = p_piece
   order by x.created_at desc, x.id desc
   limit 1;
  if v_extraction is null then
    raise exception 'refus.relecture.sans_lecture' using errcode = 'check_violation';
  end if;

  v_heures := app.relecture_de_nuit(v_tenant);
  if v_heures is null then
    raise exception 'refus.relecture.coupee' using errcode = 'check_violation';
  end if;
  v_pas_avant := v_lue_le + v_heures * interval '1 hour';

  -- La priorité la plus basse que la file admette (`travaux_priorite_check`,
  -- 1 à 9) : la file se prend par priorité, puis par ancienneté, et une
  -- relecture due depuis la nuit passerait sinon AVANT la lecture d'une pièce
  -- que le client vient de déposer — quinze secondes de modèle de vision par
  -- relecture, devant lui. Ce n'est pas un seuil métier : c'est l'ordre de la
  -- file, et la relecture est par définition ce qui peut attendre.
  insert into fabrique.travaux
    (tenant_id, piece_id, nature, cle_idempotence, priorite, extraction_id, pas_avant, consigne)
  values (v_tenant, p_piece, 'relecture_piece', 'relecture_piece:' || v_extraction::text,
          9, v_extraction, v_pas_avant,
          jsonb_build_object('lecteur', p_consigne -> 'lecteur',
                             'paddleTente', p_consigne -> 'paddleTente'))
  on conflict (tenant_id, cle_idempotence) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('travail_id', v_id, 'deja', false, 'pas_avant', v_pas_avant);
  end if;
  select t.id, t.pas_avant into v_id, v_pas_avant from fabrique.travaux t
   where t.tenant_id = v_tenant and t.cle_idempotence = 'relecture_piece:' || v_extraction::text;
  if v_id is null then
    raise exception 'refus.introuvable.travail' using errcode = '42501';
  end if;
  return jsonb_build_object('travail_id', v_id, 'deja', true, 'pas_avant', v_pas_avant);
end
$function$;

alter function fabrique.relecture_inscrire(uuid, jsonb) owner to portier;
revoke all on function fabrique.relecture_inscrire(uuid, jsonb) from public, anon;
grant execute on function fabrique.relecture_inscrire(uuid, jsonb) to authenticated;

comment on function fabrique.relecture_inscrire(uuid, jsonb) is
  'Inscrit la relecture de nuit de la lecture qui fait foi : pas avant la lecture + le délai du '
  'dossier. Refuse si la relecture de nuit est coupée. Le serveur seul.';

-- ------------------------------------------- 8. Ce que l'exécution doit savoir, avant de payer

/*
 * Lue sous l'identité de celui qui fait tourner la file, AVANT tout appel de
 * modèle : la lecture relue et sa qualité (contrat, drapeaux), la consigne,
 * et la raison de s'abstenir s'il y en a une — la pièce remplacée, une
 * lecture plus récente, une correction humaine (et laquelle), ou la relecture
 * de nuit coupée depuis. La porte de persistance revérifie tout.
 */
create or replace function fabrique.relecture_a_faire(p_travail uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  t record;
  x record;
  v_derniere uuid;
  v_trace text;
  v_abstention text;
begin
  select tr.id, tr.tenant_id, tr.piece_id, tr.extraction_id, tr.consigne into t
    from fabrique.travaux tr
   where tr.id = p_travail and tr.nature = 'relecture_piece';
  if t.id is null then
    raise exception 'refus.introuvable.travail' using errcode = '42501';
  end if;
  select e.id, e.created_at, e.contract, e.flags into x
    from capture.extractions e where e.id = t.extraction_id;
  select e.id into v_derniere
    from capture.extractions e
   where e.piece_id = t.piece_id
   order by e.created_at desc, e.id desc
   limit 1;

  if exists (select 1 from capture.remplacements r where r.piece_id = t.piece_id) then
    v_abstention := 'remplacee';
  elsif v_derniere is distinct from t.extraction_id then
    v_abstention := 'lecture_depassee';
  else
    v_trace := app.piece_corrigee_depuis(t.piece_id, x.created_at);
    if v_trace is not null then
      v_abstention := 'correction_humaine';
    elsif app.relecture_de_nuit(t.tenant_id) is null then
      v_abstention := 'coupee';
    end if;
  end if;

  return jsonb_build_object(
    'piece_id', t.piece_id,
    'extraction_id', t.extraction_id,
    'contract', x.contract,
    'flags', coalesce(x.flags, '[]'::jsonb),
    'consigne', t.consigne,
    'abstention', v_abstention,
    'trace', v_trace);
end
$function$;

revoke all on function fabrique.relecture_a_faire(uuid) from public, anon;
grant execute on function fabrique.relecture_a_faire(uuid) to authenticated;

comment on function fabrique.relecture_a_faire(uuid) is
  'Ce qu''une relecture doit savoir avant de payer un modèle, et la raison de s''abstenir : '
  'remplacee, lecture_depassee, correction_humaine (avec sa trace), coupee.';

-- --------------------------------------- 9. Persister une relecture : sa porte, et elle seule

/*
 * La relecture retenue est une LECTURE NOUVELLE (R7) : elle passe par le même
 * corps que la première, et par une porte qui l'autorise EXPLICITEMENT — là où
 * `capture_read_persist` refuse toute seconde lecture. Elle exige :
 *   - le serveur, et une pièce que l'appelant peut modifier ;
 *   - un travail de relecture de CETTE pièce, PRIS et encore en cours ;
 *   - que la lecture qu'il relit fasse encore foi ;
 *   - aucune correction humaine depuis cette lecture — revérifiée ici, au
 *     moment d'écrire, et non seulement avant d'avoir payé le modèle.
 */
create or replace function public.capture_relecture_persist(
  p_travail uuid, p_piece uuid, p_tokens jsonb, p_contract text, p_extract jsonb,
  p_citations jsonb, p_flags jsonb, p_mode text, p_confiance jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_extraction uuid;
  v_lue_le timestamptz;
  v_derniere uuid;
begin
  if coalesce(current_setting('malica.origine', true), '') <> 'serveur' then
    raise exception 'refus.reserve.serveur' using errcode = '42501';
  end if;
  if not exists (select 1 from capture.pieces where id = p_piece)
     or not app.piece_modifiable(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  select t.extraction_id into v_extraction
    from fabrique.travaux t
    join fabrique.etat_des_travaux_v e on e.travail_id = t.id
   where t.id = p_travail and t.piece_id = p_piece and t.nature = 'relecture_piece'
     and e.etat = 'en_cours';
  if v_extraction is null then
    raise exception 'refus.relecture.travail' using errcode = 'check_violation';
  end if;

  select x.id into v_derniere
    from capture.extractions x
   where x.piece_id = p_piece
   order by x.created_at desc, x.id desc
   limit 1;
  if v_derniere is distinct from v_extraction then
    raise exception 'refus.relecture.depassee' using errcode = 'check_violation';
  end if;
  select x.created_at into v_lue_le from capture.extractions x where x.id = v_extraction;
  if app.piece_corrigee_depuis(p_piece, v_lue_le) is not null then
    raise exception 'refus.relecture.corrigee' using errcode = 'check_violation';
  end if;

  return capture.lecture_inscrire(p_piece, p_tokens, p_contract, p_extract, p_citations,
                                  p_flags, p_mode, p_confiance, p_travail);
end
$function$;

alter function public.capture_relecture_persist(uuid, uuid, jsonb, text, jsonb, jsonb, jsonb, text, jsonb)
  owner to portier;
revoke all on function public.capture_relecture_persist(uuid, uuid, jsonb, text, jsonb, jsonb, jsonb, text, jsonb)
  from public, anon;
grant execute on function public.capture_relecture_persist(uuid, uuid, jsonb, text, jsonb, jsonb, jsonb, text, jsonb)
  to authenticated;

comment on function public.capture_relecture_persist(uuid, uuid, jsonb, text, jsonb, jsonb, jsonb, text, jsonb) is
  'Persiste une relecture retenue comme une lecture NOUVELLE (R7) : le serveur, un travail de '
  'relecture pris, une lecture qui fait encore foi, aucune correction humaine depuis.';

-- Ce que les portes du portier vérifient en son nom.
grant execute on function app.piece_corrigee_depuis(uuid, timestamptz) to portier;
grant execute on function app.relecture_de_nuit(uuid) to portier;

-- ------------------------------------------------------ 10. Les réglages : appliqués

update ref.reglages_comptables set applique = true
 where code in ('lecture.relecture_nuit', 'lecture.relecture_delai_heures');
update ref.reglages_comptables_options set applique = true
 where reglage = 'lecture.relecture_nuit' and code in ('active', 'coupee');

update ref.labels set value = v.value
  from (values
    ('fr', 'Appliqués : la relecture de nuit et son délai. Ce qui reste : la relecture part au '
           'prochain appel d''un membre du dossier après son heure, pas d''elle-même la nuit — il '
           'manque un déclencheur planifié sous une identité de service. Le passage en désignation '
           'se décide sur les mesures de l''observation des vraies pièces.'),
    ('en', 'Applied: the night re-reading and its delay. What remains: the re-reading starts at '
           'the next call from a member of the file after its time, not by itself at night — a '
           'scheduled trigger under a service identity is missing. Switching to designation is '
           'decided on the measurements of observing real documents.'),
    ('ar', 'مطبّق: إعادة القراءة الليلية ومهلتها. ما يبقى: تنطلق إعادة القراءة عند أول طلب من عضو '
           'في الملف بعد موعدها، لا من تلقاء نفسها ليلا — ينقص مُشغّل مُجدول بهوية خدمة. يُقرَّر '
           'المرور إلى التعيين على أساس قياسات ملاحظة الوثائق الحقيقية.')
  ) as v(locale, value)
 where ref.labels.ns = 'reglage_sujet_incertain' and ref.labels.key = 'lecture'
   and ref.labels.locale = v.locale;

update ref.labels set value = v.value
  from (values
    ('fr', 'En observation, il lit chaque pièce et inscrit ce qu''il a prouvé, sans rien changer à '
           'la lecture. Désignant, une pièce prouvée prend ses montants ; une pièce non prouvée '
           'garde la lecture de la chaîne et ses contrôles. Relecture de nuit active : une lecture '
           'imparfaite est rendue tout de suite, et un autre lecteur la relit après le délai — '
           'sauf si le client ou le cabinet l''a corrigée entre-temps.'),
    ('en', 'When observing, it reads every document and records what it proved, without changing '
           'the reading. When designating, a proven document takes its amounts; an unproven one '
           'keeps the chain''s reading and its checks. With night re-reading on: an imperfect '
           'reading is returned at once, and another reader re-reads it after the delay — unless '
           'the client or the firm has corrected it in the meantime.'),
    ('ar', 'في وضع الملاحظة، يقرأ كل وثيقة ويسجّل ما أثبته دون تغيير القراءة. في وضع التعيين، تأخذ '
           'الوثيقة المُثبَتة مبالغه؛ وتحتفظ الوثيقة غير المُثبَتة بقراءة السلسلة ومراقباتها. مع '
           'تفعيل إعادة القراءة الليلية: تُعاد القراءة غير الكاملة فورا، ويعيد قارئ آخر قراءتها بعد '
           'المهلة — ما لم يصحّحها الحريف أو المكتب في الأثناء.')
  ) as v(locale, value)
 where ref.labels.ns = 'reglage_sujet_pratique' and ref.labels.key = 'lecture'
   and ref.labels.locale = v.locale;
