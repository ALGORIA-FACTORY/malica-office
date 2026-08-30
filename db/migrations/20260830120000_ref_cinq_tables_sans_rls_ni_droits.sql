-- Cinq tables du référentiel n'ont jamais reçu leur RLS ni leurs droits.
--
-- Ce n'est pas un défaut d'environnement : c'est un défaut de production. Deux
-- boucles `do $$` ont posé le même traitement sur dix tables de `ref` — RLS,
-- révocation, lecture accordée aux authentifiés, politique de sélection. Cinq
-- tables sont passées au travers :
--
--     stock_categories, fiscal_charges, charge_familles,
--     charge_famille_rules, anomaly_thresholds
--
-- Les vues publiques correspondantes existent et sont lisibles, mais elles sont
-- en `security_invoker` : le droit posé sur la vue ne remplace pas celui de la
-- table. Toute lecture s'arrête donc sur un 42501, partout, pour tout le monde.
-- Les écrans stocks et charges ne peuvent pas fonctionner, et n'ont jamais pu.
--
-- Le motif ci-dessous est celui des boucles existantes, repris à l'identique —
-- y compris la révocation de `service_role`, qui n'a de lecture sur aucune des
-- dix tables déjà traitées.
--
-- Trouvé en exécutant chaque lecture des dépôts portés contre le schéma réel
-- (`apps/api/src/depots.test.ts`).

do $$
declare
  t text;
begin
  foreach t in array array[
    'stock_categories', 'fiscal_charges', 'charge_familles',
    'charge_famille_rules', 'anomaly_thresholds'
  ] loop
    execute format('alter table ref.%I enable row level security', t);
    execute format('alter table ref.%I force row level security', t);
    execute format('revoke all on table ref.%I from public, anon, service_role', t);
    execute format('grant select on table ref.%I to authenticated', t);
    execute format(
      'create policy %I on ref.%I for select to authenticated using (true)',
      'ref_' || t || '_sel', t);
  end loop;
end $$;
