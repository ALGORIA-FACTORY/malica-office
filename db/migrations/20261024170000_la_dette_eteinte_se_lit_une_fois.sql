-- La dette qu'un paiement éteint se lit à un seul endroit.
--
-- Relecture de la demande n°87 (24 octobre 2026) : la même somme — les débits
-- des écritures de règlement encore VIVANTES d'un paiement — était écrite deux
-- fois, dans `capture.paiementsDUnePiece` (ce que l'écran affiche) et dans la
-- proposition de règlement (ce qui borne le cumul au TTC). Deux copies d'une
-- définition comptable finissent par diverger, et c'est alors l'écran qui dit
-- « payé » quand la proposition refuse, ou l'inverse.
--
-- Une fonction SQL plutôt qu'une fonction TypeScript : les deux lecteurs la
-- calculent DANS leur requête, ligne à ligne ; une fonction TypeScript aurait
-- demandé une requête de plus par paiement, ou un fragment SQL partagé en
-- chaîne, qui n'est pas une définition.
--
-- `security invoker` (le défaut, écrit pour qu'on le lise) : chacun ne somme
-- que les écritures que la RLS lui montre, par les mêmes vues qu'avant.
-- `app.ecriture_vivante` reste la seule définition d'une écriture vivante.
--
-- R11 : aucune donnée de référence n'est écrite. REJEU : `create or replace`.

begin;

create or replace function app.dette_eteinte(p_paiement uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select sum(l.debit)
    from public.ecritures_v e
    join public.ecriture_lignes_v l on l.ecriture_id = e.id
   where e.paiement_id = p_paiement
     and e.nature = 'reglement'
     and app.ecriture_vivante(e.id)
$$;

comment on function app.dette_eteinte(uuid) is
  'La dette qu''un paiement éteint : somme des débits de ses écritures de règlement vivantes, en unités de la devise (null s''il n''en a aucune).';

revoke all on function app.dette_eteinte(uuid) from public, anon;
grant execute on function app.dette_eteinte(uuid) to authenticated;

commit;
