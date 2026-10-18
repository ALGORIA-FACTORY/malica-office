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
    -- Le drapeau ne suffit pas : l'accord se DÉRIVE de la donnée (section 17).
    if not app.accord_donne(p_piece, 'rappel') then
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

-- --- 6. Des vues qui contournaient l'isolation entre clients (R6) -------------
--
-- `postgres` est superutilisateur et `bypassrls`. Une vue qui lui appartient
-- et n'est pas `security_invoker` lit ses tables avec SES droits : la RLS ne
-- s'applique pas, et la vue rend les lignes de tous les clients à qui a
-- `select` dessus. Sept vues accordées à `authenticated`
-- par la livraison étaient dans ce cas : `droits_reels_v`, `encours_v`, `flux_mensuel_v`,
-- `a_relancer_v`, `plateforme.clients_v`, `plateforme.reclamations_v`,
-- `notif.envois_v` — plus `droits_v` et `consommation_v`, qu'elles emboîtent,
-- et `public.entities_v` (voir plus bas).
--
-- Le défaut était invisible tant que le schéma `facturation` n'avait pas
-- `usage` pour `authenticated` (point 1) : les vues étaient inatteignables.
-- En ouvrant ce droit, nécessaire, la fuite est devenue réelle : n'importe
-- quel compte authentifié lisait les factures, les soldes, le chiffre
-- d'affaires mensuel d'ALGORIA et les impayés avec leur titulaire.
-- `une-vue-ne-contourne-pas-l-isolation.test.ts` l'a établi par exécution
-- avant ce correctif : A lisait les lignes de B dans chacune des sept vues.
--
-- `security_invoker` est la forme que portent déjà toutes les vues de `public`.
-- La RLS des tables sous-jacentes s'applique alors à celui qui lit.
--
-- Une vue `security_invoker` lit les vues qu'elle emboîte avec les droits de
-- l'appelant : `droits_v` et `consommation_v`, jusque-là réservées à leur
-- propriétaire, reçoivent donc `select` pour `authenticated` — elles sont
-- elles aussi `security_invoker`, sans quoi on rouvrirait la porte une marche
-- plus bas.
--
-- ⚠ Conséquence assumée : `plateforme.interventions` n'est lisible que par la
-- plateforme. Sous l'identité d'un titulaire, `droits_reels_v` ne voit donc
-- plus les lectures supplémentaires que la plateforme lui a accordées
-- (`lectures_supplement` = 0, `lectures_droit` sous-estimé), et un
-- collaborateur ne lit rien de `facturation.licences`. Ces vues sont donc
-- un AFFICHAGE, jamais une décision. Celle qui décide d'une lecture,
-- `public.lecture_autorisee`, était `security invoker` et en dépendait : le
-- point 7 la passe `security definer` pour qu'elle lise les vraies valeurs.
-- (La phrase de la première rédaction de ce point, affirmant que les fonctions
-- `security definer` lisaient déjà les vraies valeurs, était fausse : celle-ci
-- n'en était pas une.)

alter view facturation.droits_v         set (security_invoker = true);
alter view facturation.droits_reels_v   set (security_invoker = true);
alter view facturation.consommation_v   set (security_invoker = true);
alter view facturation.encours_v        set (security_invoker = true);
alter view facturation.flux_mensuel_v   set (security_invoker = true);
alter view facturation.a_relancer_v     set (security_invoker = true);
alter view plateforme.clients_v         set (security_invoker = true);
alter view plateforme.reclamations_v    set (security_invoker = true);
alter view notif.envois_v               set (security_invoker = true);

-- Et une vue ancienne que la livraison a fait perdre : `public.entities_v`
-- était `security_invoker` depuis sa création (20260824131631).
-- `20261018130000` l'a redéfinie par `create or replace view` sans la clause
-- `with (security_invoker = true)`, et l'option a disparu avec. Le défaut est
-- celui de la livraison, pas du dépôt : il se corrige ici.
alter view public.entities_v            set (security_invoker = true);

grant select on facturation.droits_v, facturation.consommation_v to authenticated;

-- --- 7. Le plafond se décide sur les vraies valeurs --------------------------
--
-- Le point 6 a révélé, à l'exécution, ce qu'il avait cassé. `lecture_autorisee`
-- (`20261018093000`) était `security invoker` et lisait `consommation_v`. Tant
-- que la vue lisait avec les droits de son propriétaire, tout le monde y voyait
-- la licence. Devenue `security_invoker`, la vue ne rend rien de
-- `facturation.licences` à un collaborateur : le seul à la lire est le
-- titulaire, ou la plateforme. Deux défauts, mesurés :
--
--   - le collaborateur d'une organisation au plafond (65 lectures sur 65) ou
--     d'une licence suspendue recevait `autorisee: true, dans_le_forfait` : la
--     vue était vide, l'enregistrement NULL, et aucun `if` ne se déclenchait.
--     L'échec était passé de FERMÉ à OUVERT — un résultat plausible et faux,
--     la pire forme d'erreur selon R4 ;
--   - le titulaire qui avait PAYÉ un supplément (50 lectures, droit réel 115)
--     restait bloqué à 65 : `plateforme.interventions`, d'où vient le
--     supplément, n'est lisible que par la plateforme.
--
-- La phrase du point 6, « les fonctions `security definer` qui décident d'une
-- lecture lisent toujours les vraies valeurs », était fausse : celle-ci n'en
-- était pas une. Ce qui est vrai après ce point : les vues restent
-- `security_invoker`, pour l'affichage (un titulaire ne lit que ses chiffres) ;
-- la fonction qui DÉCIDE passe `security definer` et lit, avec les droits de son
-- propriétaire, les valeurs réelles de la licence. Elle ne rend qu'un verdict
-- et deux compteurs : elle n'ouvre aucune table.
--
-- Une fonction `security definer` ne doit pas devenir une sonde. L'ancienne
-- garde (« pièce introuvable ou non autorisée ») venait de la RLS de
-- `capture.pieces`, que la fonction ne subit plus : elle est remplacée par
-- `app.piece_lisible`, qui dit la même chose pour l'appelant. Sans elle, tout
-- compte authentifié apprendrait le plafond et le droit de n'importe quelle
-- licence en passant l'identifiant d'une pièce.
--
-- Enfin l'absence de licence ne vaut jamais « autorisée ». Si
-- `consommation_v` ne rend rien pour la licence trouvée, la réponse est le
-- refus explicite qui existe déjà, `organisation_sans_licence`.
--
-- `lecture_consommer` reste `security invoker` : elle écrit sous l'identité de
-- l'appelant, donc sous la RLS de `facturation.lectures` (écriture réservée aux
-- membres), et ne fait que suivre le verdict de la porte.

create or replace function public.lecture_autorisee(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant   uuid;
  v_vis      app.vis_t;
  v_licence  uuid;
  v_conso    record;
  v_deja     boolean;
begin
  -- La RLS de `capture.pieces` ne s'applique plus ici : la lisibilité de la
  -- pièce pour l'appelant se demande à la fonction qui la porte.
  if not app.piece_lisible(p_piece) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  select tenant_id, vis into v_tenant, v_vis
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- B6 : une pièce personnelle n'est jamais lue.
  if v_vis = 'personnel'::app.vis_t then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'piece_personnelle',
      'restantes', null, 'droit', null);
  end if;

  select licence_id into v_licence
    from facturation.licence_organisations where tenant_id = v_tenant;
  if v_licence is null then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'organisation_sans_licence',
      'restantes', null, 'droit', null);
  end if;

  select * into v_conso from facturation.consommation_v where licence_id = v_licence;
  if v_conso.licence_id is null then
    -- Pas de ligne : on ne sait pas, donc on refuse. Jamais `true` par défaut.
    return jsonb_build_object(
      'autorisee', false, 'motif', 'organisation_sans_licence',
      'restantes', null, 'droit', null);
  end if;

  -- Une pièce déjà comptée se relit sans rien coûter. C'est la correction
  -- gratuite, et c'est volontaire.
  select exists (select 1 from facturation.lectures where piece_id = p_piece)
    into v_deja;
  if v_deja then
    return jsonb_build_object(
      'autorisee', true, 'motif', 'relecture_gratuite',
      'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
      'licence_id', v_licence);
  end if;

  -- Une licence suspendue n'arrête pas la caméra, elle arrête l'œil.
  if v_conso.statut <> 'active' then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'licence_' || v_conso.statut,
      'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
      'licence_id', v_licence);
  end if;

  if v_conso.lectures_restantes <= 0 then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'plafond_atteint',
      'restantes', 0, 'droit', v_conso.lectures_droit,
      'licence_id', v_licence);
  end if;

  return jsonb_build_object(
    'autorisee', true, 'motif', 'dans_le_forfait',
    'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
    'licence_id', v_licence);
end
$$;

revoke all on function public.lecture_autorisee(uuid) from public, anon;
grant execute on function public.lecture_autorisee(uuid) to authenticated;

-- --- 8. Une lecture s'impute à la licence de SON organisation ----------------
--
-- Le point 7 a fait mordre le plafond. Il ne l'a pas rendu infranchissable :
-- la quatrième relecture l'a franchi, par exécution, SANS toucher à la
-- fonction.
--
-- `facturation_lectures_ins` ne vérifiait que `tenant_id in app.member_orgs()`.
-- `licence_id` et `piece_id` restaient libres — seule une clé étrangère les
-- tenait, et une clé étrangère dit « cette licence existe », jamais « cette
-- licence est la vôtre ». Or `lecture_autorisee` tient l'EXISTENCE d'une ligne
-- dans `facturation.lectures` pour une preuve de comptage : c'est la branche
-- `relecture_gratuite`, voulue, et c'est elle qui se forge.
--
-- Mesuré : un collaborateur à 65/65 reçoit `plafond_atteint` ; il insère une
-- ligne portant son tenant, la licence d'un tiers et sa propre pièce
-- (`INSERT 0 1`) ; `lecture_autorisee` rend ensuite `relecture_gratuite` et
-- autorise. Deux dégâts d'un seul geste : son plafond ne mord plus, et le quota
-- du tiers est consommé à sa place.
--
-- Le pré-requis est de connaître l'uuid d'une autre licence. Ce n'est pas
-- trivial, et ce n'est pas une garde : R6 dit où la garde se met. Un filtre
-- oublié dans du code applicatif OUVRE l'accès ; une politique oubliée le
-- REFUSE. Celle-ci va donc dans le `with check`, et non dans une fonction qu'il
-- suffit de ne pas appeler.
--
-- Deux conditions, structurelles, visibles sans lire aucune fonction :
--
--   - la licence est celle à laquelle CE tenant est rattaché
--     (`facturation.licence_organisations`, dont `tenant_id` est unique : une
--     organisation n'a qu'une licence) ;
--   - la pièce appartient à CE tenant.
--
-- Les deux sous-requêtes sont lues sous la RLS de l'appelant, et c'est voulu :
-- le membre voit le rattachement de son organisation et ses propres pièces.
-- Le chemin légitime — `lecture_consommer`, qui écrit sous l'identité de
-- l'appelant — passe inchangé ; l'épreuve
-- `une-lecture-s-impute-a-la-bonne-licence.test.ts` le prouve dans les deux
-- sens, parce qu'une politique qui refuse tout est aussi fausse qu'une
-- politique qui accepte tout.

alter policy facturation_lectures_ins on facturation.lectures
  with check (
    tenant_id in (select app.member_orgs())
    and exists (select 1 from facturation.licence_organisations lo
                 where lo.tenant_id = lectures.tenant_id
                   and lo.licence_id = lectures.licence_id)
    and exists (select 1 from capture.pieces pc
                 where pc.id = lectures.piece_id
                   and pc.tenant_id = lectures.tenant_id));

-- Les autres tables de `facturation` et de `plateforme` qui portent à la fois
-- un `tenant_id` et un identifiant d'un autre dossier ont été relues une par
-- une. Deux méritaient la même garde ; aucune n'était exploitable comme
-- `lectures`, et c'est pourquoi elles sont corrigées ici plutôt que par une
-- migration à elles.
--
-- `facturation.licence_organisations` (licence + tenant, écriture ouverte aux
-- membres) : le lien EXISTE déjà, mais dans un déclencheur
-- (`facturation.rattachement_legitime`, `before insert`), qui exige que le
-- titulaire de la licence soit dirigeant de l'organisation. C'est plus strict
-- que ce qu'une politique dirait, et c'est dans la base : on n'y touche pas.
--
-- `plateforme.reclamations` : `licence_id` est tenu (titulaire ou plateforme),
-- `tenant_id` ne l'était pas. Un titulaire pouvait donc ouvrir une réclamation
-- en l'ATTRIBUANT à l'organisation d'un autre client. La lecture est cadrée par
-- la licence, donc rien ne fuyait ; ce qui se forgeait était l'imputation, et
-- la plateforme décide sur cette colonne. La valeur reste facultative — toutes
-- les réclamations ne visent pas une organisation.
--
-- `plateforme.archives` : `requisition_id` n'était pas tenu au `tenant_id`.
-- L'écriture est réservée à la plateforme, donc l'acteur est déjà privilégié ;
-- mais la lecture d'une archive est accordée aux membres du tenant qu'elle
-- nomme, et un couple dépareillé aurait montré à un client l'empreinte et le
-- volume d'une réquisition qui ne le concerne pas.

alter policy plateforme_reclamations_ins on plateforme.reclamations
  with check (
    ((licence_id in (select l.id from facturation.licences l
                      where l.titulaire = auth.uid()))
     or (select app.is_platform()))
    and (tenant_id is null
         or exists (select 1 from facturation.licence_organisations lo
                     where lo.tenant_id = reclamations.tenant_id
                       and lo.licence_id = reclamations.licence_id)));

alter policy plateforme_archives_ins on plateforme.archives
  with check (
    (select app.is_platform())
    and exists (select 1 from plateforme.requisitions r
                 where r.id = archives.requisition_id
                   and r.tenant_id = archives.tenant_id));

-- --- 9. La politique d'écriture dit la même chose que le verdict -------------
--
-- La section 8 a fermé le trou ; elle a aussi figé une incohérence que la
-- relecture avait mesurée sans la trancher. TOUT MEMBRE d'un cabinet engagé
-- reçoit de `lecture_autorisee` le verdict de la licence du CLIENT —
-- `autorisee: true` sous le plafond — puis `lecture_consommer` échouait en
-- 42501, parce que le `with check` n'admettait que `app.member_orgs()` et
-- qu'un cabinet n'est pas membre du dossier de son client.
--
-- « Tout membre », et non « l'expert » : `app.engaged_orgs()` ne regarde pas le
-- rôle dans le cabinet. L'expert, le collaborateur et l'assistant y passent de
-- la même façon, à l'écriture comme au verdict. C'est le modèle de tout le
-- dépôt, et on l'assume ; mais un commentaire qui dirait « expert » laisserait
-- croire à une condition qui n'existe pas, et un commentaire faux est pire que
-- pas de commentaire.
--
-- Aujourd'hui aucun chemin ne passe par là. Dès l'étape 2 de la livraison,
-- CHAQUE lecture d'un cabinet serait payée au modèle et jamais comptée : feu
-- vert, dépense, inscription qui casse. C'est le pire des trois états — pire
-- qu'un refus franc, qui au moins ne coûte rien.
--
-- La décision : la lecture d'un membre de cabinet engagé se compte sur la
-- licence DU CLIENT. C'est déjà ce que le verdict répond, et le cabinet
-- travaille pour le client — qui paie ses propres pièces, quel que soit celui
-- qui déclenche la lecture.
--
-- Élargir une politique est le geste par lequel on rouvre ce qu'on vient de
-- fermer. La branche ajoutée est donc la plus étroite qui répond au verdict :
--
--   - le tenant est celui d'un mandat ACTIF de l'appelant (`app.engaged_orgs`,
--     qui exige `status = 'actif'` et des dates qui couvrent le jour) ;
--   - et la pièce est `partage` — la seule visibilité qu'un mandat ouvre
--     (`app.piece_lisible`). Une pièce `entite` ou `personnel` du client reste
--     hors de portée du cabinet, à l'écriture comme à la lecture.
--
-- Les deux conditions de la section 8 restent EN FACTEUR COMMUN, hors de la
-- parenthèse : la licence est celle du tenant, la pièce appartient au tenant.
-- La ligne forgée que la ronde 4 refuse est donc toujours refusée, et les
-- quatre épreuves de `une-lecture-s-impute-a-la-bonne-licence.test.ts` le
-- vérifient après cet élargissement.
--
-- Le plafond garde son mot : `lecture_consommer` consulte la porte avant
-- d'écrire, et au plafond le cabinet est refusé comme le collaborateur du client.

alter policy facturation_lectures_ins on facturation.lectures
  with check (
    (tenant_id in (select app.member_orgs())
     or (tenant_id in (select app.engaged_orgs())
         and exists (select 1 from capture.pieces pc
                      where pc.id = lectures.piece_id
                        and pc.vis = 'partage'::app.vis_t)))
    and exists (select 1 from facturation.licence_organisations lo
                 where lo.tenant_id = lectures.tenant_id
                   and lo.licence_id = lectures.licence_id)
    and exists (select 1 from capture.pieces pc
                 where pc.id = lectures.piece_id
                   and pc.tenant_id = lectures.tenant_id));

-- L'opérateur de plateforme sous réquisition n'est PAS ajouté ici, et c'est une
-- décision, pas un oubli : il reste arrêté par le plafond du client. C'est
-- fermé, donc sans danger, et une réquisition est rare. Une porte fermée qu'on
-- ouvrira le jour où on en connaîtra le prix vaut mieux qu'une porte ouverte
-- aujourd'hui. L'épreuve qui dit cet état existe et reste.

-- Et l'hygiène que la ronde 4 avait laissée en suspens : sept fonctions
-- `security definer` gardaient `execute` pour `public` et `anon`. Toutes
-- retournent `trigger`, et PostgreSQL refuse l'appel direct d'une telle
-- fonction : ce n'était pas une surface d'appel. Le droit n'en est pas moins
-- inutile, et un droit inutile est un droit qu'on finit par croire nécessaire.
-- Le déclenchement d'un trigger ne vérifie pas `execute` ; seul `create trigger`
-- le fait, et les déclencheurs existent déjà.

revoke all on function agents.toucher_conversation() from public, anon;
revoke all on function app.honoraires_totaux_apres_ligne() from public, anon;
revoke all on function facturation.place_disponible() from public, anon;
revoke all on function facturation.rattachement_legitime() from public, anon;
revoke all on function parametrage.verifier_compte_cabinet() from public, anon;
revoke all on function ref.verifier_classe_role() from public, anon;
revoke all on function tiers.verifier_compte_collectif() from public, anon;

-- --- 10. Une seule porte écrit les lectures, et c'est elle qui compte --------
--
-- La section 9 n'a rien rouvert — la relecture l'a établi en remettant les deux
-- conditions à l'intérieur du `or` et en voyant trois épreuves repasser au
-- rouge. Elle a trouvé le désaccord INVERSE, et il est plus grave :
-- **la politique d'écriture ne connaît pas le plafond.**
--
-- Mesuré à 65/65 : `lecture_autorisee` répond `plafond_atteint`, et l'insertion
-- DIRECTE passait — la licence montait à 66, puis le verdict devenait
-- `relecture_gratuite`. Une lecture comptée que personne n'avait autorisée, et
-- un forfait dépassé aux frais du client. Le cas du membre du client existait
-- depuis la section 8 ; la section 9 l'a étendu à tout membre d'un cabinet
-- engagé. Aucune épreuve ne le couvrait : celle de la ronde 4 forge la licence
-- d'un TIERS, pas la MÊME licence au plafond.
--
-- Deux corrections étaient possibles. Encoder le plafond dans le `with check`
-- écrirait la règle du plafond à DEUX endroits, et deux copies d'une règle
-- divergent toujours — c'est exactement ainsi que ce défaut est né. On prend
-- l'autre : `authenticated` perd le droit d'écrire, et
-- `public.lecture_consommer` devient la seule porte. Une table écrite par une
-- seule porte, et la porte qui porte la règle : c'est R6 appliqué.
--
-- ⚠ CE QUE CELA DÉPLACE, et il faut le lire avant de relire la politique.
-- `lecture_consommer` était `security invoker` pour écrire sous l'identité de
-- l'appelant, donc sous la RLS de la table. En `definer`, propriété de
-- `postgres` — superutilisateur —, elle NE SUBIT PLUS la politique, et
-- `force row level security` n'y change rien : un superutilisateur passe
-- outre. Les garanties des sections 8 et 9 ne reposent donc plus, sur ce
-- chemin, sur le `with check` : elles reposent sur ce que la fonction écrit.
--
-- Elle les tient PAR CONSTRUCTION, et c'est vérifiable ligne à ligne : le
-- tenant est lu sur la pièce, la licence est lue sur le rattachement de ce
-- tenant, la pièce est l'argument. Le triplet qu'elle écrit est celui que la
-- politique exige ; il n'y a aucune valeur que l'appelant choisisse.
--
-- Le `with check` reste en place, et pour deux raisons qui ne sont pas
-- décoratives : il garde le jour où un droit d'insertion reviendrait, et il
-- reste l'objet du garde d'architecture (« toute table de comptage lie son
-- identifiant au tenant »). Les épreuves continuent de l'exercer en se rendant
-- le droit d'insérer DANS une transaction annulée.
--
-- La porte, enfin : une `definer` sans porte est une sonde. `lecture_autorisee`
-- porte `app.piece_lisible` depuis la ronde 3 ; `lecture_consommer` la porte
-- maintenant aussi, en tête et pour elle-même, avant tout accès à la pièce.

create or replace function public.lecture_consommer(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_licence uuid;
  v_verdict jsonb;
begin
  -- La porte, nommée, et d'abord. La RLS de `capture.pieces` ne s'applique
  -- plus ici : sans cette ligne, tout compte authentifié ferait compter la
  -- lecture d'une pièce qu'il n'a pas le droit de voir.
  if not app.piece_lisible(p_piece) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- La règle du plafond vit à UN seul endroit, et c'est ici qu'on l'invoque.
  v_verdict := public.lecture_autorisee(p_piece);
  if not (v_verdict ->> 'autorisee')::boolean then
    raise exception 'lecture refusee : %', v_verdict ->> 'motif'
      using errcode = 'check_violation';
  end if;

  if (v_verdict ->> 'motif') = 'relecture_gratuite' then
    return v_verdict;
  end if;

  -- Rien de ce qui s'écrit ne vient de l'appelant : le tenant est celui de la
  -- pièce, la licence est celle du tenant. C'est ce qui tient les sections 8
  -- et 9 sans la politique.
  select tenant_id into v_tenant from capture.pieces where id = p_piece;
  select licence_id into v_licence
    from facturation.licence_organisations where tenant_id = v_tenant;

  insert into facturation.lectures (tenant_id, licence_id, piece_id, periode, consommee_par)
  values (v_tenant, v_licence, p_piece,
          date_trunc('month', current_date)::date, auth.uid())
  on conflict (piece_id) do nothing;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'lecture.consommee', 'capture', 'pieces', p_piece,
          jsonb_build_object('licence_id', v_licence));

  return public.lecture_autorisee(p_piece);
end
$$;

revoke all on function public.lecture_consommer(uuid) from public, anon;
grant execute on function public.lecture_consommer(uuid) to authenticated;

comment on function public.lecture_consommer(uuid) is
  'La SEULE écrivante de facturation.lectures. À appeler APRÈS une lecture '
  'réussie : une lecture qui échoue ne se facture pas. Elle refuse si son '
  'propre verdict n''autorise pas — le plafond est écrit là, et nulle part '
  'ailleurs.';

-- Et le droit s'en va. Les trois chemins d'écriture, pas seulement `insert` :
-- R7 refuse déjà `update` et `delete` par déclencheur, mais un droit inutile
-- est un droit qu'on finit par croire nécessaire. `select` reste : un cabinet
-- lit ce qui lui a été compté.
revoke insert, update, delete on facturation.lectures from authenticated;
revoke insert, update, delete on facturation.lectures from public, anon;

comment on table facturation.lectures is
  'Une ligne par pièce lue, jamais deux. Append-only (R7), et sans écrivain '
  'direct : seule public.lecture_consommer y écrit, parce qu''elle seule '
  'connaît le plafond.';

-- --- 11. Supprimer une facture dont le paiement porte un talon rattaché ------
--
-- DÉFAUT RÉEL, relevé par `une-piece-avec-un-paiement-se-supprime.test.ts` :
-- supprimer la FACTURE dont un paiement a reçu un talon par
-- `rattacherJustificatif` levait 42703, « l'enregistrement old n'a pas de
-- champs justificatif_piece_id ». C'est la manipulation que la migration
-- `20261018120000` existe pour réparer, avec une pièce jointe au paiement —
-- ce que fait le dirigeant qui photographie son chèque.
--
-- Deux causes, dans la même fonction :
--
--   a. Le second passage lisait `old.justificatif_piece_id` dans une condition
--      PLATE. PL/pgSQL n'y court-circuite pas la résolution du champ : sur
--      `paiement_justificatifs`, qui n'a pas cette colonne, la lecture lève
--      avant que `tg_table_name = 'paiements'` ait pu l'écarter. Le nom de la
--      table garde désormais la lecture, en `if` imbriqués.
--
--   b. Même sans l'erreur, le premier passage ne reconnaissait pas la ligne :
--      elle porte le `piece_id` du TALON, et le drapeau est posé sur la FACTURE.
--
-- QUELLE LIGNE DE `paiement_justificatifs` EST EFFAÇABLE — une décision :
--
--   — celle dont `piece_id` (le talon) est la pièce qu'on efface ;
--   — OU celle dont le PAIEMENT vient d'être supprimé par cette même
--     effacement (la facture qu'on efface).
--
-- Donc « l'un ou l'autre », et pas davantage. Pour le second cas on ne peut pas
-- relire le paiement : la cascade s'exécute après la suppression de sa ligne,
-- qui n'est plus visible. Le trigger de `paiements`, lui, tourne avant, et note
-- dans un réglage local à la transaction les identifiants de paiements qu'il
-- laisse partir POUR LA PIÈCE EN COURS D'EFFACEMENT. Une ligne de justificatif
-- n'est effaçable par ce second chemin que si son `paiement_id` y figure.
--
-- Ce qui ne s'ouvre pas : un DELETE direct sur `paiements` ou sur
-- `paiement_justificatifs`, sans drapeau ou avec le drapeau d'une autre pièce,
-- reste refusé par R7. Le drapeau ouvre la suppression d'une pièce, pas la
-- table. Les autres tables du garde portent toutes `piece_id` : aucune autre
-- lecture de colonne n'est à garder.

create or replace function app.deny_mutation_hors_effacement_de_piece()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_effacable text := coalesce(current_setting('malica.piece_effacable', true), '');
  v_paiements text;
begin
  -- Premier passage : la cascade d'une suppression de pièce que
  -- `capture_piece_supprimer` a validée, et pour CETTE pièce précisément.
  if tg_op = 'DELETE' and v_effacable = old.piece_id::text then
    -- Un paiement qui part avec la pièce note son identifiant : ses
    -- justificatifs, supprimés ensuite par cascade, s'y reconnaîtront.
    if tg_table_schema = 'capture' and tg_table_name = 'paiements' then
      perform set_config(
        'malica.paiements_effacables',
        coalesce(current_setting('malica.paiements_effacables', true), '')
          || ',' || old.id::text,
        true);
    end if;
    return old;
  end if;

  if tg_table_schema = 'capture' and tg_table_name = 'paiements' then
    -- Second passage : le SET NULL d'un justificatif qui disparaît. La pièce
    -- effacée est celle que le paiement citait, la colonne part vers NULL, et
    -- AUCUNE autre colonne ne bouge.
    if tg_op = 'UPDATE'
       and old.justificatif_piece_id is not null
       and v_effacable = old.justificatif_piece_id::text
       and new.justificatif_piece_id is null
       and to_jsonb(new) - 'justificatif_piece_id'
         = to_jsonb(old) - 'justificatif_piece_id'
    then
      return new;
    end if;
  elsif tg_table_schema = 'capture' and tg_table_name = 'paiement_justificatifs' then
    -- Troisième passage : la ligne de preuve d'un paiement qui part avec sa
    -- facture. Son `piece_id` est le talon, pas la pièce effacée.
    v_paiements := coalesce(current_setting('malica.paiements_effacables', true), '');
    if tg_op = 'DELETE'
       and v_effacable <> ''
       and (',' || v_paiements || ',') like ('%,' || old.paiement_id::text || ',%')
    then
      return old;
    end if;
  end if;

  raise exception
    'R7 : % interdit sur %.% — une correction est une ecriture nouvelle',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

comment on function app.deny_mutation_hors_effacement_de_piece() is
  'Immuabilité R7, levée pour la cascade d''une pièce non engagée, pour le '
  'détachement du justificatif qu''elle emporte, et pour les preuves des '
  'paiements qui partent avec elle. Rien d''autre.';

-- --- 12. La sûreté de l'effacement s'écrit, elle ne tient plus à une absence --
--
-- Les deux réglages `malica.piece_effacable` et `malica.paiements_effacables`
-- sont posables par n'importe quel utilisateur, sans privilège : un réglage de
-- session n'est pas un secret. Ce qui empêche qu'il serve de clé n'est PAS le
-- déclencheur R7, c'est que `authenticated` n'a pas `delete` sur
-- `capture.pieces` et que les onze tables du garde n'ont aucune politique
-- `DELETE` ni `UPDATE` : la RLS forcée ne laisse passer aucune ligne.
--
-- Une sûreté qui tient à l'ABSENCE de quelque chose disparaît un jour par
-- inadvertance — quelqu'un ajoute, pour une raison légitime, une politique
-- `DELETE` à l'une de ces tables, et le réglage posable par tous devient une
-- clé, sans qu'aucune épreuve rougisse. On l'écrit donc deux fois :
--
--   — ici, le privilège `delete` et `update` est retiré à `authenticated` sur
--     les onze tables. Il ne servait à rien (aucune politique ne le laissait
--     passer) ; il reste désormais refusé AVANT même la RLS, et une politique
--     ajoutée plus tard ne l'ouvre pas sans un `grant` qui se voit dans un diff.
--     Vérifié : aucun chemin ne l'utilise — les écritures de ces tables passent
--     par des fonctions `security definer` ou par `insert`, la cascade et le
--     SET NULL s'exécutent avec les droits du propriétaire, et aucune fonction
--     n'y pose de `select … for update`, qui exigerait `update`.
--   — `schema.test.ts` garde ce qui reste : aucune politique `DELETE`/`UPDATE`
--     sur ces tables, aucun `delete` pour `authenticated` sur `capture.pieces`.
--
-- Et le réglage `malica.paiements_effacables`, posé par le garde, est remis à
-- vide en même temps que `malica.piece_effacable` : une asymétrie sans
-- conséquence aujourd'hui est une question sans réponse demain.

revoke delete, update on
  capture.token_plan, capture.citations, capture.extractions, capture.conformite,
  capture.piece_versions, capture.precisions, capture.analyses, agents.agent_runs,
  capture.paiements, capture.paiement_justificatifs, collab.demandes_sur_piece
from authenticated, public, anon;

create or replace function public.capture_piece_supprimer(
  p_piece uuid,
  p_par_accord boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vis    text;
  v_status text;
  v_tenant uuid;
begin
  select p.vis::text, p.status, p.tenant_id
    into v_vis, v_status, v_tenant
    from capture.pieces p where p.id = p_piece;

  if v_vis is null then
    raise exception 'piece introuvable' using errcode = 'no_data_found';
  end if;

  -- `security definer` court-circuite la RLS : on refait ICI le contrôle de
  -- la politique `capture_pieces_del`.
  -- Le cabinet sous mandat n'est pas membre du dossier : il n'entre que pour
  -- exécuter un accord que la donnée établit (section 17), jamais autrement.
  if v_tenant not in (select app.member_orgs())
     and not (p_par_accord
              and v_tenant in (select app.engaged_orgs())
              and app.accord_donne(p_piece, 'suppression')) then
    raise exception 'piece introuvable' using errcode = 'no_data_found';
  end if;

  -- Libre tant que personne ne l'a reçue. `personnel` et `entite` sont tous
  -- deux « chez le client » : la seconde a seulement quitté le compte de son
  -- auteur pour la société, et la société a le droit de défaire ce qu'elle a
  -- fait. Seule `partage` a franchi la frontière du cabinet.
  -- Le drapeau ne suffit pas : l'accord se DÉRIVE de la donnée (section 17).
  if v_vis = 'partage'
     and not app.accord_donne(p_piece, 'suppression') then
    raise exception
      'Cette pièce a été transmise à votre cabinet : sa suppression demande son accord.'
      using errcode = 'check_violation';
  end if;

  if v_status not in ('capturee', 'lue') then
    raise exception
      'Cette pièce est engagée dans votre comptabilité : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from socle.ecritures e where e.piece_id = p_piece)
     or exists (select 1 from immo.assets a where a.piece_id = p_piece)
     or exists (select 1 from stocks.mouvements m where m.piece_id = p_piece)
     or exists (select 1 from identity.fiches_fiscales f where f.piece_id = p_piece)
  then
    raise exception
      'Cette pièce sert de justificatif : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  -- La trace survit à la pièce. `audit.event_log` porte `object_id` sans clé
  -- étrangère : ce qui a existé reste dit, même quand l'objet n'est plus là.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.supprimee', 'capture', 'pieces', p_piece,
          jsonb_build_object('vis', v_vis, 'status', v_status,
                             'par_accord', p_par_accord));

  perform set_config('malica.piece_effacable', p_piece::text, true);
  delete from capture.pieces where id = p_piece;
  perform set_config('malica.piece_effacable', '', true);
  perform set_config('malica.paiements_effacables', '', true);

  return true;
end;
$$;

revoke all on function public.capture_piece_supprimer(uuid, boolean) from public, anon;
grant execute on function public.capture_piece_supprimer(uuid, boolean) to authenticated;

comment on function public.capture_piece_supprimer(uuid, boolean) is
  'LA SEULE porte par laquelle une pièce disparaît. Libre tant que le cabinet '
  'ne l''a pas reçue ; sur accord inscrit ensuite, que seul `piece_repondre` '
  'passe. Jamais sur une pièce comptabilisée, accord compris.';

-- --- 13. Une pièce déjà lue ne paie pas un modèle pour rien ------------------
--
-- Relevé par l'épreuve `une-lecture-qui-echoue-ne-se-facture-pas` : pour une
-- pièce déjà comptée, `lecture_autorisee` répondait `relecture_gratuite`
-- (autorisée), le modèle était appelé et PAYÉ, puis `capture_read_persist`
-- refusait la seconde persistance (R7 : « cette pièce a déjà été lue »).
-- Dépense réelle, aucun résultat, aucun comptage. Déclencheurs ordinaires :
-- relance de la file hors ligne du téléphone, double clic.
--
-- La porte dit désormais non AVANT le modèle, avec un motif à elle :
-- `piece_deja_lue`. La condition est celle, exacte, du refus de la
-- persistance : une extraction existe pour la pièce.
--
-- ⚠ Le piège que l'épreuve a trouvé en rougissant : `lecture_consommer` est
-- appelée APRÈS la persistance, donc quand l'extraction existe. Si elle
-- interrogeait la même porte, elle se refuserait elle-même sur chaque lecture
-- réussie. Le verdict de fond est donc DÉPLACÉ dans `lecture_verdict` (le corps
-- de l'ancienne `lecture_autorisee`, inchangé), que la porte publique habille
-- du refus « déjà lue » et que `lecture_consommer` appelle nue. Les deux n'ont
-- pas la même question : l'une demande « peut-on commencer à lire ? », l'autre
-- « cette lecture rendue se compte-t-elle ? ».
--
-- `lecture_verdict` n'est PAS exposée : pas d'`execute` pour `authenticated`,
-- elle ne s'appelle que depuis les deux fonctions `security definer`, qui
-- portent chacune `app.piece_lisible` en tête (une `definer` sans porte est une
-- sonde).
--
-- Ce qui ne bouge pas : `relecture_gratuite` reste le verdict d'une pièce
-- comptée qui n'a pas d'extraction — une relecture ne coûte pas une lecture au
-- client. On retire l'inutilité, pas la gratuité.
--
-- La vraie réponse est plus riche — une seconde lecture est un fait nouveau et
-- daté (R7), donc c'est la persistance qui est trop stricte — mais elle touche
-- la chaîne de lecture (R2) et se décide ailleurs. Le motif disparaîtra avec
-- elle.

create or replace function public.lecture_verdict(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant   uuid;
  v_vis      app.vis_t;
  v_licence  uuid;
  v_conso    record;
  v_deja     boolean;
begin
  -- La RLS de `capture.pieces` ne s'applique plus ici : la lisibilité de la
  -- pièce pour l'appelant se demande à la fonction qui la porte.
  if not app.piece_lisible(p_piece) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  select tenant_id, vis into v_tenant, v_vis
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- B6 : une pièce personnelle n'est jamais lue.
  if v_vis = 'personnel'::app.vis_t then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'piece_personnelle',
      'restantes', null, 'droit', null);
  end if;

  select licence_id into v_licence
    from facturation.licence_organisations where tenant_id = v_tenant;
  if v_licence is null then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'organisation_sans_licence',
      'restantes', null, 'droit', null);
  end if;

  select * into v_conso from facturation.consommation_v where licence_id = v_licence;
  if v_conso.licence_id is null then
    -- Pas de ligne : on ne sait pas, donc on refuse. Jamais `true` par défaut.
    return jsonb_build_object(
      'autorisee', false, 'motif', 'organisation_sans_licence',
      'restantes', null, 'droit', null);
  end if;

  -- Une pièce déjà comptée se relit sans rien coûter. C'est la correction
  -- gratuite, et c'est volontaire.
  select exists (select 1 from facturation.lectures where piece_id = p_piece)
    into v_deja;
  if v_deja then
    return jsonb_build_object(
      'autorisee', true, 'motif', 'relecture_gratuite',
      'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
      'licence_id', v_licence);
  end if;

  -- Une licence suspendue n'arrête pas la caméra, elle arrête l'œil.
  if v_conso.statut <> 'active' then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'licence_' || v_conso.statut,
      'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
      'licence_id', v_licence);
  end if;

  if v_conso.lectures_restantes <= 0 then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'plafond_atteint',
      'restantes', 0, 'droit', v_conso.lectures_droit,
      'licence_id', v_licence);
  end if;

  return jsonb_build_object(
    'autorisee', true, 'motif', 'dans_le_forfait',
    'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
    'licence_id', v_licence);
end
$$;

revoke all on function public.lecture_verdict(uuid) from public, anon, authenticated;

create or replace function public.lecture_autorisee(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.piece_lisible(p_piece) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- Une pièce déjà lue ne reçoit pas de seconde lecture : le dire ICI, avant
  -- le modèle, et non après l'avoir payé. Avant les licences : le refus ne
  -- dépend ni du forfait ni du plafond.
  if exists (select 1 from capture.extractions where piece_id = p_piece) then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'piece_deja_lue',
      'restantes', null, 'droit', null);
  end if;

  return public.lecture_verdict(p_piece);
end
$$;

revoke all on function public.lecture_autorisee(uuid) from public, anon;
grant execute on function public.lecture_autorisee(uuid) to authenticated;

create or replace function public.lecture_consommer(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_licence uuid;
  v_verdict jsonb;
begin
  -- La porte, nommée, et d'abord. La RLS de `capture.pieces` ne s'applique
  -- plus ici : sans cette ligne, tout compte authentifié ferait compter la
  -- lecture d'une pièce qu'il n'a pas le droit de voir.
  if not app.piece_lisible(p_piece) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- La règle du plafond vit à UN seul endroit, et c'est ici qu'on l'invoque.
  v_verdict := public.lecture_verdict(p_piece);
  if not (v_verdict ->> 'autorisee')::boolean then
    raise exception 'lecture refusee : %', v_verdict ->> 'motif'
      using errcode = 'check_violation';
  end if;

  if (v_verdict ->> 'motif') = 'relecture_gratuite' then
    return v_verdict;
  end if;

  -- Rien de ce qui s'écrit ne vient de l'appelant : le tenant est celui de la
  -- pièce, la licence est celle du tenant. C'est ce qui tient les sections 8
  -- et 9 sans la politique.
  select tenant_id into v_tenant from capture.pieces where id = p_piece;
  select licence_id into v_licence
    from facturation.licence_organisations where tenant_id = v_tenant;

  insert into facturation.lectures (tenant_id, licence_id, piece_id, periode, consommee_par)
  values (v_tenant, v_licence, p_piece,
          date_trunc('month', current_date)::date, auth.uid())
  on conflict (piece_id) do nothing;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'lecture.consommee', 'capture', 'pieces', p_piece,
          jsonb_build_object('licence_id', v_licence));

  return public.lecture_verdict(p_piece);
end
$$;

revoke all on function public.lecture_consommer(uuid) from public, anon;
grant execute on function public.lecture_consommer(uuid) to authenticated;

-- --- 14. Un refus de lecture s'inscrit, il ne se perd pas dans le silence ----
--
-- La file hors ligne du téléphone lance la lecture avec `?attendre=0` : la
-- route répond avant la lecture, et le refus n'arrive que dans la promesse
-- d'arrière-plan. Il n'était lu par personne. Le dirigeant au plafond
-- photographiait sa facture, l'application ne disait rien, et ce silence ne
-- se distinguait pas d'une panne.
--
-- Où l'inscrire : `audit.event_log`, qui porte déjà `lecture.consommee` pour la
-- même pièce, est en ajout seul (R7), lisible par les membres et le cabinet
-- engagé, indexé par objet. Aucune colonne nouvelle sur `capture.pieces`, dont
-- le `status` est une machine d'états à huit valeurs qui ne dit pas « refusée »
-- : une pièce refusée est une pièce `capturee`, non lue, et c'est vrai.
--
-- Le motif voyage STRUCTURÉ : le code que rend `lecture_autorisee`, tel quel,
-- dans `payload.motif`. Jamais une phrase — elle s'afficherait en français à
-- une personne qui lit l'anglais ou l'arabe (R4).
--
-- Le motif n'est pas fourni par l'appelant : la fonction REJOUE le verdict et
-- n'inscrit que ce que la base répond. Une porte qui écrirait un motif choisi
-- par le client serait un moyen de fabriquer des refus. Rien n'est inscrit si
-- la lecture est autorisée, ni deux fois de suite pour le même motif (un rejeu
-- de la file ne remplit pas le journal).

create or replace function public.lecture_refusee_inscrire(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_verdict jsonb;
  v_tenant  uuid;
  v_motif   text;
  v_dernier text;
begin
  v_verdict := public.lecture_autorisee(p_piece);   -- porte comprise
  if (v_verdict ->> 'autorisee')::boolean then
    return v_verdict;
  end if;

  v_motif := v_verdict ->> 'motif';
  select tenant_id into v_tenant from capture.pieces where id = p_piece;

  select payload ->> 'motif' into v_dernier
    from audit.event_log
   where object_table = 'pieces' and object_id = p_piece and action = 'lecture.refusee'
   order by at desc limit 1;

  if v_dernier is distinct from v_motif then
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, payload)
    values (v_tenant, auth.uid(), 'lecture.refusee', 'capture', 'pieces', p_piece,
            jsonb_build_object('motif', v_motif));
  end if;

  return v_verdict;
end
$$;

revoke all on function public.lecture_refusee_inscrire(uuid) from public, anon;
grant execute on function public.lecture_refusee_inscrire(uuid) to authenticated;

comment on function public.lecture_refusee_inscrire(uuid) is
  'Inscrit au journal d''audit POURQUOI une lecture a été refusée (payload.motif, '
  'le code de la base). Rejoue le verdict : le client ne choisit jamais le motif.';

-- --- 15. Le contrat RPC lit l'abonnement : deux vues, une fonction -------------
--
-- Les écrans de l'abonnement n'avaient rien à appeler. Le dépôt n'ajoute
-- aucune logique à ce que la base rend (R3) : tout ce qu'il faut afficher —
-- le forfait, les sièges, ce que chaque société consomme — est donc dit ici,
-- par des vues, et le dépôt les relaie.
--
-- Les deux vues naissent `security_invoker` (section 6) : la RLS des tables
-- lues s'applique à celui qui interroge. Et chacune est bornée à la licence
-- dont l'appelant est TITULAIRE : sans cette borne, un opérateur de la
-- plateforme — qui lit tout — recevrait la ligne d'un client au hasard.
-- « La licence de l'appelant » est une condition de la base, pas un filtre
-- d'application.
--
-- Une licence par titulaire n'est pas une contrainte du schéma
-- (`licences_titulaire_idx` n'est pas unique) : `mon_forfait()` peut donc
-- avoir plusieurs licences à rendre. Aucun parcours ne crée
-- aujourd'hui une seconde licence pour un même titulaire ; le dépôt rend la
-- première par identifiant, de façon déterministe, et la question reste posée
-- (voir le rapport de la tâche 3).

begin;

-- Le forfait n'est pas une vue : un collaborateur doit en lire une PART.
--
-- Une vue `security_invoker` ne rend rien de `facturation.licences` à qui n'en
-- est pas titulaire, et le layout lit le forfait pour tous les rôles. Ce qui
-- limite le travail d'un collaborateur — combien de pièces il peut encore faire
-- lire — le concerne ; ce que son employeur paie, non. La fonction rend donc
-- au titulaire sa ligne entière, et à un membre d'une organisation rattachée
-- le NOM de l'offre (un employé sait dans quel outil il travaille, et l'écran en a
-- besoin pour dégrader les fonctions) et le compteur de lectures de la licence :
-- le statut, les organisations, les places et le prix valent `null`.
-- `security definer` pour lire les vraies valeurs (comme `lecture_autorisee`) ;
-- elle porte sa propre porte : sans licence détenue ni organisation rattachée
-- dont l'appelant est membre, elle ne rend rien. Un membre de cabinet n'est
-- membre que du cabinet : il ne lit pas le compteur du client.

create or replace function public.mon_forfait()
returns table (
  offre text, statut text,
  lectures_droit integer, lectures_consommees integer, lectures_restantes integer,
  organisations integer, sieges_occupes integer, sieges_inclus integer, sieges_max integer,
  prix_mensuel_ht numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select c.offre_code, c.statut, c.lectures_droit, c.lectures_consommees,
           c.lectures_restantes, c.organisations, c.sieges_occupes,
           c.sieges_inclus::integer, c.sieges_max::integer, c.prix_mensuel_ht
      from facturation.consommation_v c
      join facturation.licences l on l.id = c.licence_id
     where l.titulaire = auth.uid()
     order by c.licence_id
     limit 1;
  if found then
    return;
  end if;

  return query
    select c.offre_code, null::text, c.lectures_droit, c.lectures_consommees,
           c.lectures_restantes, null::integer, null::integer, null::integer,
           null::integer, null::numeric
      from facturation.consommation_v c
     where c.licence_id = (
       select lo.licence_id from facturation.licence_organisations lo
        where lo.tenant_id in (select app.member_orgs())
        order by lo.licence_id limit 1);
end
$$;

revoke all on function public.mon_forfait() from public, anon;
grant execute on function public.mon_forfait() to authenticated;

comment on function public.mon_forfait() is
  'Le forfait de l''appelant. Titulaire : la ligne entière. Membre d''une '
  'organisation rattachée : le nom de l''offre et le compteur de lectures, le reste à null. '
  'Un AFFICHAGE : la décision d''une lecture se prend dans `lecture_autorisee`.';

create or replace view public.licence_sieges_v with (security_invoker = true) as
select
  m.user_id,
  p.display_name as nom,
  m.role,
  m.tenant_id,
  o.name         as organisation
from facturation.licences l
join facturation.licence_organisations lo on lo.licence_id = l.id
join identity.memberships m               on m.tenant_id = lo.tenant_id
join identity.organizations o             on o.id = m.tenant_id
left join identity.profiles p             on p.user_id = m.user_id
where l.titulaire = auth.uid();

comment on view public.licence_sieges_v is
  'Les membres de toutes les organisations de la licence dont l''appelant est '
  'titulaire. Le dirigeant y figure (il n''occupe pas de place) ; la place se '
  'lit dans `mon_forfait().sieges_occupes`.';

create or replace view public.licence_organisations_v with (security_invoker = true) as
select
  lo.tenant_id,
  o.name as nom,
  -- Même période que `consommation_v` : le mois courant.
  (select count(*) from facturation.lectures le
    where le.licence_id = lo.licence_id
      and le.tenant_id = lo.tenant_id
      and le.periode = date_trunc('month', current_date)::date)::int
         as lectures_consommees
from facturation.licences l
join facturation.licence_organisations lo on lo.licence_id = l.id
join identity.organizations o             on o.id = lo.tenant_id
where l.titulaire = auth.uid();

comment on view public.licence_organisations_v is
  'Les organisations de la licence dont l''appelant est titulaire, et ce que '
  'chacune a consommé ce mois-ci.';

revoke all on public.licence_sieges_v, public.licence_organisations_v
  from public, anon, service_role;
grant select on public.licence_sieges_v, public.licence_organisations_v
  to authenticated;

-- --- 16. Inviter un siège : la place se demande À L'INVITATION ---------------
--
-- `memberships_place_disponible` (`20261018110000`) refuse la onzième place à
-- l'ENTRÉE, c'est-à-dire quand l'invité accepte. L'invitation, elle, se créait
-- sans regarder : le dirigeant d'une licence au complet invitait quelqu'un,
-- recevait « invitation envoyée », et la personne butait ensuite sur un refus
-- qu'elle n'avait aucun moyen de comprendre. Le déclencheur reste la dernière
-- porte (une invitation ne réserve pas de place, et deux invités peuvent
-- légitimement se disputer la dernière) ; celle-ci dit non plus tôt, avec la
-- même règle — `places_occupees` contre `sieges_max` — et le même code.
--
-- Elle délègue ensuite à l'invitation qui existe (`cabinet_inviter`), au rôle
-- `collaborateur` : le dépôt n'a pas à choisir un rôle. `security definer`
-- parce que le dirigeant qui n'est pas le titulaire ne lit pas la licence ;
-- l'autorité est posée ici, en tête, comme dans `siege_reprendre_sa_place`.

create or replace function public.siege_inviter(p_tenant uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
  v_max     smallint;
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'seul le dirigeant invite un siege' using errcode = '42501';
  end if;

  v_licence := facturation.licence_de(p_tenant);

  -- Une organisation sans licence n'a pas de plafond à opposer : le
  -- déclencheur fait de même, pour la même raison.
  if v_licence is not null then
    select sieges_max into v_max from facturation.droits_v where licence_id = v_licence;
    if facturation.places_occupees(v_licence) >= coalesce(v_max, 0) then
      raise exception 'cette offre porte % place(s) ; elles sont prises', coalesce(v_max, 0)
        using errcode = 'check_violation',
              hint = 'Passer à l''offre supérieure, ou libérer une place.';
    end if;
  end if;

  return public.cabinet_inviter(p_tenant, p_email, 'collaborateur');
end
$$;

revoke all on function public.siege_inviter(uuid, text) from public, anon;
grant execute on function public.siege_inviter(uuid, text) to authenticated;

comment on function public.siege_inviter(uuid, text) is
  'Invite un collaborateur sur une organisation de la licence, si une place est '
  'libre. Réservé au dirigeant. Le plafond vient de `droits_v`, jamais d''un compte du client.';

commit;

-- --- 17. L'accord du cabinet se DÉRIVE, il ne se signale pas -----------------
--
-- `capture_piece_supprimer(piece, true)` et `capture_piece_set_vis(piece, vis,
-- true)` croyaient leur dernier argument. Il vaut « le cabinet a donné son
-- accord », et il était accordé à `authenticated` : mesuré, le propriétaire
-- d'une pièce transmise l'effaçait ou la reprenait en écrivant `true` dans un
-- appel direct. Un réglage de session ne serait pas plus sûr — il se pose sans
-- privilège. Ce qu'on peut croire, c'est ce qu'on relit : `collab.demandes_sur_piece`
-- est en ajout seul, et l'état d'une demande est son dernier fait.
--
-- `app.accord_donne` le relit : le dernier fait de cet objet sur cette pièce est
-- `accordee`, et il date d'après la transmission (un accord de rappel donné avant
-- une retransmission ne vaut pas pour la suivante). Le drapeau n'est plus qu'une
-- intention, honorée si la donnée la fonde. `piece_repondre` inscrit le fait AVANT
-- d'appeler les deux fonctions : son chemin légitime passe inchangé.
--
-- (Ajout : l'accord est aussi « acquis » quand le dossier n'a aucun mandat
-- actif. Le drapeau `p_par_accord` ne décide alors plus rien : il reste dans la
-- signature, pour `piece_repondre`, et la donnée tranche seule.)
--
-- Ce que ce contrôle ne fait PAS : dire QUI a inscrit l'accord. La politique
-- d'insertion de `collab.demandes_sur_piece` est « membre du dossier », et
-- `piece_repondre` ne regarde pas le rôle : le dirigeant peut demander, puis
-- répondre lui-même. Voir le rapport de la tâche 3.
--
-- Porte propre : `security definer`, donc `app.piece_lisible` d'abord — sans
-- elle, tout compte apprendrait l'état d'une demande sur la pièce d'un autre.

begin;

create or replace function app.accord_donne(p_piece uuid, p_objet text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.piece_lisible(p_piece)
     and (
       -- Aucun mandat actif sur le DOSSIER : personne à qui demander, la pièce est
       -- au client. Ce n'est pas « le mandat de ce cabinet-ci » : un dossier passé
       -- de A à B a un mandat actif chez B, et l'accord est alors exigé de B.
       not exists (
         select 1
           from capture.pieces pc
           join identity.engagements e on e.pme_org_id = pc.tenant_id
          where pc.id = p_piece
            and e.status = 'actif'
            and e.starts_on <= current_date
            and (e.ends_on is null or e.ends_on >= current_date))
       or coalesce((
         select d.fait = 'accordee'
                and d.created_at >= coalesce(pc.transmise_le, '-infinity'::timestamptz)
           from collab.demandes_sur_piece d
           join capture.pieces pc on pc.id = d.piece_id
          where d.piece_id = p_piece and d.objet = p_objet
          order by d.created_at desc
          limit 1), false))
$$;

revoke all on function app.accord_donne(uuid, text) from public, anon;
grant execute on function app.accord_donne(uuid, text) to authenticated;

comment on function app.accord_donne(uuid, text) is
  'L''accord est-il acquis pour cet objet (rappel, suppression) sur cette pièce ? '
  'Oui si aucun mandat n''est actif sur le dossier, ou si le cabinet l''a accordé '
  'depuis la dernière transmission. Relu dans `demandes_sur_piece` et '
  '`engagements`, jamais reçu. Ne couvre pas une pièce comptabilisée : les '
  'fonctions appelantes la refusent d''abord par son statut.';

commit;

-- --- 18. Reprendre une place compte ce qui reste, sans le montrer -------------
--
-- `siege_reprendre_sa_place` était `security invoker` : sous la RLS du
-- dirigeant, les pièces `personnel` d'un collaborateur sont invisibles
-- (`20261018103000`). Elle comptait donc toujours zéro, libérait le partant, et
-- laissait sa pièce orpheline : le motif `pieces_personnelles_a_trancher` était
-- inatteignable.
--
-- Elle passe `security definer` pour COMPTER, et ne rend que le nombre : le
-- dirigeant apprend « n pièces restent à trancher », il n'en voit aucune, et la
-- personne qui part garde son espace privé (comme `etablissement_archiver` :
-- refuser et dire combien). Sa porte est écrite en tête : le dirigeant de CE
-- tenant, rien d'autre.

begin;

create or replace function public.siege_reprendre_sa_place(
  p_tenant uuid, p_membre uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restantes integer;
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'seul le dirigeant reprend une place' using errcode = '42501';
  end if;

  select count(*) into v_restantes
    from capture.pieces
   where tenant_id = p_tenant
     and created_by = p_membre
     and vis = 'personnel'::app.vis_t;

  if v_restantes > 0 then
    return jsonb_build_object(
      'libere', false,
      'motif', 'pieces_personnelles_a_trancher',
      'pieces', v_restantes);
  end if;

  delete from identity.memberships
   where tenant_id = p_tenant and user_id = p_membre and role <> 'dirigeant';

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_tenant, auth.uid(), 'siege.libere', 'identity', 'memberships',
          p_membre, jsonb_build_object('membre', p_membre));

  return jsonb_build_object('libere', true, 'pieces', 0);
end
$$;

revoke all on function public.siege_reprendre_sa_place(uuid, uuid) from public, anon;
grant execute on function public.siege_reprendre_sa_place(uuid, uuid) to authenticated;

commit;

-- --- 19. Seul le cabinet sous mandat tranche une demande ---------------------
--
-- Le dirigeant l'a dit : « le comptable sera notifié et c'est à lui d'accepter
-- ou décliner ». Jusqu'ici, rien ne l'imposait. La politique d'insertion de
-- `collab.demandes_sur_piece` était « membre du dossier » pour TOUS les faits, et
-- `piece_repondre` (`security invoker`) ne regardait aucun rôle : le dirigeant
-- demandait, puis répondait « accordé » lui-même. Pire, le cabinet ne pouvait
-- pas répondre du tout — la politique d'insertion lui était fermée, et la mise à
-- jour de `capture.pieces` qu'un rappel exige (vis `partage` -> `personnel`)
-- contredit la clause `with check` de `pieces_upd_cabinet`. Le seul chemin qui
-- fonctionnait était l'auto-accord. Les sections 17 et 3 dérivent l'accord de la
-- donnée ; encore faut-il que la donnée ne soit pas écrite par celui qu'elle lie.
--
-- Deux gardes, la base d'abord (R6) :
--
--   - la POLITIQUE d'insertion distingue inscrire une demande (`demandee`, membre
--     du dossier) de la trancher (`accordee` / `refusee`, cabinet engagé sous
--     mandat actif). Un insert direct du dirigeant est refusé, `piece_repondre`
--     ou pas ;
--   - `piece_repondre` porte sa porte : la pièce doit être lisible de l'appelant
--     et son dossier engagé auprès de lui. Elle passe `security definer`, parce
--     que l'effet d'un accord (rappel, suppression) écrit là où le cabinet n'a
--     pas de droit d'écriture, et qu'on n'a pas voulu lui en accorder : AUCUN
--     droit nouveau sur `capture.pieces`. Le droit est dans la fonction, et la
--     fonction ne se laisse pas appeler par la PME.
--
-- Une pièce `personnel` ou `entite` n'est visible d'aucun cabinet : la porte la
-- refuse, et son chemin de suppression est celui d'avant — libre, sans accord,
-- car `capture_piece_supprimer` n'en exige un que pour `partage`.

begin;

alter policy collab_demandes_sur_piece_ins on collab.demandes_sur_piece
  with check (
    (fait = 'demandee' and tenant_id in (select app.member_orgs()))
    or (fait in ('accordee', 'refusee') and tenant_id in (select app.engaged_orgs())));

create or replace function public.piece_repondre(
  p_piece uuid, p_objet text, p_accorde boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_dernier text;
begin
  if not app.piece_lisible(p_piece) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  select tenant_id into v_tenant from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  if v_tenant not in (select app.engaged_orgs()) then
    raise exception 'seul le cabinet sous mandat tranche une demande sur une piece'
      using errcode = '42501';
  end if;

  select d.fait into v_dernier
    from collab.demandes_sur_piece d
   where d.piece_id = p_piece and d.objet = p_objet
   order by d.created_at desc limit 1;
  if v_dernier is distinct from 'demandee' then
    raise exception 'aucune demande en attente sur cette piece'
      using errcode = 'check_violation';
  end if;

  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur)
  values (v_tenant, p_piece, p_objet,
          case when p_accorde then 'accordee' else 'refusee' end, p_note, auth.uid());

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.demande_tranchee',
          jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde));

  if p_accorde then
    if p_objet = 'rappel' then
      perform public.capture_piece_set_vis(p_piece, 'personnel'::app.vis_t, true);
    elsif p_objet = 'suppression' then
      -- `collab.demandes_sur_piece` cascade depuis la pièce ; ce qui survit est
      -- la ligne `piece.supprimee` de `audit.event_log` et la notification.
      perform public.capture_piece_supprimer(p_piece, true);
    end if;
  end if;

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde);
end
$$;

revoke all on function public.piece_repondre(uuid, text, boolean, text) from public, anon;
grant execute on function public.piece_repondre(uuid, text, boolean, text) to authenticated;

-- --- 20. Une table du referentiel oubliee dans les droits ---------------------
--
-- ============================================================ LE DEFAUT REEL
--
-- 18 octobre 2026, trouve EN REGARDANT l'accueil PME, pas en lisant le code :
-- la console accumulait quatre « 400 Bad Request » a chaque chargement, et le
-- corps de la reponse disait « droit refuse pour la table account_classes ».
--
-- La cause est un oubli, et un seul. `ref.account_classes` est nee avec la
-- migration 20261012240000, qui a accorde `select` sur la VUE
-- `public.ref_account_classes_v` et jamais sur la table dessous. La vue est
-- `security_invoker` -- elle lit donc avec les droits de l'appelant, ce qui est
-- exactement ce que le depot exige depuis la fuite entre clients du 17 octobre.
-- Resultat : la vue est accordee, la table ne l'est pas, et tout utilisateur
-- connecte recoit un refus.
--
-- Mesure du 18 octobre : sur les trente tables de `ref`, vingt-neuf sont
-- lisibles par `authenticated`. Celle-ci etait la seule a ne pas l'etre.
--
-- Pourquoi cela n'a casse aucune epreuve : l'ecran encaisse le refus et se
-- rend quand meme. La classe d'un compte ne s'affiche simplement jamais. Un
-- echec qui ne casse rien est le plus durable de tous.
--
-- R10 est la raison de fond : le referentiel est LIVRE, date et surchargeable.
-- Il se lit donc par quiconque a ouvert une session -- il ne porte aucune
-- donnee de tenant, et c'est ce qui distingue `ref` de tout le reste.

grant select on table ref.account_classes to authenticated;

commit;

begin;

-- --- 21. Le FODEC manquait au pack, et il est sur la plupart des factures ----
--
-- ============================================================ LE DEFAUT REEL
--
-- 18 octobre 2026, mesure sur une facture reelle (MEUBLES EL AMEN) : le FODEC
-- a 1 % figurait sur QUATRE des cinq lignes, pour 71,200 dinars, et
-- `ref.fiscal_charges` du pack TN ne connaissait que le droit de timbre.
--
-- La lecture etait JUSTE -- HT, TVA, timbre et TTC au millime pres. C'est
-- l'arithmetique qui sortait incoherente : le moteur d'equilibre retrouvait un
-- residu de 71,200 entre le TTC imprime et HT + TVA + droits declares, ne
-- trouvait au pack aucun droit a montant fixe de cette valeur, et bloquait
-- l'ecriture sur `RESIDUAL_UNEXPLAINED`. Le Fonds de developpement de la
-- competitivite est sur une grande partie des factures industrielles
-- tunisiennes : ce n'est pas un cas rare, c'est le cas courant.
--
-- Un second effet, moins visible et plus grave : la liste des codes de droits
-- offerte au modele qui DESIGNE vient de `ref_fiscal_charges_v`
-- (`depots/capture.ts`). Un droit absent du pack n'est pas seulement mal
-- impute : il est invisible au designateur, qui n'a aucun code ou le ranger.
--
-- ================================================================= LA SOURCE
--
-- Le taux et l'assiette ne viennent pas d'une memoire : ils sont dans le
-- corpus du depot, verbatim, en francais et en arabe. `LF-2011` art. 15 :
--
--   « Sont modifiees les dispositions du paragraphe premier de l'article 37 de
--     la loi n° 99-101 du 31 decembre 1999 portant loi de finances pour
--     l'annee 2000 comme suit : La taxe est due au taux de 1% sur : -- le
--     chiffre d'affaires hors taxe sur la valeur ajoutee realise par les
--     fabricants des produits soumis a la taxe et sur la valeur en douane pour
--     [l'importation], -- le chiffre d'affaires hors taxe sur la valeur
--     ajoutee realise par les prestataires de services. »
--
-- Taux 1 %, assiette « chiffre d'affaires hors TVA », date d'effet le 1er
-- janvier 2011 -- la loi de finances pour 2011. L'article 16 de la meme loi
-- renomme le fonds « fonds de developpement de la competitivite dans les
-- secteurs industriel, de services et de l'artisanat » ; le sigle FODEC reste
-- celui qui s'imprime sur les factures, et c'est donc lui qui est le code.
--
-- L'assiette de la TVA, elle, vient du Code de la TVA, art. 6-I, lui aussi
-- dans le corpus : « le chiffre d'affaires imposable comprend le prix des
-- marchandises, des travaux ou des services, TOUS FRAIS, DROITS ET TAXES
-- INCLUS [...] a l'exclusion de la taxe sur la valeur ajoutee ». Le FODEC est
-- un droit : il entre dans l'assiette de la TVA. D'ou `taxable = true`.
--
-- ========================================= CE QUE LE SCHEMA NE SAVAIT PAS DIRE
--
-- `ref.fiscal_charges` ne portait qu'un `fixed_amount` : elle savait decrire un
-- droit de timbre (un dinar par piece), pas un droit PROPORTIONNEL. Le taux et
-- l'assiette n'avaient donc nulle part a vivre -- et R4 interdit de les ecrire
-- en TypeScript. Deux colonnes les accueillent, et une contrainte refuse la
-- ligne qui dirait les deux a la fois ou aucune des deux.
--
-- Ce que ces colonnes ne font PAS, et il faut le dire : aucun moteur ne
-- recalcule le FODEC a partir du taux. Le montant reste celui qui est LU sur la
-- piece et cite (R2). Un controle « base x taux ~ montant » serait faux ici :
-- sur la facture mesuree le FODEC ne porte que quatre lignes sur cinq, et
-- `extract.v1` ne dit pas QUELLES lignes le portent. Poser ce garde
-- demanderait de remonter l'assiette ligne par ligne jusqu'a la lecture --
-- c'est-a-dire de toucher a la chaine que R2 protege. Le taux est donc, pour
-- aujourd'hui, une donnee que l'expert LIT au parametrage, pas un calcul.
--
-- ============================================================ LES IMPUTATIONS
--
-- Deux defauts livres, au sens de R10 : visibles, dates, surchargeables par le
-- cabinet sans migration. Ce ne sont pas des verites.
--
--   a l'achat   6652 « Taxes sur le chiffre d'affaires non recuperables »
--               -- compte OFFICIEL NC 01, et son libelle decrit exactement ce
--               que le FODEC est pour l'acheteur : une taxe assise sur le
--               chiffre d'affaires, qu'il ne recupere pas.
--
--   a la vente  4374 « Etat - FODEC collecte » -- subdivision OUVERTE PAR
--               MALICA sous 437, comme 4371 (timbre), 4372 (TFP) et 4373
--               (FOPROLOS) le sont deja. NC 01 ne subdivise pas 437 ; son
--               commentaire dit que 437 « est credite du montant de tous les
--               autres impots et taxes dus par l'entreprise ». Le FODEC n'est
--               pas une taxe sur le chiffre d'affaires de la serie 436 : c'est
--               une taxe affectee a un fonds. `is_official = false`.

alter table ref.fiscal_charges
  add column if not exists rate  numeric(9,6),
  add column if not exists basis text;

comment on column ref.fiscal_charges.rate is
  'Le taux d''un droit PROPORTIONNEL (FODEC : 0.01). Nul pour un droit a '
  'montant fixe. Aucun moteur ne s''en sert pour recalculer : le montant reste '
  'celui qui est lu sur la piece (R2). Il se lit au parametrage.';

comment on column ref.fiscal_charges.basis is
  'L''assiette : « per_document » pour un droit du par piece (droit de timbre), '
  '« base_ht » pour un droit assis sur le chiffre d''affaires hors TVA (FODEC).';

-- Les deux lignes deja la sont des droits par piece : un dinar, quelle que
-- soit la facture. On le DIT, puis la colonne devient obligatoire -- sans quoi
-- une assiette nulle serait une assiette qu'on ne voit pas, ce que R4 refuse.
update ref.fiscal_charges set basis = 'per_document'
 where basis is null and fixed_amount is not null;

alter table ref.fiscal_charges
  alter column basis set not null;

alter table ref.fiscal_charges
  drop constraint if exists fiscal_charges_assiette_coherente;
alter table ref.fiscal_charges
  add constraint fiscal_charges_assiette_coherente check (
    (basis = 'per_document' and fixed_amount is not null and rate is null)
    or (basis = 'base_ht' and rate is not null and fixed_amount is null)
  );

-- Le compte de la vente : extension Malica sous 437, jamais un compte officiel.
insert into ref.accounts
  (pack_version_id, account_code, label, parent_code, account_class,
   normal_side, is_collective, requires_auxiliary, is_official, source_ref)
select p.id, '4374', 'Etat - FODEC collecte', '437', '4', 'credit', false, false, false,
       'Extension Malica sous 437 (NC 01 ne subdivise pas 437), par symetrie avec '
       '4371/4372/4373. Le FODEC est une taxe affectee a un fonds, pas une taxe sur '
       'le CA de la serie 436. Taxe instituee par l''art. 36 de la loi 99-101 du '
       '31/12/1999, taux fixe par l''art. 37, modifie par l''art. 15 de la LF 2011.'
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN' and p.version = '2026.1'
   and not exists (
     select 1 from ref.accounts a
      where a.pack_version_id = p.id and a.account_code = '4374');

-- Le droit lui-meme. `valid_from` est ECRIT, en litteral : la colonne a pour
-- defaut `current_date`, et l'omettre ferait entrer la date du jour dans le
-- referentiel (R11, forme cachee). La date est celle du taux : 1er janvier
-- 2011, la loi de finances pour 2011.
insert into ref.fiscal_charges
  (pack_version_id, code, label, document_kind, account_code,
   fixed_amount, rate, basis, taxable, legal_reference, valid_from)
select p.id, 'FODEC', c.label, c.kind, c.compte,
       null, 0.010000, 'base_ht', true, c.ref, date '2011-01-01'
  from ref.jurisdiction_packs p,
  (values
    ('Fonds de developpement de la competitivite (FODEC)', 'facture_achat', '6652',
     'Art. 36 et 37 de la loi n° 99-101 du 31 decembre 1999 (LF 2000), art. 37 tel que '
     'modifie par l''art. 15 de la loi de finances pour 2011 : taxe due au taux de 1 % '
     'sur le chiffre d''affaires hors TVA. Assiette de la TVA : Code de la TVA, art. 6-I.'),
    ('Fonds de developpement de la competitivite (FODEC)', 'facture_vente', '4374',
     'Art. 36 et 37 de la loi n° 99-101 du 31 decembre 1999 (LF 2000), art. 37 tel que '
     'modifie par l''art. 15 de la loi de finances pour 2011 : taxe due au taux de 1 % '
     'sur le chiffre d''affaires hors TVA. Assiette de la TVA : Code de la TVA, art. 6-I.')
  ) as c(label, kind, compte, ref)
 where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, code, document_kind, valid_from) do nothing;

-- Le libelle que l'ecran montre vient de `ref.labels`, pas de la colonne
-- `label` qui est francaise.
insert into ref.labels (ns, key, locale, value) values
  ('fiscal_charge','FODEC','fr','FODEC - Fonds de developpement de la competitivite'),
  ('fiscal_charge','FODEC','en','FODEC - Competitiveness Development Fund levy'),
  ('fiscal_charge','FODEC','ar','المعلوم لفائدة صندوق تنمية القدرة التنافسية')
on conflict (ns, key, locale) do nothing;

-- ===================================== CE QUI N'EST PAS ENTRE, ET POURQUOI
--
-- Trois charges ont ete examinees et ECARTEES. Aucune ne l'est faute de
-- source : chacune l'est parce que `ref.fiscal_charges` decrit un droit
-- IMPRIME SUR UNE PIECE, et qu'y inscrire autre chose dirait au designateur de
-- le chercher sur la facture -- c'est-a-dire l'inviterait a inventer.
--
--   TCL. Taux sourcable : `CFL` art. 38, dans le corpus, « 0.2 pourcent »
--   (0,1 % pour certains commerces a prix homologues, 25 % pour les personnes
--   de l'art. 37 al. 2). Mais la taxe sur les etablissements ne se facture
--   pas : l'entreprise la declare et la paie sur son propre chiffre
--   d'affaires. Elle n'apparait sur aucune facture. Sa place est une echeance
--   (`ref.pack_rules`), pas un droit de piece.
--
--   Retenue a la source. Elle ne s'AJOUTE pas au TTC, elle se RETIENT du
--   montant a payer, et c'est le payeur qui l'opere -- pas l'emetteur de la
--   facture. Le moteur d'equilibre traite `other_charges` comme additif et les
--   porte du cote de la contrepartie : une retenue y entrerait avec le mauvais
--   signe et fabriquerait une ecriture fausse. Son taux depend en outre de la
--   nature du paiement ET de la convention applicable -- ce qui est exactement
--   l'objet de la section 22.
--
--   Droit de consommation. Son taux n'existe pas au singulier : il se lit
--   position tarifaire par position tarifaire, du simple au centuple. Une
--   ligne de pack porterait donc un taux faux pour presque tout. Il est de
--   plus compris dans le prix et dans l'assiette de la TVA, et ne figure
--   qu'exceptionnellement en ligne separee.
--
-- Ce qui reste a faire un jour, et qui n'est pas fait ici faute d'avoir trouve
-- le taux verbatim dans le corpus : les taxes au profit du fonds de
-- developpement des communications, qui figurent, elles, sur les factures de
-- telecommunications. Le `RECUEIL` en porte le chapitre XVII mais le texte
-- ingere s'arrete avant le tarif. Rien n'est pose : un taux devine serait la
-- faute que ce depot existe pour empecher.

-- --- 22. Mille trois cent cinquante-sept articles qui n'osaient rien dire ----
--
-- ============================================================ LE DEFAUT REEL
--
-- 18 octobre 2026 : 1 357 articles du corpus PORTAIENT le droit et tous
-- disaient `indetermine` -- les 45 conventions fiscales (1 315 articles) et les
-- 42 normes comptables tunisiennes (42).
--
-- Deux regles du depot se heurtaient :
--
--   -- la recherche les rend, et DOIT les rendre : une convention prime sur la
--      loi interne et plafonne la retenue a la source. C'est tout l'objet de
--      `20260901200000_les_conventions_entrent_dans_la_recherche.sql` ;
--   -- la consigne 12 du systeme de Malica dit « Un article dont le statut
--      n'est pas "en vigueur" ne fonde aucune reponse actuelle », et l'en-tete
--      transmis au modele imprime « -- STATUT : indetermine »
--      (`malica/conseil/corpus.ts`).
--
-- Mesure : a une question sur la convention France-Tunisie -- en vigueur
-- depuis le 1er avril 1975 -- Malica refusait de fonder sa reponse. Et le
-- verdict `statut_non_en_vigueur` partait au journal des controles, ou
-- personne ne le lit.
--
-- La migration du 1er septembre avait fait la moitie du chemin : elle a ouvert
-- la RECHERCHE aux conventions. Elle n'a pas touche au STATUT, et le statut
-- est ce que le modele lit.
--
-- ================================================================= LA SOURCE
--
-- Aucun statut n'est pose de memoire. La date de signature et la date
-- d'entree en vigueur de chacune des 45 conventions viennent de la liste de
-- reserves et de notifications deposee par la REPUBLIQUE TUNISIENNE au moment
-- du depot de son instrument de ratification de la Convention multilaterale
-- BEPS (OCDE, deposee le 24 juillet 2023), qui nomme, convention par
-- convention, la juridiction, la date de signature et la date d'entree en
-- vigueur. Les 45 corpus ingeres dans ce depot y figurent TOUS -- la liste en
-- compte 56 : onze conventions couvertes n'ont pas encore ete ingerees
-- (Cameroun, Cote d'Ivoire, Indonesie, Iran, Koweit, Maurice, Portugal,
-- Royaume-Uni, Singapour, Soudan, Viet Nam), et cela se verra dans le rapport
-- plutot que de se deviner ici.
--
-- Le texte de chaque convention porte en outre, dans le corpus et verbatim,
-- son article d'entree en vigueur et son article de denonciation -- controle
-- fait sur les 45 : chacune a les deux. La convention France-Tunisie art. 44
-- dit « La Convention restera en vigueur sans limitation de duree ».
--
-- Pour les normes comptables : la loi n° 96-112 du 30 decembre 1996 relative
-- au systeme comptable des entreprises, et les arretes du ministre des
-- finances portant approbation des normes NC 01 a NC 42. Chaque norme porte
-- deja sa propre date d'effet sur sa version (1997 pour NC 01-15, 1999 pour
-- NC 16-25, 2001 pour NC 26-31, 2002 pour NC 32-34, 2003 pour NC 35-39, 2008
-- pour NC 40-41, 2011 pour NC 42) et toutes ont `source_code = 'ARRETE'`.
--
-- ========================================================== LA REGLE RETENUE
--
-- Un article est `en_vigueur` quand l'instrument qui le porte est entre en
-- vigueur a une date passee, qu'aucun instrument ulterieur du meme corpus ne
-- le remplace, et que cette date est ECRITE avec sa source. C'est exactement
-- la regle sous laquelle les 5 381 articles deja `en_vigueur` du depot le
-- sont : une edition consolidee ingeree, non supplantee dans le corpus. On ne
-- l'invente pas pour l'occasion, on l'applique au reste.
--
-- Ce qu'elle ne couvre pas, et qu'il faut dire : une denonciation notifiee par
-- voie diplomatique et non publiee dans le corpus resterait invisible. Aucune
-- source consultee n'en signale pour ces 45 conventions, et la liste BEPS de
-- 2023 les donne toutes pour couvertes -- une convention denoncee n'y serait
-- pas. C'est la meilleure garantie disponible, et elle n'est pas absolue.

create table if not exists legal.corpus_vigueur (
  corpus        text primary key,
  instrument    text not null,
  signe_le      date,
  en_vigueur_le date not null,
  source        text not null
);

comment on table legal.corpus_vigueur is
  'Pourquoi un corpus est en vigueur : l''instrument, sa date, et la source qui '
  'l''etablit. Une ligne ici est la justification d''un statut dans '
  '`legal.articles` -- sans elle, « en vigueur » serait une affirmation nue.';

comment on column legal.corpus_vigueur.en_vigueur_le is
  'Date d''entree en vigueur, en LITTERAL (R11). Deux machines qui jouent ce '
  'depot a deux jours d''intervalle doivent obtenir le meme referentiel.';

alter table legal.corpus_vigueur enable row level security;
alter table legal.corpus_vigueur force row level security;
revoke all on table legal.corpus_vigueur from public, anon, service_role;
grant select on table legal.corpus_vigueur to authenticated;

drop policy if exists legal_corpus_vigueur_sel on legal.corpus_vigueur;
create policy legal_corpus_vigueur_sel on legal.corpus_vigueur
  for select to authenticated using (true);

insert into legal.corpus_vigueur (corpus, instrument, signe_le, en_vigueur_le, source)
select v.corpus, v.instrument, v.signe, v.vigueur, v.source
  from (values
    ('CONV-AFRIQUE-DU-SUD',  date '1999-02-02', date '1999-12-10'),
    ('CONV-ALGERIE',         date '1985-02-09', date '1986-05-28'),
    ('CONV-ALLEMAGNE',       date '2018-02-08', date '2019-12-16'),
    ('CONV-ARABIE-SAOUDITE', date '2010-07-08', date '2013-04-01'),
    ('CONV-AUTRICHE',        date '1977-06-23', date '1978-08-05'),
    ('CONV-BELGIQUE',        date '2004-10-07', date '2009-06-05'),
    ('CONV-BURKINA-FASO',    date '2003-04-15', date '2013-04-11'),
    ('CONV-CANADA',          date '1982-02-10', date '1984-12-04'),
    ('CONV-CHINE',           date '2002-04-16', date '2003-09-23'),
    ('CONV-COREE-DU-SUD',    date '1988-09-27', date '1989-11-25'),
    ('CONV-DANEMARK',        date '1981-02-05', date '1981-05-28'),
    ('CONV-EGYPTE',          date '1989-12-08', date '1991-01-02'),
    ('CONV-EMIRATS',         date '1996-04-10', date '1997-05-27'),
    ('CONV-ESPAGNE',         date '1982-07-12', date '1987-02-14'),
    ('CONV-ETATS-UNIS',      date '1985-06-17', date '1990-12-26'),
    ('CONV-ETHIOPIE',        date '2003-01-23', date '2007-06-17'),
    ('CONV-FRANCE',          date '1973-05-28', date '1975-04-01'),
    ('CONV-GRECE',           date '1992-10-31', date '2010-09-29'),
    ('CONV-HONGRIE',         date '1992-10-22', date '1997-07-19'),
    ('CONV-ITALIE',          date '1979-05-16', date '1981-09-17'),
    ('CONV-JORDANIE',        date '1988-02-14', date '1990-01-01'),
    ('CONV-LIBAN',           date '1998-06-24', date '2000-06-03'),
    ('CONV-LIBYE',           date '1978-05-15', date '1979-06-14'),
    ('CONV-LUXEMBOURG',      date '1996-03-27', date '1999-10-18'),
    ('CONV-MALI',            date '2000-04-28', date '2002-11-20'),
    ('CONV-MALTE',           date '2000-05-31', date '2001-12-31'),
    ('CONV-MAROC',           date '1974-08-28', date '1979-06-26'),
    ('CONV-MAURITANIE',      date '1986-03-12', date '2000-01-01'),
    ('CONV-NORVEGE',         date '1978-05-31', date '1980-01-03'),
    ('CONV-OMAN',            date '1997-11-16', date '1998-04-22'),
    ('CONV-PAKISTAN',        date '1996-04-18', date '1997-08-05'),
    ('CONV-PAYS-BAS',        date '1995-05-16', date '1995-12-15'),
    ('CONV-POLOGNE',         date '1993-03-30', date '1993-11-15'),
    ('CONV-QATAR',           date '1997-03-08', date '1999-01-01'),
    ('CONV-ROUMANIE',        date '1987-09-23', date '1989-01-19'),
    ('CONV-SENEGAL',         date '1984-05-17', date '1985-05-25'),
    ('CONV-SERBIE',          date '2012-04-11', date '2013-06-03'),
    ('CONV-SLOVAQUIE',       date '1990-03-14', date '1991-10-25'),
    ('CONV-SUEDE',           date '1981-05-07', date '1983-04-19'),
    ('CONV-SUISSE',          date '1994-02-10', date '1995-04-28'),
    ('CONV-SYRIE',           date '1998-06-22', date '2001-01-01'),
    ('CONV-TCHEQUIE',        date '1990-03-14', date '1991-10-25'),
    ('CONV-TURQUIE',         date '1986-10-02', date '1987-12-28'),
    ('CONV-UMA',             date '1990-07-23', date '1993-07-14'),
    ('CONV-YEMEN',           date '1998-03-08', date '2000-09-27')
  ) as c(corpus, signe, vigueur)
  cross join lateral (values (
    c.corpus, c.signe, c.vigueur,
    'Convention de non double imposition',
    'Republique Tunisienne, Statut de la Liste de reserves et de notifications '
    'au moment du depot de l''instrument de ratification de la Convention '
    'multilaterale BEPS (OCDE), deposee le 24 juillet 2023 : conventions '
    'fiscales couvertes, date de signature et date d''entree en vigueur. '
    'L''article d''entree en vigueur et l''article de denonciation de la '
    'convention figurent en outre verbatim dans le corpus du depot.'
  )) as v(corpus, signe, vigueur, instrument, source)
on conflict (corpus) do nothing;

-- Les normes comptables. Un seul instrument fondateur, et des arretes
-- d'approbation successifs dont chaque norme porte deja la date sur sa version.
insert into legal.corpus_vigueur (corpus, instrument, signe_le, en_vigueur_le, source)
values (
  'NCT',
  'Systeme comptable des entreprises (NC 01 a NC 42)',
  date '1996-12-30',
  date '1997-01-01',
  'Loi n° 96-112 du 30 decembre 1996 relative au systeme comptable des '
  'entreprises, et arretes du ministre des finances portant approbation des '
  'normes comptables (NC 01-15 applicables en 1997, NC 16-25 en 1999, '
  'NC 26-31 en 2001, NC 32-34 en 2002, NC 35-39 en 2003, NC 40-41 en 2008, '
  'NC 42 en 2011). Chaque norme porte sa propre date d''effet sur sa version '
  'd''article ; aucun arrete d''abrogation n''existe. NC 42 cite elle-meme '
  '« l''article premier de la loi n° 96-112 du 30 decembre 1996 ».'
)
on conflict (corpus) do nothing;

-- Le statut suit la source, et seulement elle : un corpus sans ligne dans
-- `legal.corpus_vigueur` reste `indetermine`, ce qui est la reponse juste.
update legal.articles a
   set statut = 'en_vigueur'
  from legal.corpus_vigueur v
 where v.corpus = a.corpus
   and a.statut = 'indetermine';

-- ============================================ L'ANACHRONISME DE L'ALLEMAGNE
--
-- Trouve en comparant les dates ingerees a la liste BEPS : CONV-ALLEMAGNE
-- portait `valid_from = 1975-01-01` alors que son texte ingere est celui de la
-- convention du 8 fevrier 2018 -- il a 32 articles, un art. 26 « Echange de
-- renseignements », un art. 27 « Assistance en matiere de recouvrement » et un
-- art. 29 renvoyant a un protocole annexe, tous absents de la convention de
-- 1975. Une question datee de 1990 recevait donc un texte entre en vigueur
-- vingt-neuf ans plus tard, presente comme le droit de l'epoque.
--
-- Les 45 conventions portaient toutes une date du 1er janvier, arrondie a
-- l'annee par l'ingestion. On leur rend leur vraie date, celle de la source,
-- en litteral. Ce n'est pas une correction de confort : `corpus.rechercher`
-- choisit la version par `valid_from <= le jour demande`.
--
-- Ce que cela ne repare pas : l'ingestion continuera de deriver la date du
-- texte. Une reingestion ramenerait 1975. C'est pourquoi l'epreuve
-- `le-droit-conventionnel-est-citable.test.ts` compare les deux -- elle
-- rougira le jour ou l'ingestion repassera devant cette table au lieu de la
-- lire.

update legal.article_versions av
   set valid_from = v.en_vigueur_le
  from legal.articles a
  join legal.corpus_vigueur v on v.corpus = a.corpus
 where av.article_id = a.id
   and a.corpus like 'CONV-%'
   and av.valid_from <> v.en_vigueur_le;

-- --- 23. L'etat d'une licence s'affichait en code brut ----------------------
--
-- ============================================================ LE DEFAUT REEL
--
-- 18 octobre 2026 : l'ecran des reglages imprimait `f.statut` tel quel sous
-- « Etat de la licence » -- `active`, `suspendue`, `resiliee`. Le specialiste
-- des langues a refuse de le traduire, et il avait raison :
-- `apps/web/src/lib/champ-lisible.ts` note que ces codes ne forment pas une
-- enumeration fermee du cote de l'ecran (`lecture_autorisee` compose
-- `'licence_' || statut`), et inventer la table dans le code aurait ete la
-- constante que R4 interdit.
--
-- Or la base, elle, SAIT : `facturation.licences` porte
-- `check (statut in ('active','suspendue','resiliee'))`. L'enumeration est
-- fermee la ou elle est ecrite. Il ne restait qu'a poser ses libelles dans le
-- referentiel, comme les motifs de rejet le sont depuis le 24 aout 2026.
--
-- Le motif de suspension suit, parce que c'est la meme contrainte et le meme
-- ecran : « suspendue » sans son motif ne dit pas si le client a demande la
-- suspension ou s'il n'a pas paye.
--
-- L'epreuve `les-statuts-de-licence-ont-un-libelle.test.ts` releve la liste
-- dans la contrainte `check` elle-meme, dans les deux sens : un statut sans
-- libelle la fait rougir, et un libelle sans statut aussi (R9).

insert into ref.labels (ns, key, locale, value) values
  ('licence_statut','active','fr','Active'),
  ('licence_statut','active','en','Active'),
  ('licence_statut','active','ar','نشطة'),
  ('licence_statut','suspendue','fr','Suspendue'),
  ('licence_statut','suspendue','en','Suspended'),
  ('licence_statut','suspendue','ar','موقوفة'),
  ('licence_statut','resiliee','fr','Résiliée'),
  ('licence_statut','resiliee','en','Terminated'),
  ('licence_statut','resiliee','ar','ملغاة'),

  ('licence_motif_suspension','impaye','fr','Impayé'),
  ('licence_motif_suspension','impaye','en','Unpaid invoice'),
  ('licence_motif_suspension','impaye','ar','عدم الدفع'),
  ('licence_motif_suspension','detachement_cabinet','fr','Détachement du cabinet'),
  ('licence_motif_suspension','detachement_cabinet','en','Firm detached the client'),
  ('licence_motif_suspension','detachement_cabinet','ar','فصل المكتب للملف'),
  ('licence_motif_suspension','demande_client','fr','Demande du client'),
  ('licence_motif_suspension','demande_client','en','Customer request'),
  ('licence_motif_suspension','demande_client','ar','بطلب من الحريف')
on conflict (ns, key, locale) do nothing;

commit;
