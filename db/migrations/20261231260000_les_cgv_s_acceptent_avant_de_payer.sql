-- Les CGV s'acceptent avant de payer, et l'acceptation se garde avec le paiement.
--
-- CGV publiées le 23 novembre 2026 (algoria-factory.com/fr/cgv/), art. 2 : « Le client les
-- accepte en cochant la case prévue avant de payer » ; « la version acceptée est conservée avec
-- la commande et peut être obtenue sur simple demande » ; art. 17 : les commandes font preuve.
-- Recette Flouci du 24 novembre : aucune case n'existait, rien n'était gardé. Décision du
-- dirigeant le même jour : case obligatoire, et preuve.
--
--   1. `plateforme.conditions_de_vente` : la version des CGV en vigueur et son adresse
--      publique. La tour la règle (`plateforme.cgv_regler`) : datée, motivée, en ajout seul,
--      sans déploiement. Semée ici : la version du 23 novembre 2026 (défaut livré,
--      `decide_par` nul).
--   2. `facturation.acceptations_cgv` : pour chaque paiement, la version acceptée, par qui et
--      quand. En ajout seul ; une ligne par paiement.
--   3. `public.paiement_cgv_accepter` : la porte. Seul celui qui peut payer accepte, et
--      seulement la version EN VIGUEUR (une page restée ouverte sur une ancienne version ne
--      fait pas foi).
--   4. `public.paiement_inscrire` refuse d'ouvrir la page de paiement (`lien_cree`) d'un
--      paiement dont les CGV n'ont pas été acceptées : la case ne se contourne pas par un
--      appel direct.
--
-- REJEU (R11) : la version semée porte ses dates en littéral ; fonctions reprises de leur
-- définition EN VIGUEUR.
-- _Gardé par_ apps/api/src/facturation/les-cgv-s-acceptent-avant-de-payer.test.ts.

begin;

-- ---------------------------------------------------------------- 1. La version en vigueur
create table plateforme.conditions_de_vente (
  id          uuid primary key default gen_random_uuid(),
  version     date not null,
  url         text not null check (url ~ '^https://[A-Za-z0-9.-]+(/[^\s]*)?$' and length(url) <= 300),
  valide_des  date not null,
  motif       text not null check (length(btrim(motif)) > 0),
  -- Nul : le défaut livré par une migration (R10).
  decide_par  uuid references auth.users (id),
  decide_le   timestamptz not null default now(),
  rang        bigint generated always as identity
);
comment on table plateforme.conditions_de_vente is
  'Les CGV en vigueur et leur adresse publique : la version qu''un client accepte avant de '
  'payer. Daté, motivé, en ajout seul ; decide_par nul = défaut livré.';
create index conditions_de_vente_en_vigueur_idx
  on plateforme.conditions_de_vente (valide_des desc, rang desc);
create unique index conditions_de_vente_une_par_version
  on plateforme.conditions_de_vente (version, url);

alter table plateforme.conditions_de_vente enable row level security;
-- Les CGV sont publiques : tout client connecté lit la version qu'on lui demande d'accepter.
create policy conditions_de_vente_lire on plateforme.conditions_de_vente
  for select to authenticated using (true);
revoke all on plateforme.conditions_de_vente from public, anon, authenticated;
grant select on plateforme.conditions_de_vente to authenticated;
create trigger conditions_de_vente_ne_se_reecrivent_pas
  before update or delete on plateforme.conditions_de_vente
  for each row execute function app.deny_mutation();

insert into plateforme.conditions_de_vente (version, url, valide_des, motif, decide_par, decide_le)
values (date '2026-11-23', 'https://algoria-factory.com/fr/cgv/', date '2026-11-23',
        'CGV Malica Office publiées le 23 novembre 2026', null,
        timestamptz '2026-11-23 00:00:00+01');

create function plateforme.cgv_en_vigueur(p_jour date default null)
returns plateforme.conditions_de_vente
language sql
stable
security definer
set search_path = ''
as $$
  select c.* from plateforme.conditions_de_vente c
   where c.valide_des <= coalesce(p_jour, current_date)
   order by c.valide_des desc, c.rang desc
   limit 1
$$;
revoke all on function plateforme.cgv_en_vigueur(date) from public, anon;
grant execute on function plateforme.cgv_en_vigueur(date) to authenticated;

create function plateforme.cgv_regler(p_version date, p_url text, p_valide_des date, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  p_motif := nullif(btrim(coalesce(p_motif, '')), '');
  if p_motif is null then
    raise exception 'refus.motif.a_dire' using errcode = 'check_violation';
  end if;
  if p_valide_des is null or p_valide_des < current_date then
    raise exception 'refus.facturation.reglage_date' using errcode = 'check_violation';
  end if;
  p_url := btrim(coalesce(p_url, ''));
  if p_version is null or p_url !~ '^https://[A-Za-z0-9.-]+(/[^\s]*)?$' or length(p_url) > 300 then
    raise exception 'refus.cgv.mal_formees' using errcode = 'check_violation';
  end if;
  insert into plateforme.conditions_de_vente (version, url, valide_des, motif, decide_par)
  values (p_version, p_url, p_valide_des, p_motif, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'version', p_version, 'url', p_url, 'valide_des', p_valide_des);
end
$$;
revoke all on function plateforme.cgv_regler(date, text, date, text) from public, anon;
grant execute on function plateforme.cgv_regler(date, text, date, text) to authenticated;

-- ---------------------------------------------------------------- 2. L'acceptation, gardée
create table facturation.acceptations_cgv (
  paiement_id   uuid primary key references facturation.paiements_en_ligne (id),
  cgv_id        uuid not null references plateforme.conditions_de_vente (id),
  acceptees_par uuid not null references auth.users (id),
  acceptees_le  timestamptz not null default now()
);
comment on table facturation.acceptations_cgv is
  'La version des CGV acceptée avant chaque paiement en ligne, par qui et quand (CGV, art. 2 '
  'et 17). En ajout seul.';
create index acceptations_cgv_cgv_idx on facturation.acceptations_cgv (cgv_id);
alter table facturation.acceptations_cgv enable row level security;
create policy acceptations_cgv_lire on facturation.acceptations_cgv
  for select to authenticated
  using (paiement_id in (select p.id from facturation.paiements_en_ligne p)
         or (select app.is_platform()));
revoke all on facturation.acceptations_cgv from public, anon, authenticated;
grant select on facturation.acceptations_cgv to authenticated;
create trigger acceptations_cgv_ne_se_reecrivent_pas
  before update or delete on facturation.acceptations_cgv
  for each row execute function app.deny_mutation();

create function public.paiement_cgv_accepter(p_paiement uuid, p_cgv uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
  v_payeur  uuid;
  v_cgv     plateforme.conditions_de_vente;
begin
  select p.licence_id, p.payeur_tenant_id into v_licence, v_payeur
    from facturation.paiements_en_ligne p where p.id = p_paiement;
  if not found or not facturation.peut_payer(v_licence, v_payeur) then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;
  v_cgv := plateforme.cgv_en_vigueur();
  if v_cgv.id is null or p_cgv is distinct from v_cgv.id then
    raise exception 'refus.cgv.version_perimee' using errcode = 'check_violation';
  end if;
  insert into facturation.acceptations_cgv (paiement_id, cgv_id, acceptees_par)
  values (p_paiement, v_cgv.id, auth.uid())
  on conflict (paiement_id) do nothing;
  return (select jsonb_build_object('paiement_id', a.paiement_id, 'cgv_id', a.cgv_id,
                                    'acceptees_le', a.acceptees_le)
            from facturation.acceptations_cgv a where a.paiement_id = p_paiement);
end
$$;
revoke all on function public.paiement_cgv_accepter(uuid, uuid) from public, anon;
grant execute on function public.paiement_cgv_accepter(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- 3. Pas de page sans elles
CREATE OR REPLACE FUNCTION public.paiement_inscrire(p_paiement uuid, p_etat text, p_prestataire text, p_reference text DEFAULT NULL::text, p_lien text DEFAULT NULL::text, p_detail jsonb DEFAULT '{}'::jsonb, p_moyen text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid;
  v_payeur  uuid;
  v_presta  facturation.prestataires_paiement;
  v_attendu numeric;
begin
  select p.licence_id, p.payeur_tenant_id into v_licence, v_payeur
    from facturation.paiements_en_ligne p where p.id = p_paiement;
  if not found or not facturation.peut_payer(v_licence, v_payeur) then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;
  select * into v_presta from facturation.prestataires_paiement where code = p_prestataire;
  if not found or not v_presta.ouvre_le_paiement then
    raise exception 'refus.paiement.prestataire_inconnu' using errcode = 'check_violation';
  end if;
  -- Un prestataire qui ne fait entrer aucun argent n'est admis que si l'API l'a
  -- déclaré pour la transaction, ce qu'elle ne fait que si la tour l'a ouvert.
  if not v_presta.fait_entrer_argent
     and coalesce(current_setting('malica.paiement_simulateur', true), '') <> 'oui' then
    raise exception 'refus.paiement.simulateur_ferme' using errcode = '42501';
  end if;
  -- Le lien se crée pour un moyen choisi, actif, que ce prestataire accepte, et
  -- vers sa propre page.
  if p_etat = 'lien_cree' then
    -- Pas de page de paiement sans les CGV acceptées pour CE paiement (CGV, art. 2 :
    -- « le client les accepte en cochant la case prévue avant de payer »).
    if not exists (select 1 from facturation.acceptations_cgv a where a.paiement_id = p_paiement) then
      raise exception 'refus.cgv.non_acceptees' using errcode = 'check_violation';
    end if;
    if not facturation.moyen_admis(p_moyen, p_prestataire) then
      raise exception 'refus.paiement.moyen_indisponible' using errcode = 'check_violation';
    end if;
    if p_reference is null or p_lien is null then
      raise exception 'refus.saisie.mal_formee' using errcode = '22023';
    end if;
    if v_presta.fait_entrer_argent and not exists (
         select 1 from facturation.hotes_par_prestataire h
          where h.prestataire = p_prestataire and h.usage = 'page'
            and h.hote = facturation.hote_de(p_lien)) then
      raise exception 'refus.paiement.hote_non_autorise' using errcode = 'check_violation';
    end if;
  end if;
  -- « Payé » ou « refusé » se constate sur une référence que CE prestataire a
  -- rendue pour CE paiement — quel que soit le prestataire en vigueur aujourd'hui :
  -- un changement de réglage ne rend pas orphelin un lien déjà payé. Un simulateur
  -- ouvert après coup ne solde donc pas un lien parti chez un prestataire réel.
  if p_etat in ('paye', 'refuse') and not exists (
       select 1 from facturation.paiement_evenements e
        where e.paiement_id = p_paiement and e.etat = 'lien_cree'
          and e.prestataire = p_prestataire
          and e.reference is not distinct from p_reference) then
    raise exception 'refus.paiement.prestataire_du_lien' using errcode = 'check_violation';
  end if;
  if p_etat = 'paye' and exists (select 1 from facturation.paiement_evenements e
                                  where e.paiement_id = p_paiement and e.etat = 'paye') then
    -- Déjà constaté : on ne le compte pas deux fois, on le rend.
    return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = p_paiement);
  end if;
  -- Un argent réel se constate au montant du paiement, en unités de sa devise
  -- (le millime du dinar), tel que le prestataire dit l'avoir encaissé.
  if p_etat = 'paye' and v_presta.fait_entrer_argent then
    select p.montant_ttc * power(10::numeric, d.exposant) into v_attendu
      from facturation.paiements_en_ligne p
      join ref.devises d on d.code = p.devise
     where p.id = p_paiement;
    if coalesce(p_detail ->> 'unites_encaissees', '') !~ '^[0-9]+$'
       or (p_detail ->> 'unites_encaissees')::numeric <> v_attendu then
      raise exception 'refus.paiement.montant_different' using errcode = 'check_violation';
    end if;
  end if;

  insert into facturation.paiement_evenements
    (paiement_id, etat, prestataire, reference, lien, detail, moyen)
  values (p_paiement, p_etat, p_prestataire, p_reference, p_lien, coalesce(p_detail, '{}'::jsonb),
          case when p_etat = 'lien_cree' then p_moyen end);

  if p_etat = 'paye' then
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    select coalesce(v_payeur, lo.tenant_id), auth.uid(), 'paiement.recu', 'facturation',
           'paiements_en_ligne', p_paiement,
           jsonb_build_object('prestataire', p_prestataire, 'reference', p_reference)
      from (select 1) un
      left join lateral (
        select x.tenant_id from facturation.licence_organisations x
         where x.licence_id = v_licence order by x.tenant_id limit 1) lo on true
     where coalesce(v_payeur, lo.tenant_id) is not null;
  end if;

  return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = p_paiement);
end
$function$;
revoke all on function public.paiement_inscrire(uuid, text, text, text, text, jsonb, text) from public, anon;

commit;
