-- La livraison du 19 octobre passe les règles du dépôt.
--
-- ============================================================= LE DÉFAUT RÉEL
--
-- Les quatorze migrations du 18 et du 19 octobre se disaient vérifiées. Les
-- épreuves d'architecture du dépôt (`schema.test.ts`) et une épreuve de
-- comportement (`garder-chez-soi-est-une-decision.test.ts`) disaient cinq
-- violations. Aucune n'ouvre une porte entre deux clients ; chacune est le
-- genre de faute qu'une règle exécutable existe pour attraper avant qu'elle
-- ne coûte. Le point 5 est le seul qui pouvait toucher à un droit, et dans le
-- sens du RETRAIT, pas de l'ouverture : un pré-filtre trop étroit cacherait
-- à l'auteur d'une pièce privée les dépendances d'une pièce qu'il voit. Il est
-- écrit pour ne rien retirer.
--
-- On ne réécrit AUCUNE des quatorze : elles portent des arbitrages
-- commerciaux, et le runner refuserait de toute façon un fichier dont
-- l'empreinte a changé. Une correction est une écriture nouvelle (R7) ; les
-- deux histoires restent lisibles l'une à côté de l'autre.
--
-- ⚠ Le fichier porte la date du 19 octobre à 15 h et non celle du 17 : les
-- migrations qu'il corrige ne se rejouent dans l'ordre des noms que s'il vient
-- APRÈS elles. Daté avant, il corrigerait des tables qui n'existent pas encore
-- sur une base neuve, et `capture_piece_set_vis` serait réécrite une seconde
-- fois, par `20261018103000`, sans la ligne qu'on lui rend ici.
--
-- ===================================== 1. UNE DEVISE POSÉE PAR OMISSION (R4)
--
-- `facturation.factures.devise` portait `default 'TND'`. Un défaut de colonne
-- est invisible : toute insertion qui oublie la colonne fabrique une facture
-- en dinars, sans que rien ne le dise et sans que personne ne l'ait décidé.
-- C'est la forme exacte que R4 interdit — la valeur qu'on ne voit pas et
-- qu'on ne peut pas changer.
--
-- Le défaut tombe. La devise d'une facture est celle de son ÉMETTEUR, ALGORIA
-- — ni celle de la licence (elle n'en porte pas), ni celle de l'organisation
-- cliente (c'est la monnaie du client, pas celle de la facture).
--
-- Or `facturation.emettre` ne savait pas qui émet : « ALGORIA facture en
-- Tunisie » était une hypothèse écrite dans un commentaire, et le taux de TVA
-- était pris au premier `TVA19` valide de n'importe quel pack, sans filtre.
-- Une seconde juridiction active aurait changé le taux d'une facture sans
-- qu'aucune ligne ne bouge. On rend l'hypothèse lisible : `facturation.emetteurs`
-- désigne l'organisation émettrice, datée, en ajout seul, écrite par la
-- plateforme. `emettre` en lit la devise sur `identity.organizations.currency`
-- et la juridiction pour choisir le pack — donc le taux et le timbre — en
-- vigueur ce jour-là : un pack, une réponse.
--
-- Pas de repli (R4) : tant qu'aucun émetteur n'est désigné, `emettre` lève
-- une erreur. Désigner l'émetteur est une étape de mise en service, pas un
-- défaut livré — une migration ne peut pas connaître l'identifiant de
-- l'organisation d'ALGORIA dans une base qu'elle n'a pas vue.
--
-- `identity.organizations.currency` est `not null` : une fois l'émetteur
-- désigné, la devise existe. La seule absence possible est celle de
-- l'émetteur, et c'est elle que la garde nomme.
--
-- Le corps d'`emettre` est repris de `20261019110000`, aux lectures du taux,
-- du timbre et de la devise près.

alter table facturation.factures alter column devise drop default;

-- Trouvé en faisant tourner `emettre` pour de bon (épreuve
-- `emettre-une-facture.test.ts`) : le schéma `facturation` n'a JAMAIS reçu
-- `usage` pour `authenticated`. `plateforme` (20261019100000) et `notif`
-- (20261019130000) l'ont ; `facturation` non. Tous les `grant select/execute`
-- de la livraison sur ce schéma — factures, encaissements, `emettre` — étaient
-- donc lettre morte : « droit refusé pour le schéma facturation », pour la
-- plateforme comme pour un titulaire qui veut lire ses factures. Aucune
-- épreuve de lecture n'avait jamais tourné dessus.
grant usage on schema facturation to authenticated;

create table if not exists facturation.emetteurs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references identity.organizations(id) on delete restrict,
  valide_des      date not null unique,
  designe_par     uuid not null default auth.uid(),
  created_at      timestamptz not null default now()
);

comment on table facturation.emetteurs is
  'Qui émet les factures d''ALGORIA, à partir de quelle date. Ajout seul : '
  'changer d''émetteur inscrit une ligne datée, il n''en réécrit aucune. La '
  'devise et la juridiction des factures viennent de cette organisation.';

alter table facturation.emetteurs enable row level security;
alter table facturation.emetteurs force row level security;
revoke all on table facturation.emetteurs from public, anon, service_role;
grant select, insert on table facturation.emetteurs to authenticated;

drop policy if exists facturation_emetteurs_sel on facturation.emetteurs;
create policy facturation_emetteurs_sel on facturation.emetteurs
  for select to authenticated using ((select app.is_platform()));
drop policy if exists facturation_emetteurs_ins on facturation.emetteurs;
create policy facturation_emetteurs_ins on facturation.emetteurs
  for insert to authenticated with check ((select app.is_platform()));

drop trigger if exists facturation_emetteurs_no_upd on facturation.emetteurs;
create trigger facturation_emetteurs_no_upd
  before update or delete on facturation.emetteurs
  for each row execute function app.deny_mutation();

create or replace function facturation.emettre(
  p_licence uuid, p_periode date, p_jours_echeance integer default 15)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c          record;
  v_emetteur record;
  v_pack     uuid;
  v_taux     numeric(8,6);
  v_timbre   app.money_t;
  v_ht       app.money_t;
  v_tva      app.money_t;
  v_numero   text;
  v_id       uuid;
  v_sieges   smallint;
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  if extract(day from p_periode) <> 1 then
    raise exception 'une periode est un premier du mois' using errcode = 'check_violation';
  end if;

  select * into c from facturation.consommation_v where licence_id = p_licence;
  if c.licence_id is null then
    raise exception 'licence introuvable' using errcode = 'no_data_found';
  end if;

  -- R4 : l'émetteur est une donnée, pas une hypothèse. Sa devise est celle de
  -- la facture ; sa juridiction désigne le pack dont on lit le taux et le
  -- timbre.
  select o.currency, o.jurisdiction into v_emetteur
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
   where e.valide_des <= current_date
   order by e.valide_des desc limit 1;
  if not found then
    raise exception 'aucun emetteur designe (facturation.emetteurs)'
      using errcode = 'no_data_found';
  end if;

  select p.id into v_pack
    from ref.jurisdiction_packs p
   where p.jurisdiction = v_emetteur.jurisdiction
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc limit 1;
  if v_pack is null then
    raise exception 'aucun pack de juridiction en vigueur pour l''emetteur (ref.jurisdiction_packs)'
      using errcode = 'no_data_found';
  end if;

  select r.rate into v_taux
    from ref.tva_rates r
   where r.pack_version_id = v_pack
     and r.code = 'TVA19'
     and r.valid_from <= current_date
     and (r.valid_to is null or r.valid_to >= current_date)
   order by r.valid_from desc limit 1;

  select coalesce(sp.value_num, sp.value_text::numeric) into v_timbre
    from ref.socle_params sp
   where sp.pack_version_id = v_pack
     and sp.code = 'facture.droit_de_timbre'
     and sp.valid_from <= current_date
     and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;

  -- Pas de valeur de repli. R4 jusqu'au bout : une facture émise sous un taux
  -- supposé serait fausse sans que personne ne le voie.
  if v_taux is null then
    raise exception 'aucun taux de TVA en vigueur (ref.tva_rates, code TVA19)'
      using errcode = 'no_data_found';
  end if;
  if v_timbre is null then
    raise exception
      'aucun droit de timbre en vigueur (ref.socle_params, code facture.droit_de_timbre)'
      using errcode = 'no_data_found';
  end if;

  v_ht     := c.prix_mensuel_ht;
  -- `rate` est une fraction : pas de division par cent, et l'arrondi au
  -- millime, qui est la plus petite unité du dinar.
  v_tva    := round(v_ht * v_taux, 3);
  v_sieges := greatest(0, c.sieges_occupes - c.sieges_inclus)::smallint;
  v_numero := 'ALG-' || to_char(p_periode, 'YYYYMM') || '-'
              || lpad(nextval('facturation.numero_facture_seq')::text, 5, '0');

  insert into facturation.factures
    (licence_id, numero, periode, emise_le, echeance_le, offre_code,
     organisations, sieges_payants, montant_ht, taux_tva, montant_tva,
     timbre, montant_ttc, devise)
  values
    (p_licence, v_numero, p_periode, current_date,
     current_date + p_jours_echeance, c.offre_code,
     c.organisations, v_sieges, v_ht, v_taux, v_tva, v_timbre,
     v_ht + v_tva + v_timbre, v_emetteur.currency)
  returning id into v_id;

  insert into facturation.facture_lignes
    (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
  values (v_id, 1, 'Abonnement ' || c.offre_code || ' — '
                   || to_char(p_periode, 'TMMonth YYYY'),
          1, v_ht, v_ht);

  return jsonb_build_object('facture_id', v_id, 'numero', v_numero,
                            'ttc', v_ht + v_tva + v_timbre);
end
$$;

-- --- 2. Un index qui mène par `tenant_id` (R6) ------------------------------
--
-- `plateforme.archives` est sous RLS de tenant, et sa politique de lecture
-- filtre par `tenant_id` à chaque requête. Son seul index portait sur
-- `requisition_id` : chaque lecture d'un membre parcourait la table entière,
-- tous tenants confondus. L'ordre de lecture d'un dossier est celui où les
-- archives ont été constituées, la plus récente d'abord — comme
-- `requisitions_tenant_idx` le fait pour `close_le`.

create index if not exists archives_tenant_idx
  on plateforme.archives (tenant_id, constituee_le desc);

-- --- 3. `gardee_le` s'efface quand la pièce part (régression) ----------------
--
-- `20261012100000` écrivait `gardee_le = null` dans `capture_piece_set_vis` :
-- une pièce partie au cabinet n'est plus « gardée », et deux dates feraient
-- deux vérités sur un seul fait. `20261018103000` a réécrit la fonction pour
-- ajouter `entite` et a perdu la ligne — la fonction qu'elle a reprise était
-- celle du 11 octobre, antérieure à l'ajout de la colonne.
--
-- Le corps ci-dessous est la fonction vivante, intégralement (la sémantique
-- d'`entite`, la garde sur l'origine, le propriétaire seul pour sortir de la
-- société), plus l'effacement. Il s'efface à TOUT changement de visibilité,
-- comme le faisait le 12 octobre : une date de garde ne survit pas au lieu
-- qui l'a motivée, et « effacer toujours » se prouve sans raisonner sur les
-- transitions atteignables (entite -> personnel, par exemple).

create or replace function public.capture_piece_set_vis(
  p_piece uuid,
  p_vis app.vis_t,
  p_par_accord boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_old    app.vis_t;
  v_status text;
  v_auteur uuid;
begin
  select tenant_id, vis, status, created_by
    into v_tenant, v_old, v_status, v_auteur
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_old = p_vis then
    return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', false);
  end if;

  -- Quitter `partage` — vers l'entité comme vers le personnel — c'est retirer
  -- au cabinet ce qu'il a reçu. La garde de `20261011220000` s'étend donc au
  -- troisième lieu : elle portait sur la destination, elle porte désormais
  -- sur l'ORIGINE, qui est ce qui compte.
  if v_old = 'partage'::app.vis_t then
    if v_status in ('comptabilisee','supervisee') then
      raise exception 'une piece comptabilisee reste partagee' using errcode = 'check_violation';
    end if;
    if not p_par_accord then
      raise exception 'une piece transmise ne revient que par accord du cabinet'
        using errcode = 'check_violation';
    end if;
  end if;

  -- B7 resserré, 17 octobre : « un siège ne peut marquer personnel qu'au
  -- moment de la capture ». Après, sortir une pièce de la société relève du
  -- propriétaire — sinon la facture qu'un collaborateur glisse dans son
  -- espace privé quitte l'entreprise avec lui, et la règle 1 tombe.
  if p_vis = 'personnel'::app.vis_t
     and v_old = 'entite'::app.vis_t
     and not app.has_org_role(v_tenant, array['dirigeant'])
  then
    raise exception 'sortir une piece de la societe releve du proprietaire'
      using errcode = 'check_violation';
  end if;

  update capture.pieces
     set vis = p_vis,
         -- Seul `partage` est une transmission. `entite` ne l'est pas.
         transmise_le = case when p_vis = 'partage'::app.vis_t then now() else null end,
         -- Partie au cabinet, à la société ou revenue : la décision de la
         -- garder est à reprendre, donc à vide. Deux dates feraient deux
         -- vérités sur un seul fait.
         gardee_le = null,
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', p_piece,
          jsonb_build_object('from', v_old, 'to', p_vis, 'status', v_status,
                             'par_accord', p_par_accord, 'auteur', v_auteur));

  -- Deux destinataires, deux notifications : `entite` prévient le dirigeant
  -- qu'il a quelque chose à valider, `partage` prévient le cabinet qu'il a
  -- quelque chose à comptabiliser.
  if p_vis = 'partage'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.partagee', jsonb_build_object('piece_id', p_piece));
  elsif p_vis = 'entite'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.a_valider',
            jsonb_build_object('piece_id', p_piece, 'auteur', v_auteur));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', true);
end
$$;

-- --- 4. Des appels nus dans des politiques (performance) --------------------
--
-- `app.is_platform()` écrit nu dans un `using` est réévalué à chaque ligne
-- examinée ; enveloppé en `(select app.is_platform())`, le planificateur en
-- fait un InitPlan évalué une fois. Le dépôt l'a mesuré (voir l'en-tête de
-- `20260830140000`) et en a fait une règle depuis ; les migrations du 19 octobre l'ont redécouverte à la main,
-- vingt fois, sans l'appliquer.
--
-- `alter policy` change l'expression et rien d'autre : la commande, les rôles
-- et le sens du droit restent ceux posés par la livraison. Seule la FORME
-- change. `auth.uid()` ne porte pas la règle (elle ne vise que `app.*`) et
-- n'est donc pas touché.

-- facturation

alter policy facturation_factures_ins on facturation.factures
  with check ((select app.is_platform()));

alter policy facturation_factures_sel on facturation.factures
  using ((select app.is_platform())
         or licence_id in (select id from facturation.licences
                            where titulaire = auth.uid()));

alter policy facturation_facture_lignes_ins on facturation.facture_lignes
  with check ((select app.is_platform()));

alter policy facturation_facture_lignes_sel on facturation.facture_lignes
  using (exists (select 1 from facturation.factures f
                  where f.id = facture_lignes.facture_id
                    and ((select app.is_platform())
                         or f.licence_id in (select id from facturation.licences
                                              where titulaire = auth.uid()))));

alter policy facturation_encaissements_ins on facturation.encaissements
  with check ((select app.is_platform()));

alter policy facturation_encaissements_sel on facturation.encaissements
  using (exists (select 1 from facturation.factures f
                  where f.id = encaissements.facture_id
                    and ((select app.is_platform())
                         or f.licence_id in (select id from facturation.licences
                                              where titulaire = auth.uid()))));

alter policy facturation_licences_sel on facturation.licences
  using (titulaire = auth.uid() or (select app.is_platform()));

-- notif

alter policy notif_envois_sel on notif.envois
  using (destinataire = auth.uid() or (select app.is_platform()));

alter policy notif_remises_sel on notif.remises
  using (exists (select 1 from notif.envois e
                  where e.id = remises.envoi_id
                    and (e.destinataire = auth.uid()
                         or (select app.is_platform()))));

-- plateforme

alter policy plateforme_archives_ins on plateforme.archives
  with check ((select app.is_platform()));

alter policy plateforme_archives_sel on plateforme.archives
  using ((select app.is_platform())
         or (tenant_id in (select app.member_orgs())
             and exists (select 1 from plateforme.requisitions r
                          where r.id = archives.requisition_id
                            and not r.secret_impose)));

alter policy plateforme_archives_upd on plateforme.archives
  using ((select app.is_platform()))
  with check ((select app.is_platform()));

alter policy plateforme_interventions_ins on plateforme.interventions
  with check ((select app.is_platform()));

alter policy plateforme_interventions_sel on plateforme.interventions
  using ((select app.is_platform()));

alter policy plateforme_reclamations_ins on plateforme.reclamations
  with check (licence_id in (select id from facturation.licences
                              where titulaire = auth.uid())
              or (select app.is_platform()));

alter policy plateforme_reclamations_sel on plateforme.reclamations
  using ((select app.is_platform())
         or licence_id in (select id from facturation.licences
                            where titulaire = auth.uid()));

alter policy plateforme_reclamations_upd on plateforme.reclamations
  using ((select app.is_platform()))
  with check ((select app.is_platform()));

alter policy plateforme_requisitions_ins on plateforme.requisitions
  with check ((select app.is_platform()));

alter policy plateforme_requisitions_sel on plateforme.requisitions
  using ((select app.is_platform())
         or (not secret_impose and tenant_id in (select app.member_orgs())));

alter policy plateforme_requisitions_upd on plateforme.requisitions
  using ((select app.is_platform()))
  with check ((select app.is_platform()));

-- --- 5. Dix politiques qui ne disaient plus de quel dossier (R6) -------------
--
-- `20261018103000` a réécrit la lecture de dix tables en
-- `using (app.piece_lisible(piece_id))`. Ce n'est pas une porte ouverte :
-- la fonction vérifie la pièce, et c'est elle qui fait foi. Mais la règle du
-- dépôt exige qu'une politique d'une table de tenant porte une condition
-- VISIBLE sur le tenant, précisément pour qu'un oubli ne puisse pas ouvrir
-- l'accès en silence — et pour qu'on n'ait pas à lire une fonction pour savoir
-- de quoi la table est cloisonnée.
--
-- On ajoute donc la condition structurelle, EN TÊTE, comme pré-filtre : elle
-- écarte les lignes des autres dossiers avant d'appeler la fonction, qui les
-- refusait déjà. Les lieux où `app.piece_lisible` peut répondre oui —
-- l'organisation, le cabinet sous mandat, la plateforme sous réquisition,
-- l'auteur de la pièce — y sont tous : le pré-filtre ne retire aucun droit
-- que la fonction accordait.
--
-- Il n'existe pas de fonction `app.lisible_orgs()` dans le dépôt, et on n'en
-- invente pas une pour cet usage : l'union est écrite à la main, avec les trois
-- primitives que `piece_lisible` lit elle-même.
--
-- Le quatrième lieu est l'AUTEUR. `piece_lisible` accorde une pièce
-- `personnel` à qui l'a créée sans regarder s'il est encore membre du tenant,
-- et la politique de `capture.pieces` fait de même : la pièce reste lisible
-- par son auteur. Un pré-filtre qui ne regarde que les organisations aurait
-- caché ses extractions et ses paiements à celui qui voit la pièce — une
-- incohérence, et un droit retiré (première version de cette migration). La
-- branche `created_by = auth.uid()` passe par la pièce elle-même, par sa clé
-- primaire.

do $$
declare
  t text;
begin
  foreach t in array array['analyses','citations','extractions','token_plan',
                           'precisions','conformite','piece_versions',
                           'paiements','piece_articles'] loop
    execute format($f$
      alter policy %1$I on capture.%2$I
        using (
          (tenant_id in (select app.member_orgs())
           or tenant_id in (select app.engaged_orgs())
           or app.plateforme_requise(tenant_id)
           or exists (select 1 from capture.pieces pc
                       where pc.id = %2$I.piece_id
                         and pc.created_by = auth.uid()))
          and app.piece_lisible(piece_id))
    $f$, 'capture_' || t || '_sel', t);
  end loop;
end $$;

alter policy capture_paiement_justificatifs_sel on capture.paiement_justificatifs
  using (
    (tenant_id in (select app.member_orgs())
     or tenant_id in (select app.engaged_orgs())
     or app.plateforme_requise(tenant_id)
     or exists (select 1 from capture.paiements pa
                  join capture.pieces pc on pc.id = pa.piece_id
                 where pa.id = paiement_justificatifs.paiement_id
                   and pc.created_by = auth.uid()))
    and exists (select 1 from capture.paiements p
                 where p.id = paiement_justificatifs.paiement_id
                   and app.piece_lisible(p.piece_id)));
