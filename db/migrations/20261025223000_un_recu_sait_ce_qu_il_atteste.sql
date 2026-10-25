-- Un reçu sait ce qu'il atteste ; un justificatif se déplace, se reprend et
-- se supprime sans rien casser (25 octobre 2026).
--
-- ================================================================ POURQUOI
--
-- Maquette « Reçus et justificatifs d'une pièce », validée par Wissem le
-- 25 octobre 2026. Une pièce qui en ACCOMPAGNE une autre — le reçu que Malica
-- produit, le talon photographié d'un règlement — tombait dans l'écran d'une
-- pièce « pas encore lue » : un « Lire la pièce » mort, et un « Supprimer et
-- reprendre la photo » qui mélangeait deux gestes. Elle a désormais sa fiche,
-- et cette migration lui donne ce que la fiche doit dire et faire.
--
-- ===================================================== CE QUI EST AJOUTÉ
--
-- 1. `capture.recu_paiements` : le reçu sait QUELS règlements il atteste. Le
--    reçu est dessiné dans le navigateur à partir des règlements vivants ;
--    la liste voyage avec lui et s'inscrit dans la transaction qui
--    l'enregistre. Sans elle, un règlement annulé laissait derrière lui un
--    reçu qui l'attestait encore, et personne ne pouvait le voir.
--
-- 2. `capture.paiement_justificatifs` apprend le DÉTACHEMENT. La table est en
--    ajout seul (R7) : la dernière ligne d'un règlement dit sa preuve. Un
--    détachement est donc une ligne de plus, `fait = 'detache'`, sans pièce —
--    jamais un effacement. `paiements_v` lit la dernière ligne telle qu'elle
--    est : une preuve, ou aucune.
--
-- 3. Quatre portes, chacune une transaction :
--      `recu_attester_paiements`           le lien reçu → règlements ;
--      `piece_qui_accompagne`              ce que la fiche affiche ;
--      `justificatif_deplacer`             rattacher à un autre règlement ;
--      `justificatif_remplacer`            reprendre la photo ;
--      `piece_qui_accompagne_supprimer`    supprimer un reçu ou un justificatif.
--    Les suppressions passent par `capture_piece_supprimer`, la SEULE porte
--    par laquelle une pièce disparaît : une pièce transmise au cabinet ne se
--    supprime que sur son accord. Le refus lève une CLÉ du dictionnaire
--    (`refus.accompagne.transmise`), que l'écran dit dans la langue de la
--    personne.
--
-- 4. Les libellés de la fiche viennent du référentiel (R4) : comment on a
--    payé (« par chèque ») et le nom de la preuve d'un moyen (« Talon de
--    chèque »), en trois langues. La base rend des CODES ; l'API les
--    traduit, comme tous les espaces de noms de `ref.labels`.
--
-- Toutes les portes sont `security invoker` : la RLS décide de ce que
-- l'appelant voit et écrit, comme pour `paiement_rattacher_justificatif`.

-- --- 1. Le reçu et les règlements qu'il atteste -----------------------------------------

create table if not exists capture.recu_paiements (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references identity.organizations(id) on delete cascade,
  -- Le reçu. La colonne s'appelle `piece_id` pour que le garde d'effacement
  -- (`deny_mutation_hors_effacement_de_piece`) la reconnaisse : le reçu qui
  -- disparaît emporte ses lignes.
  piece_id     uuid not null references capture.pieces(id) on delete cascade,
  paiement_id  uuid not null references capture.paiements(id) on delete cascade,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  constraint recu_paiements_une_fois unique (tenant_id, piece_id, paiement_id)
);

comment on table capture.recu_paiements is
  'Les règlements qu''un reçu atteste, inscrits avec lui. Un reçu dont un '
  'règlement est éteint ne compte plus : il reste lisible, barré. Les reçus '
  'produits avant cette table n''y ont aucune ligne et comptent toujours.';

-- R6 : l'index unique mène par `tenant_id`. Les deux clés étrangères ont le
-- leur (`20261022420000`).
create index if not exists recu_paiements_piece_id_fk_idx on capture.recu_paiements (piece_id);
create index if not exists recu_paiements_paiement_id_fk_idx on capture.recu_paiements (paiement_id);

select app.enable_tenant_rls('capture', 'recu_paiements', false, true);

-- Le helper accorde UPDATE et DELETE avant de poser son garde : une table du
-- garde ne les laisse à personne (`schema.test.ts`), sinon le réglage
-- `malica.piece_effacable` deviendrait une clé posable par tous.
revoke delete, update on capture.recu_paiements from authenticated;

-- Lecture : comme les preuves d'un règlement, seulement si le reçu est
-- lisible par l'appelant — un cabinet ne voit pas le lien d'un reçu privé.
alter policy capture_recu_paiements_sel on capture.recu_paiements
  using (
    ((tenant_id in (select app.member_orgs()))
      or (tenant_id in (select app.engaged_orgs()))
      or (select app.is_platform()))
    and app.piece_lisible(piece_id));

-- Le garde strict du helper cède la place au garde permissif, comme pour les
-- trois tables du 18 octobre : même immuabilité, avec la porte que
-- `capture_piece_supprimer` a le droit d'ouvrir.
drop trigger if exists capture_recu_paiements_no_upd on capture.recu_paiements;
create trigger capture_recu_paiements_no_upd
  before delete or update on capture.recu_paiements
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

-- Corps repris de la base vivante (`20261024120000`) ; seul le cinquième
-- passage s'ajoute.
create or replace function app.deny_mutation_hors_effacement_de_piece()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_effacable text := coalesce(current_setting('malica.piece_effacable', true), '');
  v_paiements text;
begin
  -- Premier passage : la cascade d'une suppression de pièce que
  -- `capture_piece_supprimer` a validée, et pour CETTE pièce précisément.
  if tg_op = 'DELETE' and v_effacable = old.piece_id::text then
    -- Un paiement qui part avec la pièce note son identifiant : ses
    -- justificatifs, supprimés ensuite par cascade, s'y reconnaîtront.
    if tg_table_schema = 'capture' and tg_table_name = 'paiements' then
      perform set_config(
        'malica.paiements_effacables',
        coalesce(current_setting('malica.paiements_effacables', true), '')
          || ',' || old.id::text,
        true);
    end if;
    return old;
  end if;

  if tg_table_schema = 'capture' and tg_table_name = 'paiements' then
    -- Second passage : le SET NULL d'un justificatif qui disparaît. La pièce
    -- effacée est celle que le paiement citait, la colonne part vers NULL, et
    -- AUCUNE autre colonne ne bouge.
    if tg_op = 'UPDATE'
       and old.justificatif_piece_id is not null
       and v_effacable = old.justificatif_piece_id::text
       and new.justificatif_piece_id is null
       and to_jsonb(new) - 'justificatif_piece_id'
         = to_jsonb(old) - 'justificatif_piece_id'
    then
      return new;
    end if;
  elsif tg_table_schema = 'capture'
        and tg_table_name in ('paiement_justificatifs', 'recu_paiements') then
    -- Troisième passage : la ligne de preuve d'un paiement qui part avec sa
    -- facture. Son `piece_id` est le talon, pas la pièce effacée.
    -- Cinquième passage (25 octobre 2026), même règle : le lien d'un reçu
    -- vers un paiement qui part avec sa facture. Le reçu, lui, reste.
    v_paiements := coalesce(current_setting('malica.paiements_effacables', true), '');
    if tg_op = 'DELETE'
       and v_effacable <> ''
       and (',' || v_paiements || ',') like ('%,' || old.paiement_id::text || ',%')
    then
      return old;
    end if;
  elsif tg_table_schema = 'capture' and tg_table_name = 'rattachements' then
    -- Quatrième passage : le registre des rattachements a DEUX bouts. La pièce
    -- effacée peut être la pièce liée ; le premier passage n'a lu que l'autre.
    if tg_op = 'DELETE'
       and v_effacable <> ''
       and v_effacable = old.piece_liee_id::text
    then
      return old;
    end if;
  end if;

  raise exception
    'R7 : % interdit sur %.% — une correction est une ecriture nouvelle',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

-- --- 2. Le détachement d'une preuve est un fait -----------------------------------------

alter table capture.paiement_justificatifs
  add column if not exists fait text not null default 'rattache';
alter table capture.paiement_justificatifs
  alter column piece_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'paiement_justificatifs_fait_porte_sa_piece') then
    alter table capture.paiement_justificatifs
      add constraint paiement_justificatifs_fait_porte_sa_piece
        check (fait in ('rattache', 'detache')
               and ((fait = 'rattache') = (piece_id is not null)));
  end if;
end $$;

comment on column capture.paiement_justificatifs.fait is
  'rattache : la pièce devient la preuve du règlement. detache : le règlement '
  'n''a plus de preuve (la pièce est partie ailleurs, ou supprimée). La '
  'dernière ligne d''un règlement dit sa preuve ; aucune n''est réécrite (R7).';

-- La lecture, unique : la DERNIÈRE ligne de preuve décide, même quand elle
-- dit « aucune ». Corps repris de `20261013120000` ; seule la colonne
-- `justificatif_piece_id` change de calcul (même nom, même type, même rang).
create or replace view public.paiements_v with (security_invoker = true) as
  select p.id, p.tenant_id, p.entity_id, p.vis, p.piece_id, p.moyen_code,
         p.pack_version_id, p.montant_mineur, p.devise, p.paye_le,
         case when j.inscrite then j.piece_id else p.justificatif_piece_id end
           as justificatif_piece_id,
         p.created_at,
         p.reference,
         p.annule_paiement_id,
         p.annulation_motif_id,
         (p.annule_paiement_id is not null
          or exists (select 1 from capture.paiements a
                      where a.annule_paiement_id = p.id)) as eteint
    from capture.paiements p
    left join lateral (
      select pj.piece_id, true as inscrite
        from capture.paiement_justificatifs pj
       where pj.paiement_id = p.id
       order by pj.created_at desc, pj.id desc
       limit 1
    ) j on true;

revoke all on table public.paiements_v from public, anon, service_role;
grant select on table public.paiements_v to authenticated;

-- Les règlements dont cette pièce est AUJOURD'HUI la preuve. Une seule
-- définition — celle de `paiements_v` —, le filtre d'entrée ne sert qu'à ne
-- pas parcourir tous les règlements du dossier.
create or replace function app.reglements_prouves_par(p_piece uuid)
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select v.id
    from public.paiements_v v
   where v.id in (select p.id from capture.paiements p where p.justificatif_piece_id = p_piece
                  union
                  select j.paiement_id from capture.paiement_justificatifs j
                   where j.piece_id = p_piece)
     and v.justificatif_piece_id = p_piece
$$;

revoke all on function app.reglements_prouves_par(uuid) from public, anon;
grant execute on function app.reglements_prouves_par(uuid) to authenticated;

-- Une pièce qui a été la preuve d'un règlement accompagne, même rattachée
-- après coup sans `source_piece_id` : la table des preuves tardives n'était
-- pas lue. Corps repris de `20261025140000`, une ligne de plus.
create or replace function app.piece_accompagne(p_piece uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  -- Un reçu généré depuis une pièce, ou le justificatif d'un paiement.
  select exists (select 1 from capture.pieces where id = p_piece and source_piece_id is not null)
      or exists (select 1 from capture.paiements where justificatif_piece_id = p_piece)
      or exists (select 1 from capture.paiement_justificatifs where piece_id = p_piece)
$$;

revoke all on function app.piece_accompagne(uuid) from public, anon;
grant execute on function app.piece_accompagne(uuid) to authenticated;

-- --- 3. Les libellés : comment on a payé, et le nom de la preuve ------------------------

insert into ref.labels (ns, key, locale, value) values
  ('moyen_paiement_par', 'especes',        'fr', 'en espèces'),
  ('moyen_paiement_par', 'especes',        'en', 'in cash'),
  ('moyen_paiement_par', 'especes',        'ar', 'نقدًا'),
  ('moyen_paiement_par', 'cheque',         'fr', 'par chèque'),
  ('moyen_paiement_par', 'cheque',         'en', 'by cheque'),
  ('moyen_paiement_par', 'cheque',         'ar', 'بشيك'),
  ('moyen_paiement_par', 'cheque_banque',  'fr', 'par chèque de banque'),
  ('moyen_paiement_par', 'cheque_banque',  'en', 'by bank cheque'),
  ('moyen_paiement_par', 'cheque_banque',  'ar', 'بشيك بنكي'),
  ('moyen_paiement_par', 'carte_bancaire', 'fr', 'par carte bancaire'),
  ('moyen_paiement_par', 'carte_bancaire', 'en', 'by bank card'),
  ('moyen_paiement_par', 'carte_bancaire', 'ar', 'ببطاقة بنكية'),
  ('moyen_paiement_par', 'traite',         'fr', 'par traite'),
  ('moyen_paiement_par', 'traite',         'en', 'by bill of exchange'),
  ('moyen_paiement_par', 'traite',         'ar', 'بكمبيالة'),
  ('moyen_paiement_par', 'virement',       'fr', 'par virement'),
  ('moyen_paiement_par', 'virement',       'en', 'by bank transfer'),
  ('moyen_paiement_par', 'virement',       'ar', 'بتحويل بنكي'),
  ('moyen_paiement_par', 'autre',          'fr', 'par un autre moyen'),
  ('moyen_paiement_par', 'autre',          'en', 'by another means'),
  ('moyen_paiement_par', 'autre',          'ar', 'بوسيلة أخرى'),
  ('justificatif_du_moyen', 'especes',        'fr', 'Reçu d''espèces'),
  ('justificatif_du_moyen', 'especes',        'en', 'Cash receipt'),
  ('justificatif_du_moyen', 'especes',        'ar', 'وصل نقدي'),
  ('justificatif_du_moyen', 'cheque',         'fr', 'Talon de chèque'),
  ('justificatif_du_moyen', 'cheque',         'en', 'Cheque stub'),
  ('justificatif_du_moyen', 'cheque',         'ar', 'كعب الشيك'),
  ('justificatif_du_moyen', 'cheque_banque',  'fr', 'Copie du chèque de banque'),
  ('justificatif_du_moyen', 'cheque_banque',  'en', 'Bank cheque copy'),
  ('justificatif_du_moyen', 'cheque_banque',  'ar', 'نسخة الشيك البنكي'),
  ('justificatif_du_moyen', 'carte_bancaire', 'fr', 'Ticket de carte bancaire'),
  ('justificatif_du_moyen', 'carte_bancaire', 'en', 'Card payment slip'),
  ('justificatif_du_moyen', 'carte_bancaire', 'ar', 'وصل البطاقة البنكية'),
  ('justificatif_du_moyen', 'traite',         'fr', 'Copie de la traite'),
  ('justificatif_du_moyen', 'traite',         'en', 'Bill of exchange copy'),
  ('justificatif_du_moyen', 'traite',         'ar', 'نسخة الكمبيالة'),
  ('justificatif_du_moyen', 'virement',       'fr', 'Avis de virement'),
  ('justificatif_du_moyen', 'virement',       'en', 'Transfer advice'),
  ('justificatif_du_moyen', 'virement',       'ar', 'إشعار التحويل'),
  ('justificatif_du_moyen', 'autre',          'fr', 'Justificatif de paiement'),
  ('justificatif_du_moyen', 'autre',          'en', 'Proof of payment'),
  ('justificatif_du_moyen', 'autre',          'ar', 'مؤيّد دفع')
on conflict (ns, key, locale) do nothing;

-- --- 4. Les portes ---------------------------------------------------------------------

-- 4a. Le reçu inscrit ce qu'il atteste, dans la transaction qui l'enregistre.
--
-- Rejouable : la file hors ligne renvoie le même reçu avec la même clé, et la
-- même liste ne s'inscrit qu'une fois. Un règlement annulé ENTRE la
-- production du reçu et son envoi s'inscrit quand même : c'est ce que le
-- reçu atteste, et il dira aussitôt qu'il ne compte plus.
create or replace function public.recu_attester_paiements(p_recu uuid, p_paiements uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_source uuid;
  v_kind   text;
  v_n      integer;
begin
  select tenant_id, source_piece_id, document_kind into v_tenant, v_source, v_kind
    from capture.pieces where id = p_recu;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_kind is distinct from 'recu_de_paiement' or v_source is null then
    raise exception 'seul un reçu issu d''une pièce atteste des règlements'
      using errcode = '22023';
  end if;

  -- Chaque règlement est un règlement RÉEL de la pièce dont le reçu est issu :
  -- ni une annulation, ni « pas encore payé », ni le règlement d'une autre.
  if exists (
    select 1 from unnest(p_paiements) as x(id)
     where not exists (select 1 from capture.paiements p
                        where p.id = x.id and p.piece_id = v_source
                          and p.tenant_id = v_tenant
                          and p.annule_paiement_id is null
                          and p.montant_mineur is not null)
  ) then
    raise exception 'reglement introuvable ou non autorise pour ce recu'
      using errcode = '42501';
  end if;

  insert into capture.recu_paiements (tenant_id, piece_id, paiement_id)
  select v_tenant, p_recu, x.id from unnest(p_paiements) as x(id)
  on conflict (tenant_id, piece_id, paiement_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke all on function public.recu_attester_paiements(uuid, uuid[]) from public, anon;
grant execute on function public.recu_attester_paiements(uuid, uuid[]) to authenticated;

-- 4b. Ce que la fiche d'une pièce qui accompagne affiche — `null` si la pièce
-- n'en accompagne aucune.
--
--   genre        recu | justificatif
--   mere         la pièce à laquelle elle est rattachée (résumé de sa lecture)
--   reglements   ce que le reçu atteste, ou ce que le justificatif prouve
--   vaut         faux dès qu'un de ces règlements est éteint
--   annulation   la date et le motif de cette extinction
--   candidats    (justificatif) les règlements du dossier SANS preuve, de même
--                côté de la frontière du cabinet : déplacer une preuve ne
--                transmet rien et ne rappelle rien.
--
-- Un reçu produit avant `recu_paiements` n'a aucune ligne : on ne sait pas ce
-- qu'il attestait, et on ne le devine pas. Il compte (pas de tampon), et la
-- fiche le dit.
create or replace function public.piece_qui_accompagne(p_piece uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_piece      capture.pieces;
  v_genre      text;
  v_mere       uuid;
  v_reglements uuid[];
  v_mere_json  jsonb;
  v_regl_json  jsonb;
  v_annulation jsonb;
  v_candidats  jsonb := '[]'::jsonb;
begin
  select * into v_piece from capture.pieces where id = p_piece;
  if v_piece.id is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if not app.piece_accompagne(p_piece) then
    return null;
  end if;

  select coalesce(array_agg(r), '{}') into v_reglements from app.reglements_prouves_par(p_piece) r;

  v_genre := case
    when v_piece.document_kind = 'recu_de_paiement' then 'recu'
    when cardinality(v_reglements) > 0 or v_piece.document_kind = 'justificatif_paiement'
      then 'justificatif'
    -- Une pièce née d'une autre, sans type et sans règlement : les reçus
    -- produits avant que le type ne soit déclaré.
    when v_piece.source_piece_id is not null then 'recu'
    else 'justificatif'
  end;

  if v_genre = 'recu' then
    select coalesce(array_agg(rp.paiement_id), '{}') into v_reglements
      from capture.recu_paiements rp where rp.piece_id = p_piece;
    v_mere := v_piece.source_piece_id;
  else
    -- Le justificatif suit son règlement : sa pièce est la mère.
    v_mere := coalesce(
      (select p.piece_id from capture.paiements p where p.id = any (v_reglements)
        order by p.created_at limit 1),
      v_piece.source_piece_id);
  end if;

  select jsonb_build_object(
           'id', m.id,
           'typeDeDocument', coalesce(m.document_kind, x.payload ->> 'document_kind'),
           'emetteur', x.payload ->> 'issuer',
           'date', x.payload ->> 'document_date',
           'ttc', x.payload #>> '{totals,ttc}',
           'devise', x.payload ->> 'currency')
    into v_mere_json
    from capture.pieces m
    left join lateral (
      select e.payload from public.extractions_v e
       where e.piece_id = m.id and e.contract like 'extract.v1%'
       order by e.created_at desc limit 1
    ) x on true
   where m.id = v_mere;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id,
           'moyenCode', v.moyen_code,
           'montantMineur', v.montant_mineur,
           'devise', v.devise,
           'payeLe', v.paye_le,
           'eteint', v.eteint) order by v.paye_le, v.created_at), '[]'::jsonb)
    into v_regl_json
    from public.paiements_v v
   where v.id = any (v_reglements);

  -- La première extinction : le règlement d'origine annulé, sa date et son motif.
  select jsonb_build_object(
           'paiementId', v.id,
           'le', a.created_at,
           'motifCode', m.code)
    into v_annulation
    from public.paiements_v v
    join capture.paiements a on a.annule_paiement_id = v.id
    join ref.paiement_motifs_annulation m on m.id = a.annulation_motif_id
   where v.id = any (v_reglements)
   order by a.created_at
   limit 1;

  if v_genre = 'justificatif' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id,
             'moyenCode', c.moyen_code,
             'montantMineur', c.montant_mineur,
             'devise', c.devise,
             'payeLe', c.paye_le,
             'pieceId', c.piece_id,
             'tiers', c.tiers) order by c.paye_le desc, c.created_at desc), '[]'::jsonb)
      into v_candidats
      from (
        select v.id, v.moyen_code, v.montant_mineur, v.devise, v.paye_le, v.piece_id,
               v.created_at,
               (select e.payload ->> 'issuer' from public.extractions_v e
                 where e.piece_id = v.piece_id and e.contract like 'extract.v1%'
                 order by e.created_at desc limit 1) as tiers
          from public.paiements_v v
          join capture.pieces f on f.id = v.piece_id
         where v.tenant_id = v_piece.tenant_id
           and not v.eteint
           and v.annule_paiement_id is null
           and v.montant_mineur is not null
           and v.moyen_code <> 'non_paye'
           and v.justificatif_piece_id is null
           and not (v.id = any (v_reglements))
           and ((f.vis = 'partage'::app.vis_t) = (v_piece.vis = 'partage'::app.vis_t))
         order by v.paye_le desc, v.created_at desc
         limit 50
      ) c;
  end if;

  return jsonb_build_object(
    'genre', v_genre,
    'vis', v_piece.vis,
    'creeLe', v_piece.created_at,
    'mere', v_mere_json,
    'reglements', v_regl_json,
    'vaut', v_annulation is null,
    'annulation', v_annulation,
    'candidats', v_candidats);
end
$$;

revoke all on function public.piece_qui_accompagne(uuid) from public, anon;
grant execute on function public.piece_qui_accompagne(uuid) to authenticated;

-- Le garde commun des trois gestes : la pièce est lisible, elle accompagne,
-- et — pour les gestes qui la suppriment — elle n'est pas partie au cabinet.
-- Rend son dossier.
create or replace function app.piece_qui_accompagne_garde(p_piece uuid, p_supprime boolean)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
begin
  select tenant_id, vis into v_tenant, v_vis from capture.pieces where id = p_piece;
  if v_tenant is null or not app.piece_accompagne(p_piece) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_tenant not in (select app.member_orgs()) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- Une pièce transmise ne disparaît que sur accord du cabinet
  -- (`capture_piece_supprimer`) : la fiche le dit, dans la langue de la
  -- personne, AVANT qu'une nouvelle photo ne soit prise pour rien.
  if p_supprime and v_vis = 'partage'::app.vis_t then
    raise exception 'refus.accompagne.transmise' using errcode = 'check_violation';
  end if;
  return v_tenant;
end
$$;

revoke all on function app.piece_qui_accompagne_garde(uuid, boolean) from public, anon;
grant execute on function app.piece_qui_accompagne_garde(uuid, boolean) to authenticated;

-- 4c. Rattacher à un autre règlement.
--
-- La preuve quitte les règlements qu'elle prouvait (un fait `detache` pour
-- chacun) et rejoint celui choisi (un fait `rattache`). Elle suit sa facture :
-- `source_piece_id` devient la pièce du règlement choisi.
create or replace function public.justificatif_deplacer(p_piece uuid, p_paiement uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant    uuid;
  v_vis       app.vis_t;
  v_kind      text;
  v_cible     public.paiements_v;
  v_vis_cible app.vis_t;
  v_quittes   uuid[];
begin
  v_tenant := app.piece_qui_accompagne_garde(p_piece, false);
  select vis, document_kind into v_vis, v_kind from capture.pieces where id = p_piece;
  if v_kind = 'recu_de_paiement' then
    raise exception 'un recu ne se rattache pas a un reglement' using errcode = '22023';
  end if;

  -- Deux déplacements simultanés vers le même règlement : le second attend
  -- et voit la preuve du premier. Pas de `for update` : la table refuse
  -- l'UPDATE (R7), et PostgreSQL le soumettrait à cette politique.
  perform pg_advisory_xact_lock(hashtextextended(p_paiement::text, 0));

  select * into v_cible from public.paiements_v where id = p_paiement;
  if v_cible.id is null or v_cible.tenant_id <> v_tenant then
    raise exception 'paiement introuvable ou non autorise' using errcode = '42501';
  end if;
  if v_cible.eteint or v_cible.annule_paiement_id is not null
     or v_cible.montant_mineur is null or v_cible.moyen_code = 'non_paye' then
    raise exception 'refus.justificatif.reglement_eteint' using errcode = 'check_violation';
  end if;
  if v_cible.justificatif_piece_id is not null then
    raise exception 'refus.justificatif.reglement_deja_prouve' using errcode = 'check_violation';
  end if;
  select vis into v_vis_cible from capture.pieces where id = v_cible.piece_id;
  if (v_vis_cible = 'partage'::app.vis_t) <> (v_vis = 'partage'::app.vis_t) then
    raise exception 'refus.justificatif.autre_cote_du_cabinet' using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(r), '{}') into v_quittes from app.reglements_prouves_par(p_piece) r;

  insert into capture.paiement_justificatifs (tenant_id, paiement_id, piece_id, fait)
  select v_tenant, q, null, 'detache' from unnest(v_quittes) q;

  insert into capture.paiement_justificatifs (tenant_id, paiement_id, piece_id, fait)
  values (v_tenant, p_paiement, p_piece, 'rattache');

  update capture.pieces set source_piece_id = v_cible.piece_id where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'paiement.justificatif_deplace', 'capture', 'pieces', p_piece,
          jsonb_build_object('vers', p_paiement, 'depuis', to_jsonb(v_quittes)));

  return jsonb_build_object('piece_id', p_piece, 'paiement_id', p_paiement);
end
$$;

revoke all on function public.justificatif_deplacer(uuid, uuid) from public, anon;
grant execute on function public.justificatif_deplacer(uuid, uuid) to authenticated;

-- 4d. Reprendre la photo : la nouvelle devient la preuve des mêmes
-- règlements, l'ancienne est supprimée — ensemble, ou rien.
create or replace function public.justificatif_remplacer(p_ancien uuid, p_nouveau uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant    uuid;
  v_source    uuid;
  v_kind      text;
  v_tenant_n  uuid;
  v_reglements uuid[];
begin
  v_tenant := app.piece_qui_accompagne_garde(p_ancien, true);
  select source_piece_id, document_kind into v_source, v_kind
    from capture.pieces where id = p_ancien;
  if v_kind = 'recu_de_paiement' then
    raise exception 'un recu se produit, il ne se photographie pas' using errcode = '22023';
  end if;

  select tenant_id into v_tenant_n from capture.pieces where id = p_nouveau;
  if v_tenant_n is null or v_tenant_n <> v_tenant or p_nouveau = p_ancien then
    raise exception 'justificatif introuvable ou non autorise dans ce dossier'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(r), '{}') into v_reglements from app.reglements_prouves_par(p_ancien) r;

  -- La nouvelle photo prend la place de l'ancienne, règlement par règlement :
  -- « le rattachement au règlement est gardé ».
  insert into capture.paiement_justificatifs (tenant_id, paiement_id, piece_id, fait)
  select v_tenant, r, p_nouveau, 'rattache' from unnest(v_reglements) r;

  update capture.pieces
     set source_piece_id = coalesce(v_source, source_piece_id)
   where id = p_nouveau;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'paiement.justificatif_remplace', 'capture', 'pieces', p_nouveau,
          jsonb_build_object('remplace', p_ancien, 'reglements', to_jsonb(v_reglements)));

  -- La SEULE porte par laquelle une pièce disparaît ; ses lignes de preuve
  -- partent avec elle (cascade), et la nouvelle est déjà la dernière.
  perform public.capture_piece_supprimer(p_ancien, false);

  return jsonb_build_object('piece_id', p_nouveau, 'remplace', p_ancien);
end
$$;

revoke all on function public.justificatif_remplacer(uuid, uuid) from public, anon;
grant execute on function public.justificatif_remplacer(uuid, uuid) to authenticated;

-- 4e. Supprimer : un reçu disparaît ; un justificatif quitte d'abord ses
-- règlements (un fait `detache` chacun), sinon une photo plus ancienne
-- redeviendrait la preuve en silence.
create or replace function public.piece_qui_accompagne_supprimer(p_piece uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := app.piece_qui_accompagne_garde(p_piece, true);

  insert into capture.paiement_justificatifs (tenant_id, paiement_id, piece_id, fait)
  select v_tenant, r, null, 'detache' from app.reglements_prouves_par(p_piece) r;

  return public.capture_piece_supprimer(p_piece, false);
end
$$;

revoke all on function public.piece_qui_accompagne_supprimer(uuid) from public, anon;
grant execute on function public.piece_qui_accompagne_supprimer(uuid) to authenticated;
