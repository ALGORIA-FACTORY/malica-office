-- Un avoir se lie à sa facture d'origine (1er novembre 2026).
--
-- ================================================================= LE DÉFAUT
--
-- Le CEO a tranché le 31 octobre 2026 (`avoirs.traitement` = `lie_facture`,
-- 20261108090000 ; Code TVA art. 9, point 5) : un avoir est obligatoirement
-- lié à sa facture, et s'écrit en annulation (extourne) ou en réduction (709
-- pour une vente, 609 pour un achat). Le réglage était ENREGISTRÉ, pas
-- appliqué : le Socle refusait tout avoir, et le cabinet le saisissait.
--
-- ================================================================= LA RÈGLE
--
-- 1. LE LIEN EST UN FAIT, en ajout seul : `capture.avoirs_rattaches`. Il se pose
--    par la porte `public.avoir_rattacher`, au `portier` (#149), droits de
--    supervision vérifiés par `app.peut_arreter_le_parametrage` : à VALIDER,
--    quand le numéro imprimé sur l'avoir désigne une seule facture du dossier
--    (`numero`) ; ou par le geste du cabinet qui la désigne (`cabinet`). Le
--    plus récent fait foi ; aucun ne se réécrit (R7).
-- 2. LE TRAITEMENT est un réglage de plus du sujet « avoirs » :
--    `avoirs.ecriture` = l'extourne, le rabais, ou selon l'avoir (total :
--    extourne ; partiel : rabais). Son défaut n'est pas une décision du CEO :
--    c'est la pratique que la recherche du 31 octobre 2026 décrit, à confirmer.
-- 3. LE COMPTE DES RRR se lit par préfixe du compte d'origine, par sens :
--    `ref.comptes_de_rabais` (un rôle, résolu par le paramétrage, R10). Une base
--    dont le compte n'a pas de compte de RRR se contre-passe sur lui-même (une
--    immobilisation, un service extérieur 61/62 : INCERTAIN, la recherche cite
--    609/619/629 et le plan ne porte pas de rôle pour 619 ni 629).
--
-- CE QUI RESTE NON APPLIQUÉ, et se dit : l'option `libre` (un avoir sans
-- facture, avec avertissement) ; un avoir aux montants imprimés en négatif ; un
-- avoir en devise.
--
-- REJEU (R11) : dates en littéral ; aucune horloge n'écrit dans `ref`.

begin;

-- --- 1. Le traitement d'un avoir lié ------------------------------------------------------------

insert into ref.reglages_comptables (code, sujet, ordre, nature, porte, applique) values
  ('avoirs.ecriture', 'avoirs', 2, 'option', 'reglages_comptables', true);

insert into ref.reglages_comptables_options (reglage, code, ordre, applique) values
  ('avoirs.ecriture', 'selon_avoir', 1, true),
  ('avoirs.ecriture', 'extourne', 2, true),
  ('avoirs.ecriture', 'rabais', 3, true);

update ref.reglages_comptables_options set applique = true
 where reglage = 'avoirs.traitement' and code = 'lie_facture';

insert into ref.socle_params (pack_version_id, code, value_text, value_num, legal_reference, valid_from)
select p.id, 'avoirs.ecriture', 'selon_avoir', null,
       'Défaut technique posé le 01/11/2026, à confirmer par un expert-comptable : la pratique de '
       'la recherche du 31/10/2026 (annulation : extourne de l''écriture ; réduction : 709 pour '
       'une vente, 609 pour un achat). Code TVA art. 9 (point 5).',
       date '2026-01-01'
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN' and p.version = '2026.1';

-- --- 2. Le compte des RRR, par préfixe du compte d'origine --------------------------------------

create table ref.comptes_de_rabais (
  pack_version_id uuid not null references ref.jurisdiction_packs (id),
  document_kind   text not null check (document_kind in ('facture_achat', 'facture_vente')),
  -- Le préfixe du compte de base de la facture que l'avoir réduit.
  prefixe         text not null check (prefixe ~ '^[0-9]+$'),
  -- Le rôle du compte des RRR : son compte se résout par le paramétrage (R10).
  role_code       text not null references ref.account_roles (code),
  legal_reference text not null check (length(btrim(legal_reference)) > 0),
  valid_from      date not null,
  valid_to        date,
  check (valid_to is null or valid_to >= valid_from),
  primary key (pack_version_id, document_kind, prefixe, valid_from)
);

create index comptes_de_rabais_role_idx on ref.comptes_de_rabais (role_code);

comment on table ref.comptes_de_rabais is
  'Le compte des rabais, remises et ristournes qu''un avoir en réduction emploie, par préfixe du '
  'compte d''origine et par sens. Une base sans compte de RRR se contre-passe sur son compte.';

alter table ref.comptes_de_rabais enable row level security;
alter table ref.comptes_de_rabais force row level security;
revoke all on table ref.comptes_de_rabais from public, anon;
grant select on table ref.comptes_de_rabais to authenticated;
create policy ref_comptes_de_rabais_sel on ref.comptes_de_rabais
  for select to authenticated using (true);

insert into ref.comptes_de_rabais
  (pack_version_id, document_kind, prefixe, role_code, legal_reference, valid_from)
select p.id, v.sens, v.prefixe, v.role,
       'Plan NC 01 : ' || v.reference || ' Pratique de la recherche du 31/10/2026, à confirmer '
       'par un expert-comptable.',
       date '2026-01-01'
  from ref.jurisdiction_packs p
 cross join (values
   ('facture_vente', '70', 'RRR_ACCORDES', '709 RRR accordés par l''entreprise.'),
   ('facture_achat', '60', 'RRR_OBTENUS', '609 RRR obtenus sur achats.')
 ) as v(sens, prefixe, role, reference)
 where p.jurisdiction = 'TN' and p.version = '2026.1';

-- --- 3. Le lien d'un avoir à sa facture : un fait ----------------------------------------------

create table capture.avoirs_rattaches (
  id               uuid primary key default gen_random_uuid(),
  -- Le dossier des deux pièces.
  tenant_id        uuid not null references identity.organizations (id),
  -- L'avoir (sa version courante au moment du lien).
  piece_id         uuid not null references capture.pieces (id) on delete cascade,
  facture_piece_id uuid not null references capture.pieces (id) on delete cascade,
  -- `numero` : le numéro imprimé sur l'avoir désignait cette seule facture ;
  -- `cabinet` : le cabinet l'a désignée.
  origine          text not null check (origine in ('numero', 'cabinet')),
  -- Le cabinet qui supervise le dossier et a posé le lien.
  cabinet_id       uuid not null references identity.organizations (id),
  decide_par       uuid not null default auth.uid(),
  decide_le        timestamptz not null default clock_timestamp(),
  check (piece_id <> facture_piece_id)
);

comment on table capture.avoirs_rattaches is
  'Le lien d''un avoir à sa facture d''origine, en ajout seul : le plus récent fait foi '
  '(1er novembre 2026). Écrit par public.avoir_rattacher.';

create index avoirs_rattaches_tenant_idx
  on capture.avoirs_rattaches (tenant_id, piece_id, decide_le desc);
create index avoirs_rattaches_piece_id_fk_idx on capture.avoirs_rattaches (piece_id);
create index avoirs_rattaches_facture_piece_id_fk_idx
  on capture.avoirs_rattaches (facture_piece_id);
create index avoirs_rattaches_cabinet_id_fk_idx on capture.avoirs_rattaches (cabinet_id);

-- Ajout seul : un lien ne se réécrit pas, il ne part qu'avec l'une des deux
-- pièces, quand sa suppression est validée (`capture_piece_supprimer`).
create or replace function app.avoir_rattache_ajout_seulement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and (app.effacement_en_cours(old.piece_id) or app.effacement_en_cours(old.facture_piece_id))
  then
    return old;
  end if;
  raise exception 'refus.avoir.lien_immuable' using errcode = '42501';
end
$$;

create trigger avoirs_rattaches_ajout_seulement
  before update or delete on capture.avoirs_rattaches
  for each row execute function app.avoir_rattache_ajout_seulement();

alter table capture.avoirs_rattaches enable row level security;
alter table capture.avoirs_rattaches force row level security;
revoke all on table capture.avoirs_rattaches from public, anon;
grant select on table capture.avoirs_rattaches to authenticated;
create policy avoirs_rattaches_sel on capture.avoirs_rattaches
  for select to authenticated
  using ((tenant_id in (select app.member_orgs()) or tenant_id in (select app.engaged_orgs()))
         and app.piece_lisible(piece_id));
-- La porte s'exécute sous le portier : la politique d'insertion est la règle
-- de droits elle-même, signée de l'appelant.
create policy avoirs_rattaches_ins on capture.avoirs_rattaches
  for insert to authenticated
  with check (decide_par = (select auth.uid())
              and app.peut_arreter_le_parametrage(cabinet_id, 'dossier', tenant_id));
grant insert on capture.avoirs_rattaches to portier;
grant execute on function app.cabinet_du_parametrage(uuid) to portier;

-- --- 4. La porte ---------------------------------------------------------------------------------

create or replace function public.avoir_rattacher(p_avoir uuid, p_facture uuid, p_origine text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_avoir   uuid := app.version_courante(p_avoir);
  v_facture uuid := app.version_courante(p_facture);
  v_dossier uuid;
  v_cabinet uuid;
  v_sens    text;
  v_id      uuid;
begin
  if p_origine is null or p_origine not in ('numero', 'cabinet') then
    raise exception 'refus.avoir.saisie' using errcode = '22023';
  end if;
  select p.tenant_id, p.document_kind into v_dossier, v_sens
    from capture.pieces p
   where p.id = v_avoir and app.piece_lisible(p.id);
  if v_dossier is null then
    raise exception 'refus.avoir.droits' using errcode = '42501';
  end if;
  v_cabinet := app.cabinet_du_parametrage(v_dossier);
  if v_cabinet is null
     or not app.peut_arreter_le_parametrage(v_cabinet, 'dossier', v_dossier) then
    raise exception 'refus.avoir.droits' using errcode = '42501';
  end if;
  -- La facture : une autre pièce du même dossier, du même sens.
  if v_facture is null or v_facture = v_avoir
     or not exists (select 1 from capture.pieces f
                     where f.id = v_facture and f.tenant_id = v_dossier
                       and f.document_kind is not distinct from v_sens
                       and app.piece_lisible(f.id)) then
    raise exception 'refus.avoir.facture' using errcode = '22023';
  end if;
  insert into capture.avoirs_rattaches (tenant_id, piece_id, facture_piece_id, origine, cabinet_id)
  values (v_dossier, v_avoir, v_facture, p_origine, v_cabinet)
  returning id into v_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id,
                               payload)
  values (v_dossier, auth.uid(), 'avoir.rattache', 'capture', 'avoirs_rattaches', v_id,
          jsonb_build_object('avoir', v_avoir, 'facture', v_facture, 'origine', p_origine));
  return v_id;
end
$$;

alter function public.avoir_rattacher(uuid, uuid, text) owner to portier;
revoke all on function public.avoir_rattacher(uuid, uuid, text) from public, anon;
grant execute on function public.avoir_rattacher(uuid, uuid, text) to authenticated;

-- --- 5. Les mots ---------------------------------------------------------------------------------

insert into ref.labels (ns, key, locale, value) values
  ('reglage_comptable', 'avoirs.ecriture', 'fr', 'Écriture d''un avoir lié'),
  ('reglage_comptable', 'avoirs.ecriture', 'en', 'Entry for a linked credit note'),
  ('reglage_comptable', 'avoirs.ecriture', 'ar', 'قيد الإشعار الدائن المرتبط'),
  ('reglage_comptable_option', 'avoirs.ecriture:selon_avoir', 'fr',
   'Selon l''avoir : total, extourne de la facture ; partiel, au compte des rabais du pack'),
  ('reglage_comptable_option', 'avoirs.ecriture:selon_avoir', 'en',
   'By credit note: full, reversal of the invoice; partial, to the pack''s discount account'),
  ('reglage_comptable_option', 'avoirs.ecriture:selon_avoir', 'ar',
   'حسب الإشعار: كلي، عكس قيد الفاتورة؛ جزئي، في حساب التخفيضات للحزمة'),
  ('reglage_comptable_option', 'avoirs.ecriture:extourne', 'fr',
   'Toujours l''extourne de l''écriture de la facture, au prorata'),
  ('reglage_comptable_option', 'avoirs.ecriture:extourne', 'en',
   'Always the reversal of the invoice entry, pro rata'),
  ('reglage_comptable_option', 'avoirs.ecriture:extourne', 'ar',
   'دائما عكس قيد الفاتورة، بالتناسب'),
  ('reglage_comptable_option', 'avoirs.ecriture:rabais', 'fr',
   'Toujours au compte des rabais, remises et ristournes du pack'),
  ('reglage_comptable_option', 'avoirs.ecriture:rabais', 'en',
   'Always to the pack''s rebates, discounts and refunds account'),
  ('reglage_comptable_option', 'avoirs.ecriture:rabais', 'ar',
   'دائما في حساب التخفيضات والحطائط والمرتجعات للحزمة');

commit;
