-- La PME ne voit jamais les écritures (lot S2 ; audit de sécurité du
-- 6 novembre 2026, constat S2).
--
-- La règle, décidée par le dirigeant : « la PME ne voit jamais les
-- écritures ». Elle n'était pas tenue. `20261104090000` ouvrait
-- `socle.ecritures` et `socle.ecriture_lignes` à `societe.tout_voir` — le
-- droit du DIRIGEANT de PME — et à tout membre pour une pièce qu'il lit
-- (`app.piece_lisible`, donc l'AUTEUR de la pièce, même siège). Reproduit :
-- après la prise en charge d'une pièce d'un siège, les deux dirigeants et le
-- siège auteur lisaient l'écriture et ses lignes en SQL, et par
-- `office.ecrituresForPiece`, `office.ecrituresByIds`, `office.periodeLignes`
-- (`socle_periode_lignes`, `security invoker`) et `supervision.auditForPiece`
-- (le fait `ecriture.booked`, avec l'identifiant du comptable).
--
-- Ce que fait cette migration :
--
-- 1. UN DOSSIER CONFIÉ se reconnaît à un engagement actif d'un cabinet, à la
--    date du jour — la même fenêtre qu'`app.engaged_orgs()`. Là, les
--    écritures se lisent du cabinet engagé (par ses droits de cabinet,
--    inchangés) et de la plateforme réquisitionnée (`app.plateforme_requise`,
--    inchangée), de PERSONNE de la PME — hors ses écritures de RÈGLEMENT,
--    geste qui reste le sien (exception nommée au §2, INCERTAIN).
--    `app.mes_dossiers_sans_cabinet()`
--    rend les organisations de l'appelant qui n'en ont pas : sans argument,
--    elle se calcule une fois par requête (InitPlan), jamais ligne à ligne.
--
-- 2. UN DOSSIER SANS CABINET (autonome, ou le cabinet d'un cabinet) : RIEN NE
--    CHANGE dans ce lot. Il tient lui-même ses livres (« en mandat, la PME
--    n'inscrit pas l'écriture d'une pièce ; un dossier autonome, si ») et
--    les lit par les mêmes branches qu'hier. Appliquer « jamais » à la
--    lettre l'aurait laissé sans personne pour lire ses propres écritures :
--    la question est portée au dirigeant (décision ouverte, INCERTAIN).
--
-- 3. LE JOURNAL D'AUDIT : un fait qui porte sur une écriture (`socle` ·
--    `ecritures` ou `ecriture_lignes`) d'un dossier confié ne se lit plus
--    côté PME — ni par la branche du membre, ni par « ce qu'on a fait
--    soi-même ». Le cabinet engagé et la plateforme : inchangés.
--
-- 4. LA TVA DU MOIS de la PME range une pièce prise en charge au jour de
--    son écriture : ce jour, et lui seul, sort par
--    `app.jours_des_ecritures_du_dossier`. Les portes de la PME (au
--    portier) gardent leur lecture d'hier, et les deux contrôles différés
--    d'une écriture passent en `security definer` (voir §2 et §3).
--
-- 5. L'ACCUEIL DE LA PME comparait ses charges d'un mois à l'autre en
--    lisant les LIGNES de la période (`periodeLignes`). Il lit désormais
--    `public.socle_totaux_par_classe` : des totaux débit/crédit par mois et
--    par classe du plan (la classe que le pack de l'écriture dit, préfixe le
--    plus long), jamais une ligne, un compte, un journal ou une écriture.
--    C'est exactement ce que l'écran affiche — un pourcentage de charges —
--    et le moteur du compte de résultat le calcule toujours (R3).
--    `security definer` au propriétaire des migrations, et non au portier :
--    c'est une LECTURE que la RLS, désormais, refuse à la PME ; le portier,
--    membre d'`authenticated`, n'y verrait rien. Elle porte donc sa garde :
--    qui voit toute la société (`societe.tout_voir`), le cabinet engagé, la
--    plateforme réquisitionnée.
--
-- REJEU (R11) : `create or replace`, `drop policy if exists` ; aucune donnée
-- de référence n'est écrite.

begin;

-- --- 1. Les dossiers de l'appelant qu'aucun cabinet ne tient ----------------------------------------

create or replace function app.mes_dossiers_sans_cabinet()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
    from app.member_orgs() m(id)
   where not exists (select 1 from identity.engagements g
                      where g.pme_org_id = m.id
                        and g.status = 'actif'
                        and g.starts_on <= current_date
                        and (g.ends_on is null or g.ends_on >= current_date))
$$;

revoke all on function app.mes_dossiers_sans_cabinet() from public, anon;
grant execute on function app.mes_dossiers_sans_cabinet() to authenticated;

comment on function app.mes_dossiers_sans_cabinet() is
  'Les organisations de l''appelant sans engagement actif d''un cabinet : là seulement, la PME '
  'lit ses écritures (« la PME ne voit jamais les écritures » d''un dossier confié, lot S2).';

-- --- 2. Les écritures et leurs lignes ---------------------------------------------------------------

-- Une exception, nommée : le RÈGLEMENT (`nature = 'reglement'`). Il reste un
-- geste de la PME en mandat (`pme.regler`, `office.inscrireLeReglement`) :
-- elle en voit la proposition, ligne à ligne, avant de l'inscrire
-- (`office.propositionDeReglement`), et l'API relit sous son identité ce
-- qu'elle vient d'inscrire (idempotence, statut, mêmes lignes). La PME lit
-- donc ses écritures de règlement, et aucune autre — question portée au
-- dirigeant avec celle du dossier autonome (INCERTAIN).
drop policy if exists socle_ecritures_sel on socle.ecritures;
create policy socle_ecritures_sel on socle.ecritures
  for select to authenticated
  using (((tenant_id in (select app.mes_dossiers_sans_cabinet()) or nature = 'reglement')
          and (tenant_id in (select app.orgs_avec_droit('societe.tout_voir'))
               or (tenant_id in (select app.member_orgs())
                   and piece_id is not null and app.piece_lisible(piece_id))))
         or (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs()))
         or app.plateforme_requise(tenant_id));

drop policy if exists socle_ecriture_lignes_sel on socle.ecriture_lignes;
create policy socle_ecriture_lignes_sel on socle.ecriture_lignes
  for select to authenticated
  using ((tenant_id in (select app.mes_dossiers_sans_cabinet())
          and (tenant_id in (select app.orgs_avec_droit('societe.tout_voir'))
               or exists (select 1 from socle.ecritures e
                           where e.id = ecriture_id and e.piece_id is not null
                             and app.piece_lisible(e.piece_id))))
         or (tenant_id in (select app.member_orgs())
             and exists (select 1 from socle.ecritures e
                          where e.id = ecriture_id and e.nature = 'reglement'
                            and (e.tenant_id in (select app.orgs_avec_droit('societe.tout_voir'))
                                 or (e.piece_id is not null and app.piece_lisible(e.piece_id)))))
         or tenant_id in (select app.engaged_orgs())
         or app.plateforme_requise(tenant_id));

-- Les PORTES de la PME, elles, continuent de voir ce qu'elles écrivent. Une
-- porte appartient au portier et s'exécute sous les politiques
-- (`20261105100000`) : proposer une écriture (`insert … returning`), la
-- transmettre avec sa pièce, enregistrer un règlement, annuler, renvoyer
-- relisent la ligne qu'elles touchent — et la PME garde ces gestes en mandat
-- (la porte refuse ensuite par sa propre clé, `refus.inscription.reservee_au_
-- cabinet`, `refus.supervision.reservee`…). Ces politiques ne valent que pour
-- le rôle `portier` : personne n'en est membre, aucune session ne l'endosse,
-- et aucune requête de l'API ne lit sous lui. Ce sont exactement les
-- branches de la PME d'avant ce lot, dans la porte et nulle part ailleurs.
drop policy if exists socle_ecritures_sel_porte on socle.ecritures;
create policy socle_ecritures_sel_porte on socle.ecritures
  for select to portier
  using (tenant_id in (select app.orgs_avec_droit('societe.tout_voir'))
         or (tenant_id in (select app.member_orgs())
             and piece_id is not null and app.piece_lisible(piece_id)));

drop policy if exists socle_ecriture_lignes_sel_porte on socle.ecriture_lignes;
create policy socle_ecriture_lignes_sel_porte on socle.ecriture_lignes
  for select to portier
  using (tenant_id in (select app.orgs_avec_droit('societe.tout_voir'))
         or (tenant_id in (select app.member_orgs())
             and exists (select 1 from socle.ecritures e
                          where e.id = ecriture_id and e.piece_id is not null
                            and app.piece_lisible(e.piece_id))));

-- --- 3. Le journal d'audit : les faits d'une écriture d'un dossier confié -----------------------------
--
-- Repris de `20261104110000_le_journal_d_audit_suit_la_piece`, une garde en
-- plus sur les deux branches de la PME.

drop policy if exists audit_event_log_sel on audit.event_log;
create policy audit_event_log_sel on audit.event_log
  for select to authenticated
  using ((select app.is_platform())
         or (((actor = (select auth.uid())
               and (tenant_id in (select app.member_orgs())
                    or tenant_id in (select app.engaged_orgs())
                    or app.evenement_de_mon_espace(object_schema, object_table, object_id,
                                                   payload)))
              or (tenant_id in (select app.member_orgs())
                  and app.evenement_lisible_du_membre(tenant_id, object_schema, object_table,
                                                      object_id, payload)))
             -- Une écriture d'un dossier confié ne regarde que le cabinet —
             -- hors les faits du règlement (`reglement.*`), geste de la PME
             -- dont l'inscription relit la qualification (voir §2).
             and not (object_schema = 'socle'
                      and object_table in ('ecritures', 'ecriture_lignes')
                      and action not like 'reglement.%'
                      and tenant_id not in (select app.mes_dossiers_sans_cabinet())
                      and tenant_id not in (select app.engaged_orgs())))
         -- Ce que se disent le siège et le propriétaire ne regarde pas le comptable.
         or (tenant_id in (select app.engaged_orgs())
             and coalesce(payload ->> 'chez', '') <> 'proprietaire'
             and app.evenement_lisible_du_cabinet(object_schema, object_table, object_id,
                                                  payload)));

-- La porte qui consigne le fait d'une écriture le relit (`insert … returning`,
-- `on conflict`) : sous le portier, et sous lui seul, les deux branches de la
-- PME d'avant ce lot (voir §2).
drop policy if exists audit_event_log_sel_porte on audit.event_log;
create policy audit_event_log_sel_porte on audit.event_log
  for select to portier
  using ((actor = (select auth.uid())
          and (tenant_id in (select app.member_orgs())
               or app.evenement_de_mon_espace(object_schema, object_table, object_id, payload)))
         or (tenant_id in (select app.member_orgs())
             and app.evenement_lisible_du_membre(tenant_id, object_schema, object_table,
                                                 object_id, payload)));

-- Les deux contrôles DIFFÉRÉS d'une écriture (`ecriture_proposee_equilibree`,
-- `ecriture_inscrite_dans_son_plan`) somment ses lignes au COMMIT : la porte
-- est alors sortie, et le rôle courant est redevenu celui du client — qui,
-- dans un dossier confié, ne voit plus ces lignes. Lues sous sa RLS, la somme
-- valait zéro et une écriture équilibrée était refusée. Ils passent en
-- `security definer` : ils ne rendent rien qu'un refus ou rien, et ne lisent
-- que les lignes de l'écriture qui les déclenche.
alter function app.ecriture_proposee_equilibree() security definer;
alter function app.ecriture_inscrite_dans_son_plan() security definer;

-- --- 4. Le jour de l'écriture d'une pièce, pour la TVA du mois -------------------------------------
--
-- La TVA du mois de la PME (`office.extraitsTransmis`) range une pièce prise
-- en charge au jour de son écriture vivante — la date de la facture que le
-- cabinet a inscrite (25 octobre 2026) — et elle lisait ce jour en joignant
-- `ecritures_v` sous la RLS de la PME. Elle n'y voit plus rien : la date, et
-- elle seule, sort par cette fonction, pour les pièces que l'appelant lit. Les
-- montants pris en charge sortent déjà ainsi (`app.montants_pris_en_charge`).
-- Une fonction d'ensemble, appelée UNE fois par lecture du mois et jointe par
-- pièce : par pièce, elle coûtait un appel et un `piece_lisible` de plus à
-- chacune (`la-tva-du-mois-tient-la-charge`). Qui voit toute la société, le
-- cabinet engagé et la plateforme réquisitionnée lisent le dossier entier ;
-- un siège, les pièces qu'il lit — la règle d'hier, sous la RLS.

create or replace function app.jours_des_ecritures_du_dossier(p_tenant uuid)
returns table (piece_id uuid, jour date)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (e.piece_id) e.piece_id, e.date_ecriture
    from socle.ecritures e
   where e.tenant_id = p_tenant
     and e.nature = 'piece' and e.status = 'booked'
     and e.reverses_id is null
     and not exists (select 1 from socle.ecritures r
                      where r.reverses_id = e.id and r.status = 'booked')
     and (p_tenant in (select app.orgs_avec_droit('societe.tout_voir'))
          or p_tenant in (select app.engaged_orgs())
          or app.plateforme_requise(p_tenant)
          or (p_tenant in (select app.member_orgs()) and app.piece_lisible(e.piece_id)))
   order by e.piece_id, e.created_at desc
$$;

revoke all on function app.jours_des_ecritures_du_dossier(uuid) from public, anon;
grant execute on function app.jours_des_ecritures_du_dossier(uuid) to authenticated;

-- De même le cours de change de cette écriture (`conversionsDesPieces`) : une
-- pièce en devise inscrite garde, dans la TVA et « Vos charges » de la PME,
-- le cours auquel le cabinet l'a inscrite (revue de #148). L'identifiant du
-- cours, rien d'autre.
create or replace function app.cours_de_l_ecriture_de_la_piece(p_piece uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.cours_id
    from socle.ecritures e
    join socle.ecriture_lignes l on l.ecriture_id = e.id
   where e.piece_id = p_piece
     and e.nature = 'piece' and e.status = 'booked' and e.reverses_id is null
     and not exists (select 1 from socle.ecritures r
                      where r.reverses_id = e.id and r.status = 'booked')
     and l.cours_id is not null
     and app.piece_lisible(p_piece)
   limit 1
$$;

revoke all on function app.cours_de_l_ecriture_de_la_piece(uuid) from public, anon;
grant execute on function app.cours_de_l_ecriture_de_la_piece(uuid) to authenticated;

-- --- 5. L'accueil de la PME : des totaux par classe et par mois --------------------------------------

create or replace function public.socle_totaux_par_classe(
  p_tenant uuid,
  p_from date,
  p_to date
) returns table (
  mois text,
  classe text,
  debit numeric(38,3),
  credit numeric(38,3)
)
language sql
stable
security definer
set search_path = ''
as $$
  -- La définition de « comptabilisé » est celle de `socle_periode_lignes` :
  -- une écriture `booked` de la période, contre-passations comprises (elles
  -- s'annulent dans la somme).
  select to_char(e.date_ecriture, 'YYYY-MM'), c.prefix, sum(l.debit), sum(l.credit)
    from socle.ecritures e
    join socle.ecriture_lignes l on l.ecriture_id = e.id
    cross join lateral (
      select k.prefix
        from ref.account_classes k
       where k.pack_version_id = e.pack_version_id
         and starts_with(l.account_code, k.prefix)
         and k.valid_from <= e.date_ecriture
         and (k.valid_to is null or k.valid_to >= e.date_ecriture)
       order by length(k.prefix) desc
       limit 1) c
   where e.tenant_id = p_tenant
     and e.status = 'booked'
     and e.date_ecriture between p_from and p_to
     and (p_tenant in (select app.orgs_avec_droit('societe.tout_voir'))
          or p_tenant in (select app.engaged_orgs())
          or app.plateforme_requise(p_tenant))
   group by 1, 2
   order by 1, 2
$$;

revoke all on function public.socle_totaux_par_classe(uuid, date, date) from public, anon;
grant execute on function public.socle_totaux_par_classe(uuid, date, date) to authenticated;

comment on function public.socle_totaux_par_classe(uuid, date, date) is
  'L''accueil de la PME : débit et crédit comptabilisés par mois et par classe du plan, jamais '
  'une ligne ni un compte (lot S2). Qui voit toute la société, le cabinet engagé, la plateforme '
  'réquisitionnée.';

commit;
