-- Le Sudoku d'abord : une pièce prouvée par le moteur seul n'appelle aucun modèle.
--
-- ================================================================== LE PRINCIPE
--
-- 8 novembre 2026, le dirigeant : « J'ai fait le Sudoku pour minimiser au
-- maximum le GPU et l'IA. » Jusqu'ici, la désignation par modèle partait sur
-- CHAQUE pièce et le Sudoku vérifiait après. Désormais, le relevé passe d'abord
-- par le moteur seul ; si la pièce est prouvée pour TOUT ce que l'écriture
-- comptable exige, aucun modèle n'est appelé. Sinon seulement, la chaîne
-- Claude → DeepSeek → arrêt s'applique, et le Sudoku revérifie. Le banc dit
-- 175 pièces sur 261 prouvées par le moteur seul, sans un faux.
--
-- ================================================================== CE QUI EST POSÉ
--
-- 1. `ref.lecture_sans_ia` : ce que l'écriture exige, par pack, par grille et
--    par date d'effet (R4, R10 : un défaut livré, `defaut_a_valider`, changé
--    par migration). Une exigence, et le niveau qu'elle demande :
--
--      montants            toute l'arithmétique prouvée (HT, TVA par taux,
--                          droits dont le timbre, TTC) : `prouve`, rien d'autre ;
--      sens                achat ou vente, par le matricule du dossier : `prouve` ;
--      emetteur_matricule  le matricule de l'émetteur (anneau 2) : `prouve` ;
--      emetteur_nom        son nom : `conforme` (un fournisseur nouveau n'est
--                          jamais « prouvé » : il n'est dans aucun tiers) ;
--      numero, date        lus par leurs repères (anneau 3), le moteur les rend
--                          au mieux `conforme` : c'est le niveau livré.
--
--    Plusieurs lignes pour une même exigence : l'une suffit (la date de
--    l'opération, ou celle d'émission). Exigence absente du pack : la porte ne
--    s'ouvre jamais — on appelle la chaîne, comme avant.
-- 2. Le Sudoku a sa ligne de tarif (zéro, souverain) : sans elle, une pièce lue
--    sans IA ne se journaliserait pas, et le compteur de la tour (« pièces lues
--    sans IA ce mois ») ne compterait rien. Rôle propre : `sudoku`.
-- 3. `plateforme.designation_etat()` rend aussi ce compteur, et celui des
--    pièces désignées par un modèle, sur le mois civil.
--
-- REJEU (R11) : dates en littéral, `if not exists`, `on conflict do nothing`,
-- `create or replace`.

begin;

-- --- 1. Ce que l'écriture exige --------------------------------------------------------------------

create table if not exists ref.lecture_sans_ia (
  id               uuid primary key default gen_random_uuid(),
  pack_version_id  uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  grille_code      text not null,
  exigence         text not null check (exigence in ('montants', 'sens', 'emetteur_matricule',
                                                     'emetteur_nom', 'numero', 'date')),
  -- Le champ de la grille qui porte l'exigence ; nul pour les montants, le sens
  -- et l'émetteur, que le moteur prouve par ses preuves et son anneau 2.
  champ            text,
  statut_minimum   text not null check (statut_minimum in ('prouve', 'conforme')),
  fondement        text not null check (length(btrim(fondement)) > 0),
  statut           text not null check (statut in ('defaut_a_valider', 'arrete')),
  valid_from       date not null,
  valid_to         date check (valid_to is null or valid_to >= valid_from),
  check ((exigence in ('numero', 'date')) = (champ is not null)),
  check (exigence not in ('montants', 'sens', 'emetteur_matricule') or statut_minimum = 'prouve'),
  unique nulls not distinct (pack_version_id, grille_code, exigence, champ, valid_from)
);

comment on table ref.lecture_sans_ia is
  'Ce qu''une pièce doit avoir de PROUVÉ (ou de conforme) par le moteur Sudoku seul pour '
  'que sa lecture se fasse sans aucun modèle. Défaut livré par Malica (R10).';

alter table ref.lecture_sans_ia enable row level security;
alter table ref.lecture_sans_ia force row level security;
revoke all on table ref.lecture_sans_ia from public, anon;
grant select on table ref.lecture_sans_ia to authenticated;
drop policy if exists ref_lecture_sans_ia_sel on ref.lecture_sans_ia;
create policy ref_lecture_sans_ia_sel on ref.lecture_sans_ia
  for select to authenticated using (true);

insert into ref.lecture_sans_ia
  (pack_version_id, grille_code, exigence, champ, statut_minimum, fondement, statut, valid_from)
select p.id, 'facture', v.exigence, v.champ, v.minimum, v.fondement, 'defaut_a_valider',
       date '2026-01-01'
  from ref.jurisdiction_packs p
 cross join (values
   ('montants', null::text, 'prouve',
    'HT, TVA par taux, droits (timbre compris) et TTC : l''arithmétique de la pièce, fermée et unique.'),
   ('sens', null::text, 'prouve',
    'Achat ou vente : le matricule du dossier lu sur la pièce (anneau 2).'),
   ('emetteur_matricule', null::text, 'prouve',
    'Le matricule fiscal de l''émetteur, attribué par l''anneau 2 (Code TVA art. 18-II).'),
   ('emetteur_nom', null::text, 'conforme',
    'Le nom de l''émetteur : prouvé pour un tiers connu, conforme pour un fournisseur nouveau.'),
   ('numero', 'numero_facture', 'conforme',
    'Le numéro de facture lu derrière son repère (Code TVA art. 18-III) ; le moteur le rend au mieux conforme.'),
   ('date', 'date_operation', 'conforme',
    'La date de l''opération lue derrière son repère (Code TVA art. 18-II).'),
   ('date', 'date_emission', 'conforme',
    'À défaut, la date d''émission, en pratique confondue avec celle de l''opération.')
 ) as v(exigence, champ, minimum, fondement)
 where p.jurisdiction = 'TN'
   and exists (select 1 from ref.grilles g where g.pack_version_id = p.id and g.code = 'facture')
on conflict do nothing;

-- --- 2. Le Sudoku a son tarif ---------------------------------------------------------------------

alter table agents.model_pricing
  drop constraint if exists model_pricing_role_check;
alter table agents.model_pricing
  add constraint model_pricing_role_check
  check (role in ('reasoner', 'chat', 'vision', 'cache', 'cache_ecriture', 'embedding', 'recette',
                  'generateur', 'sudoku'));

insert into agents.model_pricing
  (provider, model, role, price_in_per_mtok, price_out_per_mtok, currency, sovereign, effective_from)
values ('interne', 'sudoku', 'sudoku', 0, 0, 'EUR', true, date '2026-11-01')
on conflict do nothing;

-- --- 3. Le compteur de la tour --------------------------------------------------------------------

create or replace function plateforme.designation_etat()
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
  return jsonb_build_object(
    'maillons', app.chaine_de_designation(),
    'modeles', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'fournisseur', m.provider, 'modele', m.model, 'role', m.role,
               'prix_entree', m.price_in_per_mtok, 'prix_sortie', m.price_out_per_mtok)
               order by m.provider, m.model, m.role), '[]'::jsonb)
        from (select distinct on (p.model, p.role) p.provider, p.model, p.role,
                     p.price_in_per_mtok, p.price_out_per_mtok
                from agents.model_pricing p
               where p.provider in ('anthropic', 'deepseek')
                 and p.role in ('chat', 'reasoner')
                 and p.effective_from <= current_date
                 and (p.effective_to is null or p.effective_to >= current_date)
               order by p.model, p.role, p.effective_from desc) m),
    -- Le mois civil : sans IA (le Sudoku a tout prouvé), et par un modèle.
    'mois', (
      select jsonb_build_object(
               'sans_ia', count(*) filter (where exists (
                 select 1 from agents.model_pricing x
                  where x.model = r.model and x.provider = 'interne' and x.role = 'sudoku')),
               'par_modele', count(*) filter (where r.status in ('ok', 'degraded') and exists (
                 select 1 from agents.model_pricing x
                  where x.model = r.model and x.provider in ('anthropic', 'deepseek'))))
        from agents.agent_runs r
       where r.agent = 'malica.lecture.designation'
         and r.created_at >= date_trunc('month', now())),
    'bascules', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'le', b.created_at, 'modele', b.model, 'statut', b.status,
               'motif', split_part(coalesce(b.error, ''), ':', 1))
               order by b.created_at desc), '[]'::jsonb)
        from (select r.created_at, r.model, r.status, r.error
                from agents.agent_runs r
               where r.agent = 'malica.lecture.designation'
                 and r.status in ('error', 'degraded')
                 and r.created_at >= now() - interval '30 days'
               order by r.created_at desc
               limit 30) b));
end
$function$;

commit;
