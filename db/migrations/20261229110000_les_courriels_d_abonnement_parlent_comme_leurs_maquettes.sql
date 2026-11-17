-- ======================================================================
--  Les courriels d'abonnement parlent comme leurs maquettes (E21, E22,
--  E23, E25 — 13 novembre 2026), et une offre se dit par son nom.
--
--  1. `notif.jetons_lisibles` : avant de rendre un gabarit, les jetons se
--     disent pour un lecteur — une date JJ/MM/AAAA aussi en toutes lettres
--     (`_longue`), une offre par son nom (« Premium », jamais `premium`) avec
--     ses droits et son prix, la société par son nom (`societe`). `notif.poster`
--     l'appelle ; rien d'autre ne change en lui.
--  2. `acces.monte` porte aussi l'offre d'avant (la carte « Team → Premium »).
--  3. `notif.cartes_courriel` : la carte de chaque genre (passage, montant,
--     lignes) ; ses textes sont des clés de `notif.libelles_courriel`.
--  4. Nouvelles versions datées des gabarits `email` (R7), textes en base ;
--     les versions remplacées jamais envoyées sont retirées.
--
--  R4 : la devise vient de la fiscalité en vigueur, les droits de `ref.offres`.
--  R11 : dates littérales.
-- ======================================================================

begin;

-- --- 1. Des jetons lisibles -----------------------------------------------

create function notif.jetons_lisibles(p_jetons jsonb, p_tenant uuid, p_locale text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v   jsonb := coalesce(p_jetons, '{}'::jsonb);
  k   text;
  o   ref.offres;
  v_devise text;
begin
  -- Une date JJ/MM/AAAA se dit aussi en toutes lettres : `{{cle_longue}}` (« 9 janvier »).
  for k in select jsonb_object_keys(coalesce(p_jetons, '{}'::jsonb)) loop
    if (p_jetons ->> k) ~ '^\d{2}/\d{2}/\d{4}$' then
      v := v || jsonb_build_object(
        k || '_longue', notif.date_longue(to_date(p_jetons ->> k, 'DD/MM/YYYY'), p_locale));
    end if;
  end loop;

  -- Une offre se dit par son nom ; son code reste à côté (`offre_code`).
  foreach k in array array['offre', 'avant', 'offre_couverte'] loop
    if v ? k then
      o := ref.offre_a(v ->> k, current_date);
      if o.code is not null then
        v := v || jsonb_build_object(k, o.libelle, k || '_code', o.code);
        if k = 'offre' then
          v := v || jsonb_build_object(
            'offre_lectures', o.lectures_par_organisation,
            'offre_places', o.sieges_inclus,
            'offre_societes', o.organisations_incluses,
            'offre_prix', to_char(o.prix_mensuel_ht, 'FM999G999G990D000'));
        end if;
      end if;
    end if;
  end loop;

  -- La devise de facturation en vigueur, s'il y en a une (R4) ; sinon le jeton manque.
  if v ? 'offre' and not v ? 'offre_devise' then
    begin
      select f.devise into v_devise from facturation.fiscalite_en_vigueur(current_date) f;
    exception when others then
      v_devise := null;
    end;
    if v_devise is not null then
      v := v || jsonb_build_object('offre_devise', v_devise);
    end if;
  end if;

  -- La société de l'événement, par son nom.
  if p_tenant is not null and not v ? 'societe' then
    v := v || jsonb_build_object('societe',
           (select o2.name from identity.organizations o2 where o2.id = p_tenant));
  end if;
  return jsonb_strip_nulls(v);
end
$$;
revoke all on function notif.jetons_lisibles(jsonb, uuid, text) from public, anon, authenticated;

-- Repris de sa définition en vigueur (20261229090000) ; seuls les jetons passent
-- désormais par `notif.jetons_lisibles`.
CREATE OR REPLACE FUNCTION notif.poster(p_destinataire uuid, p_code text, p_sujet_cle text, p_jetons jsonb DEFAULT '{}'::jsonb, p_tenant uuid DEFAULT NULL::uuid, p_canal text DEFAULT 'push'::text, p_fenetre interval DEFAULT '24:00:00'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  g          record;
  pref       record;
  v_locale   text;
  v_titre    text;
  v_jetons   jsonb;
  v_corps    text;
  v_abandon  text := null;
  v_heure    time;
  v_id       uuid;
  k          text;
begin
  -- ─ verrou 1 : le droit. Un destinataire sans membership sur le tenant
  --   concerné n'a plus rien à recevoir de ce tenant.
  if p_tenant is not null and p_destinataire not in (select notif.candidats(p_tenant)) then
    v_abandon := 'droit_perdu';
  end if;

  select * into pref from notif.preferences where user_id = p_destinataire;
  if pref.user_id is null then
    insert into notif.preferences (user_id) values (p_destinataire)
      on conflict do nothing;
    select * into pref from notif.preferences where user_id = p_destinataire;
  end if;

  -- ─ le canal ouvert. Une personne qui a fermé le courriel ou le push ne
  --   les reçoit pas ; l'application, elle, ne se ferme pas.
  if v_abandon is null
     and ((p_canal = 'email' and not pref.email_actif)
          or (p_canal = 'push' and not pref.push_actif)) then
    v_abandon := 'canal_absent';
  end if;

  -- ─ verrou 2 : la cadence. `jamais` veut dire jamais, y compris pour une
  --   échéance fiscale — c'est son choix, et le produit le respecte.
  if v_abandon is null and pref.cadence = 'jamais' and p_canal <> 'app' then
    v_abandon := 'cadence';
  end if;

  -- ─ verrou 3 : le silence. Le calcul se fait dans le fuseau de la personne.
  --   La fenêtre traverse minuit, d'où le `or` plutôt qu'un `between`.
  if v_abandon is null and p_canal = 'push' then
    v_heure := (now() at time zone pref.fuseau)::time;
    if (pref.silence_de < pref.silence_a
        and v_heure >= pref.silence_de and v_heure < pref.silence_a)
       or (pref.silence_de > pref.silence_a
        and (v_heure >= pref.silence_de or v_heure < pref.silence_a))
    then
      v_abandon := 'silence';
    end if;
  end if;

  -- ─ verrou 4 : le doublon. La promesse « une fois, et je me tais ».
  -- Deux façons de s'être déjà exprimé, et il faut les deux :
  --
  --   REMIS        la personne l'a reçu ;
  --   À REMETTRE   c'est décidé, le travailleur ne l'a pas encore poussé.
  --
  -- Oublier le second a une conséquence mesurée : un ordonnanceur qui tourne
  -- toutes les heures repose la même relance vingt-quatre fois avant que le
  -- travailleur n'en ait poussé une seule, et le client reçoit vingt-quatre
  -- courriels d'un coup. C'est exactement la boucle que « une fois, et je me
  -- tais » existe pour empêcher.
  --
  -- Un envoi ABANDONNÉ, lui, ne compte pas : retenu par le silence de 23 h,
  -- la même chose doit pouvoir repartir à 8 h.
  if v_abandon is null and exists (
       select 1 from notif.envois_v e
        where e.destinataire = p_destinataire
          and e.code = p_code
          and e.canal = p_canal              -- la ligne de l'application n'est pas le courriel
          and e.sujet_cle = p_sujet_cle
          and e.decision = 'a_remettre'      -- décidé : remis, ou en attente
          and e.etat <> 'refuse'             -- refusé pour de bon : on peut redire
          and e.cree_le > now() - p_fenetre)
  then
    v_abandon := 'doublon';
  end if;

  -- Le canal doit exister. Un push sans appareil enregistré n'échoue pas :
  -- il s'abandonne, proprement, et la ligne le dit.
  if v_abandon is null and p_canal = 'push' and not exists (
       select 1 from collab.push_devices d
        where d.user_id = p_destinataire and d.revoked_at is null)
  then
    v_abandon := 'canal_absent';
  end if;

  -- Le gabarit, dans la langue de la personne, repli sur le français.
  select coalesce(pr.locale, 'fr') into v_locale
    from identity.profiles pr where pr.user_id = p_destinataire;
  v_locale := coalesce(v_locale, 'fr');

  select * into g from notif.gabarits
   where code = p_code and canal = p_canal
     and locale in (v_locale, 'fr')
     and effective_from <= current_date
   order by (locale = v_locale) desc, effective_from desc
   limit 1;

  if g.id is null then
    raise exception '%', app.refus_avec_valeurs('refus.referentiel.gabarit_absent', 'code', (p_code)::text, 'canal', (p_canal)::text)
      using errcode = 'no_data_found';
  end if;

  -- La substitution : {{jeton}} → valeur. Un jeton absent reste visible dans
  -- le texte rendu plutôt que de disparaître — on veut le voir en recette,
  -- pas découvrir une phrase amputée chez un client.
  -- Les jetons dits pour un lecteur : dates en toutes lettres, offres par leur
  -- nom et leurs droits, société par son nom (`notif.jetons_lisibles`).
  v_jetons := notif.jetons_lisibles(p_jetons, p_tenant, g.locale);

  v_titre := g.titre; v_corps := g.corps;
  for k in select jsonb_object_keys(v_jetons) loop
    v_titre := replace(v_titre, '{{' || k || '}}', coalesce(v_jetons ->> k, ''));
    v_corps := replace(v_corps, '{{' || k || '}}', coalesce(v_jetons ->> k, ''));
  end loop;

  insert into notif.envois
    (tenant_id, destinataire, code, canal, gabarit_id, sujet_cle,
     titre_rendu, corps_rendu, decision, motif_abandon, donnees)
  values
    (p_tenant, p_destinataire, p_code, p_canal, g.id, p_sujet_cle,
     v_titre, v_corps,
     case when v_abandon is null then 'a_remettre' else 'abandonne' end,
     v_abandon,
     -- Ce que l'événement a porté : le courriel en dessine ses données (montant,
     -- frise, échéance) et son objet.
     v_jetons)
  returning id into v_id;

  return jsonb_build_object('envoi_id', v_id, 'poste', v_abandon is null,
                            'motif', v_abandon, 'canal', p_canal);
end
$$;

-- --- 2. La montée dit d'où l'on part ---------------------------------------
-- Repris de 20261226150000 ; seul l'événement `acces.monte` porte `avant`.
create or replace function public.acces_changer_offre(p_acces uuid, p_offre text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v        facturation.acces;
  v_grille ref.offres;
  v_regle  ref.offres_par_canal;
  v_id     uuid;
  v_rang_a smallint;
  v_rang_o smallint;
  v_forfait text;
  v_nom    text;
begin
  select * into v from facturation.acces where id = p_acces for update;
  if v.id is null or v.canal <> 'cabinet'
     or not app.has_org_role(v.cabinet_tenant_id, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if v.statut not in ('propose', 'actif') then
    raise exception 'refus.abonnement.plus_en_attente' using errcode = '22023';
  end if;
  v_grille := ref.offre_a(p_offre, current_date);
  if v_grille.code is null then
    raise exception 'refus.offre.hors_grille' using errcode = '22023';
  end if;
  v_regle := ref.canal_offre_a('cabinet', v_grille.code, current_date);
  if v_regle.canal is null or not v_regle.cabinet_peut_ouvrir then
    raise exception '%', app.refus_avec_valeurs('refus.offre.pas_par_un_cabinet', 'offre', v_grille.code)
      using errcode = 'check_violation';
  end if;
  if v_grille.code = v.offre_code then
    return jsonb_build_object('acces_id', v.id, 'effet', 'inchange');
  end if;
  v_nom := (select name from identity.organizations where id = v.cabinet_tenant_id);

  -- Le dirigeant n'a pas encore rejoint (A2) : la proposition change, rien ne se facture.
  if v.statut = 'propose' then
    update facturation.acces
       set statut = 'termine', effet_du = current_date, effet_au = current_date,
           motif_fin = 'changement_offre', licence_id = null
     where id = v.id;
    insert into facturation.acces
      (tenant_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut,
       propose_le, propose_par)
    values
      (v.tenant_id, 'cabinet', v.cabinet_tenant_id, v_grille.code, v_grille.effective_from,
       'propose', current_date, auth.uid())
    returning id into v_id;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (v.cabinet_tenant_id, auth.uid(), 'acces.offre_changee', 'facturation', 'acces', v_id,
            jsonb_build_object('client', v.tenant_id, 'avant', v.offre_code, 'offre', v_grille.code));
    return jsonb_build_object('acces_id', v_id, 'effet', 'proposition');
  end if;

  v_rang_a := (ref.offre_a(v.offre_code, current_date)).rang;
  v_rang_o := v_grille.rang;

  -- Le client est monté à sa charge au-dessus de ce que la comptabilité paie : elle peut
  -- prendre en charge l'offre qu'il a déjà (recette du 13 novembre, B7). Le même chemin que
  -- toute montée : ce que le client a réglé d'avance court jusqu'à son terme (la garde), puis
  -- la comptabilité paie l'offre entière ; aucun jour ne se paie deux fois.
  if v_rang_o > v_rang_a then
    -- Montée : sur-le-champ, le dirigeant est prévenu.
    update facturation.acces_descentes
       set statut = 'retiree', repondu_le = current_date, repondu_par = auth.uid()
     where tenant_id = v.tenant_id and statut = 'propose';
    v_id := facturation.acces_relayer(v.id, v_grille.code);
    select f.offre_code into v_forfait
      from facturation.forfait_courant_v f where f.licence_id = v.licence_id;
    if v_rang_o > coalesce((ref.offre_a(v_forfait, current_date)).rang, 0) then
      perform facturation.forfait_poser(v.licence_id, v_grille.code, current_date);
    end if;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (v.tenant_id, auth.uid(), 'acces.monte', 'facturation', 'acces', v_id,
            jsonb_build_object('cabinet', v.cabinet_tenant_id, 'avant', v.offre_code,
                               'offre', v_grille.code));
    perform notif.emettre(v.tenant_id, 'acces.monte', jsonb_build_object('acces_id', v_id, 'offre', v_grille.code, 'avant', v.offre_code, 'cabinet', v_nom));
    return jsonb_build_object('acces_id', v_id, 'effet', 'immediat');
  end if;

  -- Descente : elle attend l'accord du dirigeant. Elle doit tenir dans ce
  -- que la société utilise déjà (sociétés, places), si le forfait la suit.
  select f.offre_code into v_forfait
    from facturation.forfait_courant_v f where f.licence_id = v.licence_id;
  if v_forfait = v.offre_code then
    perform facturation.descente_possible(v.licence_id, v_grille.code);
  end if;
  update facturation.acces_descentes
     set statut = 'retiree', repondu_le = current_date, repondu_par = auth.uid()
   where tenant_id = v.tenant_id and statut = 'propose';
  insert into facturation.acces_descentes (acces_id, tenant_id, offre_code, propose_par)
  values (v.id, v.tenant_id, v_grille.code, auth.uid())
  returning id into v_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'acces.descente_demandee', 'facturation', 'acces_descentes', v_id,
          jsonb_build_object('cabinet', v.cabinet_tenant_id, 'avant', v.offre_code,
                             'offre', v_grille.code));
  perform notif.emettre(v.tenant_id, 'acces.descente_demandee', jsonb_build_object('descente_id', v_id, 'offre', v_grille.code, 'cabinet', v_nom));
  return jsonb_build_object('acces_id', v.id, 'descente_id', v_id, 'effet', 'accord_attendu');
end
$function$;

-- --- 3. La carte de chaque genre -------------------------------------------

create table notif.cartes_courriel (
  code        text not null,
  rang        smallint not null check (rang > 0),
  -- passage : « avant → offre » ; montant : la somme et son unité ; ligne : libellé, valeur.
  genre       text not null check (genre in ('passage', 'montant', 'ligne')),
  libelle_cle text not null,
  valeur_cle  text not null,
  primary key (code, rang)
);
alter table notif.cartes_courriel enable row level security;
revoke all on notif.cartes_courriel from public, anon, authenticated;

insert into notif.cartes_courriel (code, rang, genre, libelle_cle, valeur_cle) values
  ('acces.monte', 1, 'passage', 'carte.passage.avant', 'carte.passage.offre'),
  ('acces.monte', 2, 'montant', 'unite.pourVous', 'valeur.zeroPourVous'),
  ('acces.monte', 3, 'ligne', 'donnee.lectures', 'valeur.lecturesParSociete'),
  ('acces.monte', 4, 'ligne', 'donnee.places', 'valeur.placesEnPlus'),
  ('acces.monte', 5, 'ligne', 'donnee.societes', 'valeur.societesIncluses'),
  ('acces.propose', 1, 'ligne', 'donnee.offre', 'valeur.offre'),
  ('acces.propose', 2, 'ligne', 'donnee.payeePar', 'valeur.cabinet'),
  ('acces.propose', 3, 'ligne', 'donnee.factureMalica', 'valeur.zeroDevise'),
  ('acces.accepte', 1, 'ligne', 'donnee.client', 'valeur.client'),
  ('acces.accepte', 2, 'ligne', 'donnee.offre', 'valeur.offrePrixHt'),
  ('place.donnee', 1, 'ligne', 'donnee.pour', 'valeur.email');

insert into notif.libelles_courriel (cle, locale, texte, effective_from) values
  ('carte.passage.avant', 'fr', '{{avant}}', date '2026-11-17'),
  ('carte.passage.offre', 'fr', '{{offre}}', date '2026-11-17'),
  ('valeur.zeroPourVous', 'fr', '0,000', date '2026-11-17'),
  ('valeur.zeroPourVous', 'en', '0.000', date '2026-11-17'),
  ('valeur.zeroPourVous', 'ar', '0.000', date '2026-11-17'),
  ('unite.pourVous', 'fr', '{{offre_devise}} pour vous', date '2026-11-17'),
  ('unite.pourVous', 'en', '{{offre_devise}} for you', date '2026-11-17'),
  ('unite.pourVous', 'ar', '{{offre_devise}} عليكم', date '2026-11-17'),
  ('donnee.lectures', 'fr', 'Lectures', date '2026-11-17'),
  ('donnee.lectures', 'en', 'Readings', date '2026-11-17'),
  ('donnee.lectures', 'ar', 'القراءات', date '2026-11-17'),
  ('donnee.places', 'fr', 'Places', date '2026-11-17'),
  ('donnee.places', 'en', 'Seats', date '2026-11-17'),
  ('donnee.places', 'ar', 'المقاعد', date '2026-11-17'),
  ('donnee.societes', 'fr', 'Sociétés', date '2026-11-17'),
  ('donnee.societes', 'en', 'Companies', date '2026-11-17'),
  ('donnee.societes', 'ar', 'الشركات', date '2026-11-17'),
  ('donnee.payeePar', 'fr', 'Payée par', date '2026-11-17'),
  ('donnee.payeePar', 'en', 'Paid by', date '2026-11-17'),
  ('donnee.payeePar', 'ar', 'تدفعها', date '2026-11-17'),
  ('donnee.factureMalica', 'fr', 'Votre facture Malica', date '2026-11-17'),
  ('donnee.factureMalica', 'en', 'Your Malica invoice', date '2026-11-17'),
  ('donnee.factureMalica', 'ar', 'فاتورتكم من Malica', date '2026-11-17'),
  ('donnee.client', 'fr', 'Client', date '2026-11-17'),
  ('donnee.client', 'en', 'Client', date '2026-11-17'),
  ('donnee.client', 'ar', 'العميل', date '2026-11-17'),
  ('donnee.pour', 'fr', 'Pour', date '2026-11-17'),
  ('donnee.pour', 'en', 'For', date '2026-11-17'),
  ('donnee.pour', 'ar', 'لـ', date '2026-11-17'),
  ('valeur.lecturesParSociete', 'fr', '{{offre_lectures}} par mois et par société', date '2026-11-17'),
  ('valeur.lecturesParSociete', 'en', '{{offre_lectures}} a month per company', date '2026-11-17'),
  ('valeur.lecturesParSociete', 'ar', '{{offre_lectures}} شهريًا لكل شركة', date '2026-11-17'),
  ('valeur.placesEnPlus', 'fr', '{{offre_places}} en plus de vous', date '2026-11-17'),
  ('valeur.placesEnPlus', 'en', '{{offre_places}} besides you', date '2026-11-17'),
  ('valeur.placesEnPlus', 'ar', '{{offre_places}} إضافة إليكم', date '2026-11-17'),
  ('valeur.societesIncluses', 'fr', '{{offre_societes}} incluses', date '2026-11-17'),
  ('valeur.societesIncluses', 'en', '{{offre_societes}} included', date '2026-11-17'),
  ('valeur.societesIncluses', 'ar', '{{offre_societes}} مشمولة', date '2026-11-17'),
  ('valeur.offre', 'fr', '{{offre}}', date '2026-11-17'),
  ('valeur.cabinet', 'fr', '{{cabinet}}', date '2026-11-17'),
  ('valeur.client', 'fr', '{{client}}', date '2026-11-17'),
  ('valeur.email', 'fr', '{{email}}', date '2026-11-17'),
  ('valeur.zeroDevise', 'fr', '0,000 {{offre_devise}}', date '2026-11-17'),
  ('valeur.zeroDevise', 'en', '0.000 {{offre_devise}}', date '2026-11-17'),
  ('valeur.zeroDevise', 'ar', '0.000 {{offre_devise}}', date '2026-11-17'),
  ('valeur.offrePrixHt', 'fr', '{{offre}} · {{offre_prix}} {{offre_devise}} HT', date '2026-11-17'),
  ('valeur.offrePrixHt', 'en', '{{offre}} · {{offre_prix}} {{offre_devise}} excl. tax', date '2026-11-17'),
  ('valeur.offrePrixHt', 'ar', '{{offre}} · {{offre_prix}} {{offre_devise}} دون احتساب الأداء', date '2026-11-17'),
  ('etiquette.acces.propose', 'fr', 'Proposition', date '2026-11-17'),
  ('etiquette.acces.propose', 'en', 'Proposal', date '2026-11-17'),
  ('etiquette.acces.propose', 'ar', 'اقتراح', date '2026-11-17'),
  ('etiquette.acces.accepte', 'fr', 'Abonnements des clients', date '2026-11-17'),
  ('etiquette.acces.accepte', 'en', 'Client subscriptions', date '2026-11-17'),
  ('etiquette.acces.accepte', 'ar', 'اشتراكات العملاء', date '2026-11-17'),
  ('raison.acces.monte', 'fr', 'Votre abonnement est pris en charge par {{cabinet}}.', date '2026-11-17'),
  ('raison.acces.monte', 'en', 'Your subscription is paid by {{cabinet}}.', date '2026-11-17'),
  ('raison.acces.monte', 'ar', 'اشتراككم على نفقة {{cabinet}}.', date '2026-11-17'),
  ('raison.acces.propose', 'fr', 'Envoyé à la demande de {{cabinet}}.', date '2026-11-17'),
  ('raison.acces.propose', 'en', 'Sent at the request of {{cabinet}}.', date '2026-11-17'),
  ('raison.acces.propose', 'ar', 'أُرسلت بطلب من {{cabinet}}.', date '2026-11-17'),
  ('raison.acces.accepte', 'fr', 'Vous avez proposé cette prise en charge.', date '2026-11-17'),
  ('raison.acces.accepte', 'en', 'You proposed this take-over.', date '2026-11-17'),
  ('raison.acces.accepte', 'ar', 'اقترحتم هذا التكفّل.', date '2026-11-17'),
  ('raison.place.donnee', 'fr', 'Cette place est payée par {{cabinet}}.', date '2026-11-17'),
  ('raison.place.donnee', 'en', 'This seat is paid by {{cabinet}}.', date '2026-11-17'),
  ('raison.place.donnee', 'ar', 'هذا المقعد على نفقة {{cabinet}}.', date '2026-11-17'),
  ('apercu.acces.monte', 'fr', '{{offre_places}} places, {{offre_societes}} sociétés — sans rien changer à votre facture.', date '2026-11-17'),
  ('apercu.acces.monte', 'en', '{{offre_places}} seats, {{offre_societes}} companies — your invoice does not change.', date '2026-11-17'),
  ('apercu.acces.monte', 'ar', '{{offre_places}} مقاعد و{{offre_societes}} شركات — دون أي تغيير في فاتورتكم.', date '2026-11-17'),
  ('apercu.acces.propose', 'fr', 'Vous ne payez plus Malica : {{offre}} apparaît sur la facture de votre comptabilité.', date '2026-11-17'),
  ('apercu.acces.propose', 'en', 'You no longer pay Malica: {{offre}} goes on your accountant''s invoice.', date '2026-11-17'),
  ('apercu.acces.propose', 'ar', 'لن تدفعوا Malica بعد الآن: يظهر {{offre}} على فاتورة محاسبكم.', date '2026-11-17'),
  ('apercu.acces.accepte', 'fr', 'Son {{offre}} passe sur votre facture du mois.', date '2026-11-17'),
  ('apercu.acces.accepte', 'en', 'Its {{offre}} goes on your monthly invoice.', date '2026-11-17'),
  ('apercu.acces.accepte', 'ar', 'ينتقل {{offre}} إلى فاتورتكم الشهرية.', date '2026-11-17'),
  ('apercu.place.donnee', 'fr', 'La place est payée par {{cabinet}}.', date '2026-11-17'),
  ('apercu.place.donnee', 'en', 'The seat is paid by {{cabinet}}.', date '2026-11-17'),
  ('apercu.place.donnee', 'ar', 'المقعد على نفقة {{cabinet}}.', date '2026-11-17');

-- Une carte ne cite que des textes qui existent.
do $$
begin
  if exists (select 1 from notif.cartes_courriel c
              where not exists (select 1 from notif.libelles_courriel l where l.cle = c.libelle_cle and l.locale = 'fr')
                 or not exists (select 1 from notif.libelles_courriel l where l.cle = c.valeur_cle and l.locale = 'fr')) then
    raise exception 'notif.cartes_courriel : texte absent de notif.libelles_courriel';
  end if;
end
$$;

-- La file rend la carte avec le reste.
drop function notif.reserver_courriels(integer, interval);

create function notif.reserver_courriels(p_limite integer, p_duree interval)
returns table (envoi_id uuid, email text, locale text, titre text, corps text,
               action_libelle text, action_route text, ton text,
               code text, organisation text, donnees jsonb, frise jsonb,
               sujet text, libelles jsonb, carte jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_reglage jsonb;
begin
  -- Une réservation à la fois (revue de #403, Codex P2). `skip locked` n'écarte que les
  -- verrous encore tenus : deux travailleurs partis sur le même instantané pouvaient,
  -- l'un ayant validé, prendre la même ligne — et le courriel partait deux fois. Le
  -- verrou consultatif tient jusqu'à la validation ; la requête qui suit prend son
  -- instantané APRÈS lui, et voit donc les réservations du précédent.
  perform pg_advisory_xact_lock(hashtext('notif.reserver_courriels'));

  -- Le réglage de l'exploitant est la seule source du plafond. Absent : on le dit.
  select plateforme.relances_reglage() into v_reglage;
  if v_reglage ->> 'tentatives_max' is null then
    raise warning 'refus.relances.reglage_absent : relances d''impayé non remises';
  end if;

  return query
  with dus as (
    select e.id
      from notif.envois_v e
     where e.canal = 'email'
       and e.etat in ('a_remettre', 'a_reessayer')
       -- Les relances d'impayé : seulement avec le réglage, actif, et dans son plafond.
       -- Les autres courriels : sans plafond d'essais.
       and (e.code not like 'impaye.%'
            or (v_reglage ->> 'tentatives_max' is not null
                and (v_reglage ->> 'actives')::boolean
                and e.tentatives < (v_reglage ->> 'tentatives_max')::integer))
       -- une réservation encore vivante : le courriel part ailleurs, ou tout à l'heure
       and not exists (
         select 1 from notif.reservations r
          where r.envoi_id = e.id and r.reserve_jusqu > now())
  ),
  pris as (
    select n.id, n.destinataire, n.gabarit_id, n.titre_rendu, n.corps_rendu, n.cree_le,
           n.code, n.tenant_id, n.donnees
      from notif.envois n
     where n.id in (select id from dus)
     order by n.cree_le
     limit p_limite
       for update of n skip locked
  ),
  posees as (
    insert into notif.reservations (envoi_id, reserve_jusqu)
    select p.id, now() + p_duree from pris p
    returning notif.reservations.envoi_id
  )
  select p.id, u.email::text, g.locale, p.titre_rendu, p.corps_rendu,
         g.action_libelle, g.action_route, g.ton,
         p.code, o.name, p.donnees,
         -- Les relances d'impayé dessinent leur frise : les paliers dans l'ordre, leur
         -- couleur, leur jour tiré du calendrier de recouvrement en vigueur (R4).
         case when exists (select 1 from notif.paliers_impaye x where x.code = p.code) then (
           select jsonb_agg(jsonb_build_object(
                    'code', pa.code, 'signal', pa.signal, 'repondre', pa.repondre,
                    'jour', (select max(sp.value_num) from ref.socle_params sp
                              where sp.code = pa.parametre
                                and sp.valid_from <= current_date
                                and (sp.valid_to is null or sp.valid_to >= current_date)))
                  order by pa.rang)
             from notif.paliers_impaye pa)
         end,
         -- L'objet du message (le gabarit le porte) ; ses jetons, le travailleur les remplit.
         g.sujet,
         -- Les textes du cadre, dans la langue du message.
         notif.libelles_du_courriel(g.locale),
         -- La carte du genre (`notif.cartes_courriel`), dans l'ordre ; les textes sont des clés.
         (select jsonb_agg(jsonb_build_object('genre', c.genre, 'libelle', c.libelle_cle,
                                              'valeur', c.valeur_cle) order by c.rang)
            from notif.cartes_courriel c where c.code = p.code)
    from pris p
    join notif.gabarits g on g.id = p.gabarit_id
    join auth.users u on u.id = p.destinataire
    left join identity.organizations o on o.id = p.tenant_id
   order by p.cree_le;
end
$$;

revoke all on function notif.reserver_courriels(integer, interval) from public, anon, authenticated;
grant execute on function notif.reserver_courriels(integer, interval) to malica_api;

-- --- 4. Les gabarits, au texte des maquettes --------------------------------

insert into notif.gabarits
  (code, canal, locale, sujet, titre, corps, action_libelle, action_route, ton, effective_from)
values
  ('acces.monte', 'email', 'fr', '{{cabinet}} a passé {{societe}} en {{offre}}', 'Vous êtes en {{offre}}.', '{{cabinet}} a monté votre offre. Elle reste à sa charge : rien ne change pour vous, sinon ce que vous pouvez faire.', 'Voir mon abonnement', '/pme/reglages', 'succes', date '2026-11-17'),
  ('acces.monte', 'email', 'en', '{{cabinet}} moved {{societe}} to {{offre}}', 'You are on {{offre}}.', '{{cabinet}} moved your plan up. It stays at their expense: nothing changes for you, except what you can do.', 'See my subscription', '/pme/reglages', 'succes', date '2026-11-17'),
  ('acces.monte', 'email', 'ar', 'نقل {{cabinet}} {{societe}} إلى {{offre}}', 'أنتم على {{offre}}.', 'رفع {{cabinet}} عرضكم. يبقى على نفقته: لا شيء يتغيّر بالنسبة إليكم، سوى ما يمكنكم فعله.', 'عرض اشتراكي', '/pme/reglages', 'succes', date '2026-11-17'),
  ('acces.propose', 'email', 'fr', '{{cabinet}} propose de prendre votre abonnement en charge', 'Votre comptabilité paie Malica pour vous.', '{{cabinet}} propose de prendre en charge votre offre {{offre}}. Vous gardez la main : vous pouvez reprendre l''abonnement à tout moment.', 'Accepter ou refuser', '/pme/notifications', 'alerte', date '2026-11-17'),
  ('acces.propose', 'email', 'en', '{{cabinet}} offers to pay your subscription', 'Your accountant pays Malica for you.', '{{cabinet}} offers to take over your {{offre}} plan. You stay in control: you can take the subscription back at any time.', 'Accept or decline', '/pme/notifications', 'alerte', date '2026-11-17'),
  ('acces.propose', 'email', 'ar', 'يقترح {{cabinet}} التكفّل باشتراككم', 'محاسبكم يدفع Malica عنكم.', 'يقترح {{cabinet}} التكفّل بعرضكم {{offre}}. تبقى القرار بأيديكم: يمكنكم استرجاع الاشتراك في أي وقت.', 'القبول أو الرفض', '/pme/notifications', 'alerte', date '2026-11-17'),
  ('acces.accepte', 'email', 'fr', '{{client}} accepte : son {{offre}} passe sur votre facture', '{{client}} a accepté.', 'Son offre {{offre}} figurera sur votre facture du mois.', 'Voir les abonnements des clients', '/cabinet/abonnements', 'succes', date '2026-11-17'),
  ('acces.accepte', 'email', 'en', '{{client}} accepts: its {{offre}} goes on your invoice', '{{client}} accepted.', 'Its {{offre}} plan will appear on your monthly invoice.', 'See client subscriptions', '/cabinet/abonnements', 'succes', date '2026-11-17'),
  ('acces.accepte', 'email', 'ar', 'قبِل {{client}}: ينتقل {{offre}} إلى فاتورتكم', 'قبِل {{client}}.', 'سيظهر عرضه {{offre}} على فاتورتكم الشهرية.', 'عرض اشتراكات العملاء', '/cabinet/abonnements', 'succes', date '2026-11-17'),
  ('place.donnee', 'email', 'fr', 'Votre comptabilité a ouvert une place dans votre équipe', 'Une place de plus, offerte.', '{{cabinet}} a ouvert une place dans votre équipe pour {{email}}. Cette personne reçoit son invitation.', 'Voir mon équipe', '/pme/reglages', 'succes', date '2026-11-17'),
  ('place.donnee', 'email', 'en', 'Your accountant opened a seat in your team', 'One more seat, on them.', '{{cabinet}} opened a seat in your team for {{email}}. This person receives an invitation.', 'See my team', '/pme/reglages', 'succes', date '2026-11-17'),
  ('place.donnee', 'email', 'ar', 'فتح محاسبكم مقعدًا في فريقكم', 'مقعد إضافي على نفقتهم.', 'فتح {{cabinet}} مقعدًا في فريقكم لـ {{email}}. يتلقى هذا الشخص دعوته.', 'عرض فريقي', '/pme/reglages', 'succes', date '2026-11-17');

-- Les versions remplacées qu'aucun envoi n'a utilisées s'en vont ; celles qui
-- ont servi restent, car elles prouvent ce qui est parti.
delete from notif.gabarits g
 where g.code in ('acces.monte', 'acces.propose', 'acces.accepte', 'place.donnee')
   and g.canal = 'email'
   and g.effective_from < date '2026-11-17'
   and not exists (select 1 from notif.envois e where e.gabarit_id = g.id);

commit;
