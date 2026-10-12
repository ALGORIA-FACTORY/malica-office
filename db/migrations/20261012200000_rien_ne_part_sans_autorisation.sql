-- Rien ne part sans autorisation — dans aucun des deux sens.
--
-- ================================================================= POURQUOI
--
-- 11 octobre 2026 : « jamais de transfert vers espace privé ou cabinet sans
-- autorisation, ou de l'espace privé vers cabinet ».
--
-- La règle était tenue pour la PIÈCE et pas pour ce qui lui est attaché.
-- Relevé en comparant les politiques de lecture, le soir même :
--
--   pieces    → member_orgs OR (vis = 'partage' AND engaged_orgs)
--   paiements → member_orgs OR engaged_orgs
--
-- Le cabinet lisait donc les paiements de TOUTES les pièces d'un dossier sous
-- mandat, celles que le dirigeant avait décidé de garder comprises : le moyen,
-- le montant, la date, et l'existence d'un justificatif. Une facture gardée au
-- coffre disait au cabinet « payée 613,493 par chèque le 9 octobre ».
--
-- Ce n'est pas une fuite de ce qui a été construit aujourd'hui : c'est
-- l'appel au helper qui porte le drapeau de visibilité à `false`, et donc la
-- forme LARGE de la politique. Les deux tables de paiement sont nées comme ça,
-- et aucun écran ne les lisait — jusqu'à cet après-midi.
--
-- ======================== POURQUOI LA VISIBILITÉ SE DÉDUIT DE LA PIÈCE
--
-- `capture.paiements` porte une colonne `vis`, recopiée de la pièce À
-- L'INSERTION. Elle ne peut pas servir : la table est en ajout seul (R7), donc
-- cette copie ne se met jamais à jour. Une pièce gardée puis transmise aurait
-- laissé ses paiements invisibles au cabinet pour toujours — l'erreur inverse,
-- et aussi fausse, parce que le moyen de paiement décide du compte de
-- trésorerie.
--
-- La politique interroge donc la PIÈCE, seule vérité sur sa visibilité. Un
-- seul endroit décide, et il se met à jour tout seul.
--
-- ============================================= CE QUI NE CHANGE PAS
--
-- Le dirigeant et les membres de son dossier voient tout, comme avant. La
-- règle protège du cabinet, pas du dossier de lui-même.

-- --- Les paiements ------------------------------------------------------------------------

drop policy if exists capture_paiements_sel on capture.paiements;

create policy capture_paiements_sel on capture.paiements
  for select to authenticated
  using (
    tenant_id in (select app.member_orgs())
    or (
      tenant_id in (select app.engaged_orgs())
      and exists (
        select 1 from capture.pieces p
         where p.id = piece_id
           and p.vis = 'partage'::app.vis_t
      )
    )
    or (select app.is_platform())
  );

comment on column capture.paiements.vis is
  'Recopie de la visibilité de la pièce à l''insertion, conservée pour '
  'l''historique. Elle ne décide de RIEN : la table est en ajout seul, donc '
  'cette copie ne se met jamais à jour, et une pièce gardée puis transmise '
  'garderait des paiements invisibles au cabinet. La politique de lecture '
  'interroge la pièce, qui est la seule vérité sur sa visibilité.';

-- --- Les justificatifs rattachés ----------------------------------------------------------
--
-- Même raison, un saut de plus : le justificatif pend au paiement, qui pend à
-- la pièce. Sans ce filtre, l'existence d'une preuve et son identifiant de
-- pièce sortaient du coffre — et l'identifiant suffit à demander les octets.

drop policy if exists capture_paiement_justificatifs_sel on capture.paiement_justificatifs;

create policy capture_paiement_justificatifs_sel on capture.paiement_justificatifs
  for select to authenticated
  using (
    tenant_id in (select app.member_orgs())
    or (
      tenant_id in (select app.engaged_orgs())
      and exists (
        select 1
          from capture.paiements pa
          join capture.pieces p on p.id = pa.piece_id
         where pa.id = paiement_id
           and p.vis = 'partage'::app.vis_t
      )
    )
    or (select app.is_platform())
  );

-- R6 : la politique mène par `piece_id`, et l'index existe déjà
-- (`paiements_tenant_piece_idx`). Celui du justificatif mène par `paiement_id`
-- (`paiement_justificatifs_tenant_paiement_idx`). Sans eux, chaque lecture du
-- cabinet parcourrait les deux tables entières, tous dossiers confondus.
