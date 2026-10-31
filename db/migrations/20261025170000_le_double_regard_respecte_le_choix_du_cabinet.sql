-- Le double regard est un choix du cabinet, y compris pour une comptabilité tenue seule.
-- Aucun droit, contrôle de comptabilisation ou journal d’audit n’est supprimé.
begin;

create or replace function socle.assert_bookable()
returns trigger
language plpgsql
security definer
set search_path = socle, identity, capture, ref, app, pg_catalog
as $$
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
      raise exception 'R5 : une ecriture sans ligne ne peut pas etre comptabilisee'
        using errcode = 'check_violation';
    end if;
    if v_debit <> v_credit then
      raise exception 'R5 : desequilibre debit=% credit=%', v_debit, v_credit
        using errcode = 'check_violation';
    end if;

    /*
     * Ce qui a été photographié doit être un document qui porte écriture, et
     * son type doit être ÉTABLI.
     *
     * Sans cela, un procès-verbal d'assemblée ou un brouillon devenait une
     * facture d'achat par simple valeur par défaut, et cherchait un compte de
     * charge. La règle est ici et non dans l'écran : un écran s'oublie.
     *
     * Une écriture sans pièce reste possible — une écriture d'à-nouveaux, une
     * régularisation. C'est le rattachement à une pièce qui est contrôlé, pas
     * son existence.
     */
    if new.piece_id is not null then
      select p.document_kind, p.document_kind_statut
        into v_kind, v_statut
        from capture.pieces p where p.id = new.piece_id;

      if v_statut is distinct from 'confirme' then
        raise exception 'R2 : le type de la piece n''est pas confirme (%), aucune ecriture ne peut en decouler',
          coalesce(v_statut, 'inconnu')
          using errcode = 'check_violation';
      end if;

      select t.porte_ecriture into v_porte
        from ref.document_types t where t.code = v_kind;

      if coalesce(v_porte, false) = false then
        raise exception 'R2 : un document de type % ne porte pas d''ecriture comptable',
          coalesce(v_kind, 'inconnu')
          using errcode = 'check_violation';
      end if;
    end if;

    select o.validation_mode into v_mode
      from identity.organizations o where o.id = new.tenant_id;
    new.booked_autonome := (v_mode = 'autonome');
  end if;

  if new.review_outcome is not null and new.reviewed_by is not null then
    select o.validation_mode into v_mode
      from identity.organizations o where o.id = new.tenant_id;
    -- Le mandat ne rend pas le double regard obligatoire : le cabinet le décide.
    -- NULL (ou aucun réglage) signifie jamais ; zéro couvre tout montant positif.
    -- Tous les mandats actifs sont considérés : un autre cabinet ne contourne
    -- pas le seuil d'un cabinet déjà engagé sur ce dossier.
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
$$;

revoke all on function socle.assert_bookable() from public;

commit;
