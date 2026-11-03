-- Chaque parcours se suit : l'appareil, les gestes métier, les travaux différés.
--
-- ================================================================== POURQUOI
--
-- Le socle du 18 novembre (20261118130000) trace HTTP et RPC. Trois trous
-- restaient, et chacun empêchait de répondre à « qu'est-il arrivé à cette
-- pièce » :
--
--   1. L'APPAREIL. La capture, l'attente hors ligne et la synchronisation se
--      passent avant tout appel : l'API ne les voyait pas. Et « ce que l'écran
--      a montré » n'existait que dans la mémoire du téléphone.
--   2. LE GESTE. Une étape `rpc` dit `office.forcer` ; elle ne dit ni la pièce,
--      ni l'objet, ni que c'est un forçage. Un nom de méthode n'est pas une
--      preuve métier.
--   3. LA TRACE PARTAGÉE. Un client qui reprenait l'identifiant de trace d'un
--      autre y ajoutait ses étapes.
--
-- ================================================================== CE QUI EST POSÉ
--
-- 1. Le vocabulaire : les étapes `retour`, `correction`, `forcage`, `import`,
--    `envoi` ; les clés que chaque étape métier, client et différée peut
--    porter ; et, par étape, si l'APPAREIL a le droit de l'émettre
--    (`emise_par_l_appareil`).
-- 2. `observabilite.gestes` : la table de référence qui dit, pour chaque
--    méthode RPC sensible, l'étape métier qu'elle est, le geste, le type de
--    l'objet et où l'appel le nomme. L'API la lit par `gestes_connus()` ;
--    aucune liste n'est écrite dans le code.
-- 3. L'audit note aussi, dans la transaction, l'OBJET de chaque ligne écrite
--    (dossier, table, identifiant, action) : le geste réussi cite ce que
--    l'audit porte, sans le recopier ni le relire.
-- 4. `capture_piece_register` n'audite plus un RENVOI : la même clé rend la
--    même pièce, et une seule ligne `piece.captured`.
-- 5. `consigner` n'ajoute plus rien à la trace d'un AUTRE acteur : l'étape
--    d'un acteur qui n'est pas celui de la trace (ou pas admis dans son
--    dossier) part sous une trace qui lui est propre, dérivée et stable.
--
-- REJEU (R11) : rien n'est daté ; les tables du schéma ne sont pas `ref`.

begin;

-- --- 1. Le vocabulaire --------------------------------------------------------------------------

alter table observabilite.etapes
  add column emise_par_l_appareil boolean not null default false;

insert into observabilite.etapes (code, cles_autorisees, description) values
  ('retour',     '{}', 'Un retour du cabinet, une demande, ou le renvoi de la PME.'),
  ('correction', '{}', 'Une correction : date, type, rattachement, paiement, suppression.'),
  ('forcage',    '{}', 'Une écriture forcée par le cabinet.'),
  ('import',     '{}', 'Des données importées : un relevé bancaire, un cours.'),
  ('envoi',      '{}', 'Un message remis à l''extérieur : un courriel.');

/* Les étapes métier citent le geste, l'objet et l'audit ; jamais une valeur saisie. */
update observabilite.etapes
   set cles_autorisees = '{depot,methode,geste,action,objet_type,objet_id,code_refus}'
 where code in ('transfert', 'validation', 'rejet', 'comptabilisation', 'paiement', 'droits',
                'reglage', 'export', 'retour', 'correction', 'forcage', 'import');

/*
 * Les étapes de l'appareil : la plateforme (android, pwa, web) et des
 * compteurs. `affiche` porte les montants RÉELLEMENT rendus — une valeur
 * métier citée, permise (docs/journalisation.md) ; jamais une photo, jamais
 * un texte lu.
 */
update observabilite.etapes set emise_par_l_appareil = true, cles_autorisees = '{plateforme,source}'
 where code = 'capture';
update observabilite.etapes set emise_par_l_appareil = true, cles_autorisees = '{plateforme,tentatives}'
 where code = 'file_hors_ligne';
update observabilite.etapes set emise_par_l_appareil = true, cles_autorisees = '{plateforme,tentatives}'
 where code = 'synchronisation';
update observabilite.etapes set emise_par_l_appareil = true,
       cles_autorisees = '{plateforme,ecran,source,ttc,base_ht,tva,total_debit,total_credit}'
 where code = 'affiche';
update observabilite.etapes set cles_autorisees = cles_autorisees || '{resultat}'::text[]
 where code = 'tache';
update observabilite.etapes set cles_autorisees = '{canal,resultat}' where code = 'envoi';

-- --- 2. Les gestes : méthode RPC → étape métier ----------------------------------------------------

/*
 * `objet_chemin` et `dossier_chemin` disent où l'appel nomme l'objet et le
 * dossier : un chemin dans la liste des arguments (`{0}`, `{0,pieceId}`). Le
 * chemin ne sert qu'à un REFUS — une transaction annulée n'a rien audité ; un
 * geste réussi cite l'objet que l'audit porte. Seul un identifiant bien formé
 * en est tiré : un argument qui porterait un jeton ou un texte ne s'extrait
 * pas (l'invitation par lien n'a donc pas de chemin).
 */
create table observabilite.gestes (
  depot           text not null check (depot ~ '^[a-z][A-Za-z]{1,39}$'),
  methode         text not null check (methode ~ '^[a-z][A-Za-z]{1,63}$'),
  etape           text not null references observabilite.etapes (code),
  geste           text not null check (geste ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  objet_type      text not null check (objet_type ~ '^[a-z][a-z_]{1,39}$'),
  objet_chemin    text[] check (cardinality(objet_chemin) between 1 and 3),
  dossier_chemin  text[] check (cardinality(dossier_chemin) between 1 and 3),
  primary key (depot, methode)
);

insert into observabilite.gestes (depot, methode, etape, geste, objet_type, objet_chemin, dossier_chemin) values
  -- La PME : la pièce, ses paiements, ses corrections, son renvoi.
  ('capture', 'enregistrerPaiement', 'paiement', 'paiement.inscrire', 'piece', '{0,pieceId}', null),
  ('capture', 'annulerPaiement', 'paiement', 'paiement.annuler', 'paiement', '{0}', null),
  ('capture', 'corrigerPaiement', 'correction', 'paiement.corriger', 'paiement', '{0,paiementId}', null),
  ('capture', 'rattacherJustificatif', 'paiement', 'paiement.justifier', 'piece', '{1}', null),
  ('capture', 'deplacerJustificatif', 'correction', 'justificatif.deplacer', 'piece', '{0}', null),
  ('capture', 'remplacerJustificatif', 'correction', 'justificatif.remplacer', 'piece', '{0}', null),
  ('capture', 'daterLaPiece', 'correction', 'piece.dater', 'piece', '{0}', null),
  ('capture', 'preciser', 'correction', 'piece.preciser', 'piece', '{0}', null),
  ('capture', 'rattacher', 'correction', 'piece.rattacher', 'piece', '{0}', null),
  ('capture', 'detacher', 'correction', 'piece.detacher', 'piece', '{0}', null),
  ('capture', 'supprimer', 'correction', 'piece.supprimer', 'piece', '{0}', null),
  ('capture', 'supprimerPieceQuiAccompagne', 'correction', 'piece.supprimer_jointe', 'piece', '{0}', null),
  ('capture', 'renvoyer', 'retour', 'piece.renvoyer', 'piece', '{0}', null),
  ('capture', 'repondreAuCabinet', 'retour', 'piece.repondre_au_cabinet', 'piece', '{0}', null),
  -- Le transfert : siège → propriétaire → cabinet, la destination, la garde.
  ('collab', 'envoyer', 'transfert', 'piece.envoyer', 'piece', '{0}', null),
  ('collab', 'transmettreLesPieces', 'transfert', 'piece.transmettre', 'piece', '{0,0}', null),
  ('collab', 'setPieceVis', 'transfert', 'piece.destination', 'piece', '{0}', null),
  ('collab', 'garderPiece', 'transfert', 'piece.garder', 'piece', '{0}', null),
  ('collab', 'demanderSurPiece', 'retour', 'piece.demander', 'piece', '{0}', null),
  ('collab', 'repondreSurPiece', 'retour', 'piece.repondre_demande', 'piece', '{0}', null),
  ('collab', 'inviter', 'droits', 'membre.inviter', 'organisation', '{0,tenantId}', '{0,tenantId}'),
  ('collab', 'repondreAInvitation', 'droits', 'invitation.repondre', 'invitation', '{0}', null),
  ('collab', 'assign', 'droits', 'collaborateur.affecter', 'organisation', '{0,clientTenantId}', '{0,cabinetTenantId}'),
  -- La Comptabilité : retour, validation, forçage, comptabilisation.
  ('supervision', 'retourner', 'retour', 'piece.retourner', 'piece', '{0,pieceId}', null),
  ('supervision', 'review', 'validation', 'ecriture.revoir', 'ecriture', '{0,ecritureId}', null),
  ('office', 'valider', 'validation', 'piece.valider', 'piece', '{0}', null),
  ('office', 'forcer', 'forcage', 'ecriture.forcer', 'piece', '{0,pieceId}', null),
  ('office', 'book', 'comptabilisation', 'ecriture.comptabiliser', 'ecriture', '{0}', null),
  ('office', 'inscrireLeReglement', 'comptabilisation', 'reglement.comptabiliser', 'paiement', '{0}', null),
  ('office', 'rattacherLaFacture', 'correction', 'piece.rattacher_facture', 'piece', '{0}', null),
  ('office', 'trancherLeSens', 'correction', 'piece.trancher_sens', 'piece', '{0}', null),
  ('office', 'saisirLeCoursDeLaPiece', 'correction', 'piece.saisir_cours', 'piece', '{0}', null),
  ('office', 'saisirUnCours', 'import', 'cours.saisir', 'organisation', '{0,dossierId}', '{0,orgId}'),
  ('office', 'rejugerLesPieces', 'validation', 'pieces.rejuger', 'organisation', '{0}', '{0}'),
  ('banque', 'importLines', 'import', 'banque.importer', 'organisation', '{0,tenantId}', '{0,tenantId}'),
  ('banque', 'bookLines', 'comptabilisation', 'banque.comptabiliser', 'organisation', '{0,tenantId}', '{0,tenantId}'),
  ('banque', 'lettrer', 'comptabilisation', 'banque.lettrer', 'ecriture', '{0,ecritureId}', null),
  ('banque', 'delettrer', 'correction', 'banque.delettrer', 'ligne_bancaire', '{0,ligneId}', null),
  ('honoraires', 'emettre', 'comptabilisation', 'honoraires.emettre', 'facture', '{0}', null),
  ('honoraires', 'avoir', 'correction', 'honoraires.avoir', 'facture', '{0}', null),
  ('honoraires', 'encaisser', 'paiement', 'honoraires.encaisser', 'facture', '{0,factureId}', null),
  ('honoraires', 'definirMandat', 'droits', 'honoraires.mandat_definir', 'organisation', '{0,clientTenantId}', '{0,cabinetTenantId}'),
  ('honoraires', 'cloreMandat', 'droits', 'honoraires.mandat_clore', 'mandat', '{0}', null),
  -- Les paiements et l'abonnement.
  ('facturation', 'acheterRecharge', 'paiement', 'recharge.acheter', 'organisation', '{1}', '{1}'),
  ('facturation', 'changerForfait', 'paiement', 'forfait.changer', 'organisation', '{1}', '{1}'),
  ('facturation', 'payerEnLigne', 'paiement', 'paiement.payer_en_ligne', 'paiement', '{0}', null),
  ('facturation', 'payerFacture', 'paiement', 'facture.payer', 'facture', '{0}', null),
  ('facturation', 'souscrireAnnuel', 'paiement', 'annuel.souscrire', 'organisation', '{0}', '{0}'),
  ('facturation', 'proposerAbonnement', 'paiement', 'abonnement.proposer', 'organisation', '{1}', '{0}'),
  ('facturation', 'repondreAbonnement', 'paiement', 'abonnement.repondre', 'acces', '{0}', null),
  ('facturation', 'reglerRechargeAutomatique', 'reglage', 'recharge.automatique_regler', 'organisation', '{3}', '{3}'),
  ('facturation', 'verifierPaiement', 'paiement', 'paiement.verifier', 'paiement', '{0}', null),
  ('facturation', 'simulerPaiement', 'paiement', 'paiement.simuler', 'paiement', '{0}', null),
  -- Les droits : places, invitations, mandats, licences, clés.
  ('facturation', 'inviterProprietaire', 'droits', 'proprietaire.inviter', 'organisation', '{1}', '{1}'),
  ('facturation', 'inviterSiege', 'droits', 'siege.inviter', 'organisation', '{1}', '{1}'),
  ('facturation', 'libererPlace', 'droits', 'place.liberer', 'organisation', '{0}', '{0}'),
  ('facturation', 'transmettreLicence', 'droits', 'licence.transmettre', 'organisation', '{0}', '{0}'),
  ('identite', 'accepterInvitationParLien', 'droits', 'invitation.accepter_par_lien', 'invitation', null, null),
  ('identite', 'inviterContact', 'droits', 'contact.inviter', 'organisation', '{0}', '{0}'),
  ('identite', 'revoquerInvitation', 'droits', 'invitation.revoquer', 'invitation', '{0}', null),
  ('identite', 'creerMandat', 'droits', 'mandat.creer', 'organisation', '{0,pmeOrgId}', '{0,cabinetOrgId}'),
  ('identite', 'proposerMandat', 'droits', 'mandat.proposer', 'organisation', '{0}', '{0}'),
  ('identite', 'repondreAuMandat', 'droits', 'mandat.repondre', 'mandat', '{0}', null),
  ('identite', 'revoquerMandat', 'droits', 'mandat.revoquer', 'organisation', '{0}', '{0}'),
  ('integrations', 'creerCle', 'droits', 'cle_api.creer', 'organisation', '{0}', '{0}'),
  ('integrations', 'revoquerCle', 'droits', 'cle_api.revoquer', 'cle_api', '{0}', null),
  -- Les réglages du dossier et du cabinet.
  ('identite', 'definirOrganisation', 'reglage', 'organisation.definir', 'organisation', '{0,tenantId}', '{0,tenantId}'),
  ('identite', 'etablirFiche', 'reglage', 'fiche.etablir', 'organisation', '{0,tenantId}', '{0,tenantId}'),
  ('parametrage', 'arreterDeclarationTva', 'reglage', 'tva.declaration_arreter', 'organisation', '{0,porteeId}', '{0,cabinetId}'),
  ('parametrage', 'arreterReglagesComptables', 'reglage', 'reglages.comptables_arreter', 'organisation', '{0,porteeId}', '{0,cabinetId}'),
  ('parametrage', 'definirReglagesCabinet', 'reglage', 'reglages.cabinet_definir', 'organisation', '{0,tenantId}', '{0,tenantId}'),
  ('parametrage', 'definirLiaison', 'reglage', 'plan.liaison_definir', 'organisation', '{0,porteeId}', '{0,tenantId}'),
  ('parametrage', 'rendreAuPack', 'reglage', 'plan.rendre_au_pack', 'organisation', '{0,porteeId}', '{0,tenantId}'),
  ('parametrage', 'definirObligation', 'reglage', 'obligation.definir', 'organisation', '{0,tenantId}', '{0,tenantId}'),
  ('parametrage', 'creerObligationPropre', 'reglage', 'obligation.creer', 'organisation', '{0,tenantId}', '{0,tenantId}'),
  ('parametrage', 'ouvrirCompte', 'reglage', 'plan.compte_ouvrir', 'organisation', '{0,tenantId}', '{0,tenantId}'),
  ('parametrage', 'fermerCompte', 'reglage', 'plan.compte_fermer', 'organisation', '{0}', '{0}'),
  ('parametrage', 'poserReport', 'reglage', 'report.poser', 'organisation', '{0,tenantId}', '{0,tenantId}'),
  ('parametrage', 'retirerReport', 'reglage', 'report.retirer', 'report', '{1}', '{0}'),
  ('parametrage', 'definirFuseauDuCabinet', 'reglage', 'fuseau.definir', 'organisation', '{0}', '{0}'),
  ('parametrage', 'terminerMiseEnRoute', 'reglage', 'mise_en_route.terminer', 'organisation', '{0}', '{0}'),
  -- Les exports.
  ('exports', 'generer', 'export', 'export.generer', 'organisation', '{1}', '{0}'),
  ('journalDuJour', 'exporter', 'export', 'journal_du_jour.exporter', 'organisation', '{1}', '{0}'),
  -- La plateforme (la tour).
  ('tour', 'publierGrille', 'reglage', 'plateforme.grille_publier', 'grille', null, null),
  ('tour', 'reglerPaiement', 'reglage', 'plateforme.paiement_regler', 'plateforme', null, null),
  ('tour', 'reglerAbonnement', 'reglage', 'plateforme.abonnement_regler', 'plateforme', null, null),
  ('tour', 'reglerIa', 'reglage', 'plateforme.ia_regler', 'plateforme', null, null),
  ('tour', 'reglerRelances', 'reglage', 'plateforme.relances_regler', 'plateforme', null, null),
  ('tour', 'reglerRelectureNuit', 'reglage', 'plateforme.relecture_nuit_regler', 'plateforme', null, null),
  ('tour', 'reglerCompteDeService', 'reglage', 'plateforme.compte_de_service_regler', 'plateforme', null, null),
  ('tour', 'designerEmetteur', 'reglage', 'plateforme.emetteur_designer', 'organisation', '{0}', '{0}'),
  ('tour', 'poserJourFerie', 'reglage', 'plateforme.jour_ferie_poser', 'calendrier', null, null),
  ('tour', 'retirerJourFerie', 'reglage', 'plateforme.jour_ferie_retirer', 'calendrier', '{0}', null),
  ('tour', 'publierReport', 'reglage', 'plateforme.report_publier', 'calendrier', null, null),
  ('tour', 'retirerReportPublie', 'reglage', 'plateforme.report_retirer', 'calendrier', '{0}', null);

alter table observabilite.gestes owner to greffier;
alter table observabilite.gestes enable row level security;
alter table observabilite.gestes force row level security;
revoke all on table observabilite.gestes from public, anon, authenticated, malica_api;
create policy gestes_greffier on observabilite.gestes for all to greffier using (true) with check (true);
create policy gestes_exploitation on observabilite.gestes for select to malica_exploitation using (true);
grant select on table observabilite.gestes to malica_exploitation;

/*
 * Ce que l'API lit du référentiel du journal : les gestes, et les étapes que
 * l'appareil a le droit d'émettre. Par une fonction : l'API n'a aucun droit
 * sur les tables du schéma, et n'en reçoit pas.
 */
create function observabilite.referentiel_du_journal()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'gestes', coalesce((select jsonb_agg(jsonb_build_object(
                'depot', g.depot, 'methode', g.methode, 'etape', g.etape, 'geste', g.geste,
                'objetType', g.objet_type, 'objetChemin', g.objet_chemin,
                'dossierChemin', g.dossier_chemin) order by g.depot, g.methode)
                from observabilite.gestes g), '[]'::jsonb),
    'etapesDeLAppareil', coalesce((select jsonb_agg(e.code order by e.code)
                from observabilite.etapes e where e.emise_par_l_appareil), '[]'::jsonb))
$$;

-- --- 3. L'audit note aussi son objet ----------------------------------------------------------------

/*
 * Même règle que les identifiants (20261118130000), un réglage LOCAL à la
 * transaction, seize au plus : pour chaque ligne d'`audit.event_log`, son
 * dossier, sa table, son objet et son action. Le geste réussi cite ainsi
 * l'objet que l'audit porte ; un rollback efface la note avec les lignes.
 */
create or replace function app.audit_se_note_dans_la_transaction()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_notes text := coalesce(current_setting('malica.audit_ids', true), '');
  v_objets jsonb := coalesce(nullif(current_setting('malica.audit_objets', true), ''), '[]')::jsonb;
begin
  if v_notes = '' then
    perform set_config('malica.audit_ids', new.id::text, true);
  elsif length(v_notes) < 16 * 37 - 1 then
    perform set_config('malica.audit_ids', v_notes || ',' || new.id::text, true);
  end if;
  if jsonb_array_length(v_objets) < 16 then
    perform set_config('malica.audit_objets', (v_objets || jsonb_build_array(jsonb_build_object(
      'dossier', new.tenant_id,
      'table', new.object_schema || '.' || new.object_table,
      'objet', new.object_id,
      'action', left(new.action, 80))))::text, true);
  end if;
  return new;
end
$$;

-- --- 4. Un renvoi de la capture n'audite pas deux fois ------------------------------------------

/*
 * Trouvé en écrivant l'épreuve du renvoi (chaque-parcours-se-suit.test.ts) :
 * la file hors ligne rejoue `capture.enregistrer` avec la même clé après une
 * reconnexion, la base rend bien la même pièce (`on conflict … do update`) —
 * et inscrivait une SECONDE ligne `piece.captured` à l'audit. Un fait métier
 * en double, pour un geste qui n'a eu lieu qu'une fois.
 *
 * La porte est reprise telle quelle (20261029190000), à une différence près :
 * l'audit n'est écrit que si la ligne vient d'être insérée (`xmax = 0`).
 */
create or replace function public.capture_piece_register(
  p_tenant uuid, p_source text, p_storage_path text, p_idempotency_key text,
  p_entity uuid default null, p_vis app.vis_t default 'partage'::app.vis_t,
  p_sha256 text default null, p_page_count smallint default null,
  p_document_kind text default null, p_source_piece uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_nouvelle boolean;
  v_source uuid;
  v_tenant_source uuid;
  v_vis_source app.vis_t;
  v_vis app.vis_t := p_vis;
begin
  if p_document_kind is not null
     and not exists (select 1 from ref.document_types d where d.code = p_document_kind) then
    raise exception '%', app.refus_avec_valeurs('refus.referentiel.type_de_document', 'type', (p_document_kind)::text)
      using errcode = 'foreign_key_violation';
  end if;

  -- La pièce source doit être du MÊME dossier. Sinon le lien pointerait hors
  -- du dossier et la RLS rendrait un reçu orphelin sans dire pourquoi.
  if p_source_piece is not null then
    -- Une pièce issue d'une version précédente l'est de sa version courante :
    -- rien de nouveau ne s'accroche à une version gelée, et le côté est celui
    -- de la courante.
    select id, tenant_id, vis into v_source, v_tenant_source, v_vis_source
      from capture.pieces where id = app.version_courante(p_source_piece);
    if v_tenant_source is null or v_tenant_source <> p_tenant then
      raise exception 'refus.introuvable.piece'
        using errcode = '42501';
    end if;
    -- Une pièce dérivée a la visibilité de sa source, quoi qu'on déclare :
    -- jamais partagée si sa source ne l'est pas.
    v_vis := v_vis_source;
  end if;

  insert into capture.pieces (tenant_id, entity_id, vis, source, storage_path,
                              sha256, page_count, idempotency_key,
                              document_kind, document_kind_statut, source_piece_id)
  values (p_tenant, p_entity, v_vis, p_source, p_storage_path,
          p_sha256, p_page_count, p_idempotency_key,
          p_document_kind,
          -- Sans type déclaré : à déterminer, la lecture tranchera.
          -- Type déclaré sur une pièce DÉRIVÉE : confirmé — Malica l'a faite.
          -- Type déclaré sur une pièce autonome : à confirmer, la lecture a
          -- le dernier mot.
          case
            when p_document_kind is null then 'a_determiner'
            when v_source is not null then 'confirme'
            else 'a_confirmer'
          end,
          v_source)
  on conflict (tenant_id, idempotency_key) do update
     set updated_at = now()
  returning id, (xmax = 0) into v_id, v_nouvelle;

  -- Un renvoi (même clé) rend la même pièce, et n'est pas une capture de plus.
  if v_nouvelle then
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, payload)
    values (p_tenant, auth.uid(), 'piece.captured', 'capture', 'pieces', v_id,
            jsonb_build_object('source', p_source, 'document_kind', p_document_kind,
                               'source_piece_id', v_source));
  end if;

  return v_id;
end
$$;

-- --- 5. Une trace n'appartient qu'à son acteur ----------------------------------------------------

/*
 * La porte, reprise de 20261118130000 avec une garde de plus, en tête :
 *
 *   une étape dont l'acteur n'est pas celui d'une trace DÉJÀ inscrite — ou
 *   qui n'est pas admis dans le dossier de cette trace — ne s'y ajoute pas.
 *   Elle part sous une trace propre, dérivée de (trace, acteur) : stable, donc
 *   un renvoi reste une répétition ; sans parente, donc elle ne se rattache
 *   pas à l'opération d'un autre. Le bilan les compte (`traces_isolees`).
 *
 * Une étape sans acteur (une tâche du serveur) est crue, comme avant.
 */
create or replace function observabilite.consigner(p_evenements jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appelant uuid := auth.uid();
  v_admis text[] := '{}';
  v_ecartes integer := 0;
  v_isolees integer := 0;
  v_lot jsonb;
  v_rejetes integer;
  v_nouveaux integer;
  v_repetes integer;
  r record;
begin
  if p_evenements is null or jsonb_typeof(p_evenements) <> 'array'
     or jsonb_array_length(p_evenements) > 1000 then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;

  if v_appelant is not null and exists (
       select 1 from jsonb_array_elements(p_evenements) e
        where observabilite.uuid_ou_nul(e #>> '{trace,acteur}') is distinct from v_appelant
           or observabilite.uuid_ou_nul(coalesce(e ->> 'acteur', e #>> '{trace,acteur}'))
                is distinct from v_appelant) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;

  /*
   * Chaque couple (acteur, dossier) est jugé une fois, par les règles du
   * produit : le dossier annoncé, et celui de la trace déjà inscrite.
   */
  for r in
    select distinct x.acteur, x.tenant
      from (select observabilite.uuid_ou_nul(e #>> '{trace,acteur}') as acteur,
                   observabilite.uuid_ou_nul(e #>> '{trace,tenant}') as tenant
              from jsonb_array_elements(p_evenements) e
            union
            select observabilite.uuid_ou_nul(e #>> '{trace,acteur}'), t.tenant_id
              from jsonb_array_elements(p_evenements) e
              join observabilite.traces t on t.id = observabilite.uuid_ou_nul(e #>> '{trace,id}')) x
     where x.acteur is not null and x.tenant is not null
  loop
    if v_appelant is null then
      perform set_config('request.jwt.claim.sub', r.acteur::text, true);
    end if;
    if r.tenant in (select app.member_orgs()) or r.tenant in (select app.engaged_orgs())
       or app.is_platform() then
      v_admis := v_admis || (r.acteur::text || '|' || r.tenant::text);
    end if;
  end loop;
  if v_appelant is null then
    perform set_config('request.jwt.claim.sub', '', true);
  end if;

  -- Le dossier annoncé que l'acteur n'a pas : refusé sous son identité, écarté sinon.
  select count(distinct (observabilite.uuid_ou_nul(e #>> '{trace,acteur}'),
                         observabilite.uuid_ou_nul(e #>> '{trace,tenant}')))
    into v_ecartes
    from jsonb_array_elements(p_evenements) e
   where observabilite.uuid_ou_nul(e #>> '{trace,acteur}') is not null
     and observabilite.uuid_ou_nul(e #>> '{trace,tenant}') is not null
     and not (observabilite.uuid_ou_nul(e #>> '{trace,acteur}')::text || '|'
              || observabilite.uuid_ou_nul(e #>> '{trace,tenant}')::text) = any (v_admis);
  if v_appelant is not null and v_ecartes > 0 then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;

  /*
   * La trace d'un autre : l'étape part sous une trace propre, dérivée et
   * stable. Le propriétaire d'une trace est son acteur inscrit, ou — trace
   * encore inconnue, ou inscrite sans acteur — le premier acteur du lot : deux
   * clients dont les étapes arrivent dans le même lot ne se partagent pas une
   * trace neuve.
   */
  with elements as (
    select e, ord, observabilite.uuid_ou_nul(e #>> '{trace,id}') as trace_id,
           observabilite.uuid_ou_nul(e #>> '{trace,acteur}') as acteur
      from jsonb_array_elements(p_evenements) with ordinality as l(e, ord)
  ), premiers as (
    select x.trace_id, (array_agg(x.acteur order by x.ord) filter (where x.acteur is not null))[1] as acteur
      from elements x
     group by x.trace_id
  ), juges as (
    select x.e, x.ord,
           x.acteur is not null
             and (coalesce(t.acteur, p.acteur) <> x.acteur
                  or (t.tenant_id is not null
                      and not (x.acteur::text || '|' || t.tenant_id::text) = any (v_admis))) as etrangere
      from elements x
      left join observabilite.traces t on t.id = x.trace_id
      left join premiers p on p.trace_id is not distinct from x.trace_id
  )
  select coalesce(jsonb_agg(
           case when etrangere
                then jsonb_set(jsonb_set(e, '{trace,id}',
                       to_jsonb(md5((e #>> '{trace,id}') || ':' || (e #>> '{trace,acteur}'))::uuid::text)),
                       '{trace,parente}', 'null'::jsonb)
                else e end order by ord), '[]'::jsonb),
         count(*) filter (where etrangere)
    into v_lot, v_isolees
    from juges;

  /*
   * Une seule instruction : les traces d'abord, les étapes ensuite. Les clés
   * étrangères se vérifient à la fin de l'instruction, quand les deux sont là.
   */
  with brut as (
    select e, ord,
           observabilite.uuid_ou_nul(e #>> '{trace,id}') as trace_id,
           observabilite.uuid_ou_nul(e #>> '{trace,parente}') as parente_id,
           e #>> '{trace,origine}' as origine,
           observabilite.uuid_ou_nul(e #>> '{trace,tenant}') as tenant_id,
           observabilite.uuid_ou_nul(e #>> '{trace,acteur}') as trace_acteur,
           observabilite.uuid_ou_nul(e #>> '{trace,piece}') as trace_piece,
           left(e #>> '{trace,version}', 120) as version,
           observabilite.instant_ou_nul(e #>> '{trace,debut}') as trace_debut,
           e ->> 'etape' as etape,
           e ->> 'issue' as issue,
           left(e ->> 'cle', 120) as cle,
           observabilite.instant_ou_nul(e ->> 'debut') as debut,
           case when e ->> 'dureeMs' ~ '^\d{1,9}$' then (e ->> 'dureeMs')::integer end as duree_ms,
           observabilite.uuid_ou_nul(e ->> 'acteur') as acteur,
           observabilite.uuid_ou_nul(e ->> 'piece') as piece_id,
           array(select observabilite.uuid_ou_nul(a)
                   from jsonb_array_elements_text(
                          case when jsonb_typeof(e -> 'audits') = 'array' then e -> 'audits'
                               else '[]'::jsonb end) with ordinality as l(a, n)
                  where observabilite.uuid_ou_nul(a) is not null and n <= 16) as audit_ids
      from jsonb_array_elements(v_lot) with ordinality as l(e, ord)
     where jsonb_typeof(e) = 'object'
  ), lot as (
    select b.ord, b.trace_id, nullif(b.parente_id, b.trace_id) as parente_id,
           b.origine::observabilite.origine_t as origine,
           case when b.trace_acteur is null
                  or (b.trace_acteur::text || '|' || b.tenant_id::text) = any (v_admis)
                then b.tenant_id end as tenant_id,
           b.trace_acteur, b.trace_piece, b.version, coalesce(b.trace_debut, b.debut) as trace_debut,
           b.etape, b.issue::observabilite.issue_t as issue, b.cle, b.debut, b.duree_ms,
           coalesce(b.acteur, b.trace_acteur) as acteur, b.piece_id, b.audit_ids,
           observabilite.detail_borne(b.etape, b.e -> 'detail') as detail
      from brut b
     where b.trace_id is not null
       and b.origine = any (enum_range(null::observabilite.origine_t)::text[])
       and b.issue = any (enum_range(null::observabilite.issue_t)::text[])
       and exists (select 1 from observabilite.etapes s where s.code = b.etape)
       and b.cle is not null and length(b.cle) > 0
       and b.debut is not null
  ), traces_inscrites as (
    insert into observabilite.traces as t
      (id, parente_id, origine, tenant_id, acteur, piece_id, version, debut)
    select l.trace_id,
           (array_agg(l.parente_id order by l.ord) filter (where l.parente_id is not null))[1],
           (array_agg(l.origine order by l.ord))[1],
           (array_agg(l.tenant_id order by l.ord) filter (where l.tenant_id is not null))[1],
           (array_agg(l.trace_acteur order by l.ord) filter (where l.trace_acteur is not null))[1],
           (array_agg(l.trace_piece order by l.ord) filter (where l.trace_piece is not null))[1],
           (array_agg(l.version order by l.ord) filter (where l.version is not null))[1],
           min(l.trace_debut)
      from lot l
     group by l.trace_id
    on conflict (id) do update
       set parente_id = coalesce(t.parente_id, excluded.parente_id),
           tenant_id  = coalesce(t.tenant_id, excluded.tenant_id),
           acteur     = coalesce(t.acteur, excluded.acteur),
           piece_id   = coalesce(t.piece_id, excluded.piece_id),
           version    = coalesce(t.version, excluded.version),
           debut      = least(t.debut, excluded.debut)
    returning t.id
  ), uniques as (
    select distinct on (l.trace_id, l.etape, l.cle)
           l.*, count(*) over (partition by l.trace_id, l.etape, l.cle) - 1 as doubles
      from lot l
     order by l.trace_id, l.etape, l.cle, l.ord
  ), inscrits as (
    insert into observabilite.evenements as v
      (trace_id, etape, issue, cle, debut, duree_ms, acteur, piece_id, audit_ids, detail,
       repetitions, derniere_repetition)
    select u.trace_id, u.etape, u.issue, u.cle, u.debut, u.duree_ms, u.acteur, u.piece_id,
           u.audit_ids, u.detail, u.doubles,
           case when u.doubles > 0 then clock_timestamp() end
      from uniques u
     -- La trace est inscrite par la même instruction : on attend qu'elle le soit.
     where u.trace_id in (select ti.id from traces_inscrites ti)
    on conflict (trace_id, etape, cle) do update
       set repetitions = v.repetitions + excluded.repetitions + 1,
           derniere_repetition = clock_timestamp()
    returning (xmax = 0) as nouveau
  )
  select jsonb_array_length(v_lot) - (select count(*) from lot),
         (select count(*) from inscrits i where i.nouveau),
         (select count(*) from lot) - (select count(*) from inscrits i where i.nouveau)
    into v_rejetes, v_nouveaux, v_repetes;

  return jsonb_build_object('inscrits', v_nouveaux, 'repetes', v_repetes,
                            'rejetes', v_rejetes, 'dossiers_ecartes', v_ecartes,
                            'traces_isolees', v_isolees);
end
$$;

do $$
declare
  f text;
begin
  foreach f in array array['observabilite.referentiel_du_journal()'] loop
    execute format('alter function %s owner to greffier', f);
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end
$$;

grant execute on function observabilite.referentiel_du_journal() to malica_api, malica_exploitation;

commit;
