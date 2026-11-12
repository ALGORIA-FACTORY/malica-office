-- ======================================================================
--  La note d'honoraires s'éteint à la tour, sans rien supprimer
--  (décision du dirigeant, 12 novembre 2026 — recette du 11, point 7.4).
--
--  POURQUOI. La note d'honoraires (créer, émettre, encaisser, annuler par un
--  avoir) n'est pas prête pour la production : elle n'arrive pas chez la
--  PME, s'émet sans confirmation, ne dit pas la retenue à la source
--  (docs/rallumage-des-notes-d-honoraires.md). Elle sera rallumée dans une
--  version postérieure à la mise en production. D'ici là, elle se tait : à
--  l'écran et au serveur, par un interrupteur que la tour tient.
--
--  CE QUI CHANGE.
--    * `plateforme.reglages_fonctions` : pour chaque fonction du produit que
--      la tour peut éteindre, la décision en vigueur — datée, motivée, en
--      ajout seul (R7), sur le modèle des périmètres de facturation
--      (20261128090000). Une seule fonction aujourd'hui : `notes_honoraires`,
--      livrée ÉTEINTE, en staging comme en production.
--    * L'écran lit `plateforme.fonction_ouverte` ; la tour lit
--      `plateforme.fonctions_etat` et règle par `plateforme.fonction_regler`.
--    * Les six portes qui écrivent une note d'honoraires commencent par
--      `app.notes_d_honoraires_requises()`, qui refuse par une clé
--      (`refus.honoraires.notes_eteintes`, dite en fr, en et ar).
--
--  CE QUI NE CHANGE PAS. Le mandat et son forfait (`honoraires_mandat_*`),
--  les lectures (une note déjà émise reste en base, avec son numéro), la
--  facture de Malica à la comptabilité, les exports, les écritures. Aucune
--  table, aucune ligne, aucune fonction n'est supprimée.
--
--  Chaque porte est recréée depuis sa définition EN VIGUEUR
--  (`pg_get_functiondef` d'une base migrée, comme 20261110090100), seule la
--  première instruction s'ajoutant : même corps, même `security definer`,
--  même `set search_path` ; `create or replace` garde le propriétaire et les
--  droits.
--
--  REJEU (R11) : la décision initiale est datée d'un littéral.
-- ======================================================================

begin;

-- ------------------------------------------------- 1. L'interrupteur de la tour

create table plateforme.reglages_fonctions (
  id         uuid primary key default gen_random_uuid(),
  fonction   text not null
    constraint reglages_fonctions_fonction check (fonction in ('notes_honoraires')),
  actif      boolean not null,
  motif      text not null check (length(btrim(motif)) > 0),
  decide_par uuid,
  decide_le  timestamptz not null default now(),
  -- Départage deux décisions de même instant : la plus tardive vaut.
  rang       bigint generated always as identity,
  constraint reglages_fonctions_allumee_par_quelqu_un check (not actif or decide_par is not null)
);

comment on table plateforme.reglages_fonctions is
  'Les fonctions du produit que la tour allume ou éteint : la dernière décision vaut, datée et '
  'motivée ; une décision qui allume nomme qui l''a prise. Rien ne se réécrit.';

create index reglages_fonctions_fonction_idx
  on plateforme.reglages_fonctions (fonction, decide_le desc, rang desc);

alter table plateforme.reglages_fonctions enable row level security;
alter table plateforme.reglages_fonctions force row level security;
revoke all on table plateforme.reglages_fonctions from public, anon;
grant select on table plateforme.reglages_fonctions to authenticated;
create policy reglages_fonctions_lire on plateforme.reglages_fonctions
  for select to authenticated using ((select app.is_platform()));
create trigger reglages_fonctions_ne_se_reecrivent_pas
  before update or delete on plateforme.reglages_fonctions
  for each row execute function app.deny_mutation();

insert into plateforme.reglages_fonctions (fonction, actif, motif, decide_par, decide_le)
values ('notes_honoraires', false,
        'Décision du dirigeant, 12 novembre 2026 : la note d''honoraires est éteinte jusqu''à une '
        'version postérieure à la mise en production. Rien n''est supprimé ; ce qui reste à faire '
        'au rallumage est dans docs/rallumage-des-notes-d-honoraires.md.',
        null, timestamptz '2026-11-12 00:00:00+00');

/* La décision en vigueur d'une fonction. Lue par les fonctions ci-dessous seulement. */
create function plateforme.fonction_en_vigueur(p_fonction text)
returns plateforme.reglages_fonctions
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from plateforme.reglages_fonctions r
   where r.fonction = p_fonction
   order by r.decide_le desc, r.rang desc
   limit 1
$$;

revoke all on function plateforme.fonction_en_vigueur(text) from public, anon, authenticated;

/*
 * Cette fonction du produit est-elle allumée, ici et maintenant ? Lue par
 * l'écran de toute personne connectée : elle ne dit qu'un oui ou un non, ni
 * le motif ni l'auteur. Une fonction sans décision est éteinte.
 */
create function plateforme.fonction_ouverte(p_fonction text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((plateforme.fonction_en_vigueur(p_fonction)).actif, false)
$$;

revoke all on function plateforme.fonction_ouverte(text) from public, anon;
grant execute on function plateforme.fonction_ouverte(text) to authenticated;

/* Pour la plateforme seule : chaque fonction, sa décision en vigueur et qui l'a prise. */
create function plateforme.fonctions_etat()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_object_agg(v.fonction, jsonb_build_object(
             'actif', v.actif, 'motif', v.motif, 'decide_le', v.decide_le,
             'decide_par_email', (select u.email::text from auth.users u where u.id = v.decide_par),
             'decide_par_nom', (select p.display_name::text from identity.profiles p
                                 where p.user_id = v.decide_par)))
      from (select distinct on (r.fonction) r.*
              from plateforme.reglages_fonctions r
             order by r.fonction, r.decide_le desc, r.rang desc) v), '{}'::jsonb);
end
$$;

revoke all on function plateforme.fonctions_etat() from public, anon;
grant execute on function plateforme.fonctions_etat() to authenticated;

/* La tour allume ou éteint une fonction : daté, motivé, en ajout seul. */
create function plateforme.fonction_regler(p_fonction text, p_actif boolean, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_fonction is null or p_actif is null
     or p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  if not exists (select 1 from plateforme.reglages_fonctions r where r.fonction = p_fonction) then
    raise exception 'refus.fonction.inconnue' using errcode = '22023';
  end if;
  -- La décision nouvelle passe toujours devant la précédente, même si celle-ci
  -- porte une date livrée postérieure à l'horloge du serveur (20261212110300).
  insert into plateforme.reglages_fonctions (fonction, actif, motif, decide_par, decide_le)
  select p_fonction, p_actif, btrim(p_motif), auth.uid(),
         greatest(now(), max(r.decide_le) + interval '1 millisecond')
    from plateforme.reglages_fonctions r
   where r.fonction = p_fonction;
  return plateforme.fonctions_etat() -> p_fonction;
end
$$;

revoke all on function plateforme.fonction_regler(text, boolean, text) from public, anon;
grant execute on function plateforme.fonction_regler(text, boolean, text) to authenticated;

/*
 * La garde des portes qui écrivent une note d'honoraires. Éteinte, la porte
 * refuse avant toute lecture : « Les notes d'honoraires arrivent dans une
 * prochaine version ».
 */
create function app.notes_d_honoraires_requises()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not plateforme.fonction_ouverte('notes_honoraires') then
    raise exception 'refus.honoraires.notes_eteintes' using errcode = '22023';
  end if;
end
$$;

revoke all on function app.notes_d_honoraires_requises() from public, anon, authenticated;

-- ------------------------------------- 2. Les six portes de la note d'honoraires

CREATE OR REPLACE FUNCTION public.honoraires_avoir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f        record;
  v_avoir  uuid;
  v_numero text;
  v_jour   date := current_date;
begin
  perform app.notes_d_honoraires_requises();
  select * into f from collab.factures_honoraires where id = p_id;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.facture' using errcode = 'P0002';
  end if;
  if f.statut not in ('emise', 'payee') then
    raise exception 'refus.honoraires.avoir_d_une_emise' using errcode = '22023';
  end if;
  if f.avoir_de is not null then
    raise exception 'refus.honoraires.avoir_non_annulable' using errcode = '22023';
  end if;

  insert into collab.factures_honoraires
    (tenant_id, client_tenant_id, mandat_id, periode_du, periode_au, pack_version_id,
     taux_tva_code, taux_tva, devise, droits_fixes, droits_libelle, avoir_de)
  values (f.tenant_id, f.client_tenant_id, f.mandat_id, f.periode_du, f.periode_au, f.pack_version_id,
          f.taux_tva_code, f.taux_tva, f.devise, -f.droits_fixes, f.droits_libelle, p_id)
  returning id into v_avoir;

  insert into collab.factures_honoraires_lignes (tenant_id, facture_id, ordre, libelle, quantite, prix_unitaire)
  select tenant_id, v_avoir, ordre, libelle, -quantite, prix_unitaire
    from collab.factures_honoraires_lignes where facture_id = p_id order by ordre;

  v_numero := app.honoraires_numero_suivant(f.tenant_id, v_jour);
  update collab.factures_honoraires
     set statut = 'emise', numero = v_numero, emise_le = v_jour, echeance_le = v_jour
   where id = v_avoir;

  perform set_config('malica.honoraires_transition', p_id::text, true);
  update collab.factures_honoraires set statut = 'annulee', annulee_le = v_jour where id = p_id;
  perform set_config('malica.honoraires_transition', '', true);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (f.tenant_id, auth.uid(), 'honoraires.avoir', 'collab', 'factures_honoraires', v_avoir,
          jsonb_build_object('annule', p_id, 'numero_annule', f.numero, 'numero', v_numero));
  return jsonb_build_object('id', v_avoir, 'numero', v_numero);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.honoraires_brouillon_creer(p_cabinet uuid, p_client uuid, p_du date, p_au date, p_taux_code text, p_lignes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id     uuid;
  v_mandat uuid;
  v_devise text;
  v_taux   record;
begin
  perform app.notes_d_honoraires_requises();
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  if not exists (
    select 1 from identity.engagements e
     where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client and e.status = 'actif'
  ) then
    raise exception 'refus.mandat.hors_cabinet' using errcode = '22023';
  end if;

  select id into v_mandat from collab.mandats_honoraires
   where tenant_id = p_cabinet and client_tenant_id = p_client and valid_to is null;
  select currency into v_devise from identity.organizations where id = p_cabinet;
  v_taux := app.honoraires_taux_du_pack(p_cabinet, p_taux_code);

  insert into collab.factures_honoraires
    (tenant_id, client_tenant_id, mandat_id, periode_du, periode_au, pack_version_id,
     taux_tva_code, taux_tva, devise)
  values (p_cabinet, p_client, v_mandat, p_du, p_au, v_taux.o_pack, p_taux_code, v_taux.o_taux, v_devise)
  returning id into v_id;

  perform app.honoraires_lignes_poser(v_id, p_cabinet, p_lignes);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'honoraires.brouillon_cree', 'collab', 'factures_honoraires', v_id,
          jsonb_build_object('client', p_client, 'periode_du', p_du, 'periode_au', p_au, 'taux', p_taux_code));
  return jsonb_build_object('id', v_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.honoraires_brouillon_modifier(p_id uuid, p_du date, p_au date, p_taux_code text, p_lignes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f      record;
  v_taux record;
begin
  perform app.notes_d_honoraires_requises();
  select * into f from collab.factures_honoraires where id = p_id;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.facture' using errcode = 'P0002';
  end if;
  if f.statut <> 'brouillon' then
    raise exception 'refus.honoraires.emise_figee'
      using errcode = '22023';
  end if;
  v_taux := app.honoraires_taux_du_pack(f.tenant_id, p_taux_code);

  update collab.factures_honoraires
     set periode_du = p_du, periode_au = p_au,
         pack_version_id = v_taux.o_pack, taux_tva_code = p_taux_code, taux_tva = v_taux.o_taux
   where id = p_id;
  perform app.honoraires_lignes_poser(p_id, f.tenant_id, p_lignes);
  return jsonb_build_object('id', p_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.honoraires_brouillon_supprimer(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f record;
begin
  perform app.notes_d_honoraires_requises();
  select id, tenant_id, statut into f from collab.factures_honoraires where id = p_id;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.facture' using errcode = 'P0002';
  end if;
  if f.statut <> 'brouillon' then
    raise exception 'refus.honoraires.emise_figee'
      using errcode = '22023';
  end if;
  delete from collab.factures_honoraires where id = p_id;
  return true;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.honoraires_encaisser(p_facture uuid, p_montant numeric, p_date date, p_moyen text, p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f       record;
  v_id    uuid;
  v_deja  numeric(18,3);
  v_reste numeric(18,3);
  v_somme numeric(18,3);
begin
  perform app.notes_d_honoraires_requises();
  select * into f from collab.factures_honoraires where id = p_facture;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.facture' using errcode = 'P0002';
  end if;
  if f.statut <> 'emise' then
    raise exception 'refus.honoraires.encaissable' using errcode = '22023';
  end if;
  if f.total_ttc <= 0 then
    raise exception 'refus.honoraires.avoir_non_encaissable' using errcode = '22023';
  end if;
  if p_montant is null or p_montant <= 0 then
    raise exception 'refus.honoraires.montant_positif' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'refus.honoraires.date_requise' using errcode = '22023';
  end if;

  select coalesce(sum(montant), 0) into v_deja
    from collab.encaissements_honoraires where facture_id = p_facture;
  v_reste := f.total_ttc - v_deja;
  if p_montant > v_reste then
    raise exception '%', app.refus_avec_valeurs('refus.honoraires.trop_percu', 'montant', (p_montant)::text, 'reste', (v_reste)::text)
      using errcode = '22023';
  end if;

  insert into collab.encaissements_honoraires (tenant_id, facture_id, montant, encaisse_le, moyen, reference)
  values (f.tenant_id, p_facture, p_montant, p_date, p_moyen, nullif(btrim(p_reference), ''))
  returning id into v_id;

  v_somme := v_deja + p_montant;

  if v_somme >= f.total_ttc then
    perform set_config('malica.honoraires_transition', p_facture::text, true);
    update collab.factures_honoraires set statut = 'payee', payee_le = p_date where id = p_facture;
    perform set_config('malica.honoraires_transition', '', true);
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (f.tenant_id, auth.uid(), 'honoraires.encaissement', 'collab', 'encaissements_honoraires', v_id,
          jsonb_build_object('facture', p_facture, 'numero', f.numero, 'montant', p_montant::text,
                             'date', p_date, 'moyen', p_moyen, 'soldee', v_somme >= f.total_ttc));
  -- Le montant voyage en texte : un nombre JSON deviendrait un flottant.
  return jsonb_build_object('id', v_id, 'encaisse', v_somme::text, 'soldee', v_somme >= f.total_ttc);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.honoraires_facture_emettre(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f        record;
  v_delai  integer;
  v_numero text;
  v_jour   date := current_date;
begin
  perform app.notes_d_honoraires_requises();
  select * into f from collab.factures_honoraires where id = p_id;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.facture' using errcode = 'P0002';
  end if;
  if f.statut <> 'brouillon' then
    raise exception 'refus.honoraires.deja_emise' using errcode = '22023';
  end if;
  if not exists (select 1 from collab.factures_honoraires_lignes where facture_id = p_id) then
    raise exception 'refus.honoraires.sans_ligne' using errcode = '22023';
  end if;
  if f.total_ht <= 0 then
    raise exception 'refus.honoraires.total_positif' using errcode = '22023';
  end if;

  -- Le délai : celui du mandat, ou à défaut aucun — l'échéance est le jour même.
  select delai_paiement_jours into v_delai
    from collab.mandats_honoraires where id = f.mandat_id;
  if v_delai is null then
    select delai_paiement_jours into v_delai
      from collab.mandats_honoraires
     where tenant_id = f.tenant_id and client_tenant_id = f.client_tenant_id and valid_to is null;
  end if;

  v_numero := app.honoraires_numero_suivant(f.tenant_id, v_jour);

  update collab.factures_honoraires
     set statut = 'emise', numero = v_numero, emise_le = v_jour,
         echeance_le = v_jour + coalesce(v_delai, 0)
   where id = p_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (f.tenant_id, auth.uid(), 'honoraires.facture_emise', 'collab', 'factures_honoraires', p_id,
          jsonb_build_object('numero', v_numero, 'client', f.client_tenant_id,
                             'total_ttc', f.total_ttc, 'echeance', v_jour + coalesce(v_delai, 0)));
  return jsonb_build_object('id', p_id, 'numero', v_numero);
end;
$function$
;
commit;
