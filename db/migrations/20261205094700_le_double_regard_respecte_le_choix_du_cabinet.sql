-- Le double regard est un choix du cabinet, y compris pour une comptabilité tenue seule.
--
-- ================================================================== POURQUOI
--
-- PR #103 (25 octobre 2026), portée sur la définition la plus récente de
-- `socle.assert_bookable` (20261110090300_les_refus_se_disent_par_une_cle_socle).
-- En mode mandat, le superviseur ne pouvait JAMAIS être celui qui a
-- comptabilisé : une comptabilité tenue par une seule personne restait bloquée
-- en supervision, alors que le réglage du cabinet
-- `double_validation_au_dela` disait « jamais » (NULL). Le réglage existait,
-- s'enregistrait, et ne servait à rien.
--
-- Désormais le seuil du cabinet décide : sans seuil, la même personne
-- habilitée comptabilise et valide ; au-delà du seuil, une seconde personne
-- reste exigée. Aucun droit, contrôle de comptabilisation (R2, R5) ni trace
-- d'audit n'est retiré : seul le bloc du double regard change.
--
-- _Gardé par_ apps/api/src/une-piece-ne-s-inscrit-qu-une-fois.test.ts,
-- « le cabinet seul valide ; le seuil active réellement le second regard ».
begin;

CREATE OR REPLACE FUNCTION socle.assert_bookable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'socle', 'identity', 'capture', 'ref', 'app', 'pg_catalog'
AS $function$
declare
  v_debit  numeric(38,3);
  v_credit numeric(38,3);
  v_count  integer;
  v_mode   app.validation_mode_t;
  v_kind   text;
  v_statut text;
  v_porte  boolean;
begin
  if new.status = 'booked' and (old.status is distinct from 'booked') then
    select count(*), coalesce(sum(l.debit),0), coalesce(sum(l.credit),0)
      into v_count, v_debit, v_credit
      from socle.ecriture_lignes l where l.ecriture_id = new.id;

    if v_count = 0 then
      raise exception 'refus.ecriture.sans_ligne'
        using errcode = 'check_violation';
    end if;
    if v_debit <> v_credit then
      raise exception '%', app.refus_avec_valeurs('refus.ecriture.desequilibree', 'debit', (v_debit)::text, 'credit', (v_credit)::text)
        using errcode = 'check_violation';
    end if;

    /*
     * Ce qui a été photographié doit être un document qui porte écriture, et
     * son type doit être ÉTABLI — par le cabinet qui valide ou force
     * (`piece_type_etabli_par_le_cabinet`), ou par la personne qui l'a
     * précisé (`capture_precision_persist`).
     *
     * Une écriture sans pièce reste possible — une écriture d'à-nouveaux, une
     * régularisation. C'est le rattachement à une pièce qui est contrôlé, pas
     * son existence.
     *
     * Une photo reprise : c'est la version courante qui dit le type (un
     * règlement saisi sur l'ancienne garde son écriture sur l'ancienne).
     */
    if new.piece_id is not null then
      select p.document_kind, p.document_kind_statut
        into v_kind, v_statut
        from capture.pieces p where p.id = app.version_courante(new.piece_id);

      if v_statut is distinct from 'confirme' then
        raise exception 'refus.inscription.type_inconnu'
          using errcode = 'check_violation';
      end if;

      select t.porte_ecriture into v_porte
        from ref.document_types t where t.code = v_kind;

      if coalesce(v_porte, false) = false then
        raise exception 'refus.inscription.type_sans_ecriture'
          using errcode = 'check_violation';
      end if;
    end if;

    select o.validation_mode into v_mode
      from identity.organizations o where o.id = new.tenant_id;
    new.booked_autonome := (v_mode = 'autonome');
  end if;

  if new.review_outcome = 'valide' and new.reviewed_by is not null then
    select o.validation_mode into v_mode
      from identity.organizations o where o.id = new.tenant_id;
    -- Le mandat ne rend pas le double regard obligatoire : le cabinet le décide
    -- (`collab.reglages_cabinet.double_validation_au_dela`). NULL, ou aucun
    -- réglage, signifie jamais ; zéro couvre tout montant positif. Tous les
    -- mandats actifs comptent : un autre cabinet ne contourne pas le seuil d'un
    -- cabinet déjà engagé sur ce dossier.
    if v_mode = 'mandate' and new.reviewed_by = new.booked_by and exists (
      select 1
        from identity.engagements e
        join collab.reglages_cabinet r on r.tenant_id = e.cabinet_org_id
       where e.pme_org_id = new.tenant_id and e.status = 'actif'
         and r.double_validation_au_dela is not null
         and (select coalesce(sum(l.debit), 0)
                from socle.ecriture_lignes l where l.ecriture_id = new.id)
             > r.double_validation_au_dela
    ) then
      raise exception 'chk_ecr_4eyes : le seuil du cabinet exige un superviseur distinct de celui qui a comptabilise'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$function$;


commit;
