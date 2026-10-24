-- Sens de l'effet : NC 01, comptes 403 (à payer) et 413 (à recevoir).
-- Source : https://oect.org.tn/wp-content/uploads/2023/01/NC_01.pdf
-- Les valeurs appartiennent au pack, jamais au moteur TypeScript (R4).
begin;
insert into ref.rejet_motifs (id, code, severity, requires_note, valid_from)
values ('826d3a95-562d-44e9-a186-4e3e44147124', 'reglement_annule', 'bloquant', false, '2026-10-24')
on conflict (code) do nothing;
insert into ref.labels (ns, key, locale, value) values
 ('rejet_motif', 'reglement_annule', 'fr', 'Règlement annulé'),
 ('rejet_motif', 'reglement_annule', 'en', 'Cancelled payment'),
 ('rejet_motif', 'reglement_annule', 'ar', 'دفع ملغى')
on conflict (ns, key, locale) do nothing;
alter table ref.payment_means add column if not exists tresorerie_account_vente text,
 add column if not exists role_achat text references ref.account_roles(code),
 add column if not exists role_vente text references ref.account_roles(code);
update ref.payment_means set tresorerie_account_vente = tresorerie_account
 where tresorerie_account_vente is null;
update ref.payment_means m set tresorerie_account_vente = '413'
 from ref.jurisdiction_packs p
 where p.id = m.pack_version_id and p.jurisdiction = 'TN' and m.code = 'traite';
-- Les surcharges dossier / cabinet utilisent le rôle du moyen, jamais un
-- numéro de compte deviné par le serveur. Le défaut du moyen reste visible.
update ref.payment_means m set role_achat = case
 when m.code = 'traite' then 'FOURNISSEUR_EFFETS_A_PAYER'
 when m.code = 'especes' then 'CAISSE' else 'BANQUE' end,
 role_vente = case when m.code = 'traite' then 'CLIENT_EFFETS_A_RECEVOIR'
 when m.code = 'especes' then 'CAISSE' else 'BANQUE' end
 from ref.jurisdiction_packs p where p.id = m.pack_version_id
 and p.jurisdiction = 'TN' and m.tresorerie_account is not null;
create or replace view public.ref_payment_means_v with (security_invoker = true) as
 select id, pack_version_id, code, libelle, tresorerie_account, exige_justificatif,
        rang, legal_reference, valid_from, valid_to, exige_reference, journal_code,
        tresorerie_account_vente, role_achat, role_vente
 from ref.payment_means;

-- R7 : l'annulation d'un règlement inscrit contre-passe ses lignes, atomiquement.
-- Invoker : aucune élévation de droits, les mêmes RLS s'appliquent aux deux faits.
create or replace function app.annulation_contre_passe_le_reglement()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
 v_original socle.ecritures%rowtype;
 v_reversal uuid;
begin
 if new.annule_paiement_id is null then return new; end if;
 if not exists (select 1 from capture.paiements p where p.id = new.annule_paiement_id
                  and p.tenant_id = new.tenant_id and p.piece_id = new.piece_id
                  and p.devise = new.devise and p.montant_mineur is not distinct from new.montant_mineur
                  and p.annule_paiement_id is null) then
   raise exception 'Une annulation doit recopier le paiement de la même pièce.' using errcode = '22023';
 end if;
 perform 1 from capture.pieces where id = new.piece_id for update;
 for v_original in
   select e.* from socle.ecritures e
    where e.paiement_id = new.annule_paiement_id and e.nature = 'reglement'
      and app.ecriture_vivante(e.id)
 loop
   insert into socle.ecritures
     (tenant_id, entity_id, piece_id, vis, journal, date_ecriture, devise, libelle,
      pack_version_id, status, reverses_id, nature, paiement_id, reversal_reason_id)
   values (v_original.tenant_id, v_original.entity_id, v_original.piece_id,
           v_original.vis, v_original.journal, current_date, v_original.devise,
           'Annulation du règlement — ' || v_original.libelle, v_original.pack_version_id,
           'proposee', v_original.id, 'reglement', new.annule_paiement_id,
           (select id from ref.rejet_motifs where code = 'reglement_annule'))
   returning id into v_reversal;
   insert into socle.ecriture_lignes
     (tenant_id, ecriture_id, ordinal, account_code, libelle, debit, credit, tax_code)
   select tenant_id, v_reversal, ordinal, account_code,
          'Annulation — ' || libelle, credit, debit, tax_code
     from socle.ecriture_lignes where ecriture_id = v_original.id;
   -- Revue du 24 octobre 2026 (décision de Wissem Barouni) : quand une
   -- comptabilité tient le dossier, c'est son expert qui inscrit. La
   -- contre-passation reste PROPOSÉE dans sa file ; la PME ne touche pas au
   -- grand livre qu'elle a confié. Une PME autonome tient seule ses comptes :
   -- elle inscrit, par le même chemin que toute écriture.
   if not exists (select 1 from identity.engagements g
                   where g.pme_org_id = new.tenant_id and g.status = 'actif') then
     perform public.socle_ecriture_book(v_reversal);
   end if;
   insert into audit.event_log
     (tenant_id, actor, action, object_schema, object_table, object_id, payload)
   values (new.tenant_id, auth.uid(), 'reglement.contre_passe', 'socle', 'ecritures',
           v_reversal, jsonb_build_object('original', v_original.id,
             'paiement', new.annule_paiement_id, 'motif', new.annulation_motif_id));
 end loop;
 return new;
end $$;
revoke all on function app.annulation_contre_passe_le_reglement() from public, anon, authenticated;
drop trigger if exists annulation_contre_passe_le_reglement on capture.paiements;
create trigger annulation_contre_passe_le_reglement before insert on capture.paiements
 for each row execute function app.annulation_contre_passe_le_reglement();

-- Une ancienne proposition ne peut pas réinscrire un paiement annulé.
-- Le verrou de pièce est partagé avec l'annulation, même en SQL direct.
create or replace function app.reglement_bookable_sur_paiement_actif()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 if new.nature = 'reglement' and new.reverses_id is null and new.status = 'booked' then
   perform 1 from capture.pieces where id = new.piece_id for update;
   if not exists (select 1 from capture.paiements p where p.id = new.paiement_id
                    and p.piece_id = new.piece_id and p.annule_paiement_id is null)
      or exists (select 1 from capture.paiements a where a.annule_paiement_id = new.paiement_id) then
     raise exception 'Le règlement est annulé ou ne correspond pas à la pièce.' using errcode = '22023';
   end if;
 end if;
 return new;
end $$;
revoke all on function app.reglement_bookable_sur_paiement_actif() from public, anon, authenticated;
drop trigger if exists reglement_bookable_sur_paiement_actif on socle.ecritures;
create trigger reglement_bookable_sur_paiement_actif before insert or update on socle.ecritures
 for each row execute function app.reglement_bookable_sur_paiement_actif();
-- Une proposition ne crée aucune retenue fiscale déclarable.
create or replace function public.retenues_du_mois(p_tenant uuid, p_periode date)
returns table (ecriture_id uuid, date_ecriture date, ecriture text, ligne text,
               compte text, sens text, montant numeric, statut text)
language sql
stable
set search_path = ''
as $$
  with roles (role, sens) as (values
    ('RETENUE_SOURCE_OPEREE', 'operee'),
    ('RETENUE_SOURCE_SUBIE',  'subie'),
    ('TVA_RETENUE_SUBIE',     'subie')),
  ecritures as (
    select e.* from socle.ecritures e
     where e.status = 'booked' and e.tenant_id = p_tenant
       and e.date_ecriture >= date_trunc('month', p_periode)::date
       and e.date_ecriture < (date_trunc('month', p_periode) + interval '1 month')::date),
  comptes as (
    select distinct e.pack_version_id, ro.sens,
           coalesce(d.account_code, c.account_code, p.account_code) as compte
      from (select distinct pack_version_id from ecritures) e
      cross join roles ro
      left join ref.role_bindings p
        on p.role_code = ro.role and p.pack_version_id = e.pack_version_id
      left join public.parametrage_role_bindings_v d
        on d.role_code = ro.role and d.portee = 'dossier' and d.portee_id = p_tenant
      left join public.parametrage_role_bindings_v c
        on c.role_code = ro.role and c.portee = 'cabinet'
       and c.portee_id in (select g.cabinet_org_id from identity.engagements g
                            where g.pme_org_id = p_tenant and g.status = 'actif'))
  select e.id, e.date_ecriture, e.libelle, l.libelle, l.account_code, k.sens,
         case k.sens when 'operee' then l.credit - l.debit else l.debit - l.credit end,
         e.status
    from ecritures e
    join socle.ecriture_lignes l on l.ecriture_id = e.id
    join comptes k on k.pack_version_id = e.pack_version_id and k.compte = l.account_code
   order by k.sens, e.date_ecriture, e.id, l.ordinal
$$;

-- Une contre-passation proposée s'inscrit par le chemin commun (revue du 24
-- octobre 2026) : la garde « une seule écriture vivante par pièce » ne la
-- confond plus avec un second règlement. Corps repris de la base
-- (20261022450000), seule cette condition change.
CREATE OR REPLACE FUNCTION public.socle_ecriture_book(p_ecriture uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tenant  uuid;
  v_piece   uuid;
  v_nature  text;
  v_paiement uuid;
  v_reverses uuid;
begin
  select piece_id into v_piece from socle.ecritures where id = p_ecriture;
  if v_piece is not null then
    perform 1 from capture.pieces where id = v_piece for update;
  end if;

  select e.nature, e.paiement_id, e.reverses_id into v_nature, v_paiement, v_reverses
    from socle.ecritures e where e.id = p_ecriture and e.status = 'proposee';
  -- Une contre-passation éteint l'écriture vivante : elle ne la double pas.
  if v_nature is not null and v_piece is not null and v_reverses is null and exists (
       select 1 from socle.ecritures o
        where o.piece_id = v_piece and o.id <> p_ecriture
          and o.nature = v_nature and o.paiement_id is not distinct from v_paiement
          and app.ecriture_vivante(o.id)) then
    raise exception 'Cette pièce porte déjà une écriture inscrite : une seconde la compterait deux fois.'
      using errcode = 'check_violation', hint = 'piece.deja_inscrite';
  end if;

  update socle.ecritures
     set status = 'booked',
         booked_by = auth.uid(),
         booked_at = now(),
         updated_at = now()
   where id = p_ecriture and status = 'proposee'
  returning tenant_id into v_tenant;

  if v_tenant is null then
    raise exception 'ecriture introuvable, deja comptabilisee ou non autorisee'
      using errcode = '42501';
  end if;

  -- Un règlement inscrit ne fait pas repasser une facture supervisée en
  -- « comptabilisée » : seule l'écriture de la facture fait le statut.
  if v_nature = 'piece' then
    update capture.pieces
       set status = 'comptabilisee', updated_at = now()
     where id = v_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_tenant, auth.uid(), 'ecriture.booked', 'socle', 'ecritures', p_ecriture,
          jsonb_build_object('piece_id', v_piece, 'nature', v_nature,
                             'paiement_id', v_paiement));
end $function$;

commit;
