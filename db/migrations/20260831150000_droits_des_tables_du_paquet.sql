-- Les neuf tables du paquet, sous le même régime que leurs quatorze sœurs.
--
-- Le paquet de la base de connaissance crée ses tables sans les accorder : les
-- rôles, les liaisons, les schémas d'écriture, les contrôles, les paramètres
-- fiscaux, les barèmes, les obligations et les journaux étaient invisibles à
-- `authenticated`. Le dépôt `parametrage` l'a montré à la première lecture —
-- « droit refusé pour la table account_roles ».
--
-- C'est exactement le défaut trouvé mardi sur cinq tables de `ref` : la vue
-- publique existe, la table de base n'accorde rien, et les vues étant en
-- `security_invoker`, la lecture s'arrête sur un 42501. On applique le motif
-- déjà établi, sans en inventer un second.
--
-- Ce sont des données de référence, sans tenant : la politique est « tout
-- authentifié lit », et l'écriture reste au chemin de migration.

do $$
declare
  t text;
begin
  foreach t in array array[
    'account_roles', 'role_bindings', 'entry_templates', 'entry_template_lines',
    'entry_controls', 'fiscal_parameters', 'fiscal_scale_brackets',
    'fiscal_obligations', 'journals'
  ] loop
    execute format('alter table ref.%I enable row level security', t);
    execute format('alter table ref.%I force row level security', t);
    execute format('revoke all on table ref.%I from public, anon, service_role', t);
    execute format('grant select on table ref.%I to authenticated', t);
    if not exists (
      select 1 from pg_policies
       where schemaname = 'ref' and tablename = t and policyname = 'ref_' || t || '_sel'
    ) then
      execute format(
        'create policy %I on ref.%I for select to authenticated using (true)',
        'ref_' || t || '_sel', t);
    end if;
  end loop;
end $$;

-- Le corpus juridique suit la même règle : il est public par nature — un texte
-- de loi n'appartient à personne — mais il ne s'écrit que par l'ingestion.
do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'legal' loop
    execute format('alter table legal.%I enable row level security', t);
    execute format('alter table legal.%I force row level security', t);
    execute format('revoke all on table legal.%I from public, anon, service_role', t);
    execute format('grant select on table legal.%I to authenticated', t);
    if not exists (
      select 1 from pg_policies
       where schemaname = 'legal' and tablename = t and policyname = 'legal_' || t || '_sel'
    ) then
      execute format(
        'create policy %I on legal.%I for select to authenticated using (true)',
        'legal_' || t || '_sel', t);
    end if;
  end loop;
end $$;

grant usage on schema legal to authenticated;
revoke all on schema legal from public, anon;
