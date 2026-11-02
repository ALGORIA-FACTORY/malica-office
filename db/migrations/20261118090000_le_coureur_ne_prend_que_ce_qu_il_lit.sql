-- ======================================================================
--  Le coureur ne prend que ce que son appelant peut lire (2 novembre 2026).
--
--  LE CONSTAT (B.0 de la passe de nuit), reproduit avant d'être corrigé par
--  `apps/api/src/malica/lecture/le-coureur-ne-prend-que-ce-qu-il-lit.test.ts`.
--
--  Le coureur fait tourner la file du DOSSIER sous l'identité de celui qui
--  vient de déposer. `fabrique.travail_prendre` rendait n'importe quel
--  travail prenable du dossier ; or `app.piece_lisible` n'ouvre une pièce
--  `personnel` qu'à son auteur, et une pièce `entite` qu'à son auteur ou à qui
--  a `societe.tout_voir`. Mesuré sur la base, sous l'identité d'une
--  collaboratrice sans `tout_voir` :
--
--    lecture_piece    elle prenait la lecture de la pièce personnelle d'un
--                     collègue, butait sur `refus.introuvable.piece`, et le
--                     travail passait « en_erreur » à la PREMIÈRE tentative —
--                     plus jamais repris, la pièce jamais lue ;
--    relecture_piece  pire, et silencieux : `fabrique.relecture_a_faire`
--                     (security invoker) ne voyait pas la lecture relue, la
--                     prenait pour « dépassée », et le travail se fermait
--                     « terminé » sur une abstention fausse.
--
--  LA CORRECTION, en deux endroits et nulle part ailleurs :
--    1. `fabrique.travail_prendre` ne rend un travail de lecture ou de
--       relecture que si sa pièce est lisible par l'appelant. La génération
--       de recette vise un FORMAT, pas une pièce : elle n'est pas filtrée.
--       Le travail d'un autre attend son auteur (ou un membre qui voit tout) :
--       il n'est ni pris, ni brûlé ;
--    2. `fabrique.relecture_a_faire` refuse une pièce que l'appelant ne lit
--       pas, au lieu d'en conclure une abstention.
--
--  REJEU (R11) : `create or replace`, corps repris de leur définition EN
--  VIGUEUR (20261020180000, 20261117100100), aucune donnée de référence.
-- ======================================================================

-- --------------------------------------------- 1. Prendre ce qu'on peut lire

create or replace function fabrique.travail_prendre(
  p_tenant uuid, p_natures fabrique.travail_nature_t[] default null)
returns table (travail_id uuid, piece_id uuid, nature fabrique.travail_nature_t,
               signature_cle text, tentative smallint, fait_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  c       record;
  v_fait  uuid;
begin
  -- Sans bornes, on ne prend rien : on le dit, on ne devine pas (R4).
  perform fabrique.bornes_de_travail(p_tenant);

  for c in
    select e.travail_id, e.piece_id, e.nature, t.signature_cle, e.tentatives
      from fabrique.etat_des_travaux_v e
      join fabrique.travaux t on t.id = e.travail_id
     where e.tenant_id = p_tenant
       and e.prenable
       and (p_natures is null or e.nature = any(p_natures))
       -- Une lecture ou une relecture ne se prend que si l'appelant lit sa
       -- pièce : sinon la tentative est brûlée sur un refus (constat B.0).
       and (e.nature = 'generation_recette' or app.piece_lisible(e.piece_id))
     order by e.priorite, e.demande_le
  loop
    begin
      insert into fabrique.travail_faits (tenant_id, travail_id, tentative, nature)
      values (p_tenant, c.travail_id, (c.tentatives + 1)::smallint, 'pris')
      returning id into v_fait;
    exception
      -- Un autre preneur a eu cette tentative. On passe au suivant : ce
      -- n'est pas une panne, c'est une file qui fonctionne.
      when unique_violation then continue;
      -- L'etat a bouge entre la lecture et l'ecriture — une autre execution
      -- vient de demarrer sur la meme piece, par exemple. Meme reponse.
      when check_violation then continue;
    end;

    travail_prendre.travail_id    := c.travail_id;
    travail_prendre.piece_id      := c.piece_id;
    travail_prendre.nature        := c.nature;
    travail_prendre.signature_cle := c.signature_cle;
    travail_prendre.tentative     := (c.tentatives + 1)::smallint;
    travail_prendre.fait_id       := v_fait;
    return next;
    return;
  end loop;
  -- Rien a prendre : zero ligne, et c'est une reponse, pas une erreur.
  return;
end
$function$;

comment on function fabrique.travail_prendre(uuid, fabrique.travail_nature_t[]) is
  'Prend le travail prenable le plus prioritaire du dossier, parmi les natures dites. Une lecture '
  'ou une relecture n''est prise que si l''appelant lit sa pièce (app.piece_lisible).';

-- ---------------------------------- 2. Une pièce qu'on ne lit pas n'est pas « dépassée »

create or replace function fabrique.relecture_a_faire(p_travail uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  t record;
  x record;
  v_derniere uuid;
  v_trace text;
  v_abstention text;
begin
  select tr.id, tr.tenant_id, tr.piece_id, tr.extraction_id, tr.consigne into t
    from fabrique.travaux tr
   where tr.id = p_travail and tr.nature = 'relecture_piece';
  if t.id is null then
    raise exception 'refus.introuvable.travail' using errcode = '42501';
  end if;
  -- Sans la pièce, la lecture relue est invisible : ce n'est pas une lecture
  -- « dépassée », c'est une pièce qu'on ne lit pas (constat B.0).
  if not app.piece_lisible(t.piece_id) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  select e.id, e.created_at, e.contract, e.flags into x
    from capture.extractions e where e.id = t.extraction_id;
  select e.id into v_derniere
    from capture.extractions e
   where e.piece_id = t.piece_id
   order by e.created_at desc, e.id desc
   limit 1;

  if exists (select 1 from capture.remplacements r where r.piece_id = t.piece_id) then
    v_abstention := 'remplacee';
  elsif v_derniere is distinct from t.extraction_id then
    v_abstention := 'lecture_depassee';
  else
    v_trace := app.piece_corrigee_depuis(t.piece_id, x.created_at);
    if v_trace is not null then
      v_abstention := 'correction_humaine';
    elsif app.relecture_de_nuit(t.tenant_id) is null then
      v_abstention := 'coupee';
    end if;
  end if;

  return jsonb_build_object(
    'piece_id', t.piece_id,
    'extraction_id', t.extraction_id,
    'contract', x.contract,
    'flags', coalesce(x.flags, '[]'::jsonb),
    'consigne', t.consigne,
    'abstention', v_abstention,
    'trace', v_trace);
end
$function$;
