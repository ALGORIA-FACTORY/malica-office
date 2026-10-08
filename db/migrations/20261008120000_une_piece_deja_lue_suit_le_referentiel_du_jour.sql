-- Une pièce déjà lue suit le référentiel du jour, pas celui de sa lecture.
--
-- ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
--
-- 8 octobre 2026. Le référentiel des natures de charge a été corrigé la veille
-- (`20261007120000`, `20261007140000`) : vingt et une familles, vingt-six
-- règles de libellé. Déployé. Vérifié sur le staging : « Cable souple 3*2.5
-- extra cable » donne bien FOURNITURES.
--
-- Et le commanditaire signale : « toujours la facture de casa elect sans
-- catégorie ».
--
-- Il a raison. `capture_articles_persist` résout la famille UNE SEULE FOIS, au
-- moment de la projection, et l'écrit dans la ligne. La vue
-- `piece_articles_v` — par laquelle passent TOUS les écrans — relit cette
-- colonne. Une pièce projetée avant la correction garde donc NON_CLASSE pour
-- toujours : aucune migration ne la rattrape, et aucun écran ne propose de la
-- relire.
--
-- ===================================================== CE QUE CELA VIOLAIT
--
-- R10, point 3, mot pour mot : « Un défaut se change sans migration. Si
-- l'expert doit attendre un déploiement pour corriger une imputation, ce n'est
-- pas un paramétrage : c'est une constante avec un délai. »
--
-- Ici c'était pire qu'un délai. Même APRÈS le déploiement, les pièces déjà
-- lues ne bougeaient jamais. Un cabinet qui corrige une imputation la verrait
-- s'appliquer aux pièces futures et à aucune pièce passée — donc deux moitiés
-- de comptabilité rangées selon deux référentiels, sans que rien ne le dise.
--
-- ======================================================== LE RENVERSEMENT
--
-- La famille d'une charge n'est PAS une valeur liante : ni un montant, ni une
-- écriture, ni un compte. C'est un rangement proposé par le pack, daté et
-- surchargeable. Une telle valeur se résout à la LECTURE, contre le
-- référentiel en vigueur, et non à l'écriture.
--
-- La vue résout donc la famille au moment où on la regarde, à partir de ce que
-- la ligne porte déjà : son pack, son libellé, sa date, et le compte
-- d'imputation que le SENS CONFIRMÉ de la pièce désigne. Conséquence utile :
-- le jour où la personne déclare « achat » au lieu de « vente », le classement
-- suit sans relecture ni appel de modèle.
--
-- ======================================================== R7 N'EST PAS AFFAIBLI
--
-- Rien n'est réécrit. `capture.piece_articles` continue d'inscrire ce que la
-- projection a proposé le jour de la lecture, et la vue l'expose sous
-- `famille_code_projete` / `famille_source_projete`. On doit pouvoir répondre à
-- « pourquoi cette pièce était-elle rangée là en octobre » — c'est la même
-- raison pour laquelle la règle « syndic → LOYER » a été CLOSE et non effacée.
--
-- ===================================================================== R11
--
-- Aucune donnée de référence n'est écrite ici : une vue, et elle seule. Aucune
-- date du jour n'apparaît dans cette migration ; la date de résolution est
-- celle de la pièce (`document_date`), à défaut celle de sa réception
-- (`pieces.created_at`), exactement comme `capture_articles_persist` la
-- calcule depuis `20261005140000`.
--
-- ===================================================================== R6
--
-- `security_invoker = true` est conservé : la vue ne voit que ce que la
-- personne voit. Les deux jointures ajoutées portent sur `capture.pieces`
-- (RLS de tenant, même tenant que la ligne) et sur `ref_account_mappings_v`
-- (référentiel, lisible par tout compte authentifié). Elles sont en LEFT JOIN :
-- une pièce invisible ou un pack absent donnent un compte nul — les règles de
-- libellé, qui passent de toute façon avant celles de compte, s'appliquent
-- encore, et la famille inscrite reste le dernier recours.

drop view if exists public.piece_articles_v;

create view public.piece_articles_v
  with (security_invoker = true) as
  select a.id,
         a.tenant_id,
         a.piece_id,
         a.ordinal,
         a.designation,
         a.quantity,
         a.unit_price_ht,
         a.unit_price_ttc,
         a.total_ht,
         -- Résolue maintenant. La famille inscrite ne sert que si le pack de la
         -- ligne est inconnu : alors il n'y a rien contre quoi résoudre.
         coalesce(r.famille_code, a.famille_code)     as famille_code,
         coalesce(r.famille_source, a.famille_source) as famille_source,
         -- Ce que la projection avait proposé, le jour de la lecture.
         a.famille_code   as famille_code_projete,
         a.famille_source as famille_source_projete,
         a.period,
         a.document_date,
         a.citation_field,
         a.citation_quantity,
         a.citation_unit_price_ht,
         a.citation_unit_price_ttc,
         a.citation_total_ht,
         a.pack_version_id,
         a.vis,
         a.created_at
    from capture.piece_articles a
    left join capture.pieces p
           on p.id = a.piece_id
    -- UNE seule imputation, et choisie par un ordre TOTAL.
    --
    -- `ref.account_mappings` porte une ligne par code de taxe : cinq pour
    -- `facture_achat`, cinq pour `facture_vente`. Leur `main_account` est le
    -- même (601 pour tout achat, 701 pour toute vente) — le code de taxe
    -- change le compte de TVA, pas celui de la charge. Une jointure simple
    -- multipliait donc chaque article par cinq.
    --
    -- `order by … limit 1` plutôt que `distinct` : si un pack futur
    -- distinguait l'imputation par code de taxe, deux bases doivent encore
    -- choisir la MÊME (R11). C'est la leçon du classement non déterministe du
    -- 7 octobre.
    left join lateral (
      select mm.main_account
        from public.ref_account_mappings_v mm
       where mm.pack_version_id = a.pack_version_id
         and mm.document_kind = p.document_kind
       order by mm.main_account
       limit 1
    ) m on true
    left join lateral public.charge_famille_resolve(
                a.pack_version_id,
                m.main_account,
                a.designation,
                coalesce(a.document_date, p.created_at::date)) r on true;

revoke all on table public.piece_articles_v from public, anon, service_role;
grant select on table public.piece_articles_v to authenticated;

comment on view public.piece_articles_v is
  'Les articles projetés, avec leur famille de charge RÉSOLUE AU JOUR DE LA '
  'LECTURE contre le pack de la ligne — pas celle figée à la projection. '
  'La famille est un défaut livré, surchargeable (R10) : la figer revenait à '
  'la rendre incorrigeable pour les pièces déjà lues. Ce que la projection '
  'avait proposé reste exposé par famille_code_projete (R7).';

comment on column capture.piece_articles.famille_code is
  'La famille proposée LE JOUR DE LA PROJECTION. Trace historique : elle '
  'explique un classement ancien. Ce que les écrans affichent est la '
  'résolution du jour, faite par public.piece_articles_v.';
