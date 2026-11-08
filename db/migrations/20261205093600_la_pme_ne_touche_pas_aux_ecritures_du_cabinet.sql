-- La PME ne touche pas aux écritures du cabinet, quel que soit son mode de validation.
--
-- ================================================================== POURQUOI
--
-- Vérification indépendante du 6 novembre 2026 (lot S5) : dans un dossier en
-- `validation_mode = 'autonome'` suivi par un cabinet ENGAGÉ, le dirigeant de la
-- PME a appelé `socle_ecriture_contre_passer` avec un vrai motif — et a défait
-- l'écriture que le cabinet avait inscrite. La garde était `app.peut_superviser`,
-- qui rendait vrai pour lui : `app.livres_tenus_par_le_cabinet` ne regardait les
-- livres comme tenus par le cabinet qu'en mode MANDAT. La même garde tient
-- `socle_ecriture_review` (valider ou retourner l'écriture du cabinet), et la même
-- fonction tient `socle_ecriture_book` (inscrire l'écriture d'une pièce).
--
-- La règle du produit est une : quand un cabinet est engagé sur un dossier, les
-- écritures sont son travail. La PME ne les voit pas, et ne les propose, n'inscrit,
-- ne revoit ni ne contre-passe jamais. Un dossier autonome SANS cabinet garde ses
-- droits : personne d'autre ne tient ses livres.
--
-- Le mode `autonome` avec un engagement actif n'est pas un état interdit : une PME
-- créée autonome accepte un jour un mandat (`mandat_repondre` ne touche pas au
-- mode). Le mode dit qui tient les livres QUAND aucun cabinet n'est engagé — il
-- revient à jouer le jour où le mandat prend fin. On ne le réécrit donc pas à
-- l'engagement : on cesse de le lire tant qu'un cabinet est engagé.
--
-- ================================================================== CE QUI CHANGE
--
--   1. `app.livres_tenus_par_le_cabinet` : un engagement actif suffit, le mode n'y
--      entre plus. Tout ce qui la lit suit d'un coup — `app.peut_superviser` (donc
--      `socle_ecriture_review`, `socle_ecriture_contre_passer`, les faits gardés
--      « superviseur » de `fait_consigner`, la saisie d'un cours de change),
--      `socle_ecriture_book` (l'écriture d'une pièce), `capture_precision_persist`
--      (le sens d'une pièce) et `identite.monCabinet` (« tient les livres »).
--   2. Un déclencheur sur `socle.ecritures` refuse qu'un membre du dossier qui ne
--      le supervise pas y INSÈRE une écriture qui n'est pas un règlement, pendant
--      qu'un cabinet tient les livres. Il ferme d'un coup toutes les portes qui
--      créent une écriture sans garde propre — `socle_ecriture_propose` (la
--      proposition d'une pièce), les dotations et dépréciations d'immobilisations,
--      la sortie d'un bien, l'inventaire et la dépréciation des stocks — et celles
--      qu'on écrira demain.
--
-- Ce qui reste à la PME : les gestes de règlement. `office.inscrireLeReglement`
-- propose et inscrit une écriture de nature `reglement`, et l'annulation d'un
-- paiement en propose la contre-passation (nature `reglement`, inscrite par
-- l'expert dans un dossier confié : `socle_ecriture_book` le garde déjà).
--
-- La clé levée, `refus.inscription.reservee_au_cabinet`, existe déjà en fr, en et
-- ar (`socle_ecriture_book`).
--
-- REJEU (R11) : aucune donnée de référence n'est écrite ; `create or replace`.

-- --- 1. Les livres d'un dossier engagé sont tenus par son cabinet ---------------------------------

create or replace function app.livres_tenus_par_le_cabinet(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from identity.engagements g
                  where g.pme_org_id = p_tenant and g.status = 'actif')
$$;

revoke all on function app.livres_tenus_par_le_cabinet(uuid) from public, anon;
grant execute on function app.livres_tenus_par_le_cabinet(uuid) to authenticated;

-- --- 2. Aucune écriture de la PME dans les livres que le cabinet tient ----------------------------
--
-- Le déclencheur ne décide que pour un MEMBRE du dossier : l'expert et le
-- collaborateur affecté le supervisent et passent ; un autre membre du cabinet
-- n'est pas membre du dossier, et la RLS d'insertion décide pour lui comme avant.
-- Une session sans personne (l'administration, une migration) n'a aucun dossier
-- dans `app.member_orgs()` : rien ne change pour elle.

create or replace function app.les_ecritures_du_cabinet_sont_a_lui()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.nature <> 'reglement'
     and app.livres_tenus_par_le_cabinet(new.tenant_id)
     and new.tenant_id in (select app.member_orgs())
     and not app.supervise_le_dossier(new.tenant_id) then
    raise exception 'refus.inscription.reservee_au_cabinet'
      using errcode = '42501', hint = 'inscription.cabinet';
  end if;
  return new;
end
$$;

revoke all on function app.les_ecritures_du_cabinet_sont_a_lui() from public, anon, authenticated;

drop trigger if exists ecritures_du_cabinet_sont_a_lui on socle.ecritures;
create trigger ecritures_du_cabinet_sont_a_lui
  before insert on socle.ecritures
  for each row execute function app.les_ecritures_du_cabinet_sont_a_lui();
