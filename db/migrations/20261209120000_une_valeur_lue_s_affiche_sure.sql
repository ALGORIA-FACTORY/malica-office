-- Une valeur lue sans faute au banc s'affiche comme sûre, marquée « lu, non prouvé par calcul ».
--
-- ================================================================== LA DÉCISION
--
-- 8 novembre 2026, décision du dirigeant, prise en connaissance du risque : les valeurs
-- que le moteur rend « à vérifier » (`signale`) parce que la pièce n'est pas prouvée, et
-- que le banc n'a jamais vues fausses, s'affichent comme sûres. Jamais un montant.
--
-- ================================================================== CE QUI EST POSÉ
--
-- 1. `plateforme.lecture_valeurs_sures` : un réglage PAR CHAMP de la grille (son code),
--    en ajout seul ; la dernière décision d'un champ vaut. Un champ que la base sait
--    calculé (montant, taux, nombre, ou le montant en lettres d'une preuve `lettres`) est
--    refusé — par la porte de la tour ET par le déclencheur de la table.
-- 2. `app.champs_affiches_surs()` : les codes en vigueur, lus avec le contexte du moteur
--    (`lireLeContexteDuSudoku`). L'adaptateur du moteur passe ces champs de `signale` à
--    `lu` (`afficherLesValeursSures`, sudoku.ts) ; le moteur n'en sait rien.
-- 3. `capture.champs_lus.statut` admet `lu`. Une valeur `lu` n'a pas le rang d'une valeur
--    prouvée : aucune exigence de l'écriture (`ref.lecture_sans_ia`) ne s'en contente.
-- 4. La tour règle et voit : `plateforme.valeurs_sures_regler`, `plateforme.valeurs_sures_etat`.
--
-- ================================================================== LE DÉFAUT LIVRÉ (R10)
--
-- Mesuré sur les quatre bancs du 8 novembre 2026 (référence PaddleOCR v5, PP-OCRv6 small,
-- OCR frais du staging, Qwen), caches seulement — pistes signalées justes / fausses :
--
--   champ                              référence   v6 small   staging   Qwen
--   telephone_email_emetteur             13 / 0     12 / 0        —     7 / 0
--   code_tva_categorie_etablissement      7 / 0      6 / 0        —    30 / 0
--   rib_emetteur                          6 / 0      6 / 0        —    27 / 0
--   type_document                            —          —         —    61 / 0
--   devise                                   —          —         —    40 / 0
--   mode_reglement                           —          —         —    17 / 0
--
-- EXCLUS du défaut, parce qu'au moins un banc en montre une fausse : la date d'émission et
-- la date d'opération (Qwen : 9 fausses chacune — « 2059-06-02 », « 0606-05-27 »,
-- « 2026-10-19 » pour le 17), le matricule de l'émetteur et du client, le numéro de
-- facture, la raison sociale, le nom du client, le registre de commerce, l'adresse de
-- l'émetteur. Exclus aussi, faute de mesure suffisante (moins de 5 pistes, et un champ de
-- la même famille fautif) : les autres dates, l'adresse du client, les autres identifiants.
-- La tour les ajoute si elle le décide.
--
-- REJEU (R11) : dates en littéral, `if not exists`, `create or replace`, semences gardées.

begin;

-- --- 1. Le réglage, champ par champ ----------------------------------------------------------------

create table if not exists plateforme.lecture_valeurs_sures (
  id          uuid primary key default gen_random_uuid(),
  champ       text not null check (length(btrim(champ)) > 0),
  sure        boolean not null,
  motif       text not null check (length(btrim(motif)) > 0),
  decide_par  uuid,
  decide_le   timestamptz not null default now()
);

comment on table plateforme.lecture_valeurs_sures is
  'Les champs de la grille dont une valeur lue SANS preuve (signalée) s''affiche comme sûre, '
  'marquée « lu, non prouvé par calcul » (décision du dirigeant du 8 novembre 2026). Par '
  'champ, la dernière décision vaut ; rien ne se réécrit. Jamais un montant.';

create index if not exists lecture_valeurs_sures_champ_idx
  on plateforme.lecture_valeurs_sures (champ, decide_le desc);

alter table plateforme.lecture_valeurs_sures enable row level security;
revoke all on table plateforme.lecture_valeurs_sures from public, anon;
grant select on table plateforme.lecture_valeurs_sures to authenticated;

drop policy if exists lecture_valeurs_sures_lire on plateforme.lecture_valeurs_sures;
create policy lecture_valeurs_sures_lire on plateforme.lecture_valeurs_sures
  for select to authenticated using ((select app.is_platform()));

drop trigger if exists lecture_valeurs_sures_ne_se_reecrivent_pas on plateforme.lecture_valeurs_sures;
create trigger lecture_valeurs_sures_ne_se_reecrivent_pas
  before update or delete on plateforme.lecture_valeurs_sures
  for each row execute function app.deny_mutation();

-- Un champ que la base sait calculé ne s'affirme jamais sans le calcul : un montant, un
-- taux, un nombre, ou le montant en lettres qu'une preuve `lettres` compare au total.
create or replace function app.champ_calcule(p_champ text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from ref.grille_champs c
                  where c.code = p_champ and c.type in ('montant', 'taux', 'nombre'))
      or exists (select 1 from ref.grille_preuves p
                  where p.expression ->> 'op' = 'lettres' and p.expression ->> 'champ' = p_champ)
$$;

revoke all on function app.champ_calcule(text) from public, anon, authenticated;

create or replace function app.lecture_valeurs_sures_gardees()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sure and app.champ_calcule(new.champ) then
    raise exception 'refus.valeurs_sures.champ_calcule' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from ref.grille_champs c where c.code = new.champ) then
    raise exception 'refus.valeurs_sures.champ_inconnu' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists lecture_valeurs_sures_jamais_un_montant on plateforme.lecture_valeurs_sures;
create trigger lecture_valeurs_sures_jamais_un_montant
  before insert on plateforme.lecture_valeurs_sures
  for each row execute function app.lecture_valeurs_sures_gardees();

insert into plateforme.lecture_valeurs_sures (champ, sure, motif, decide_le)
select v.champ, true,
       'Défaut livré (décision du dirigeant du 8 novembre 2026) : aucune piste fausse sur les quatre bancs (référence, v6 small, staging, Qwen). À régler par la tour.',
       timestamptz '2026-11-08 12:00:00+00'
  from (values ('telephone_email_emetteur'), ('code_tva_categorie_etablissement'),
               ('rib_emetteur'), ('type_document'), ('devise'), ('mode_reglement')) v(champ)
 where not exists (select 1 from plateforme.lecture_valeurs_sures s where s.champ = v.champ);

-- --- 2. Ce que le moteur lit ---------------------------------------------------------------------

create or replace function app.champs_affiches_surs()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(e.champ order by e.champ), '{}')
    from (select distinct on (s.champ) s.champ, s.sure
            from plateforme.lecture_valeurs_sures s
           order by s.champ, s.decide_le desc, s.id desc) e
   where e.sure
$$;

revoke all on function app.champs_affiches_surs() from public, anon;
grant execute on function app.champs_affiches_surs() to authenticated;

comment on function app.champs_affiches_surs() is
  'Les champs dont une valeur signalée s''affiche comme sûre (« lu, non prouvé par calcul »), '
  'tels que la tour les a réglés. Lu avec le contexte du moteur.';

-- --- 3. Le statut « lu » ------------------------------------------------------------------------

alter table capture.champs_lus drop constraint if exists champs_lus_statut_check;
alter table capture.champs_lus add constraint champs_lus_statut_check
  check (statut in ('prouve', 'conforme', 'signale', 'lu', 'absent', 'deduit', 'coupe'));

comment on column capture.champs_lus.statut is
  'prouve, conforme, signale (à vérifier), lu (lu sans preuve, affiché sûr par réglage de la '
  'tour : « lu, non prouvé par calcul »), absent, deduit, coupe.';

-- --- 4. La tour règle, et voit ------------------------------------------------------------------

create or replace function plateforme.valeurs_sures_regler(p_champ text, p_sure boolean, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_sure is null or coalesce(btrim(p_champ), '') = '' or coalesce(btrim(p_motif), '') = '' then
    raise exception 'refus.valeurs_sures.saisie' using errcode = 'check_violation';
  end if;
  insert into plateforme.lecture_valeurs_sures (champ, sure, motif, decide_par)
  values (btrim(p_champ), p_sure, btrim(p_motif), auth.uid())
  returning id into v_id;
  return (select to_jsonb(s) - 'decide_par' from plateforme.lecture_valeurs_sures s where s.id = v_id);
end
$function$;

revoke all on function plateforme.valeurs_sures_regler(text, boolean, text) from public, anon;
grant execute on function plateforme.valeurs_sures_regler(text, boolean, text) to authenticated;

-- Ce que la tour voit : chaque champ que la grille connaît et qu'on PEUT afficher sûr (ni
-- montant, ni taux, ni nombre, ni montant en lettres), son état, sa dernière décision.
create or replace function plateforme.valeurs_sures_etat()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'champ', c.code, 'type', c.type,
             'sure', coalesce(d.sure, false), 'motif', d.motif, 'decide_le', d.decide_le)
             order by coalesce(d.sure, false) desc, c.code)
      from (select distinct on (g.code) g.code, g.type
              from ref.grille_champs g
             where g.type not in ('montant', 'taux', 'nombre', 'booleen')
               and not app.champ_calcule(g.code)
             order by g.code, g.type) c
      left join lateral (
        select s.sure, s.motif, s.decide_le from plateforme.lecture_valeurs_sures s
         where s.champ = c.code order by s.decide_le desc, s.id desc limit 1) d on true),
    '[]'::jsonb);
end
$function$;

revoke all on function plateforme.valeurs_sures_etat() from public, anon;
grant execute on function plateforme.valeurs_sures_etat() to authenticated;

insert into observabilite.gestes (depot, methode, etape, geste, objet_type, objet_chemin, dossier_chemin)
values ('tour', 'reglerValeursSures', 'reglage', 'plateforme.valeurs_sures_regler', 'plateforme', null, null)
on conflict do nothing;

commit;
