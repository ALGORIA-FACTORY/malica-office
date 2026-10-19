-- Le mandat se lit et se révoque depuis la PME ; la retenue à la source d'un
-- règlement se constate (19 octobre 2026).
--
-- ============================================================ LE MANDAT
--
-- Les réglages de la PME portaient deux boutons éteints sous chaque société :
-- « Voir le mandat » et « Révoquer ». La raison écrite à côté : `identite` sait
-- proposer un mandat et y répondre, pas le lire ni le révoquer depuis la PME.
-- Le dirigeant a demandé le 19 octobre que « tous les boutons fonctionnent ».
--
-- La règle de sortie est arrêtée depuis le 16 octobre (scénarios D) : le
-- client change de comptabilité IMMÉDIATEMENT, sans l'accord de la sortante —
-- l'archive restée chez elle satisfait seule son obligation de conservation.
-- La révocation est donc un geste du dirigeant, seul, motivé, daté, et elle
-- s'inscrit au journal des DEUX organisations : la comptabilité doit lire
-- pourquoi elle perd un dossier, et le client pourra le relire dans dix ans.
--
-- Ce que la révocation NE fait PAS : elle ne touche ni la licence ni son
-- paiement. Un dossier dont la licence est portée par la comptabilité garde sa
-- licence jusqu'à ce que la tour la détache (D1, D4) — c'est une décision de
-- facturation, et elle ne se prend pas dans un bouton de réglages.
--
-- ============================================================ LA RETENUE
--
-- L'écriture d'un règlement d'achat de 1 969,610 DT payé par chèque proposait
-- 401 / 532 pour le montant entier. Au-dessus du seuil de l'article 52-I-g du
-- CIRPPIS, l'acheteur retient une part du prix pour l'État. Le Socle constate
-- désormais la retenue à partir du payé (`constaterLaRetenue`) ; il lui faut
-- les taux possibles et le seuil, datés. Ils sont au référentiel fiscal depuis
-- le 31 août — `RAS_MARCHES_*` —, et c'est ICI, en base, qu'on dit lesquels
-- valent pour un règlement : le code TypeScript ne nomme aucun code fiscal.
--
-- REJEU (R11) : `create or replace` partout, droits reposés à l'identique.

begin;

-- ------------------------------------------------------------- le mandat, lu

create or replace function public.mon_mandat(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'dossier non autorise' using errcode = '42501';
  end if;

  select e.id, e.status, e.starts_on, e.ends_on, o.name as comptabilite
    into v
    from identity.engagements e
    join identity.organizations o on o.id = e.cabinet_org_id
   where e.pme_org_id = p_tenant
     and e.status in ('actif', 'propose')
   order by (e.status = 'actif') desc, e.created_at desc
   limit 1;

  if v.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', v.id,
    'comptabilite', v.comptabilite,
    'statut', v.status,
    'depuis', v.starts_on,
    'revocable', app.has_org_role(p_tenant, array['dirigeant']) and v.status = 'actif');
end
$$;

revoke all on function public.mon_mandat(uuid) from public, anon;
grant execute on function public.mon_mandat(uuid) to authenticated;

comment on function public.mon_mandat(uuid) is
  'Le mandat en cours du dossier (actif, sinon proposé) : la comptabilité, le '
  'statut, la date de départ, et si l''appelant peut le révoquer.';

-- -------------------------------------------------------- le mandat, révoqué

create or replace function public.mandat_revoquer(p_tenant uuid, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'seul le dirigeant revoque le mandat' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motif), '') = '' then
    raise exception 'Dites pourquoi : la comptabilité lira ce motif.' using errcode = '22023';
  end if;

  select e.id, e.cabinet_org_id
    into v
    from identity.engagements e
   where e.pme_org_id = p_tenant and e.status = 'actif'
   order by e.created_at desc
   limit 1
   for update;

  if v.id is null then
    raise exception 'Aucun mandat actif sur ce dossier.' using errcode = '22023';
  end if;

  update identity.engagements
     set status = 'termine', ends_on = current_date
   where id = v.id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'engagement.revoque', 'identity', 'engagements', v.id,
          jsonb_build_object('cabinet_org_id', v.cabinet_org_id, 'motif', btrim(p_motif)));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.cabinet_org_id, auth.uid(), 'engagement.revoque', 'identity', 'engagements', v.id,
          jsonb_build_object('pme_org_id', p_tenant, 'motif', btrim(p_motif)));

  insert into collab.notifications (tenant_id, kind, payload)
  values (p_tenant, 'mandat.revoque',
          jsonb_build_object('engagement_id', v.id, 'motif', btrim(p_motif),
                             'cabinet', (select name from identity.organizations where id = v.cabinet_org_id),
                             'client', (select name from identity.organizations where id = p_tenant)));

  return jsonb_build_object('id', v.id, 'statut', 'termine', 'le', current_date);
end
$$;

revoke all on function public.mandat_revoquer(uuid, text) from public, anon;
grant execute on function public.mandat_revoquer(uuid, text) to authenticated;

comment on function public.mandat_revoquer(uuid, text) is
  'Le dirigeant met fin au mandat actif, seul, avec un motif (scénarios D du '
  '16 octobre). Inscrit aux deux journaux ; ne touche pas la licence.';

-- ------------------------------------------- la retenue d'un règlement, datée

create or replace function ref.retenues_au_reglement(p_jurisdiction text, p_le date)
returns table (code text, taux numeric, libelle text, seuil numeric)
language sql
stable
set search_path = ''
as $$
  -- Les taux de l'article 52-I-g, du plus fréquent au plus rare : le premier
  -- qui explique le payé l'emporte. Le seuil vaut pour les trois.
  with vigueur as (
    select p.code, p.valeur_num, p.libelle
      from ref.fiscal_parameters p
     where p.jurisdiction = p_jurisdiction
       and p.valid_from <= p_le
       and (p.valid_to is null or p.valid_to > p_le)
       and p.confiance = 'confirme'),
  seuil as (select valeur_num from vigueur where code = 'RAS_MARCHES_SEUIL')
  select v.code, v.valeur_num, v.libelle, (select valeur_num from seuil)
    from vigueur v
   where v.code in ('RAS_MARCHES_ACQUISITIONS', 'RAS_MARCHES_TAUX_REDUIT_1',
                    'RAS_MARCHES_TAUX_REDUIT_05')
     and v.valeur_num is not null
   order by case v.code when 'RAS_MARCHES_ACQUISITIONS' then 1
                        when 'RAS_MARCHES_TAUX_REDUIT_1' then 2 else 3 end;
$$;

revoke all on function ref.retenues_au_reglement(text, date) from public, anon;
grant execute on function ref.retenues_au_reglement(text, date) to authenticated;

comment on function ref.retenues_au_reglement(text, date) is
  'Les taux de retenue à la source qu''un règlement peut avoir subis (art. '
  '52-I-g CIRPPIS), et leur seuil TTC, à une date. Vide hors référentiel.';

commit;
