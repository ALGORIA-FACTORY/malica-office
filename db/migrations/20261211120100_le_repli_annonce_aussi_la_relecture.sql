-- Le chemin de secours de « Parler à Malica » annonce aussi la relecture.
--
-- `20261211120000` a donné le mode de relecture à l'assistant, qui le lit par
-- `public.assistant_configuration()` — réservée au serveur. L'ancienne
-- conversation (`askMalica` : la route `/malica/demander` et le repli quand la
-- boucle d'outils ne peut pas répondre) tourne sous les droits de la personne
-- et retenait encore. Elle lit désormais le même mode, par une fonction qui ne
-- rend que lui : la table reste lisible de la seule plateforme.
--
-- Sans ligne, la fonction rend « retenir » : le manque retombe du côté prudent.

begin;

create or replace function public.conseil_relecture()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (select l.mode from plateforme.assistant_relectures l
      order by l.decide_le desc, l.id desc limit 1),
    'retenir');
$function$;

comment on function public.conseil_relecture() is
  'Le mode de relecture en vigueur (« annoncer » ou « retenir »), et rien d''autre.';

revoke all on function public.conseil_relecture() from public, anon;
grant execute on function public.conseil_relecture() to authenticated;

commit;
