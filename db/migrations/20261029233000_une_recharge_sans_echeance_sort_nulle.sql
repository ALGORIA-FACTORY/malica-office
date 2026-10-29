-- Une recharge sans échéance sort avec `expire_le` NUL (29 octobre 2026).
--
-- Le défaut : depuis le 20 octobre (`les_recharges_sont_sans_expiration`),
-- `recharge_inscrire` pose `expire_le = 'infinity'` quand le palier n'a plus
-- de validité. La valeur est juste DANS la base — elle se trie après toute
-- date et se compare sans cas particulier — mais elle sortait telle quelle :
-- `mesRecharges` et `recharge_acheter` rendaient « infinity », que ni JSON ni
-- un navigateur ne lisent comme une date. L'écran des réglages de la PME est
-- tombé en entier sur le staging (« Invalid time value »).
--
-- Le contrat : ce qui SORT de la vue dit « pas d'échéance » par NUL. La table
-- garde « infinity » (R7 : ses lignes ne se réécrivent pas, et la règle
-- d'expiration de la vue lit la colonne de la table, pas celle-ci). L'ordre
-- « la première qui expire » ne bouge pas : un NUL se range en dernier dans
-- un tri croissant, là où se rangeait « infinity ».
--
-- Seule la colonne `expire_le` change ; le reste est la définition en vigueur.
--
-- REJEU (R11) : `create or replace`.

begin;

create or replace view facturation.recharges_v with (security_invoker = true) as
 select r.id as recharge_id,
    r.licence_id,
    r.recharge_code,
    r.lectures,
    r.prix_ht,
    r.achetee_le,
    nullif(r.expire_le, 'infinity'::date) as expire_le,
    r.origine,
    (r.lectures - coalesce(u.n, 0::bigint))::integer as restantes,
    (not ech.expiree) and coalesce(o.recharges_permises, false) as utilisable,
    (not ech.expiree) and not coalesce(o.recharges_permises, false) as gelee,
    ech.expiree
   from facturation.recharges r
     left join lateral ( select count(*) as n
           from facturation.lectures l
          where l.recharge_id = r.id) u on true
     left join lateral ( select r.expire_le < current_date
                                and (ref.recharge_a(r.recharge_code, current_date)).validite_mois is not null
                                as expiree) ech on true
     left join facturation.forfait_courant_v h on h.licence_id = r.licence_id
     left join lateral ref.offre_a(h.offre_code, h.offre_depuis) o(id, code, libelle, prix_mensuel_ht, lectures_par_organisation, sieges_inclus, sieges_max, prix_siege_sup, lectures_par_siege_sup, organisations_incluses, organisations_max, prix_organisation_sup, effective_from, created_at, rang, recharges_permises) on true;

commit;
