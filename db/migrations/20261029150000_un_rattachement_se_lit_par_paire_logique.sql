-- Un rattachement se lit par paire LOGIQUE, à travers la version courante.
--
-- Revue Codex de #127 : A rattaché à C, A remplacé par B — `piece_remplacer`
-- COPIAIT le lien vers B —, puis on détache C de B. `rattachements_v`
-- résolvait par paire PHYSIQUE : le dernier fait de (B, C) disait « detache »,
-- celui de (A, C) disait toujours « rattache », et le dossier lié, qui lit
-- chaque bout à sa version courante, ressuscitait le lien A→B–C.
--
-- Même cause que la revue précédente : on copiait à la reprise ce qui doit se
-- LIRE à travers la version courante. La règle va jusqu'au bout :
--
--   l'état d'une paire est le dernier fait parmi tous ceux dont les deux bouts
--   ont la même version courante. Les faits historiques ne bougent pas (R7) ;
--   seule leur lecture change.
--
-- Conséquences :
--   - `rattachements_v` (la vue qui fait foi) rend la paire résolue, sans
--     paire réflexive, dernier fait gagnant. Tout ce qui la lit — dossier lié,
--     fiche (`piecesRattachees`), preuve « rattachement » de `piece_retour` —
--     suit sans changement ;
--   - `capture.dernier_fait_de_la_paire` lit cette même vue : une seule règle ;
--   - `piece_rattacher` / `piece_detacher` écrivent le fait sur les pièces
--     NOMMÉES, plus sur l'orientation physique du fait précédent — qui pouvait
--     désigner une version précédente. Nommer une version précédente est refusé
--     par `pas_de_geste_sur_une_version_precedente` (refus.piece.remplacee) ;
--   - `piece_remplacer` ne copie plus aucun rattachement.

-- ---------------------------------------------------------------------------
-- 1. La vue qui fait foi : paire logique, dernier fait gagnant.
--    `tenant_id` mène la clé : un filtre par dossier descend sous le DISTINCT.
create or replace view public.rattachements_v with (security_invoker = true) as
  select distinct on (r.tenant_id, least(x.a, x.b), greatest(x.a, x.b))
         r.id, r.tenant_id, x.a as piece_id, x.b as piece_liee_id,
         r.fait, r.motif, r.auteur, r.created_at
    from capture.rattachements r
   cross join lateral (select app.version_courante(r.piece_id) as a,
                              app.version_courante(r.piece_liee_id) as b) x
   where x.a <> x.b
   order by r.tenant_id, least(x.a, x.b), greatest(x.a, x.b), r.created_at desc, r.rang desc;

revoke all on table public.rattachements_v from public, anon, service_role;
grant select on table public.rattachements_v to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Le dernier fait d'une paire, dans les deux sens, lu dans la vue.
create or replace function capture.dernier_fait_de_la_paire(p_a uuid, p_b uuid)
returns table (piece_id uuid, piece_liee_id uuid, fait text)
language sql
stable
set search_path = ''
as $$
  select r.piece_id, r.piece_liee_id, r.fait
    from public.rattachements_v r
   cross join lateral (select app.version_courante(p_a) as a,
                              app.version_courante(p_b) as b) x
   where r.tenant_id = (select p.tenant_id from capture.pieces p where p.id = p_a)
     and least(r.piece_id, r.piece_liee_id) = least(x.a, x.b)
     and greatest(r.piece_id, r.piece_liee_id) = greatest(x.a, x.b)
$$;

revoke all on function capture.dernier_fait_de_la_paire(uuid, uuid) from public, anon;
grant execute on function capture.dernier_fait_de_la_paire(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Rattacher : le fait porte les pièces nommées.
create or replace function public.piece_rattacher(p_piece uuid, p_liee uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tenant_liee uuid;
  v_vis app.vis_t;
  v_vis_liee app.vis_t;
  v_paire record;
begin
  if p_piece = p_liee then
    raise exception 'Une pièce ne se rattache pas à elle-même.'
      using errcode = 'check_violation';
  end if;
  -- Les deux lignes sont verrouillées dans un ordre fixe : deux rattachements
  -- croisés (A→B et B→A au même instant) ne s'attendent pas l'un l'autre.
  perform 1 from capture.pieces
   where id in (p_piece, p_liee) order by id for update;
  select tenant_id, vis into v_tenant, v_vis from capture.pieces where id = p_piece;
  select tenant_id, vis into v_tenant_liee, v_vis_liee from capture.pieces where id = p_liee;
  if v_tenant is null or v_tenant_liee is null
     or v_tenant not in (select app.member_orgs()) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_tenant <> v_tenant_liee then
    raise exception 'Les deux pièces ne sont pas dans le même dossier.'
      using errcode = 'check_violation';
  end if;
  if v_vis = 'personnel'::app.vis_t or v_vis_liee = 'personnel'::app.vis_t then
    raise exception
      'Une pièce de votre espace privé ne se rattache pas : elle n''est pas à la société.'
      using errcode = 'check_violation';
  end if;

  select * into v_paire from capture.dernier_fait_de_la_paire(p_piece, p_liee);
  if found and v_paire.fait = 'rattache' then
    return jsonb_build_object('piece_id', p_piece, 'piece_liee_id', p_liee, 'deja', true);
  end if;

  insert into capture.rattachements (tenant_id, piece_id, piece_liee_id, fait, auteur)
  values (v_tenant, p_piece, p_liee, 'rattache', auth.uid());
  return jsonb_build_object('piece_id', p_piece, 'piece_liee_id', p_liee, 'deja', false);
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Détacher : idem. Sur une version précédente, le garde d'insertion refuse.
create or replace function public.piece_detacher(p_piece uuid, p_liee uuid, p_motif text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_paire record;
begin
  perform 1 from capture.pieces
   where id in (p_piece, p_liee) order by id for update;
  select tenant_id into v_tenant from capture.pieces where id = p_piece;
  if v_tenant is null or v_tenant not in (select app.member_orgs()) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if p_motif is null or length(trim(p_motif)) = 0 then
    raise exception 'Dites pourquoi vous détachez ce document.'
      using errcode = 'check_violation';
  end if;
  select * into v_paire from capture.dernier_fait_de_la_paire(p_piece, p_liee);
  if not found or v_paire.fait <> 'rattache' then
    raise exception 'Ce document n''est pas rattaché à cette pièce.'
      using errcode = 'check_violation';
  end if;
  insert into capture.rattachements (tenant_id, piece_id, piece_liee_id, fait, motif, auteur)
  values (v_tenant, p_piece, p_liee, 'detache', trim(p_motif), auth.uid());
  return jsonb_build_object('piece_id', p_piece, 'piece_liee_id', p_liee);
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Reprendre la photo : plus aucune copie de rattachement.
--
-- Ce qui reste, et pourquoi chaque ligne ne peut pas se lire à travers la
-- version courante :
--   - les colonnes de la NOUVELLE pièce (vis, entity_id, transmise_le,
--     gardee_le, status, document_kind) : la règle se lit de l'ancienne vers
--     la courante, et la courante, c'est elle. Les lire en remontant la chaîne
--     obligerait chaque lecteur (politiques RLS, file du cabinet, garde de
--     licence, compteurs) à remonter aussi ;
--   - le fait « retiree » sur les demandes en attente de l'ancienne : ce n'est
--     pas une copie, c'est la clôture datée d'une demande devenue sans objet ;
--   - l'oubli des propositions de l'ancienne : un effacement, pas une copie ;
--   - le journal et la notification : des événements.
create or replace function public.piece_remplacer(p_ancienne uuid, p_nouvelle uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  n record;
begin
  -- Les deux lignes, dans un ordre fixe : deux remplacements croisés ne
  -- s'attendent pas l'un l'autre.
  perform 1 from capture.pieces where id in (p_ancienne, p_nouvelle) order by id for update;
  select * into a from capture.pieces where id = p_ancienne;
  select * into n from capture.pieces where id = p_nouvelle;

  -- `security definer` court-circuite la RLS : le contrôle est refait ici.
  if a.id is null or n.id is null or p_ancienne = p_nouvelle
     or a.tenant_id <> n.tenant_id
     or a.tenant_id not in (select app.member_orgs())
     or not app.piece_lisible(p_ancienne) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  if exists (select 1 from capture.remplacements r
              where r.piece_id = p_ancienne and r.remplacee_par = p_nouvelle) then
    return jsonb_build_object('piece_id', p_nouvelle, 'remplace', p_ancienne, 'deja', true);
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_ancienne) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  -- Un reçu, un justificatif : ils ont leur propre reprise (`justificatif_remplacer`).
  if a.source_piece_id is not null or app.piece_accompagne(p_ancienne) then
    raise exception 'refus.remplacement.accompagne' using errcode = 'check_violation';
  end if;

  -- Une pièce prise en charge porte une écriture : le cabinet la retourne
  -- d'abord (contre-passation), puis la photo se reprend.
  if a.status in ('comptabilisee', 'supervisee')
     or exists (select 1 from socle.ecritures e
                 where e.piece_id = p_ancienne and e.status = 'booked'
                   and app.ecriture_vivante(e.id)) then
    raise exception 'refus.remplacement.inscrite' using errcode = 'check_violation';
  end if;

  -- La nouvelle est une photo qui vient d'être prise, par celui qui remplace,
  -- et rien d'autre : jamais une pièce lue, issue d'une autre, ou déjà liée.
  if n.status <> 'capturee'
     or n.created_by is distinct from auth.uid()
     or n.source_piece_id is not null
     or exists (select 1 from capture.extractions x where x.piece_id = p_nouvelle)
     or exists (select 1 from capture.remplacements r
                 where r.remplacee_par = p_nouvelle or r.piece_id = p_nouvelle) then
    raise exception 'refus.remplacement.nouvelle_photo' using errcode = 'check_violation';
  end if;

  insert into capture.remplacements (tenant_id, piece_id, remplacee_par, auteur)
  values (a.tenant_id, p_ancienne, p_nouvelle, auth.uid());

  -- La nouvelle hérite du partage de l'ancienne : ce n'est pas une nouvelle
  -- transmission, et un impayé ne doit pas empêcher de corriger une pièce
  -- déjà envoyée (`une_piece_transmise_exige_une_licence_active` le lit).
  perform set_config('malica.remplacement', p_nouvelle::text, true);
  update capture.pieces
     set vis = a.vis,
         entity_id = coalesce(n.entity_id, a.entity_id),
         transmise_le = a.transmise_le,
         gardee_le = a.gardee_le,
         -- Le retour en cours suit la photo ; sinon, elle part en lecture.
         status = case when a.status = 'retournee' then 'retournee' else 'capturee' end,
         -- Le type déclaré suit, à confirmer : la lecture aura le dernier mot.
         document_kind = coalesce(n.document_kind, a.document_kind),
         document_kind_statut = case
           when n.document_kind is not null then n.document_kind_statut
           when a.document_kind is not null then 'a_confirmer'
           else n.document_kind_statut end,
         updated_at = now()
   where id = p_nouvelle;
  perform set_config('malica.remplacement', '', true);

  -- Les documents rattachés à l'ancienne ne se recopient pas : `rattachements_v`
  -- les lit à travers la version courante.

  -- Une demande en attente sur l'ancienne n'a plus d'objet : on inscrit le
  -- fait qui la clôt — la ligne « demandee » reste, R7.
  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur)
  select a.tenant_id, p_ancienne, d.objet, 'retiree', null, auth.uid()
    from (select distinct on (x.objet) x.objet, x.fait
            from collab.demandes_sur_piece x
           where x.piece_id = p_ancienne
           order by x.objet, x.created_at desc) d
   where d.fait = 'demandee';

  perform app.piece_oublie_ses_propositions(p_ancienne);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (a.tenant_id, auth.uid(), 'piece.remplacee', 'capture', 'pieces', p_nouvelle,
          jsonb_build_object('remplace', p_ancienne, 'vis', a.vis, 'status', a.status));

  if a.vis = 'partage'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (a.tenant_id, 'piece.remplacee',
            jsonb_build_object('piece_id', p_nouvelle, 'remplace', p_ancienne));
  end if;

  return jsonb_build_object('piece_id', p_nouvelle, 'remplace', p_ancienne, 'deja', false);
end
$$;

comment on view public.rattachements_v is
  'État courant de chaque paire LOGIQUE : les deux bouts lus à leur version '
  'courante, dernier fait gagnant. Les faits de capture.rattachements ne '
  'bougent pas (R7) ; seule leur lecture suit les photos reprises.';
