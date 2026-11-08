-- Une porte ne relit que la proposition OUVERTE de son appelant (lot S2,
-- seconde revue indépendante, 7 novembre 2026).
--
-- `20261202100100` bornait la lecture du portier à « ce que l'appelant a
-- écrit » : une écriture qu'il a créée (`created_by`). La revue l'a pris en
-- défaut : la PME propose l'écriture d'une pièce transmise, le cabinet engagé
-- l'INSCRIT telle quelle, et l'écriture inscrite garde `created_by` = la PME.
-- Ses portes la retrouvaient : le propriétaire la validait
-- (`socle_ecriture_review`), la contre-passait
-- (`socle_ecriture_contre_passer`), y consignait `ecriture.forcee`.
--
-- Et un effet de bord : `socle_ecriture_propose` lisait sous le portier si la
-- pièce avait déjà une écriture vivante. Celle du cabinet ne s'y voyait plus :
-- la porte ne refusait plus (`refus.ecriture.reimputer`) et laissait une
-- proposition orpheline sur une pièce déjà inscrite — que le cabinet ne
-- pouvait ni inscrire ni voir, et sur laquelle un autre membre de la PME
-- butait (clé unique `ecritures_une_proposition`).
--
-- 1. LE PORTIER ne lit plus, au-delà de son appelant, qu'une écriture que
--    celui-ci a créée ET qui est encore sa PROPOSITION OUVERTE
--    (`status = 'proposee'`, ni contre-passation) — ou qu'il a inscrite
--    LUI-MÊME, vivante et non revue (un dossier qui tient ses livres : la
--    porte d'inscription relit la ligne qu'elle met à jour) ; ses lignes de
--    même ; et un fait dont il est l'acteur sur une telle écriture. Inscrite,
--    revue ou contre-passée par le cabinet, elle n'est plus la sienne :
--    aucune porte de la PME ne la retrouve. Les faits de l'appelant qui ne
--    portent pas sur une écriture lui sont déjà lisibles (`audit_event_log_sel`).
--
-- 2. `socle_ecriture_propose` demande à la base, par
--    `app.piece_a_une_ecriture_vivante`, si la pièce — lisible de l'appelant —
--    a déjà une écriture vivante de cette nature : un booléen, rien d'autre.
--    Si oui, elle refuse comme avant (`refus.ecriture.reimputer`). La
--    proposition ouverte qu'elle remplace s'efface par
--    `app.piece_oublie_ses_propositions` (`20261202100100`), comme avant le
--    lot : la porte ne la lit pas, et ne laisse pas deux propositions.
--
-- REJEU (R11) : `drop policy if exists`, `create or replace` ; aucune donnée
-- de référence n'est écrite.

begin;

-- --- 1. Ce que le portier lit au-delà de son appelant ------------------------------------------------

-- Une écriture qu'aucune contre-passation inscrite n'annule. `security
-- definer` : appelée par une politique de `socle.ecritures`, elle relit la
-- table sans repasser par ses politiques (récursion).
create or replace function app.ecriture_non_contre_passee(p_ecriture uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from socle.ecritures r
                      where r.reverses_id = p_ecriture and r.status = 'booked')
$$;

revoke all on function app.ecriture_non_contre_passee(uuid) from public, anon;
grant execute on function app.ecriture_non_contre_passee(uuid) to authenticated;

-- La proposition ouverte de l'appelant ; et, pour que la porte d'inscription
-- relise la ligne qu'elle vient de passer à `booked` (une mise à jour doit
-- rester visible de qui la fait), l'écriture que l'appelant a créée ET
-- inscrite lui-même, tant qu'elle vit et que personne ne l'a revue — celle
-- d'un dossier qui tient ses livres. Inscrite ou revue par le cabinet, elle
-- sort de toute porte de la PME.
drop policy if exists socle_ecritures_sel_porte on socle.ecritures;
create policy socle_ecritures_sel_porte on socle.ecritures
  for select to portier
  using (created_by = (select auth.uid())
         and reverses_id is null
         and tenant_id in (select app.member_orgs())
         and (status = 'proposee'
              or (status = 'booked'
                  and booked_by = (select auth.uid())
                  and reviewed_by is null
                  and app.ecriture_non_contre_passee(id))));

-- Les lignes et les faits : ceux d'une écriture que la porte voit (la
-- sous-requête passe par la RLS du portier, ci-dessus).
drop policy if exists socle_ecriture_lignes_sel_porte on socle.ecriture_lignes;
create policy socle_ecriture_lignes_sel_porte on socle.ecriture_lignes
  for select to portier
  using (tenant_id in (select app.member_orgs())
         and exists (select 1 from socle.ecritures e where e.id = ecriture_id));

drop policy if exists audit_event_log_sel_porte on audit.event_log;
create policy audit_event_log_sel_porte on audit.event_log
  for select to portier
  using (actor = (select auth.uid())
         and tenant_id in (select app.member_orgs())
         and object_schema = 'socle' and object_table = 'ecritures'
         and exists (select 1 from socle.ecritures e where e.id = object_id));

-- --- 2. La proposition d'une pièce déjà inscrite ----------------------------------------------------

create or replace function app.piece_a_une_ecriture_vivante(p_piece uuid, p_nature text,
                                                          p_paiement uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.piece_lisible(p_piece)
     and exists (select 1 from socle.ecritures e
                  where e.piece_id = p_piece and e.nature = p_nature
                    and e.paiement_id is not distinct from p_paiement
                    and app.ecriture_vivante(e.id))
$$;

revoke all on function app.piece_a_une_ecriture_vivante(uuid, text, uuid) from public, anon;
grant execute on function app.piece_a_une_ecriture_vivante(uuid, text, uuid) to authenticated;

comment on function app.piece_a_une_ecriture_vivante(uuid, text, uuid) is
  'La pièce, lisible de l''appelant, a-t-elle déjà une écriture vivante de cette nature ? Un '
  'booléen : la porte de proposition refuse sans lire l''écriture du cabinet (lot S2).';

-- Repris de `20261110090100_les_refus_se_disent_par_une_cle_public` : le
-- refus d'une pièce déjà inscrite et l'effacement de la proposition ouverte
-- ne lisent plus l'écriture sous le portier.
create or replace function public.socle_ecriture_propose(p_piece uuid, p_journal text,
                                                         p_date date, p_libelle text,
                                                         p_pack_version uuid, p_lignes jsonb,
                                                         p_devise text,
                                                         p_paiement uuid default null::uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis    app.vis_t;
  v_nature text := case when p_paiement is null then 'piece' else 'reglement' end;
  v_ecr    uuid;
  v_inscrite uuid;
  v_l      jsonb;
  v_i      smallint := 0;
  v_devise_du_dossier text;
  v_controles jsonb;
  v_cours_juge uuid;
begin
  -- Le verrou de la pièce sérialise deux clics, deux onglets, deux personnes.
  -- Une photo reprise se lit à sa version courante : c'est elle qu'on
  -- verrouille, et elle qui dit le dossier, l'établissement et le côté.
  select tenant_id, entity_id, vis into v_tenant, v_entity, v_vis
    from capture.pieces where id = app.version_courante(p_piece) for update;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  -- Les livres d'un dossier sont dans SA devise : une pièce en devise se
  -- convertit avant (la proposition le fait, au cours de la règle de change).
  select o.currency into v_devise_du_dossier from identity.organizations o where o.id = v_tenant;
  if p_devise is distinct from v_devise_du_dossier then
    raise exception 'refus.ecriture.devise_du_dossier' using errcode = '22023';
  end if;
  -- Une ligne convertie porte LE cours de la pièce, jamais un autre (revue de
  -- #148 : la porte recopiait le cours, le taux et l'origine qu'on lui
  -- donnait). Ce cours est celui que le DERNIER jugement de la pièce a lu,
  -- jugement encore à jour ; la devise d'origine est celle du cours, le taux
  -- celui du cours pour une unité.
  if exists (select 1 from jsonb_array_elements(p_lignes) l
              where nullif(l ->> 'cours_id', '') is not null
                 or nullif(l ->> 'devise_origine', '') is not null) then
    -- Le jugement que la proposition a lu : celui de cette pièce.
    select a.controles into v_controles
      from capture.analyses a
     where a.piece_id = p_piece
     order by a.created_at desc
     limit 1;
    select (k -> 'preuves' -> 'cours' ->> 'id')::uuid into v_cours_juge
      from jsonb_array_elements(case when jsonb_typeof(v_controles) = 'array' then v_controles
                                     else '[]'::jsonb end) k
     where k ->> 'code' = 'cours_de_change' and k ->> 'statut' = 'reserve'
     limit 1;
    if v_cours_juge is null or not app.cours_du_jugement_a_jour(v_tenant, v_controles) then
      raise exception 'refus.ecriture.cours_perime' using errcode = '22023';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(p_lignes) l
       where (nullif(l ->> 'cours_id', '') is not null
              or nullif(l ->> 'devise_origine', '') is not null)
         and (nullif(l ->> 'cours_id', '')::uuid is distinct from v_cours_juge
          or (l ->> 'montant_origine') is null
          or not app.cours_de_la_ligne_conforme(v_cours_juge, l ->> 'devise_origine',
                                                v_devise_du_dossier,
                                                (l ->> 'taux_de_change')::numeric))) then
      raise exception 'refus.ecriture.cours_de_la_ligne' using errcode = '22023';
    end if;
  end if;
  if p_paiement is not null
     and not exists (select 1 from capture.paiements
                      where id = p_paiement and piece_id = p_piece) then
    raise exception 'refus.ecriture.reglement_d_une_autre_piece' using errcode = '22023';
  end if;

  -- Un règlement inscrit l'est une fois : redemander rend la même écriture —
  -- le règlement est lisible de la PME qui le demande.
  select e.id into v_inscrite
    from socle.ecritures e
   where e.piece_id = p_piece and e.nature = v_nature
     and e.paiement_id is not distinct from p_paiement
     and app.ecriture_vivante(e.id)
   limit 1;
  if v_inscrite is not null and v_nature = 'reglement' then
    return v_inscrite;
  end if;
  -- Une pièce déjà inscrite se réimpute, elle ne se propose pas : la base le
  -- dit, même quand l'écriture est celle du cabinet, que la PME ne lit pas.
  if v_inscrite is not null
     or app.piece_a_une_ecriture_vivante(p_piece, v_nature, p_paiement) then
    raise exception 'refus.ecriture.reimputer'
      using errcode = 'check_violation', hint = 'piece.deja_inscrite';
  end if;

  -- La proposition ouverte qu'on remplace, quel qu'en soit l'auteur.
  if v_nature = 'piece' then
    perform app.piece_oublie_ses_propositions(p_piece);
  else
    delete from socle.ecritures
     where piece_id = p_piece and status = 'proposee' and reverses_id is null
       and nature = v_nature and paiement_id is not distinct from p_paiement;
  end if;

  insert into socle.ecritures (tenant_id, entity_id, piece_id, vis, journal,
                               date_ecriture, devise, libelle, pack_version_id,
                               nature, paiement_id)
  values (v_tenant, v_entity, p_piece, v_vis, p_journal, p_date, p_devise,
          p_libelle, p_pack_version, v_nature, p_paiement)
  returning id into v_ecr;

  for v_l in select * from jsonb_array_elements(p_lignes)
  loop
    v_i := v_i + 1;
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit, tax_code,
                                       devise_origine, montant_origine, taux_de_change, cours_id)
    values (v_tenant, v_ecr, v_i, v_l->>'account_code', v_l->>'libelle',
            coalesce((v_l->>'debit')::numeric, 0),
            coalesce((v_l->>'credit')::numeric, 0),
            nullif(v_l->>'tax_code',''),
            nullif(v_l->>'devise_origine', ''),
            (v_l->>'montant_origine')::numeric,
            (v_l->>'taux_de_change')::numeric,
            (v_l->>'cours_id')::uuid);
  end loop;

  -- Seule l'écriture de la facture fait avancer la pièce.
  if v_nature = 'piece' then
    update capture.pieces
       set status = case when status in ('capturee','lue','retournee') then 'proposee' else status end,
           updated_at = now()
     where id = p_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_tenant, auth.uid(), 'ecriture.proposed', 'socle', 'ecritures', v_ecr,
          jsonb_build_object('piece_id', p_piece, 'pack_version_id', p_pack_version,
                             'nature', v_nature, 'paiement_id', p_paiement,
                             'lignes', jsonb_array_length(p_lignes)));

  return v_ecr;
end $function$;

commit;
