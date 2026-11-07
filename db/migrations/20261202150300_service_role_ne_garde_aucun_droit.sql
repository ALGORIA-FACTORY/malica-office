-- `service_role`, qui contourne la RLS et n'a aucun membre, ne garde aucun droit.
--
-- ================================================================== POURQUOI
--
-- Audit du 6 novembre 2026 (docs/audit-2026-11-06/base.md, § 3.6, M6) :
-- `service_role` est le rôle de compatibilité Supabase
-- (db/local/00_compat_supabase.sql) — `nologin noinherit bypassrls`, aucun
-- membre (`pg_auth_members` : 0). La production est un PostgreSQL auto-hébergé
-- (infra/compose.yml) : personne ne l'endosse. Il portait pourtant encore :
--
--   - ALL sur `agents.model_pricing` (20260825235433) ;
--   - SELECT sur `public.ref_account_classes_v` et `public.ref_account_mappings_v`
--     (20261012240000) ;
--   - EXECUTE sur `public.capture_articles_persist`,
--     `public.charge_famille_resolve`, `public.charge_question_answer`
--     (20260826141710, 20261012160000, 20261012220000, 20261012230000).
--
-- Personne ne les exerce aujourd'hui ; le jour où un rôle de connexion
-- deviendrait membre de `service_role`, il lirait et écrirait sans politique.
-- On révoque les droits ; le rôle reste (le fichier de compatibilité le crée et
-- lui donne l'usage des schémas `auth`, `storage`, `extensions` à chaque
-- montée — un usage de schéma n'ouvre aucune ligne).
--
-- `malica_exploitation` (nologin, 0 membre dans le dépôt) n'est PAS touché :
-- un rôle de connexion d'exploitation en est peut-être membre en production
-- (INCERTAIN, § 3.6).
--
-- _Gardé par_ apps/api/src/schema.test.ts, « aucun rôle qui contourne la RLS
-- ne porte de droit sur une relation ou une fonction ».

revoke all on table agents.model_pricing from service_role;
revoke all on table public.ref_account_classes_v, public.ref_account_mappings_v from service_role;
revoke all on function
  public.capture_articles_persist(uuid, uuid, date, text, jsonb),
  public.charge_famille_resolve(uuid, text, text, date),
  public.charge_question_answer(uuid, text, text, numeric, numeric, numeric, text, uuid, text)
  from service_role;

-- ================================================================== RETOUR
--
-- La migration de retour, à jouer telle quelle (sans les « -- » de tête) :
--
-- grant all on table agents.model_pricing to service_role;
-- grant select on table public.ref_account_classes_v, public.ref_account_mappings_v to service_role;
-- grant execute on function
--   public.capture_articles_persist(uuid, uuid, date, text, jsonb),
--   public.charge_famille_resolve(uuid, text, text, date),
--   public.charge_question_answer(uuid, text, text, numeric, numeric, numeric, text, uuid, text)
--   to service_role;
-- delete from app.migrations where nom = '20261202150300_service_role_ne_garde_aucun_droit.sql';
