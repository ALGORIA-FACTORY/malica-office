-- ======================================================================
--  Une immobilisation sort du bilan par une écriture (5 novembre 2026).
--
--  Relevé sur staging : une cession s'enregistrait (`immo_cession_inscrire`)
--  sans aucune écriture, puis l'écran passait le bien à « cédé » par un
--  second appel, séparé ; une mise au rebut n'avait pas de geste du tout —
--  on choisissait « rebuté » dans la fiche. Dans les trois cas, le bien
--  restait au bilan : la valeur brute en classe 2, les amortissements en
--  28, la perte ou le gain nulle part. Et l'état « cédé » se posait sans
--  cession.
--
--  Une porte, indivisible : `immo_sortir`. Dans la même transaction :
--
--   1. la dotation de l'exercice de sortie, jusqu'au mois de sortie inclus
--      (prorata au mois entamé, la règle de la mise en service), calculée par
--      le Socle (`sortieDuPlan`) et VÉRIFIÉE ici : le cumul des dotations
--      inscrites plus celle-ci doit être le cumul du plan à la sortie, sinon
--      un exercice antérieur n'a pas été doté et la porte refuse ;
--   2. l'écriture de sortie (modèle `IMMO_CESSION_SORTIE` / `IMMO_REBUT` du
--      référentiel) : au débit les amortissements cumulés, la dépréciation
--      cumulée, la valeur nette comptable en charge nette sur cession ; au
--      crédit la valeur brute ;
--   3. pour une cession à prix, l'écriture du prix (modèle
--      `IMMO_CESSION_PRIX`) : le débiteur au TTC, le produit net sur cession
--      au HT, la TVA collectée s'il y en a — montant saisi, jamais calculé :
--      aucun taux n'est écrit ici (R4) ;
--   4. la sortie (`immo.cessions`, avec son motif et son écriture), l'état du
--      bien, le journal d'audit.
--
--  Les comptes : ceux de la catégorie du bien pour l'actif, l'amortissement
--  et la dépréciation ; les rôles du référentiel pour le reste, résolus comme
--  partout — le dossier, le cabinet qui le mandate, puis le pack
--  (`app.compte_du_role`, le pendant SQL de `compteDuRole` de l'API).
--
--  Et l'état ne se change plus par la fiche : `immo_bien_modifier` refuse un
--  état différent de celui du bien. Un bien sort par `immo_sortir`, et
--  seulement par elle.
--
--  INCERTAIN (à confirmer par un expert-comptable) : la règle de prorata de
--  l'exercice de sortie — mois de sortie inclus, symétrique de la mise en
--  service. Certains cabinets dotent au jour près.
-- ======================================================================

begin;

-- --- 1. La sortie dit son motif ------------------------------------------------------------------

alter table immo.cessions
  add column motif text not null default 'cede' check (motif in ('cede', 'rebute')),
  add column ecriture_prix_id uuid references socle.ecritures (id) on delete set null;

create index cessions_ecriture_prix_idx on immo.cessions (ecriture_prix_id);

comment on column immo.cessions.motif is
  'Le motif de la sortie : « cede » (une cession, à prix) ou « rebute » (une mise au rebut, prix nul).';
comment on column immo.cessions.ecriture_prix_id is
  'L''écriture du prix de cession (débiteur, produit, TVA) ; absente pour une mise au rebut.';

create or replace view public.immo_cessions_v with (security_invoker = true) as
  select id, tenant_id, asset_id, at, prix, vnc, resultat, ecriture_id, created_at, motif,
         ecriture_prix_id
    from immo.cessions;

-- --- 2. Le compte d'un rôle, en SQL --------------------------------------------------------------

create function app.compte_du_role(p_tenant uuid, p_role text, p_pack uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_comptes text[];
begin
  select array_agg(distinct coalesce(d.account_code, c.account_code, p.account_code))
    into v_comptes
    from (select 1) source
    left join ref.role_bindings p on p.role_code = p_role and p.pack_version_id = p_pack
    left join parametrage.role_bindings d
      on d.role_code = p_role and d.portee = 'dossier' and d.portee_id = p_tenant
    left join parametrage.role_bindings c
      on c.role_code = p_role and c.portee = 'cabinet'
     and c.portee_id in (select g.cabinet_org_id from identity.engagements g
                          where g.pme_org_id = p_tenant and g.status = 'actif');
  -- Deux surcharges contradictoires ne se départagent pas par l'ordre d'une requête.
  if coalesce(array_length(v_comptes, 1), 0) <> 1 or v_comptes[1] is null then
    raise exception 'refus.immo.sortie.compte_du_role' using errcode = '22023',
      detail = p_role;
  end if;
  return v_comptes[1];
end
$$;

comment on function app.compte_du_role(uuid, text, uuid) is
  'Le compte d''un rôle pour un dossier : sa surcharge, celle du cabinet qui le mandate, puis '
  'le pack (R10). Refuse un rôle sans compte ou à deux comptes.';

revoke all on function app.compte_du_role(uuid, text, uuid) from public, anon, authenticated;
grant execute on function app.compte_du_role(uuid, text, uuid) to portier;

-- --- 3. La porte de sortie -----------------------------------------------------------------------

create function public.immo_sortir(
  p_asset uuid,
  p_motif text,
  p_at date,
  p_exercice smallint,
  p_mois smallint,
  p_dotation numeric,
  p_cumul numeric,
  p_prix_ht numeric,
  p_tva numeric,
  p_pack_version uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  v_dotees numeric;
  v_deja_dote boolean;
  v_deprec numeric;
  v_vnc numeric;
  v_resultat numeric;
  v_ecr uuid;
  v_ecr_prix uuid;
  v_dot uuid;
  v_sortie uuid;
  v_ordinal smallint := 0;
  v_charge text;
  v_produit text;
  v_debiteur text;
  v_tva text;
begin
  if p_motif is null or p_motif not in ('cede', 'rebute') or p_at is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  if coalesce(p_prix_ht, 0) < 0 or coalesce(p_tva, 0) < 0 or coalesce(p_dotation, 0) < 0 then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  if p_motif = 'rebute' and (coalesce(p_prix_ht, 0) <> 0 or coalesce(p_tva, 0) <> 0) then
    raise exception 'refus.immo.sortie.prix_au_rebut' using errcode = '22023';
  end if;
  if p_exercice <> extract(year from p_at)::smallint then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;

  -- Le bien, que l'appelant voit, verrouillé : deux sorties simultanées
  -- liraient le même état.
  if not exists (select 1 from public.immo_assets_v v where v.id = p_asset) then
    raise exception 'refus.introuvable' using errcode = '42501';
  end if;
  select x.id, x.tenant_id, x.entity_id, x.vis, x.devise, x.label, x.status,
         x.valeur_brute, x.mise_en_service,
         c.account_immo, c.account_amort, c.account_dotation, c.account_deprec
    into a
    from immo.assets x
    join ref.immo_categories c on c.id = x.category_id
   where x.id = p_asset
     for update of x;

  if a.status <> 'en_service' then
    raise exception 'refus.immo.sortie.deja_sortie' using errcode = '22023';
  end if;
  if p_at < a.mise_en_service then
    raise exception 'refus.immo.sortie.avant_mise_en_service' using errcode = '22023';
  end if;

  -- La dotation de l'exercice de sortie ne double pas une dotation déjà
  -- constatée pour cet exercice (une dotation annuelle entière, posée avant
  -- la sortie, se reprend à la main).
  select coalesce(sum(d.dotation), 0), bool_or(d.exercice = p_exercice)
    into v_dotees, v_deja_dote
    from immo.dotations d
   where d.asset_id = p_asset;
  if coalesce(v_deja_dote, false) and coalesce(p_dotation, 0) > 0 then
    raise exception 'refus.immo.sortie.exercice_deja_dote' using errcode = '22023';
  end if;
  -- Le cumul du plan à la sortie, du Socle, est celui des livres : sinon un
  -- exercice antérieur n'a pas été doté.
  if v_dotees + coalesce(p_dotation, 0) <> p_cumul then
    raise exception 'refus.immo.sortie.dotations_manquantes' using errcode = '22023';
  end if;

  select coalesce(sum(d.mouvement), 0) into v_deprec
    from immo.depreciations d where d.asset_id = p_asset;

  v_vnc := a.valeur_brute - p_cumul - v_deprec;
  if v_vnc < 0 then
    raise exception 'refus.immo.sortie.dotations_manquantes' using errcode = '22023';
  end if;
  v_resultat := coalesce(p_prix_ht, 0) - v_vnc;

  v_charge := app.compte_du_role(a.tenant_id, 'CHARGE_CESSION_IMMO', p_pack_version);

  -- L'écriture de sortie : la dotation de l'exercice, puis la sortie de l'actif.
  insert into socle.ecritures (tenant_id, entity_id, vis, journal, date_ecriture,
                               devise, libelle, pack_version_id, status)
  values (a.tenant_id, a.entity_id, a.vis, 'OD', p_at, a.devise,
          case p_motif when 'cede' then 'Cession — sortie de l''actif — '
                       else 'Mise au rebut — ' end || a.label,
          p_pack_version, 'proposee')
  returning id into v_ecr;

  if coalesce(p_dotation, 0) > 0 then
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (a.tenant_id, v_ecr, 1, a.account_dotation,
            'Dotation de l''exercice de sortie — ' || a.label, p_dotation, 0),
           (a.tenant_id, v_ecr, 2, a.account_amort,
            'Amortissements — ' || a.label, 0, p_dotation);
    v_ordinal := 2;
  end if;
  if p_cumul > 0 then
    v_ordinal := v_ordinal + 1;
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (a.tenant_id, v_ecr, v_ordinal, a.account_amort,
            'Amortissements cumulés — ' || a.label, p_cumul, 0);
  end if;
  if v_deprec > 0 then
    v_ordinal := v_ordinal + 1;
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (a.tenant_id, v_ecr, v_ordinal, a.account_deprec,
            'Dépréciation cumulée — ' || a.label, v_deprec, 0);
  end if;
  if v_vnc > 0 then
    v_ordinal := v_ordinal + 1;
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (a.tenant_id, v_ecr, v_ordinal, v_charge,
            'Valeur nette comptable — ' || a.label, v_vnc, 0);
  end if;
  v_ordinal := v_ordinal + 1;
  insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                     libelle, debit, credit)
  values (a.tenant_id, v_ecr, v_ordinal, a.account_immo,
          'Valeur brute — ' || a.label, 0, a.valeur_brute);

  update socle.ecritures
     set status = 'booked', booked_by = auth.uid(), booked_at = now(), updated_at = now()
   where id = v_ecr;

  if coalesce(p_dotation, 0) > 0 then
    insert into immo.dotations (tenant_id, asset_id, exercice, months, dotation, cumul,
                                vnc, ecriture_id, pack_version_id, created_by)
    values (a.tenant_id, p_asset, p_exercice, p_mois, p_dotation, p_cumul,
            a.valeur_brute - p_cumul, v_ecr, p_pack_version, auth.uid())
    returning id into v_dot;
  end if;

  -- Le prix de cession : le débiteur, le produit, la TVA saisie.
  if p_motif = 'cede' and coalesce(p_prix_ht, 0) > 0 then
    v_produit := app.compte_du_role(a.tenant_id, 'PRODUIT_CESSION_IMMO', p_pack_version);
    v_debiteur := app.compte_du_role(a.tenant_id, 'DIVERS_DEBITEURS_CREDITEURS', p_pack_version);
    insert into socle.ecritures (tenant_id, entity_id, vis, journal, date_ecriture,
                                 devise, libelle, pack_version_id, status)
    values (a.tenant_id, a.entity_id, a.vis, 'VEN', p_at, a.devise,
            'Cession — prix de vente — ' || a.label, p_pack_version, 'proposee')
    returning id into v_ecr_prix;
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (a.tenant_id, v_ecr_prix, 1, v_debiteur, 'Prix de cession — ' || a.label,
            p_prix_ht + coalesce(p_tva, 0), 0),
           (a.tenant_id, v_ecr_prix, 2, v_produit, 'Produit de cession — ' || a.label,
            0, p_prix_ht);
    if coalesce(p_tva, 0) > 0 then
      v_tva := app.compte_du_role(a.tenant_id, 'TVA_COLLECTEE', p_pack_version);
      insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                         libelle, debit, credit)
      values (a.tenant_id, v_ecr_prix, 3, v_tva, 'TVA sur cession — ' || a.label, 0, p_tva);
    end if;
    update socle.ecritures
       set status = 'booked', booked_by = auth.uid(), booked_at = now(), updated_at = now()
     where id = v_ecr_prix;
  end if;

  insert into immo.cessions (tenant_id, asset_id, at, prix, vnc, resultat, ecriture_id,
                             ecriture_prix_id, motif, created_by)
  values (a.tenant_id, p_asset, p_at, coalesce(p_prix_ht, 0), v_vnc, v_resultat, v_ecr,
          v_ecr_prix, p_motif, auth.uid())
  returning id into v_sortie;

  update immo.assets set status = p_motif where id = p_asset;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (a.tenant_id, auth.uid(), 'immo.sortie', 'immo', 'cessions', v_sortie, p_pack_version,
          jsonb_build_object('asset_id', p_asset, 'motif', p_motif, 'vnc', v_vnc,
                             'resultat', v_resultat, 'dotation', coalesce(p_dotation, 0),
                             'ecriture_id', v_ecr, 'ecriture_prix_id', v_ecr_prix));

  return jsonb_build_object('sortie_id', v_sortie, 'ecriture_id', v_ecr,
                            'ecriture_prix_id', v_ecr_prix, 'dotation_id', v_dot,
                            'vnc', v_vnc, 'resultat', v_resultat);
end
$$;

comment on function public.immo_sortir(uuid, text, date, smallint, smallint, numeric, numeric,
                                       numeric, numeric, uuid) is
  'Sortie indivisible d''une immobilisation (cession ou mise au rebut) : dotation de l''exercice '
  'de sortie, écriture de sortie, écriture du prix, sortie, état du bien (5 novembre 2026).';

alter function public.immo_sortir(uuid, text, date, smallint, smallint, numeric, numeric,
                                  numeric, numeric, uuid) owner to portier;
revoke all on function public.immo_sortir(uuid, text, date, smallint, smallint, numeric, numeric,
                                          numeric, numeric, uuid) from public, anon;
grant execute on function public.immo_sortir(uuid, text, date, smallint, smallint, numeric,
                                             numeric, numeric, numeric, uuid) to authenticated;

-- L'ancienne porte n'écrivait que la cession : une sortie sans écriture.
drop function public.immo_cession_inscrire(uuid, uuid, date, numeric, numeric, numeric);

-- --- 4. L'état ne se change plus par la fiche ---------------------------------------------------

create or replace function public.immo_bien_modifier(
  p_id uuid, p_label text, p_mise_en_service date, p_valeur_brute numeric,
  p_valeur_residuelle numeric, p_method app.amort_method_t, p_duree_annees smallint,
  p_coefficient numeric, p_status text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_label), '') is null or nullif(btrim(p_status), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  -- Un bien sort par `immo_sortir`, avec son écriture ; la fiche ne le fait
  -- ni sortir ni revenir.
  if exists (select 1 from immo.assets x where x.id = p_id and x.status <> p_status) then
    raise exception 'refus.immo.statut_par_la_sortie' using errcode = '22023';
  end if;
  update immo.assets
     set label = p_label, mise_en_service = p_mise_en_service, valeur_brute = p_valeur_brute,
         valeur_residuelle = p_valeur_residuelle, method = p_method,
         duree_annees = p_duree_annees, coefficient = p_coefficient, status = p_status
   where id = p_id;
  if not found then
    raise exception 'immobilisation introuvable ou non autorisee' using errcode = '42501';
  end if;
end
$$;

commit;
