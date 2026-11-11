-- ======================================================================
--  Le crayon d'une facture lue : le pied se corrige (10 novembre 2026).
--
--  Demande du dirigeant : « comme pour le nom du tiers et le type de la
--  pièce, un crayon à côté de chaque composante de la facture ». Ce fichier
--  ouvre le PIED : la base HT, la TVA, les droits, le total. Les lignes
--  suivent (`20261212090100`).
--
--  La correction est une PRÉCISION (R7), la même table et la même porte que
--  le type, la date et le nom : `capture.precisions`, une entrée nouvelle,
--  datée et signée, la dernière fait foi, la lecture reste telle qu'elle a
--  été faite. Le champ se nomme par son chemin de citation — celui que la
--  lecture cite sur la photo (`totals.vat`, `other_charges[0].amount`) —,
--  si bien que la zone à montrer et la valeur à retenir se retrouvent par la
--  même clé.
--
--  La saisie est une hypothèse (R3) : la base en borne la forme (R4 : les
--  décimales sont celles de la devise du référentiel, aucune n'est écrite
--  ici), le moteur rejuge ensuite la pièce, et c'est son jugement que
--  l'écran répète. Une pièce engagée ne se précise plus ; après, la
--  correction passe par le cabinet.
-- ======================================================================

begin;

-- --- 1. Ce que la porte accepte ------------------------------------------------------------------

create or replace function app.est_un_champ_de_lecture(p_champ text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_champ ~ '^(totals\.(base_ht|vat|ttc)|other_charges\[[0-9]{1,3}\]\.amount)$'
$$;
revoke all on function app.est_un_champ_de_lecture(text) from public, anon;
grant execute on function app.est_un_champ_de_lecture(text) to authenticated;

comment on function app.est_un_champ_de_lecture(text) is
  'Les champs de la lecture qu''une personne peut préciser, nommés par leur chemin de citation. Aucune valeur réglementaire : seulement la forme des chemins.';

-- « other_charges[0].amount » devient {other_charges,0,amount}, le chemin du payload.
create or replace function app.chemin_de_lecture(p_champ text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select string_to_array(regexp_replace(p_champ, '\[([0-9]+)\]', '.\1', 'g'), '.')
$$;
revoke all on function app.chemin_de_lecture(text) from public, anon;
grant execute on function app.chemin_de_lecture(text) to authenticated;

-- --- 2. La dernière valeur donnée, et ce qui était retenu avant -----------------------------------

create or replace function app.precision_dite(p_piece uuid, p_champ text)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select q.valeur from capture.precisions q
   where q.piece_id = p_piece and q.champ = p_champ
   order by q.decided_at desc
   limit 1
$$;
revoke all on function app.precision_dite(uuid, text) from public, anon;
grant execute on function app.precision_dite(uuid, text) to authenticated;

create or replace function app.precision_avant(p_piece uuid, p_champ text)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    app.precision_dite(p_piece, p_champ),
    (select x.payload #>> app.chemin_de_lecture(p_champ)
       from capture.extractions x
      where x.piece_id = p_piece order by x.created_at desc limit 1))
$$;
revoke all on function app.precision_avant(uuid, text) from public, anon;
grant execute on function app.precision_avant(uuid, text) to authenticated;

comment on function app.precision_avant(uuid, text) is
  'Ce qui était retenu avant une précision : la dernière donnée par une personne, sinon la valeur lue. Le journal la garde.';

-- --- 3. La forme d'une saisie ------------------------------------------------------------------

create or replace function app.precision_de_lecture(p_piece uuid, p_champ text, p_valeur text)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_devise  text;
  v_dec     smallint;
  v_texte   text := btrim(coalesce(p_valeur, ''));
  v_chemin  text[] := app.chemin_de_lecture(p_champ);
begin
  select x.payload into v_payload
    from capture.extractions x
   where x.piece_id = p_piece
   order by x.created_at desc limit 1;
  if v_payload is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  -- Une ligne qui n'existe pas dans la lecture ne se précise pas.
  if array_length(v_chemin, 1) = 3
     and (jsonb_typeof(v_payload -> v_chemin[1]) is distinct from 'array'
          or v_chemin[2]::int >= jsonb_array_length(v_payload -> v_chemin[1])) then
    raise exception 'refus.precision.ligne_inconnue' using errcode = 'check_violation';
  end if;

  -- Les décimales sont celles de la devise de la pièce : lue, à défaut celle du dossier.
  v_devise := coalesce(
    nullif(upper(v_payload ->> 'currency'), ''),
    (select o.currency from capture.pieces p
       join identity.organizations o on o.id = p.tenant_id
      where p.id = p_piece));
  select d.exposant into v_dec from ref.devises d where d.code = v_devise;
  if v_dec is null then
    raise exception '%', app.refus_avec_valeurs('refus.precision.devise_inconnue', 'devise', coalesce(v_devise, ''))
      using errcode = 'check_violation';
  end if;

  -- Un montant s'écrit en chiffres et un point décimal : l'écran a déjà lu la
  -- saisie de la personne (« 2 850,000 » devient « 2850.000 »). Borne technique.
  if v_texte !~ '^[0-9]{1,15}(\.[0-9]+)?$' then
    raise exception 'refus.precision.montant_illisible' using errcode = 'check_violation';
  end if;
  -- Un montant ne s'arrondit pas en silence.
  if substr(split_part(v_texte, '.', 2), v_dec + 1) ~ '[1-9]' then
    raise exception '%', app.refus_avec_valeurs('refus.precision.montant_trop_precis', 'max', v_dec::text)
      using errcode = 'check_violation';
  end if;
  return round(v_texte::numeric, v_dec)::text;
end
$$;
revoke all on function app.precision_de_lecture(uuid, text, text) from public, anon;
grant execute on function app.precision_de_lecture(uuid, text, text) to authenticated;

comment on function app.precision_de_lecture(uuid, text, text) is
  'Borne la saisie d''une personne sur un champ de la lecture : la forme, et les décimales de la devise du référentiel. Rend la valeur à inscrire.';

-- --- 4. L'auteur d'une précision, pour qui peut la lire ------------------------------------------

create or replace function app.auteur_d_une_precision(p_precision uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app.nom_au_moment(q.decided_by)
    from capture.precisions q
   where q.id = p_precision
     and app.piece_lisible(q.piece_id)
     and (q.tenant_id in (select app.member_orgs())
          or q.tenant_id in (select app.engaged_orgs()))
$$;
revoke all on function app.auteur_d_une_precision(uuid) from public, anon;
grant execute on function app.auteur_d_une_precision(uuid) to authenticated;

comment on function app.auteur_d_une_precision(uuid) is
  'Le nom de la personne qui a précisé, pour qui peut lire la pièce : le cabinet voit qui a saisi, comme la PME.';

-- --- 5. La porte ---------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.capture_precision_persist(p_piece uuid, p_champ text, p_valeur text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_status text;
  v_avant  text;
  v_statut text;
  v_id uuid;
  v_date date;
  v_nom  text;
  v_lu   text;
begin
  select tenant_id, status, document_kind, document_kind_statut
    into v_tenant, v_status, v_avant, v_statut
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if v_status not in ('capturee', 'lue', 'retournee') then
    raise exception 'refus.precision.engagee'
      using errcode = 'check_violation';
  end if;

  if p_champ = 'document_kind' then
    -- Ce qui se choisit à la photo se choisit aussi après, et derrière les
    -- deux portes, les types précis (planche 3).
    if not exists (select 1 from ref.document_types d
                    where d.code = p_valeur
                      and (d.propose_a_la_capture or d.propose_en_correction)) then
      raise exception '%', app.refus_avec_valeurs('refus.precision.type_non_propose', 'type', (p_valeur)::text) using errcode = 'check_violation';
    end if;
    -- Le sens (un type qui porte une écriture) est l'acte du cabinet quand il
    -- tient les livres : la PME ne le pose pas, et ne défait pas celui qu'une
    -- personne a établi.
    if app.livres_tenus_par_le_cabinet(v_tenant)
       and not app.supervise_le_dossier(v_tenant)
       and (exists (select 1 from ref.document_types d
                     where d.code = p_valeur and d.porte_ecriture)
            or (v_statut = 'confirme'
                and exists (select 1 from ref.document_types d
                             where d.code = v_avant and d.porte_ecriture))) then
      raise exception 'refus.sens.reserve_au_cabinet'
        using errcode = '42501', hint = 'sens.cabinet';
    end if;
  elsif p_champ = 'document_date' then
    -- Une date qui n'est pas une date lève ici, et non trois écrans plus loin.
    begin
      v_date := p_valeur::date;
    exception when others then
      raise exception '%', app.refus_avec_valeurs('refus.precision.date_illisible', 'date', (p_valeur)::text) using errcode = 'check_violation';
    end;
    -- Une facture dans un exercice qui n'a pas commencé disparaît de toutes
    -- les déclarations sans rien signaler. Le doigt qui ripe est courant.
    if v_date > current_date then
      raise exception '%', app.refus_avec_valeurs('refus.precision.date_a_venir', 'date', (p_valeur)::text)
        using errcode = 'check_violation';
    end if;
  elsif p_champ = 'issuer' then
    -- Le nom de l'émetteur, tel que la personne le lit sur sa pièce : le
    -- logo lu « MITEK » quand la facture imprime « MyTek ». Les blancs se
    -- resserrent ; un nom vide n'est pas un nom.
    v_nom := btrim(regexp_replace(coalesce(p_valeur, ''), '\s+', ' ', 'g'));
    if v_nom = '' then
      raise exception 'refus.precision.nom_vide' using errcode = 'check_violation';
    end if;
    -- Borne technique d'une saisie (pas une règle métier) : un nom de société
    -- tient sur une ligne de journal.
    if length(v_nom) > 200 then
      raise exception '%', app.refus_avec_valeurs('refus.precision.nom_trop_long', 'max', '200')
        using errcode = 'check_violation';
    end if;
    -- Ce qui était retenu avant : la dernière correction, sinon la lecture.
    v_lu := coalesce(app.emetteur_dit(p_piece),
                     (select x.payload ->> 'issuer' from capture.extractions x
                       where x.piece_id = p_piece order by x.created_at desc limit 1));
    if v_lu is not distinct from v_nom then
      -- Redire le même nom n'écrit rien : la pièce ne change pas.
      return jsonb_build_object('id', null, 'piece_id', p_piece, 'champ', p_champ,
                                'valeur', v_nom);
    end if;
  elsif app.est_un_champ_de_lecture(p_champ) then
    -- Un montant ou un mot de la facture, tel que la personne le lit sur sa
    -- pièce : la base borne la saisie (devise, décimales), le moteur rejuge.
    v_nom := app.precision_de_lecture(p_piece, p_champ, p_valeur);
    v_lu := app.precision_avant(p_piece, p_champ);
    if app.precision_dite(p_piece, p_champ) is not distinct from v_nom then
      -- Redire la même valeur n'écrit rien : la pièce ne change pas.
      return jsonb_build_object('id', null, 'piece_id', p_piece, 'champ', p_champ,
                                'valeur', v_nom);
    end if;
  else
    raise exception '%', app.refus_avec_valeurs('refus.precision.champ', 'champ', (p_champ)::text) using errcode = 'check_violation';
  end if;

  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, p_champ, coalesce(v_nom, p_valeur))
  returning id into v_id;

  -- La personne a tranché : la pièce porte le type, confirmé, et c'est ce que
  -- le verrou R2 attend avant toute écriture. Une date précisée ne touche pas
  -- au type.
  if p_champ = 'document_kind' then
    update capture.pieces
       set document_kind = p_valeur,
           document_kind_statut = 'confirme',
           updated_at = now()
     where id = p_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.precisee', 'capture', 'precisions', v_id,
          jsonb_build_object('piece_id', p_piece, 'champ', p_champ,
                             'valeur', coalesce(v_nom, p_valeur))
          || case when p_champ = 'document_kind'
                  then jsonb_build_object('avant', v_avant)
                  when p_champ = 'issuer' or app.est_un_champ_de_lecture(p_champ)
                  then jsonb_build_object('avant', v_lu) else '{}'::jsonb end);

  return jsonb_build_object('id', v_id, 'piece_id', p_piece, 'champ', p_champ,
                            'valeur', coalesce(v_nom, p_valeur));
end
$function$;

comment on function public.capture_precision_persist(uuid, text, text) is
  'Ce que la personne tranche ou corrige : le type de la pièce (parmi ceux que '
  'le référentiel propose au choix ou en correction), sa date, le nom de son '
  'émetteur et les montants du pied de la facture. Une entrée NOUVELLE à côté '
  'de l''extraction, qui reste immuable (R7). Une pièce engagée ne se précise '
  'plus. Dans un dossier tenu par un cabinet, le sens (un type qui porte une '
  'écriture) ne se précise que par le cabinet (`piece_type_etabli_par_le_cabinet`).';

commit;
