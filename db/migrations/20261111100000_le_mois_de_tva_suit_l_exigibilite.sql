-- Le mois de TVA d'une pièce suit l'exigibilité (11 novembre 2026).
--
-- ================================================================= LE DÉFAUT
--
-- Le CEO a tranché le 31 octobre 2026 (`mois_tva.date` = `exigibilite_calculee`,
-- 20261108090000). Le réglage était ENREGISTRÉ, pas appliqué : une pièce pesait
-- dans le mois de sa date d'écriture (la date de la facture), quelle que soit
-- la date à laquelle la TVA devient exigible (`app.jour_d_imputation_tva`,
-- 20261026090000).
--
-- ============================================ TEXTE, PRATIQUE, RISQUE (sources datées)
--
-- Texte — Code de la TVA, version 2022 publiée par chaexpert.com, consultée le
--   31/10/2026 (`ref.reglages_comptables_sources`, sujet `mois_tva`), tel que la
--   recherche du 31 octobre 2026 le résume (`reglage_sujet_texte`) : biens à la
--   livraison ; services à la réalisation, ou à l'encaissement s'il est
--   antérieur ; opérations sous retenue (art. 19 et 19 bis) à l'encaissement.
--   INCERTAIN (à confirmer par un expert-comptable sur le texte officiel) :
--     — le numéro de l'article : la recherche du dépôt cite l'art. 5, la
--       consigne de ce lot l'art. 6 ;
--     — la règle des services : la consigne de ce lot dit « à l'encaissement
--       (total ou partiel) », la recherche du dépôt et le libellé de l'option
--       que le cabinet voit disent « à la réalisation, ou à l'encaissement s'il
--       est antérieur ». C'est cette seconde lecture qui est appliquée : elle
--       est sourcée dans le dépôt, c'est celle que l'écran promet, et à tort
--       elle avance la TVA (un coût de trésorerie), là où l'autre la
--       retarderait (une pénalité de retard en cas de contrôle) ;
--     — la déduction d'un achat suit l'exigibilité chez le fournisseur : posé
--       par la consigne de ce lot, aucun texte relu dans le dépôt.
-- Pratique — `reglage_sujet_pratique` (recherche du 31/10/2026) : le mois de
--   la facture, en supposant qu'elle est émise à la livraison ou à la fin du
--   service.
-- Risque en cas de contrôle — `reglage_sujet_risque` (recherche du
--   31/10/2026) : un acompte encaissé sans TVA ; une facture tardive rattachée
--   au mauvais mois.
--
-- ================================================================= LA RÈGLE
--
-- Ce qui distingue un bien d'un service vient du référentiel, jamais du code :
-- la nature de ce que la pièce vend (`ref.natures_de_vente` et ses motifs, la
-- même reconnaissance que le compte de vente, `scan/nature-de-vente.ts`) porte
-- désormais son EXIGIBILITÉ — `livraison` (marchandises, produits finis) ou
-- `encaissement` (prestations, activités annexes). Un achat se range par la
-- même table : c'est la vente du fournisseur.
--
-- `app.jour_d_imputation_tva` reste LA fonction qui décide du jour, des deux
-- côtés (PME et cabinet) et pour la proposition. Elle rend une ligne par
-- exigibilité possible (livraison, encaissement, indécidable), parce que la
-- reconnaissance d'une désignation est une expression régulière de JavaScript
-- (`\p{L}`, que PostgreSQL ne lit pas) : l'appelant reconnaît la nature, la
-- fonction décide le jour et la réserve.
--
--   livraison    → la date de la facture. Malica ne lit pas de date de
--                  livraison : INCERTAIN quand le bon de livraison la précède.
--   encaissement → la réalisation, présumée à la date de la facture (la
--                  pratique) ; mais un encaissement COMPLET (TTC atteint, dans
--                  un seul mois) antérieur au mois de la facture fixe le mois.
--                  Un encaissement partiel antérieur, ou étalé sur plusieurs
--                  mois, ne se devine pas : la pièce garde la date de la
--                  facture et porte la réserve `encaissement_partiel`.
--   indécidable  → (aucun motif, ou des articles de deux exigibilités) la date
--                  de la facture ; la réserve `nature_indecidable` seulement
--                  quand la nature changerait le mois.
--
-- L'option `date_facture_alerte` garde la date de la facture, et porte la
-- réserve `exigibilite_anterieure` quand un encaissement antérieur au mois de
-- la facture rendrait la TVA exigible plus tôt (le libellé de l'option).
--
-- Dans tous les cas, un mois déjà DÉCLARÉ ne se réécrit pas : la pièce passe
-- au jour de son arrivée (le report du reliquat, 20261026090000).
--
-- NON APPLIQUÉ, et dit à l'écran (`reglage_sujet_incertain`) : l'opération
-- avec une personne publique (à l'encaissement : le Socle ne sait pas qui l'est)
-- et la date modifiée pièce par pièce avec un motif.
--
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

-- --- 1. L'exigibilité d'une nature ------------------------------------------------------------

alter table ref.natures_de_vente
  add column exigibilite text check (exigibilite in ('livraison', 'encaissement'));

update ref.natures_de_vente set exigibilite = case code
    when 'marchandises' then 'livraison'
    when 'produits_finis' then 'livraison'
    when 'prestations' then 'encaissement'
    -- Une location, une refacturation, une commission : des services.
    -- INCERTAIN pour la refacturation de débours (à confirmer).
    when 'annexes' then 'encaissement'
  end;

alter table ref.natures_de_vente alter column exigibilite set not null;

comment on column ref.natures_de_vente.exigibilite is
  'Quand la TVA de ce qui est vendu devient exigible (Code TVA, 11 novembre 2026) : à la '
  'livraison (un bien) ou, pour un service, à la réalisation ou à l''encaissement antérieur.';

-- --- 2. Le pack d'un dossier ---------------------------------------------------------------------
--
-- Le pack en vigueur de la juridiction du dossier au jour dit. `app.pack_de_la_piece`
-- le calculait pour son repli : il le lit ici, une seule fois écrit.

create or replace function app.pack_du_dossier(p_dossier uuid, p_jour date)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select jp.id
    from ref.jurisdiction_packs jp
    join identity.organizations o on o.jurisdiction = jp.jurisdiction
   where o.id = p_dossier and jp.effective_from <= p_jour
   order by jp.effective_from desc
   limit 1
$$;

revoke all on function app.pack_du_dossier(uuid, date) from public, anon;
grant execute on function app.pack_du_dossier(uuid, date) to authenticated;

-- Corps repris de 20261030090000 ; seul le repli appelle `app.pack_du_dossier`.
create or replace function app.pack_de_la_piece(p_piece uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- Rien pour qui ne lit pas la pièce : la fonction voit sous la RLS, pas à côté.
  select case when app.piece_lisible(p_piece) then coalesce(
    (select a.pack_version_id from capture.analyses a
      where a.piece_id = p_piece order by a.created_at desc limit 1),
    (select app.pack_du_dossier(p.tenant_id, current_date)
       from capture.pieces p where p.id = p_piece)) end
$$;

-- --- 3. Les règlements vivants d'une pièce ---------------------------------------------------
--
-- Ce qu'éteint chaque règlement vivant (ni annulé, ni « pas encore payé »), en
-- unités mineures : la dette éteinte, retenue à la source comprise
-- (`app.dette_eteinte`), sinon son montant. La garde d'inscription le
-- calculait seule ; le jour d'imputation le lit aussi, pour chaque pièce du
-- mois.
--
-- Sans `set search_path` (tous ses noms sont qualifiés, et elle s'exécute aux
-- droits de l'appelant) : PostgreSQL ne déplie pas une fonction qui fixe un
-- réglage. Dépliée, la lecture du mois coûte 2 ms pour 200 pièces ; appelée,
-- 30 à 75 ms (mesuré le 11 novembre 2026).

create or replace function app.reglements_vivants(p_versions uuid[])
returns table (paye_le date, eteint_mineur bigint)
language sql
stable
security invoker
as $$
  select p.paye_le,
         coalesce(round(app.dette_eteinte(p.id) * power(10, d.exposant))::bigint, p.montant_mineur)
    from capture.paiements p
    join ref.devises d on d.code = p.devise
   where p.piece_id = any (p_versions) and p.annule_paiement_id is null
     and p.moyen_code <> 'non_paye'
     and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)
$$;

revoke all on function app.reglements_vivants(uuid[]) from public, anon;
grant execute on function app.reglements_vivants(uuid[]) to authenticated;

-- Corps repris de 20261029190000 ; seul le calcul de ce qui est déjà éteint
-- appelle `app.reglements_vivants`. SECURITY DEFINER et propriétaire gardés.
create or replace function capture.un_reglement_dit_vrai()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ttc  bigint;
  v_paye bigint;
  v_courante uuid;
  v_versions uuid[];
begin
  -- Une annulation n'est pas un règlement : elle a ses propres gardes, et elle
  -- reste sur la pièce du règlement qu'elle annule.
  if new.annule_paiement_id is not null then
    return new;
  end if;

  -- La pièce appartient au dossier inscrit : la politique d'insertion vérifie
  -- le dossier, pas la pièce, et cette fonction lit (et éteint) au-delà de la
  -- RLS de l'appelant (revue Codex de #101).
  if not exists (select 1 from capture.pieces x
                  where x.id = new.piece_id and x.tenant_id = new.tenant_id) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  v_courante := app.version_courante(new.piece_id);
  select array_agg(v) into v_versions from app.versions_de_la_piece(new.piece_id) v;

  -- Un règlement nouveau ne s'inscrit pas sur une version gelée : c'est la
  -- même facture, il va à sa version courante — avec son établissement et son
  -- côté. La file hors ligne peut porter un identifiant d'avant la reprise ;
  -- la refuser ferait perdre un règlement réel (« rien ne bloque »).
  if new.piece_id <> v_courante then
    select c.id, c.entity_id, c.vis into new.piece_id, new.entity_id, new.vis
      from capture.pieces c where c.id = v_courante;
  end if;

  -- Une seule inscription à la fois par pièce — toutes versions : deux appuis
  -- simultanés, sur l'ancienne et la nouvelle photo, ne passent pas tous deux
  -- la règle du dépassement.
  perform pg_advisory_xact_lock(hashtextextended(v_courante::text, 0));

  if new.moyen_code = 'non_paye' then
    if exists (select 1 from capture.paiements p
                where p.piece_id = any (v_versions) and p.annule_paiement_id is null
                  and p.moyen_code <> 'non_paye'
                  and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
      raise exception 'paiement.deja_regle' using errcode = 'check_violation';
    end if;
    if exists (select 1 from capture.paiements p
                where p.piece_id = any (v_versions) and p.annule_paiement_id is null
                  and p.moyen_code = 'non_paye'
                  and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
      raise exception 'paiement.deja_non_paye' using errcode = 'check_violation';
    end if;
    new.montant_mineur := null;
    new.paye_le := null;
    return new;
  end if;

  v_ttc := capture.ttc_mineur(v_courante);
  -- Ce qui est DÉJÀ éteint (`app.reglements_vivants`).
  select coalesce(sum(r.eteint_mineur), 0) into v_paye from app.reglements_vivants(v_versions) r;

  if new.montant_mineur is null then
    if v_ttc is null then
      raise exception 'paiement.montant_requis' using errcode = 'check_violation';
    end if;
    new.montant_mineur := v_ttc - v_paye;
    if new.montant_mineur <= 0 then
      raise exception 'paiement.deja_solde' using errcode = 'check_violation';
    end if;
  end if;

  if new.montant_mineur <= 0 then
    raise exception 'paiement.montant_positif' using errcode = 'check_violation';
  end if;

  if v_ttc is not null and v_paye + new.montant_mineur > v_ttc then
    raise exception 'paiement.depasse_le_total' using errcode = 'check_violation';
  end if;

  if new.paye_le is null then
    new.paye_le := current_date;
  end if;
  if new.paye_le > current_date + 1 then
    raise exception 'paiement.date_future' using errcode = 'check_violation';
  end if;

  if exists (select 1 from capture.paiements p
              where p.piece_id = any (v_versions) and p.annule_paiement_id is null
                and p.moyen_code = new.moyen_code
                and p.montant_mineur = new.montant_mineur
                and p.paye_le is not distinct from new.paye_le
                and p.created_at > now() - interval '10 seconds'
                and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
    raise exception 'paiement.en_double' using errcode = 'check_violation';
  end if;

  return new;
end
$function$;

-- --- 4. Le jour d'imputation ---------------------------------------------------------------------
--
-- p_jour    le jour « actuel » de la pièce : la date de son écriture, à défaut
--           celle du document (la date de la facture) ;
-- p_arrivee le jour où elle est arrivée (transmise, ou inscrite) : celui du
--           report quand le mois exigible est déjà déclaré ;
-- p_regle   la valeur de `mois_tva.date` pour le dossier (`app.reglage_comptable`),
--           nulle pour un pack qui ne porte pas le réglage : le jour actuel.
--
-- Une ligne par exigibilité (`ref.natures_de_vente.exigibilite`, puis nulle :
-- indécidable) ; l'appelant retient celle de la nature qu'il a reconnue.
-- SECURITY INVOKER : elle lit les règlements sous la RLS de l'appelant.

drop function app.jour_d_imputation_tva(uuid, date, date);

create function app.jour_d_imputation_tva(
  p_tenant uuid, p_piece uuid, p_jour date, p_arrivee date, p_regle text)
returns table (exigibilite text, jour date, reserve text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_mois     date := date_trunc('month', p_jour)::date;
  v_versions uuid[];
  v_premier  date;
  v_dernier  date;
  v_eteint   bigint;
  v_exigible date := p_jour;
  v_reserve  text;
  v_actuel   date;
begin
  -- Les encaissements (ou décaissements) d'un mois ANTÉRIEUR à la facture :
  -- les seuls qui avancent l'exigibilité d'un service.
  if p_regle in ('exigibilite_calculee', 'date_facture_alerte') then
    -- Les règlements de toutes les versions de la pièce. Une pièce qu'aucune
    -- reprise ne touche est sa seule version : la chaîne (`app.versions_de_la_piece`,
    -- près d'une milliseconde) ne se lit que pour une pièce reprise. Dans une
    -- variable : un argument qui porte une sous-requête empêcherait
    -- PostgreSQL de déplier `app.reglements_vivants`.
    v_versions := case when exists (select 1 from capture.remplacements r
                                     where r.piece_id = p_piece or r.remplacee_par = p_piece)
                       then array(select app.versions_de_la_piece(p_piece))
                       else array[p_piece] end;
    select min(r.paye_le), max(r.paye_le), sum(r.eteint_mineur)
      into v_premier, v_dernier, v_eteint
      from app.reglements_vivants(v_versions) r
     where r.paye_le < v_mois;
    if v_premier is not null then
      if date_trunc('month', v_premier) = date_trunc('month', v_dernier)
         and v_eteint >= capture.ttc_mineur(app.version_courante(p_piece)) then
        v_exigible := v_premier;
      else
        v_reserve := 'encaissement_partiel';
      end if;
    end if;
  end if;

  -- Un mois déjà déclaré ne se réécrit pas : le report au jour d'arrivée.
  v_actuel := case when app.mois_tva_declare(p_tenant, p_jour)
                   then coalesce(p_arrivee, p_jour) else p_jour end;

  exigibilite := 'livraison';
  jour := v_actuel;
  reserve := null;
  return next;

  exigibilite := 'encaissement';
  if p_regle = 'exigibilite_calculee' then
    jour := case when v_exigible = p_jour then v_actuel
                 when app.mois_tva_declare(p_tenant, v_exigible) then coalesce(p_arrivee, v_exigible)
                 else v_exigible end;
    reserve := v_reserve;
  else
    jour := v_actuel;
    reserve := case when p_regle = 'date_facture_alerte' and v_premier is not null
                    then 'exigibilite_anterieure' end;
  end if;
  return next;

  -- Indécidable : la date de la facture ; une réserve seulement quand la
  -- nature changerait le mois (un encaissement antérieur existe).
  exigibilite := null;
  jour := v_actuel;
  reserve := case when v_premier is null then null
                  when p_regle = 'exigibilite_calculee' then 'nature_indecidable'
                  when p_regle = 'date_facture_alerte' then 'exigibilite_anterieure' end;
  return next;
end
$$;

revoke all on function app.jour_d_imputation_tva(uuid, uuid, date, date, text) from public, anon;
grant execute on function app.jour_d_imputation_tva(uuid, uuid, date, date, text) to authenticated;

-- --- 5. Ce qui reste à confirmer, et ce qui n'est pas appliqué ---------------------------------

update ref.reglages_comptables_sujets set incertain = true where code = 'mois_tva';

insert into ref.labels (ns, key, locale, value) values
  ('reglage_sujet_incertain', 'mois_tva', 'fr',
   'Numéro de l''article (5 ou 6) et règle des services (à la réalisation ou à l''encaissement '
   'antérieur ; ou à l''encaissement seul) : INCERTAIN. La réalisation d''un service et la '
   'livraison d''un bien sont présumées à la date de la facture. Non appliqués : l''opération avec '
   'une personne publique et la date modifiée pièce par pièce.'),
  ('reglage_sujet_incertain', 'mois_tva', 'en',
   'Article number (5 or 6) and the rule for services (on performance or earlier collection; or on '
   'collection only): UNCERTAIN. Performance of a service and delivery of goods are presumed at the '
   'invoice date. Not applied: transactions with a public body and a date changed document by '
   'document.'),
  ('reglage_sujet_incertain', 'mois_tva', 'ar',
   'رقم الفصل (5 أو 6) وقاعدة الخدمات (عند الإنجاز أو القبض السابق؛ أو عند القبض فقط): غير مؤكد. '
   'يُفترض إنجاز الخدمة وتسليم البضاعة في تاريخ الفاتورة. غير مطبّق: العمليات مع شخص عمومي وتعديل '
   'التاريخ وثيقةً بوثيقة.');

-- --- 6. Le réglage est appliqué, ses deux options aussi -----------------------------------------

update ref.reglages_comptables set applique = true where code = 'mois_tva.date';
update ref.reglages_comptables_options set applique = true where reglage = 'mois_tva.date';

commit;
