-- Un paiement se corrige, se fractionne, et porte sa référence.
--
-- ================================================== LES TROIS DÉFAUTS RÉELS
--
-- 13 octobre 2026, essai du dirigeant sur une facture de 1 969,610.
--
-- 1. IL A VOULU CHANGER D'AVIS, LE PRODUIT A COMPTÉ DEUX FOIS.
--    `capture.paiements` porte deux lignes pour cette facture : `especes`
--    à 08:51:59, puis `cheque` à 08:52:55, toutes deux au TTC PLEIN. L'écran
--    n'offre qu'« ajouter » ; changer de moyen est impossible. Et le reçu,
--    qui somme les paiements, attesterait 3 939,220 à un tiers — un document
--    faux remis à quelqu'un.
--
-- 2. L'ACOMPTE N'EST PAS ATTEIGNABLE. La colonne `montant_mineur` accepte
--    depuis toujours un montant partiel — son commentaire le dit : « acompte,
--    solde, ou retenue à la source ». Mais l'écran inscrit TOUJOURS le TTC
--    entier. Le fractionnement que la table permet, personne ne peut le
--    saisir. Rien à changer ici : le défaut est dans l'écran, et il s'y
--    corrige. Cette migration lui donne seulement de quoi dire le reste dû.
--
-- 3. LE NUMÉRO DE CHÈQUE N'EXISTE NULLE PART. L'expert lit « Chèque —
--    1 969,610 », ouvre la photo du talon, déchiffre le numéro à l'œil et le
--    recopie dans son rapprochement. Le rapprochement bancaire n'est pas
--    outillé : il est photographié.
--
-- ====================================== POURQUOI UNE ANNULATION, ET PAS UN UPDATE
--
-- `capture.paiements` refuse l'UPDATE et le DELETE par déclencheur (R7). Ce
-- n'est pas une gêne à contourner : un paiement est un fait déclaré, daté,
-- qui a pu partir au cabinet. On n'efface pas un fait — on en inscrit un
-- autre qui l'éteint, avec son motif et sa date.
--
-- La forme est celle que le dépôt emploie déjà pour les écritures comptables
-- (`socle.ecritures.reverses_id`) : une ligne qui DÉSIGNE celle qu'elle
-- annule. Deux colonnes, pas une table : l'annulation EST un paiement — même
-- tenant, même `vis`, même politique de lecture. Une table à part dupliquerait
-- la RLS et créerait un second endroit où « ce qui est payé » se calcule.
--
-- LA CHAÎNE RESTE PLATE. On n'annule jamais une annulation : on annule
-- toujours un paiement d'origine. P1 éteint par A1, P2 éteint par A2, P3
-- vivant. La vue se calcule donc en une passe, sans récursion — et c'est un
-- choix, pas une limite : autoriser l'annulation d'une annulation ferait de
-- cette vue un endroit où se tromper.
--
-- ====================================================== CE QUE LE CABINET PEUT
--
-- Rien, délibérément. L'insertion reste réservée aux membres du dossier
-- (`app.member_orgs()`), car un paiement est un fait déclaré par celui qui
-- paie. L'expert qui voit une erreur passe par le canal des demandes, qui
-- existe déjà. Lui ouvrir l'écriture ferait déclarer au cabinet le paiement
-- de son client.

begin;

-- ============================================================ LES MOTIFS
--
-- Une table à part, et non `ref.rejet_motifs`. Celle-ci sert à rejeter une
-- PIÈCE et alimente la liste du cabinet ; y verser « moyen de paiement
-- erroné » mélangerait deux vocabulaires dans un seul menu.
--
-- R4 : le motif n'est pas une chaîne en TypeScript, il est ici, daté.

create table if not exists ref.paiement_motifs_annulation (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  requires_note boolean not null default false,
  rang          smallint not null default 100,
  valid_from    date not null,
  valid_to      date
);

alter table ref.paiement_motifs_annulation enable row level security;
alter table ref.paiement_motifs_annulation force row level security;
drop policy if exists paiement_motifs_annulation_sel on ref.paiement_motifs_annulation;
create policy paiement_motifs_annulation_sel on ref.paiement_motifs_annulation
  for select to authenticated using (true);
revoke all on table ref.paiement_motifs_annulation from public, anon, service_role;
grant select on table ref.paiement_motifs_annulation to authenticated;

-- R11 : `valid_from` en littéral. La colonne n'a pas de défaut daté ici —
-- précisément pour qu'on ne puisse pas l'omettre sans s'en apercevoir.
insert into ref.paiement_motifs_annulation (code, requires_note, rang, valid_from) values
  ('moyen_errone',   false, 10, date '2026-01-01'),
  ('montant_errone', false, 20, date '2026-01-01'),
  ('paiement_annule_par_la_banque', false, 30, date '2026-01-01'),
  ('autre',          true,  90, date '2026-01-01')
on conflict (code) do nothing;

insert into ref.labels (ns, key, locale, value) values
  ('paiement_motif_annulation', 'moyen_errone',   'fr', 'Ce n''est pas le bon moyen de paiement'),
  ('paiement_motif_annulation', 'moyen_errone',   'en', 'Wrong payment method'),
  ('paiement_motif_annulation', 'moyen_errone',   'ar', 'وسيلة الدفع غير صحيحة'),
  ('paiement_motif_annulation', 'montant_errone', 'fr', 'Ce n''est pas le bon montant'),
  ('paiement_motif_annulation', 'montant_errone', 'en', 'Wrong amount'),
  ('paiement_motif_annulation', 'montant_errone', 'ar', 'المبلغ غير صحيح'),
  ('paiement_motif_annulation', 'paiement_annule_par_la_banque', 'fr', 'Le paiement n''est pas passé'),
  ('paiement_motif_annulation', 'paiement_annule_par_la_banque', 'en', 'The payment did not go through'),
  ('paiement_motif_annulation', 'paiement_annule_par_la_banque', 'ar', 'لم تتم عملية الدفع'),
  ('paiement_motif_annulation', 'autre',          'fr', 'Autre raison'),
  ('paiement_motif_annulation', 'autre',          'en', 'Other reason'),
  ('paiement_motif_annulation', 'autre',          'ar', 'سبب آخر')
on conflict (ns, key, locale) do nothing;

-- ====================================================== LA RÉFÉRENCE DU PAIEMENT
--
-- Le numéro du chèque, de la traite, l'identifiant du virement. C'est ce qui
-- se retrouve sur l'extrait bancaire, et donc ce qui permet de rapprocher.
--
-- Quels moyens l'exigent est une donnée du pack, pas une règle d'écran — au
-- même titre que `exige_justificatif` juste à côté (R4, R10).

alter table ref.payment_means
  add column if not exists exige_reference boolean not null default false;

comment on column ref.payment_means.exige_reference is
  'Ce moyen porte-t-il une référence que l''extrait bancaire reprendra ? '
  'Vrai pour le chèque, la traite, le virement ; faux pour les espèces.';

update ref.payment_means
   set exige_reference = true
 where code in ('cheque', 'cheque_banque', 'traite', 'virement');

-- La vue porte la colonne, sinon l'écran ne peut pas savoir quoi demander.
-- Appendue en fin : `create or replace view` ne sait ni retirer ni réordonner.
create or replace view public.ref_payment_means_v with (security_invoker = true) as
  select id, pack_version_id, code, libelle, tresorerie_account, exige_justificatif,
         rang, legal_reference, valid_from, valid_to, exige_reference
    from ref.payment_means;
revoke all on table public.ref_payment_means_v from public, anon, service_role;
grant select on table public.ref_payment_means_v to authenticated;

-- ====================================================== LES COLONNES DU PAIEMENT

alter table capture.paiements
  add column if not exists reference text,
  add column if not exists annule_paiement_id uuid references capture.paiements(id),
  add column if not exists annulation_motif_id uuid references ref.paiement_motifs_annulation(id);

comment on column capture.paiements.reference is
  'Le numéro du chèque ou de la traite, la référence du virement — ce que '
  'l''extrait bancaire reprendra. Saisi par la personne, ou lu sur le talon.';
comment on column capture.paiements.annule_paiement_id is
  'Le paiement que cette ligne éteint. Une correction est une écriture '
  'nouvelle (R7) : on n''efface jamais un fait déclaré.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'paiements_annulation_porte_un_motif') then
    alter table capture.paiements
      add constraint paiements_annulation_porte_un_motif
        check (annule_paiement_id is null or annulation_motif_id is not null);
  end if;
end $$;

-- UN PAIEMENT N'A QU'UNE ANNULATION, ET C'EST LA BASE QUI LE TIENT.
--
-- La première écriture de cette migration prenait un verrou de ligne
-- (`select … for update`) le temps de vérifier qu'aucune annulation
-- n'existait. Elle ne pouvait pas marcher, et c'est R7 qui l'interdit :
-- PostgreSQL soumet `for update` à la politique UPDATE de la table, et cette
-- table n'en a aucune — elle refuse l'UPDATE par déclencheur. La fonction
-- rendait donc « paiement introuvable » sur un paiement parfaitement lisible.
--
-- L'index unique est meilleur que le verrou qu'il remplace : il ne dépend
-- d'aucune discipline d'appel, et deux taps simultanés en voient un échouer.
-- R6 : il mène par `tenant_id`, et comme un identifiant de paiement
-- n'appartient qu'à un dossier, l'unicité par dossier vaut l'unicité tout
-- court.
create unique index if not exists paiements_une_seule_annulation
  on capture.paiements (tenant_id, annule_paiement_id)
  where annule_paiement_id is not null;

-- ====================================================== ANNULER, PAR UNE ÉCRITURE
--
-- Une fonction, et non une insertion depuis l'application : les deux refus
-- ci-dessous ne peuvent pas être tenus à l'étage applicatif sans course. Deux
-- taps rapides y produiraient deux annulations, et le compte repasserait à
-- zéro par soustraction double.

create or replace function public.paiement_annuler(p_paiement uuid, p_motif uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant   uuid;
  v_entity   uuid;
  v_vis      app.vis_t;
  v_piece    uuid;
  v_moyen    text;
  v_pack     uuid;
  v_montant  bigint;
  v_devise   text;
  v_paye_le  date;
  v_annule   uuid;
  v_nouveau  uuid;
begin
  -- Pas de `for update` : PostgreSQL le soumet à la politique UPDATE, que
  -- cette table n'a pas (R7). La course est fermée par l'index unique
  -- `paiements_une_seule_annulation`, plus haut — les refus qui suivent sont
  -- là pour la phrase, pas pour la garantie.
  select tenant_id, entity_id, vis, piece_id, moyen_code, pack_version_id,
         montant_mineur, devise, paye_le, annule_paiement_id
    into v_tenant, v_entity, v_vis, v_piece, v_moyen, v_pack,
         v_montant, v_devise, v_paye_le, v_annule
    from capture.paiements where id = p_paiement;

  if v_tenant is null then
    raise exception 'paiement introuvable ou non autorise' using errcode = '42501';
  end if;

  -- On n'annule pas une annulation : la chaîne reste plate, et la vue
  -- calculable en une passe.
  if v_annule is not null then
    raise exception 'cette ligne est deja une annulation' using errcode = '22023';
  end if;

  if exists (select 1 from capture.paiements where annule_paiement_id = p_paiement) then
    raise exception 'ce paiement est deja annule' using errcode = '22023';
  end if;

  if not exists (
    select 1 from ref.paiement_motifs_annulation
     where id = p_motif and valid_to is null
  ) then
    raise exception 'motif d''annulation inconnu' using errcode = '22023';
  end if;

  -- L'annulation recopie le fait qu'elle éteint. Le montant reste positif —
  -- la contrainte l'exige, et l'intention n'est pas d'écrire un négatif mais
  -- de désigner un fait éteint.
  insert into capture.paiements
    (tenant_id, entity_id, vis, piece_id, moyen_code, pack_version_id,
     montant_mineur, devise, paye_le, annule_paiement_id, annulation_motif_id)
  values
    (v_tenant, v_entity, v_vis, v_piece, v_moyen, v_pack,
     v_montant, v_devise, v_paye_le, p_paiement, p_motif)
  returning id into v_nouveau;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'paiement.annule', 'capture', 'paiements',
          p_paiement, jsonb_build_object('annulation_id', v_nouveau, 'motif_id', p_motif));

  return jsonb_build_object('paiement_id', p_paiement, 'annulation_id', v_nouveau);
end
$$;

revoke all on function public.paiement_annuler(uuid, uuid) from public, anon;
grant execute on function public.paiement_annuler(uuid, uuid) to authenticated;

comment on function public.paiement_annuler(uuid, uuid) is
  'Éteint un paiement par une écriture nouvelle, datée et motivée. Refuse '
  'd''annuler une annulation, ou un paiement déjà éteint.';

-- ====================================================== LA VUE DIT L''ÉTAT
--
-- `eteint` couvre les DEUX faces : la ligne annulée et la ligne qui annule.
-- « Ce qui est payé aujourd'hui » devient `sum(montant_mineur) where not
-- eteint` — une seule lecture, et aucun écran ne choisit.
--
-- Les colonnes nouvelles sont APPENDUES : `create or replace view` ne sait
-- ni retirer ni réordonner.

create or replace view public.paiements_v with (security_invoker = true) as
  select p.id, p.tenant_id, p.entity_id, p.vis, p.piece_id, p.moyen_code,
         p.pack_version_id, p.montant_mineur, p.devise, p.paye_le,
         coalesce(j.piece_id, p.justificatif_piece_id) as justificatif_piece_id,
         p.created_at,
         p.reference,
         p.annule_paiement_id,
         p.annulation_motif_id,
         (p.annule_paiement_id is not null
          or exists (select 1 from capture.paiements a
                      where a.annule_paiement_id = p.id)) as eteint
    from capture.paiements p
    left join lateral (
      select pj.piece_id
        from capture.paiement_justificatifs pj
       where pj.paiement_id = p.id
       order by pj.created_at desc, pj.id desc
       limit 1
    ) j on true;

revoke all on table public.paiements_v from public, anon, service_role;
grant select on table public.paiements_v to authenticated;

commit;
