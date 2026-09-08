-- ============================================================================
-- La fiche fiscale du dossier : qui est ce client, au regard de l'impôt.
-- ============================================================================
--
-- CE QUI SE PASSAIT AVANT
--
-- Malica ne savait rien du client. La base ne portait que ceci :
--
--     id · kind · name · legal_id · jurisdiction · currency · validation_mode
--
-- Pas de régime d'imposition. Pas d'assujettissement à la TVA. Pas de secteur.
-- Pas d'exercice comptable. Pas de date de début d'activité.
--
-- Conséquence : à la question « puis-je déduire cette TVA ? », elle ne pouvait
-- pas savoir si le client est seulement assujetti. À « quel est mon impôt ? »,
-- elle ne savait pas s'il relève du réel ou du forfait — deux régimes qui
-- n'ont ni la même assiette, ni le même barème, ni les mêmes obligations.
--
-- Elle avait donc deux issues, et les deux sont mauvaises : supposer en
-- silence, ou interroger le client à chaque question.
--
-- ============================================== CE QUE LA LOI DIT DE LA CARTE
--
-- Le référentiel porte déjà ceci, et c'est ce qui a décidé la forme de cette
-- migration :
--
--     RAS_HONORAIRES_REEL_CONDITION — « Condition d'application du taux 3 %
--     aux personnes physiques : présentation de la CARTE D'IDENTIFICATION
--     FISCALE régime réel » — Article 52-I-a
--
-- La carte d'identification fiscale n'est pas un formulaire administratif
-- parmi d'autres : c'est le document que le droit tunisien désigne comme la
-- preuve du régime. La fiche se lit donc sur elle, et chaque champ pourra
-- pointer la zone de la carte d'où il vient — comme un montant pointe sa
-- ligne sur une facture.
--
-- ================================================ DEUX TABLES, ET POURQUOI
--
-- `ref.regimes_fiscaux` — l'ÉNUMÉRATION. Quels régimes existent, dans quelle
-- juridiction, depuis quand. Elle est en base et non dans le code : R4. Un
-- régime est une catégorie de droit, pas une constante de programme, et la
-- Tunisie n'a pas les mêmes que la France.
--
-- Chaque valeur porte son fondement, et aucune n'a été inventée : chacune est
-- attestée par un paramètre fiscal déjà en base qui l'emploie.
--
-- `identity.fiches_fiscales` — LA FICHE. Ce que ce client-ci est, entre deux
-- dates. Un régime change : on n'écrase pas, on clôt et on ouvre. R7.
-- ============================================================================

create table if not exists ref.regimes_fiscaux (
  id           uuid primary key default gen_random_uuid(),
  jurisdiction text not null,
  -- Deux axes indépendants : on peut être au réel ET non assujetti à la TVA.
  axe          text not null,
  code         text not null,
  libelle      text not null,
  -- D'où vient cette catégorie. Jamais vide : une catégorie sans fondement
  -- est une catégorie inventée.
  fondement    text not null,
  valid_from   date not null,
  valid_to     date,
  constraint regimes_fiscaux_axe_check check (axe in ('imposition', 'tva')),
  constraint regimes_fiscaux_periode check (valid_to is null or valid_to > valid_from),
  constraint regimes_fiscaux_fondement_non_vide check (length(trim(fondement)) > 0),
  constraint regimes_fiscaux_unicite unique (jurisdiction, axe, code, valid_from)
);

alter table ref.regimes_fiscaux enable row level security;
alter table ref.regimes_fiscaux force row level security;
drop policy if exists regimes_fiscaux_sel on ref.regimes_fiscaux;
create policy regimes_fiscaux_sel on ref.regimes_fiscaux for select to authenticated using (true);
grant select on ref.regimes_fiscaux to authenticated;

-- Chaque ligne cite le paramètre fiscal déjà en base qui atteste la catégorie.
insert into ref.regimes_fiscaux (jurisdiction, axe, code, libelle, fondement, valid_from) values
  ('TN', 'imposition', 'reel',          'Régime réel',
   'Article 52-I-a — RAS_HONORAIRES_REEL : retenue applicable aux personnes au régime réel',
   date '1900-01-01'),
  ('TN', 'imposition', 'forfaitaire',   'Régime forfaitaire',
   'Article 44 ter — FORFAIT_BAREME : barème de l''impôt forfaitaire',
   date '1900-01-01'),
  ('TN', 'tva',        'assujetti',     'Assujetti à la TVA',
   'art. 6-II-2 CTVA — base_import_non_assujetti : distingue l''assujetti du non-assujetti',
   date '1900-01-01'),
  ('TN', 'tva',        'non_assujetti', 'Non assujetti à la TVA',
   'art. 6-II-2 CTVA — base_import_non_assujetti : majoration de base à l''importation',
   date '1900-01-01'),
  ('TN', 'tva',        'partiel',       'Assujetti partiel (prorata de déduction)',
   'art. 9-II-1 CTVA — prorata_formule : prorata de déduction des assujettis partiels',
   date '1900-01-01')
on conflict (jurisdiction, axe, code, valid_from) do nothing;

-- ------------------------------------------------------------------ la fiche
create table if not exists identity.fiches_fiscales (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references identity.organizations(id) on delete cascade,

  -- Ce que la fiche établit. Tout est NULLABLE : une fiche partielle vaut
  -- mieux qu'une fiche complétée par des suppositions, et Malica sait dire
  -- ce qu'elle ignore.
  regime_imposition text,
  regime_tva        text,
  -- Le prorata n'a de sens que pour un assujetti partiel ; la contrainte le dit.
  prorata_tva       numeric(5,2),
  secteur           text,
  debut_activite    date,
  -- La clôture de l'exercice, en jour et mois — « 12-31 » pour un exercice
  -- civil. L'année n'a pas de sens ici : c'est une règle qui se répète.
  cloture_exercice  text,

  -- D'où vient la fiche. `piece_id` porte la carte quand elle a été
  -- photographiée ; il reste nul quand un expert a saisi la fiche à la main.
  -- Dans les deux cas on sait qui l'a établie, et quand.
  source            text not null,
  piece_id          uuid references capture.pieces(id) on delete set null,

  -- Un régime change. On ne réécrit pas : on clôt et on rouvre.
  valid_from        date not null,
  valid_to          date,

  created_by        uuid not null default auth.uid(),
  created_at        timestamptz not null default now(),

  constraint fiches_source_check check (source in ('carte', 'saisie')),
  constraint fiches_periode check (valid_to is null or valid_to > valid_from),
  constraint fiches_prorata_si_partiel
    check (prorata_tva is null or regime_tva = 'partiel'),
  constraint fiches_prorata_borne
    check (prorata_tva is null or (prorata_tva >= 0 and prorata_tva <= 100)),
  -- « 12-31 », « 06-30 » : un jour et un mois, jamais une année.
  constraint fiches_cloture_forme
    check (cloture_exercice is null or cloture_exercice ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  -- Une seule fiche ouverte à la fois par dossier.
  constraint fiches_sans_chevauchement
    exclude using gist (tenant_id with =, daterange(valid_from, valid_to, '[)') with &&)
);

create index if not exists fiches_fiscales_courante_idx
  on identity.fiches_fiscales (tenant_id, valid_from desc);

/*
 * Le régime cité doit exister dans l'énumération, et à la bonne date.
 *
 * Ce n'est pas une clé étrangère : l'énumération est datée, et une fiche
 * ouverte en 2019 doit pouvoir citer un régime supprimé depuis. Une FK
 * refuserait cela ou empêcherait de retirer un régime. Le déclencheur, lui,
 * vérifie la cohérence AU MOMENT où la fiche est écrite.
 */
create or replace function identity.fiche_regime_connu() returns trigger
language plpgsql set search_path to '' as $$
declare
  v_jur text;
begin
  select o.jurisdiction into v_jur
    from identity.organizations o where o.id = new.tenant_id;

  if new.regime_imposition is not null and not exists (
    select 1 from ref.regimes_fiscaux r
     where r.jurisdiction = v_jur and r.axe = 'imposition'
       and r.code = new.regime_imposition
       and r.valid_from <= new.valid_from
       and (r.valid_to is null or r.valid_to > new.valid_from)
  ) then
    raise exception 'régime d''imposition inconnu pour % au % : %',
      v_jur, new.valid_from, new.regime_imposition using errcode = 'foreign_key_violation';
  end if;

  if new.regime_tva is not null and not exists (
    select 1 from ref.regimes_fiscaux r
     where r.jurisdiction = v_jur and r.axe = 'tva'
       and r.code = new.regime_tva
       and r.valid_from <= new.valid_from
       and (r.valid_to is null or r.valid_to > new.valid_from)
  ) then
    raise exception 'régime de TVA inconnu pour % au % : %',
      v_jur, new.valid_from, new.regime_tva using errcode = 'foreign_key_violation';
  end if;

  return new;
end $$;

drop trigger if exists fiches_regime_connu on identity.fiches_fiscales;
create trigger fiches_regime_connu
  before insert or update on identity.fiches_fiscales
  for each row execute function identity.fiche_regime_connu();

/*
 * R7 sur une fiche : on ne réécrit pas ce qu'elle établit.
 *
 * Seule la fermeture d'une période est permise — poser `valid_to` sur la fiche
 * courante pour en ouvrir une nouvelle. Changer un régime en place effacerait
 * le fait que le client était autre chose avant, et les écritures de l'époque
 * deviendraient inexplicables.
 */
create or replace function identity.fiche_seule_cloture() returns trigger
language plpgsql set search_path to '' as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.regime_imposition is distinct from old.regime_imposition
     or new.regime_tva is distinct from old.regime_tva
     or new.prorata_tva is distinct from old.prorata_tva
     or new.secteur is distinct from old.secteur
     or new.debut_activite is distinct from old.debut_activite
     or new.cloture_exercice is distinct from old.cloture_exercice
     or new.source is distinct from old.source
     or new.piece_id is distinct from old.piece_id
     or new.valid_from is distinct from old.valid_from
     or new.created_by is distinct from old.created_by then
    raise exception 'R7 : une fiche fiscale ne se réécrit pas — clôturez-la et ouvrez-en une nouvelle'
      using errcode = 'restrict_violation';
  end if;
  if old.valid_to is not null then
    raise exception 'R7 : cette fiche est déjà clôturée' using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

drop trigger if exists fiches_seule_cloture on identity.fiches_fiscales;
create trigger fiches_seule_cloture
  before update on identity.fiches_fiscales
  for each row execute function identity.fiche_seule_cloture();

alter table identity.fiches_fiscales enable row level security;
alter table identity.fiches_fiscales force row level security;

-- La fiche se lit et s'écrit par qui a accès au dossier — le dirigeant comme
-- le cabinet mandaté. C'est une donnée du dossier, pas une donnée personnelle.
drop policy if exists fiches_fiscales_sel on identity.fiches_fiscales;
create policy fiches_fiscales_sel on identity.fiches_fiscales for select to authenticated
  using (tenant_id in (select app.member_orgs()) or tenant_id in (select app.engaged_orgs()));

drop policy if exists fiches_fiscales_ins on identity.fiches_fiscales;
create policy fiches_fiscales_ins on identity.fiches_fiscales for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (tenant_id in (select app.member_orgs()) or tenant_id in (select app.engaged_orgs()))
  );

drop policy if exists fiches_fiscales_upd on identity.fiches_fiscales;
create policy fiches_fiscales_upd on identity.fiches_fiscales for update to authenticated
  using (tenant_id in (select app.member_orgs()) or tenant_id in (select app.engaged_orgs()))
  with check (tenant_id in (select app.member_orgs()) or tenant_id in (select app.engaged_orgs()));

grant select, insert, update on identity.fiches_fiscales to authenticated;
