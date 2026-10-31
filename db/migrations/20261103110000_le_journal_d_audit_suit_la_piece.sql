-- Le journal d'audit suit la pièce (revue indépendante de #146, P1 et P3-6).
--
-- Relevé par la revue, le 30 octobre 2026 : `audit_event_log_sel`
-- (`20260825211034`) ouvrait TOUT le journal d'une société à chacun de ses
-- membres, et au cabinet engagé. Or le lot 4 y écrit des textes privés — la
-- note du propriétaire qui retourne une pièce à un siège
-- (`piece.retournee_au_siege`), la réponse du siège (`piece.reponse_client`).
-- Par `supervision.auditForPiece` ou `journalDuMandat`, un siège lisait les
-- notes faites à un autre, et le comptable l'échange siège ↔ propriétaire sur
-- une pièce qu'on ne lui avait jamais envoyée.
--
-- La règle de lecture d'un fait est désormais celle de sa pièce :
--   - chacun lit les faits qu'il a faits ;
--   - un membre, ceux d'une pièce qu'il lit (la règle de `app.piece_lisible`,
--     une pièce archivée restant au journal de qui voit toute la société) ;
--     ceux qui ne portent sur aucune pièce, s'il voit toute la société
--     (`societe.tout_voir`) ;
--   - le cabinet engagé, ceux d'une pièce qu'il connaît
--     (`app.piece_connue_du_cabinet`) et ceux qui ne portent sur aucune pièce
--     (son mandat, ses écritures) — jamais un fait du passage interne
--     (`chez` = propriétaire, posé par les portes de `20261103090000`) ;
--   - la plateforme : inchangée.
-- Une pièce effacée n'a plus de règle : le fait qui en reste se lit de qui
-- voit toute la société, sauf s'il venait de Mon espace ; du cabinet, s'il
-- venait d'une pièce partie chez lui (`vis` du fait).
--
-- Les autres tables où ce lot écrit un texte libre suivent déjà la pièce :
-- `capture.circuit` (membres, `piece_lisible`), `collab.notifications`
-- (`app.notification_lisible`), `collab.demandes_sur_piece` (membres,
-- `piece_lisible` ; le cabinet, les seules demandes qui lui sont faites, sur
-- une pièce partagée), `capture.vues` (le cabinet ne lit pas celles du
-- propriétaire).
--
-- Et `app.pieces_prises_en_charge()` (`20261101090000`), lue sans RLS, rendait
-- à un siège l'identifiant des pièces prises en charge des autres (P3-6).

begin;

-- --- 1. La pièce d'un fait ---------------------------------------------------------------------------
--
-- Un fait porte sur une pièce par son objet (la pièce, sa lecture, son
-- paiement, son écriture), ou la nomme dans son contenu (une précision, un
-- justificatif rattaché).

create or replace function app.piece_de_l_evenement(p_schema text, p_table text, p_objet uuid,
                                                    p_payload jsonb)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case
      when p_schema = 'capture' and p_table = 'pieces' then p_objet
      when p_schema = 'capture' and p_table = 'extractions' then
        (select x.piece_id from capture.extractions x where x.id = p_objet)
      when p_schema = 'capture' and p_table = 'paiements' then
        (select pa.piece_id from capture.paiements pa where pa.id = p_objet)
      when p_schema = 'socle' and p_table = 'ecritures' then
        (select e.piece_id from socle.ecritures e where e.id = p_objet)
    end,
    case when (p_payload ->> 'piece_id') ~* '^[0-9a-f-]{36}$'
         then (p_payload ->> 'piece_id')::uuid end)
$$;

revoke all on function app.piece_de_l_evenement(text, text, uuid, jsonb) from public, anon, authenticated;

-- --- 2. Qui lit un fait ---------------------------------------------------------------------------
--
-- Le journal grandit plus vite que les pièces : la règle se juge ligne à
-- ligne, elle doit coûter peu. Ce qui ne dépend que de l'appelant (qui il
-- est, ses organisations, s'il voit toute la société) s'écrit dans la
-- politique, en sous-requêtes non corrélées — calculées une fois par
-- requête ; la fonction ne reçoit que ce qui dépend de la ligne, et lit UNE
-- ligne de pièce. Mesuré le 30 octobre 2026 (base de test, société de 376
-- faits, tout le journal lu) : 231 → 36 ms pour le propriétaire, 953 → 103 ms
-- pour le cabinet, par rapport à `app.piece_lisible` appelée par ligne. Le
-- journal d'une société se lit par `event_log_tenant_idx` (tenant, at desc) :
-- une liste limitée s'arrête aux N premiers faits lisibles.
--
-- La règle d'un membre est celle de `app.piece_lisible`, appliquée à la
-- version courante : Mon espace à son auteur seul ; la société à qui la voit
-- toute, ou à son auteur. Une pièce archivée (effacée, son écriture gardée)
-- reste au journal de qui voit toute la société.

create or replace function app.evenement_lisible_du_membre(p_tout_voir boolean, p_schema text,
                                                          p_table text, p_objet uuid,
                                                          p_payload jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_piece uuid;
  v_vis   app.vis_t;
  v_auteur uuid;
begin
  v_piece := app.piece_de_l_evenement(p_schema, p_table, p_objet, p_payload);
  if v_piece is null then
    return p_tout_voir;
  end if;
  select p.vis, p.created_by into v_vis, v_auteur
    from capture.pieces p where p.id = app.version_courante(v_piece);
  if not found then
    return p_tout_voir and coalesce(p_payload ->> 'vis', '') <> 'personnel';
  end if;
  if v_vis = 'personnel'::app.vis_t then
    return v_auteur = auth.uid();
  end if;
  return p_tout_voir or v_auteur = auth.uid();
end
$$;

revoke all on function app.evenement_lisible_du_membre(boolean, text, text, uuid, jsonb) from public, anon;
grant execute on function app.evenement_lisible_du_membre(boolean, text, text, uuid, jsonb) to authenticated;

-- Le cabinet : une pièce qu'il connaît (`app.piece_connue_du_cabinet`, qui
-- couvre la pièce partagée et celle archivée après inscription) ; une pièce
-- effacée, si elle était partie chez lui.
create or replace function app.evenement_lisible_du_cabinet(p_schema text, p_table text,
                                                           p_objet uuid, p_payload jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_piece uuid;
begin
  v_piece := app.piece_de_l_evenement(p_schema, p_table, p_objet, p_payload);
  if v_piece is null then
    return true;
  end if;
  if exists (select 1 from capture.pieces p where p.id = v_piece) then
    return app.piece_connue_du_cabinet(app.version_courante(v_piece));
  end if;
  return coalesce(p_payload ->> 'vis', '') = 'partage';
end
$$;

revoke all on function app.evenement_lisible_du_cabinet(text, text, uuid, jsonb) from public, anon;
grant execute on function app.evenement_lisible_du_cabinet(text, text, uuid, jsonb) to authenticated;

drop policy if exists audit_event_log_sel on audit.event_log;
create policy audit_event_log_sel on audit.event_log
  for select to authenticated
  using ((select app.is_platform())
         -- Ce qu'on a fait soi-même.
         or actor = (select auth.uid())
         or (tenant_id in (select app.member_orgs())
             and app.evenement_lisible_du_membre(
                   tenant_id in (select app.orgs_avec_droit('societe.tout_voir')),
                   object_schema, object_table, object_id, payload))
         -- Ce que se disent le siège et le propriétaire ne regarde pas le comptable.
         or (tenant_id in (select app.engaged_orgs())
             and coalesce(payload ->> 'chez', '') <> 'proprietaire'
             and app.evenement_lisible_du_cabinet(object_schema, object_table, object_id,
                                                  payload)));

-- --- 3. Les pièces prises en charge : celles qu'on lit ------------------------------------------------
--
-- Repris de `20261101090000`, la lecture de la pièce en plus.

create or replace function app.pieces_prises_en_charge()
returns table (piece_id uuid, ecriture_id uuid, lisible boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with vivantes as (
    select distinct on (c.courante) c.courante, e.id
      from socle.prises_en_charge pc
      join socle.ecritures e on e.id = pc.ecriture_id
      cross join lateral (select app.version_courante(e.piece_id) as courante) c
     where pc.client_tenant_id in (select app.member_orgs() union select app.engaged_orgs())
       and e.nature = 'piece'
       and app.ecriture_vivante(e.id)
     order by c.courante, pc.prise_le desc
  )
  select v.courante, v.id,
         coalesce((app.montants_pris_en_charge(v.courante) ->> 'lisible')::boolean, false)
    from vivantes v
   where app.piece_lisible(v.courante)
$$;

commit;
