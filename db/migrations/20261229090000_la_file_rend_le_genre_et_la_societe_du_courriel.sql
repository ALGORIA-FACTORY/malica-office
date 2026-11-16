-- ======================================================================
--  Les courriels au modèle des maquettes du 13 novembre 2026 (adoptées le
--  16 novembre) : ce que la file rend, et les textes qui vivent en base.
--
--  1. `notif.poster` garde sur la ligne `email` les jetons de l'événement.
--  2. Les textes du cadre, de l'invitation et du mot de passe (fr/en/ar) :
--     `notif.libelles_courriel` ; les paliers de l'impayé : `notif.paliers_impaye`.
--  3. La file rend `code`, `organisation`, `donnees`, `frise` (les paliers et
--     leur jour), `sujet` (l'objet du gabarit) et `libelles` (les textes de la
--     langue). Le type de retour change : la fonction se recrée.
--
--  R11 : les données de référence portent une date littérale.
-- ======================================================================

begin;

-- --- 1. La ligne du courriel garde ce que l'événement a porté ------------------
--
-- `notif.poster` rendait le titre et le corps, mais ne gardait pas les jetons :
-- la ligne `email` portait `donnees = '{}'`. Repris de sa définition en vigueur
-- (20261226140000) ; seule l'insertion garde désormais `p_jetons`.

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
  -- Une date JJ/MM/AAAA se dit aussi en toutes lettres, dans la langue du
  -- gabarit : `{{cle_longue}}` (« 9 janvier »), comme les maquettes.
  v_jetons := p_jetons;
  for k in select jsonb_object_keys(p_jetons) loop
    if (p_jetons ->> k) ~ '^\d{2}/\d{2}/\d{4}$' then
      v_jetons := v_jetons || jsonb_build_object(
        k || '_longue', notif.date_longue(to_date(p_jetons ->> k, 'DD/MM/YYYY'), g.locale));
    end if;
  end loop;

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

-- --- 2. Les textes du courriel vivent en base -------------------------------
--
-- Tout ce que le cadre écrit autour du message (étiquette, pied, frise, lien de
-- secours, signature), et les textes de l'invitation et du mot de passe, en
-- fr / en / ar. Une correction est une ligne nouvelle, datée (R7) ; le code ne
-- porte aucun texte de courriel.

create table notif.libelles_courriel (
  cle            text not null check (cle ~ '^[a-z][a-zA-Z0-9_.]*$'),
  locale         text not null check (locale in ('fr', 'en', 'ar')),
  texte          text not null check (btrim(texte) <> ''),
  effective_from date not null,
  primary key (cle, locale, effective_from)
);
alter table notif.libelles_courriel enable row level security;
revoke all on notif.libelles_courriel from public, anon, authenticated;

insert into notif.libelles_courriel (cle, locale, texte, effective_from) values
  ('cadre.raison', 'fr', 'Vous recevez ce message parce que vous tenez cet abonnement Malica Office. Vous pouvez régler vos notifications dans vos réglages.', date '2026-11-16'),
  ('cadre.raison', 'en', 'You receive this message because you hold this Malica Office subscription. You can adjust your notifications in your settings.', date '2026-11-16'),
  ('cadre.raison', 'ar', 'تتلقون هذه الرسالة لأنكم أصحاب اشتراك Malica Office هذا. يمكنكم ضبط إشعاراتكم من إعداداتكم.', date '2026-11-16'),
  ('cadre.signature', 'fr', '— Malica', date '2026-11-16'),
  ('cadre.signature', 'en', '— Malica', date '2026-11-16'),
  ('cadre.signature', 'ar', '— Malica', date '2026-11-16'),
  ('cadre.reglerAlertes', 'fr', 'Régler mes alertes', date '2026-11-16'),
  ('cadre.reglerAlertes', 'en', 'Manage my alerts', date '2026-11-16'),
  ('cadre.reglerAlertes', 'ar', 'ضبط تنبيهاتي', date '2026-11-16'),
  ('cadre.devise', 'fr', 'L’IA propose. Un moteur déterministe valide.', date '2026-11-16'),
  ('cadre.devise', 'en', 'AI proposes. A deterministic engine validates.', date '2026-11-16'),
  ('cadre.devise', 'ar', 'الذكاء الاصطناعي يقترح، ومحرّك حتمي يُصادق.', date '2026-11-16'),
  ('cadre.lienSecours', 'fr', 'Le bouton ne s''ouvre pas ? Copiez ce lien dans votre navigateur :', date '2026-11-16'),
  ('cadre.lienSecours', 'en', 'The button does not open? Copy this link into your browser:', date '2026-11-16'),
  ('cadre.lienSecours', 'ar', 'الزر لا يفتح؟ انسخوا هذا الرابط في متصفحكم:', date '2026-11-16'),
  ('cadre.repondre', 'fr', 'Répondre à ce message', date '2026-11-16'),
  ('cadre.repondre', 'en', 'Reply to this message', date '2026-11-16'),
  ('cadre.repondre', 'ar', 'الردّ على هذه الرسالة', date '2026-11-16'),
  ('cadre.bonjour', 'fr', 'Bonjour,', date '2026-11-16'),
  ('cadre.bonjour', 'en', 'Hello,', date '2026-11-16'),
  ('cadre.bonjour', 'ar', 'مرحبًا،', date '2026-11-16'),
  ('cadre.produit', 'fr', 'Malica Office', date '2026-11-16'),
  ('cadre.produit', 'en', 'Malica Office', date '2026-11-16'),
  ('cadre.produit', 'ar', 'Malica Office', date '2026-11-16'),
  ('cadre.marque', 'fr', 'MALICA OFFICE · ALGORIA FACTORY · TUNIS', date '2026-11-16'),
  ('cadre.marque', 'en', 'MALICA OFFICE · ALGORIA FACTORY · TUNIS', date '2026-11-16'),
  ('cadre.marque', 'ar', 'MALICA OFFICE · ALGORIA FACTORY · TUNIS', date '2026-11-16'),
  ('cadre.langue.fr', 'fr', 'FR', date '2026-11-16'),
  ('cadre.langue.fr', 'en', 'FR', date '2026-11-16'),
  ('cadre.langue.fr', 'ar', 'FR', date '2026-11-16'),
  ('cadre.langue.en', 'fr', 'EN', date '2026-11-16'),
  ('cadre.langue.en', 'en', 'EN', date '2026-11-16'),
  ('cadre.langue.en', 'ar', 'EN', date '2026-11-16'),
  ('cadre.langue.ar', 'fr', 'العربية', date '2026-11-16'),
  ('cadre.langue.ar', 'en', 'العربية', date '2026-11-16'),
  ('cadre.langue.ar', 'ar', 'العربية', date '2026-11-16'),
  ('cadre.signatureTexte', 'fr', '— Malica Office', date '2026-11-16'),
  ('cadre.signatureTexte', 'en', '— Malica Office', date '2026-11-16'),
  ('cadre.signatureTexte', 'ar', '— Malica Office', date '2026-11-16'),
  ('etiquette.acces', 'fr', 'Abonnement', date '2026-11-16'),
  ('etiquette.acces', 'en', 'Subscription', date '2026-11-16'),
  ('etiquette.acces', 'ar', 'الاشتراك', date '2026-11-16'),
  ('etiquette.conseil', 'fr', 'Question', date '2026-11-16'),
  ('etiquette.conseil', 'en', 'Question', date '2026-11-16'),
  ('etiquette.conseil', 'ar', 'سؤال', date '2026-11-16'),
  ('etiquette.mandat', 'fr', 'Mandat', date '2026-11-16'),
  ('etiquette.mandat', 'en', 'Mandate', date '2026-11-16'),
  ('etiquette.mandat', 'ar', 'عقد المسك', date '2026-11-16'),
  ('etiquette.piece', 'fr', 'Pièce', date '2026-11-16'),
  ('etiquette.piece', 'en', 'Document', date '2026-11-16'),
  ('etiquette.piece', 'ar', 'وثيقة', date '2026-11-16'),
  ('etiquette.place', 'fr', 'Équipe', date '2026-11-16'),
  ('etiquette.place', 'en', 'Team', date '2026-11-16'),
  ('etiquette.place', 'ar', 'الفريق', date '2026-11-16'),
  ('etiquette.impaye', 'fr', 'Facture', date '2026-11-16'),
  ('etiquette.impaye', 'en', 'Invoice', date '2026-11-16'),
  ('etiquette.impaye', 'ar', 'فاتورة', date '2026-11-16'),
  ('etiquette.invitation', 'fr', 'Invitation', date '2026-11-16'),
  ('etiquette.invitation', 'en', 'Invitation', date '2026-11-16'),
  ('etiquette.invitation', 'ar', 'دعوة', date '2026-11-16'),
  ('etiquette.securite', 'fr', 'Sécurité', date '2026-11-16'),
  ('etiquette.securite', 'en', 'Security', date '2026-11-16'),
  ('etiquette.securite', 'ar', 'الأمان', date '2026-11-16'),
  ('etiquette.autre', 'fr', 'Malica', date '2026-11-16'),
  ('etiquette.autre', 'en', 'Malica', date '2026-11-16'),
  ('etiquette.autre', 'ar', 'Malica', date '2026-11-16'),
  ('etiquette.impaye.rappel', 'fr', 'Échéance passée', date '2026-11-16'),
  ('etiquette.impaye.rappel', 'en', 'Past due', date '2026-11-16'),
  ('etiquette.impaye.rappel', 'ar', 'حلّ الأجل', date '2026-11-16'),
  ('etiquette.impaye.relance', 'fr', 'Relance', date '2026-11-16'),
  ('etiquette.impaye.relance', 'en', 'Reminder', date '2026-11-16'),
  ('etiquette.impaye.relance', 'ar', 'تذكير', date '2026-11-16'),
  ('etiquette.impaye.avis_de_suspension', 'fr', 'Avis', date '2026-11-16'),
  ('etiquette.impaye.avis_de_suspension', 'en', 'Notice', date '2026-11-16'),
  ('etiquette.impaye.avis_de_suspension', 'ar', 'إشعار', date '2026-11-16'),
  ('etiquette.impaye.suspension', 'fr', 'Suspendu', date '2026-11-16'),
  ('etiquette.impaye.suspension', 'en', 'Suspended', date '2026-11-16'),
  ('etiquette.impaye.suspension', 'ar', 'موقوف', date '2026-11-16'),
  ('raison.impaye', 'fr', 'Une facture de votre abonnement reste due.', date '2026-11-16'),
  ('raison.impaye', 'en', 'An invoice for your subscription is still due.', date '2026-11-16'),
  ('raison.impaye', 'ar', 'ما زالت فاتورة من اشتراككم مستحقة.', date '2026-11-16'),
  ('frise.resteDu', 'fr', 'reste dû', date '2026-11-16'),
  ('frise.resteDu', 'en', 'outstanding', date '2026-11-16'),
  ('frise.resteDu', 'ar', 'المتبقي', date '2026-11-16'),
  ('frise.impaye.rappel', 'fr', 'Échue', date '2026-11-16'),
  ('frise.impaye.rappel', 'en', 'Overdue', date '2026-11-16'),
  ('frise.impaye.rappel', 'ar', 'حلّ الأجل', date '2026-11-16'),
  ('frise.impaye.relance', 'fr', 'Relance', date '2026-11-16'),
  ('frise.impaye.relance', 'en', 'Reminder', date '2026-11-16'),
  ('frise.impaye.relance', 'ar', 'تذكير', date '2026-11-16'),
  ('frise.impaye.avis_de_suspension', 'fr', 'Avis', date '2026-11-16'),
  ('frise.impaye.avis_de_suspension', 'en', 'Notice', date '2026-11-16'),
  ('frise.impaye.avis_de_suspension', 'ar', 'إشعار', date '2026-11-16'),
  ('frise.impaye.suspension', 'fr', 'Suspension', date '2026-11-16'),
  ('frise.impaye.suspension', 'en', 'Suspension', date '2026-11-16'),
  ('frise.impaye.suspension', 'ar', 'إيقاف', date '2026-11-16'),
  ('invitation.dirigeant.sujet', 'fr', '{{cabinet}} vous ouvre votre espace Malica', date '2026-11-16'),
  ('invitation.dirigeant.sujet', 'en', '{{cabinet}} opens your Malica space', date '2026-11-16'),
  ('invitation.dirigeant.sujet', 'ar', '{{cabinet}} يفتح لكم فضاءكم على Malica', date '2026-11-16'),
  ('invitation.dirigeant.apercu', 'fr', 'Le dossier de {{pme}} est prêt. Lien valable jusqu''au {{date}}.', date '2026-11-16'),
  ('invitation.dirigeant.apercu', 'en', 'The file of {{pme}} is ready. Link valid until {{date}}.', date '2026-11-16'),
  ('invitation.dirigeant.apercu', 'ar', 'ملف {{pme}} جاهز. الرابط صالح حتى {{date}}.', date '2026-11-16'),
  ('invitation.dirigeant.titre', 'fr', 'Votre espace est prêt.', date '2026-11-16'),
  ('invitation.dirigeant.titre', 'en', 'Your space is ready.', date '2026-11-16'),
  ('invitation.dirigeant.titre', 'ar', 'فضاؤكم جاهز.', date '2026-11-16'),
  ('invitation.dirigeant.corps', 'fr', '{{cabinet}} a ouvert le dossier de {{pme}} et vous invite à le rejoindre.', date '2026-11-16'),
  ('invitation.dirigeant.corps', 'en', '{{cabinet}} opened the file of {{pme}} and invites you to join it.', date '2026-11-16'),
  ('invitation.dirigeant.corps', 'ar', 'فتح {{cabinet}} ملف {{pme}} ويدعوكم للانضمام إليه.', date '2026-11-16'),
  ('invitation.dirigeant.bouton', 'fr', 'Rejoindre mon espace', date '2026-11-16'),
  ('invitation.dirigeant.bouton', 'en', 'Join my space', date '2026-11-16'),
  ('invitation.dirigeant.bouton', 'ar', 'الانضمام إلى فضائي', date '2026-11-16'),
  ('invitation.comptabilite.sujet', 'fr', '{{pme}} vous invite à tenir sa comptabilité sur Malica', date '2026-11-16'),
  ('invitation.comptabilite.sujet', 'en', '{{pme}} invites you to keep its books on Malica', date '2026-11-16'),
  ('invitation.comptabilite.sujet', 'ar', 'تدعوكم {{pme}} لمسك محاسبتها على Malica', date '2026-11-16'),
  ('invitation.comptabilite.apercu', 'fr', 'Acceptez le mandat : il devient actif tout de suite.', date '2026-11-16'),
  ('invitation.comptabilite.apercu', 'en', 'Accept the mandate: it becomes active right away.', date '2026-11-16'),
  ('invitation.comptabilite.apercu', 'ar', 'اقبلوا العقد: يصبح ساريًا فورًا.', date '2026-11-16'),
  ('invitation.comptabilite.apercuSansFrais', 'fr', 'Acceptez le mandat : il devient actif tout de suite. Rien ne vous est facturé.', date '2026-11-16'),
  ('invitation.comptabilite.apercuSansFrais', 'en', 'Accept the mandate: it becomes active right away. Nothing is billed to you.', date '2026-11-16'),
  ('invitation.comptabilite.apercuSansFrais', 'ar', 'اقبلوا العقد: يصبح ساريًا فورًا. لا شيء يُفوتر عليكم.', date '2026-11-16'),
  ('invitation.comptabilite.titre', 'fr', 'Une société vous confie sa comptabilité.', date '2026-11-16'),
  ('invitation.comptabilite.titre', 'en', 'A company entrusts you with its books.', date '2026-11-16'),
  ('invitation.comptabilite.titre', 'ar', 'شركة تأتمنكم على محاسبتها.', date '2026-11-16'),
  ('invitation.comptabilite.corps', 'fr', '{{invitant}} vous invite à tenir la comptabilité de {{pme}}.', date '2026-11-16'),
  ('invitation.comptabilite.corps', 'en', '{{invitant}} invites you to keep the books of {{pme}}.', date '2026-11-16'),
  ('invitation.comptabilite.corps', 'ar', 'يدعوكم {{invitant}} لمسك محاسبة {{pme}}.', date '2026-11-16'),
  ('invitation.comptabilite.corpsSansInvitant', 'fr', '{{pme}} vous invite à tenir sa comptabilité sur Malica Office.', date '2026-11-16'),
  ('invitation.comptabilite.corpsSansInvitant', 'en', '{{pme}} invites you to keep its books on Malica Office.', date '2026-11-16'),
  ('invitation.comptabilite.corpsSansInvitant', 'ar', 'تدعوكم {{pme}} لمسك محاسبتها على Malica Office.', date '2026-11-16'),
  ('invitation.comptabilite.chargeSociete', 'fr', 'Son abonnement reste à sa charge.', date '2026-11-16'),
  ('invitation.comptabilite.chargeSociete', 'en', 'Its subscription stays at its own expense.', date '2026-11-16'),
  ('invitation.comptabilite.chargeSociete', 'ar', 'يبقى اشتراكها على نفقتها.', date '2026-11-16'),
  ('invitation.comptabilite.note', 'fr', 'Pas encore de comptabilité sur Malica ? Le lien vous la fait créer en deux minutes, puis vous acceptez — sans revenir à ce message.', date '2026-11-16'),
  ('invitation.comptabilite.note', 'en', 'No practice on Malica yet? The link lets you create it in two minutes, then you accept — without coming back to this message.', date '2026-11-16'),
  ('invitation.comptabilite.note', 'ar', 'لا مكتب محاسبة لكم على Malica بعد؟ يتيح لكم الرابط إنشاءه في دقيقتين، ثم تقبلون — دون العودة إلى هذه الرسالة.', date '2026-11-16'),
  ('invitation.dirigeant.note', 'fr', 'Lien personnel, valable jusqu''au {{date}}, une seule fois, avec l''adresse à laquelle ce message vous parvient.', date '2026-11-16'),
  ('invitation.dirigeant.note', 'en', 'Personal link, valid until {{date}}, once, with the address this message reached.', date '2026-11-16'),
  ('invitation.dirigeant.note', 'ar', 'رابط شخصي صالح حتى {{date}}، لمرة واحدة، بالعنوان الذي وصلتكم عليه هذه الرسالة.', date '2026-11-16'),
  ('invitation.comptabilite.bouton', 'fr', 'Voir l''invitation', date '2026-11-16'),
  ('invitation.comptabilite.bouton', 'en', 'See the invitation', date '2026-11-16'),
  ('invitation.comptabilite.bouton', 'ar', 'عرض الدعوة', date '2026-11-16'),
  ('invitation.cabinetInconnu', 'fr', 'Votre comptabilité', date '2026-11-16'),
  ('invitation.cabinetInconnu', 'en', 'Your accountant', date '2026-11-16'),
  ('invitation.cabinetInconnu', 'ar', 'محاسبكم', date '2026-11-16'),
  ('invitation.raison', 'fr', 'Envoyé à la demande de {{demandeur}}.', date '2026-11-16'),
  ('invitation.raison', 'en', 'Sent at the request of {{demandeur}}.', date '2026-11-16'),
  ('invitation.raison', 'ar', 'أُرسلت بطلب من {{demandeur}}.', date '2026-11-16'),
  ('reinitialisation.sujet', 'fr', 'Choisir un nouveau mot de passe — Malica Office', date '2026-11-16'),
  ('reinitialisation.sujet', 'en', 'Choose a new password — Malica Office', date '2026-11-16'),
  ('reinitialisation.sujet', 'ar', 'اختيار كلمة مرور جديدة — Malica Office', date '2026-11-16'),
  ('reinitialisation.apercu', 'fr', 'Le lien est valable une heure, une seule fois.', date '2026-11-16'),
  ('reinitialisation.apercu', 'en', 'The link is valid for one hour, once.', date '2026-11-16'),
  ('reinitialisation.apercu', 'ar', 'الرابط صالح لساعة واحدة، لمرة واحدة.', date '2026-11-16'),
  ('reinitialisation.titre', 'fr', 'Choisissez un nouveau mot de passe.', date '2026-11-16'),
  ('reinitialisation.titre', 'en', 'Choose a new password.', date '2026-11-16'),
  ('reinitialisation.titre', 'ar', 'اختاروا كلمة مرور جديدة.', date '2026-11-16'),
  ('reinitialisation.corps', 'fr', 'Une demande a été faite pour votre accès Malica Office. Le lien ci-dessous est valable une heure, une seule fois. Vos sessions ouvertes sur d''autres appareils seront fermées.', date '2026-11-16'),
  ('reinitialisation.corps', 'en', 'A request was made for your Malica Office access. The link below is valid for one hour, once. Your sessions open on other devices will be closed.', date '2026-11-16'),
  ('reinitialisation.corps', 'ar', 'قُدّم طلب لحسابكم على Malica Office. الرابط أدناه صالح لساعة واحدة، لمرة واحدة. ستُغلق جلساتكم المفتوحة على أجهزة أخرى.', date '2026-11-16'),
  ('reinitialisation.bouton', 'fr', 'Choisir un nouveau mot de passe', date '2026-11-16'),
  ('reinitialisation.bouton', 'en', 'Choose a new password', date '2026-11-16'),
  ('reinitialisation.bouton', 'ar', 'اختيار كلمة مرور جديدة', date '2026-11-16'),
  ('reinitialisation.note', 'fr', 'Vous n''êtes pas à l''origine de cette demande ? Ignorez ce message : votre mot de passe actuel reste valable.', date '2026-11-16'),
  ('reinitialisation.note', 'en', 'Did not make this request? Ignore this message: your current password stays valid.', date '2026-11-16'),
  ('reinitialisation.note', 'ar', 'لستم من قدّم هذا الطلب؟ تجاهلوا هذه الرسالة: تبقى كلمة مروركم الحالية صالحة.', date '2026-11-16'),
  ('reinitialisation.raison', 'fr', 'Une demande de nouveau mot de passe a été faite pour cette adresse.', date '2026-11-16'),
  ('reinitialisation.raison', 'en', 'A new password was requested for this address.', date '2026-11-16'),
  ('reinitialisation.raison', 'ar', 'طُلبت كلمة مرور جديدة لهذا العنوان.', date '2026-11-16'),
  ('etiquette.demandeMandat', 'fr', 'Demande de mandat', date '2026-11-16'),
  ('etiquette.demandeMandat', 'en', 'Mandate request', date '2026-11-16'),
  ('etiquette.demandeMandat', 'ar', 'طلب عقد مسك', date '2026-11-16'),
  ('donnee.dirigeant', 'fr', 'Dirigeant(e)', date '2026-11-16'),
  ('donnee.dirigeant', 'en', 'Manager', date '2026-11-16'),
  ('donnee.dirigeant', 'ar', 'المسيّر', date '2026-11-16'),
  ('donnee.offre', 'fr', 'Offre', date '2026-11-16'),
  ('donnee.offre', 'en', 'Plan', date '2026-11-16'),
  ('donnee.offre', 'ar', 'العرض', date '2026-11-16'),
  ('donnee.mandat', 'fr', 'Mandat', date '2026-11-16'),
  ('donnee.mandat', 'en', 'Mandate', date '2026-11-16'),
  ('donnee.mandat', 'ar', 'العقد', date '2026-11-16'),
  ('mandat.actifDesAccord', 'fr', 'actif dès votre accord', date '2026-11-16'),
  ('mandat.actifDesAccord', 'en', 'active as soon as you agree', date '2026-11-16'),
  ('mandat.actifDesAccord', 'ar', 'ساري فور موافقتكم', date '2026-11-16'),
  ('offre.chargeComptabilite', 'fr', 'prise en charge par la comptabilité', date '2026-11-16'),
  ('offre.chargeComptabilite', 'en', 'paid by the accountant', date '2026-11-16'),
  ('offre.chargeComptabilite', 'ar', 'على نفقة المحاسب', date '2026-11-16'),
  ('offre.chargeSociete.dirigeant', 'fr', 'à votre charge', date '2026-11-16'),
  ('offre.chargeSociete.dirigeant', 'en', 'at your expense', date '2026-11-16'),
  ('offre.chargeSociete.dirigeant', 'ar', 'على نفقتكم', date '2026-11-16'),
  ('offre.chargeSociete.comptabilite', 'fr', 'à sa charge', date '2026-11-16'),
  ('offre.chargeSociete.comptabilite', 'en', 'at its expense', date '2026-11-16'),
  ('offre.chargeSociete.comptabilite', 'ar', 'على نفقتها', date '2026-11-16'),
  ('mois.1', 'fr', 'janvier', date '2026-11-16'),
  ('mois.1', 'en', 'January', date '2026-11-16'),
  ('mois.1', 'ar', 'جانفي', date '2026-11-16'),
  ('mois.2', 'fr', 'février', date '2026-11-16'),
  ('mois.2', 'en', 'February', date '2026-11-16'),
  ('mois.2', 'ar', 'فيفري', date '2026-11-16'),
  ('mois.3', 'fr', 'mars', date '2026-11-16'),
  ('mois.3', 'en', 'March', date '2026-11-16'),
  ('mois.3', 'ar', 'مارس', date '2026-11-16'),
  ('mois.4', 'fr', 'avril', date '2026-11-16'),
  ('mois.4', 'en', 'April', date '2026-11-16'),
  ('mois.4', 'ar', 'أفريل', date '2026-11-16'),
  ('mois.5', 'fr', 'mai', date '2026-11-16'),
  ('mois.5', 'en', 'May', date '2026-11-16'),
  ('mois.5', 'ar', 'ماي', date '2026-11-16'),
  ('mois.6', 'fr', 'juin', date '2026-11-16'),
  ('mois.6', 'en', 'June', date '2026-11-16'),
  ('mois.6', 'ar', 'جوان', date '2026-11-16'),
  ('mois.7', 'fr', 'juillet', date '2026-11-16'),
  ('mois.7', 'en', 'July', date '2026-11-16'),
  ('mois.7', 'ar', 'جويلية', date '2026-11-16'),
  ('mois.8', 'fr', 'août', date '2026-11-16'),
  ('mois.8', 'en', 'August', date '2026-11-16'),
  ('mois.8', 'ar', 'أوت', date '2026-11-16'),
  ('mois.9', 'fr', 'septembre', date '2026-11-16'),
  ('mois.9', 'en', 'September', date '2026-11-16'),
  ('mois.9', 'ar', 'سبتمبر', date '2026-11-16'),
  ('mois.10', 'fr', 'octobre', date '2026-11-16'),
  ('mois.10', 'en', 'October', date '2026-11-16'),
  ('mois.10', 'ar', 'أكتوبر', date '2026-11-16'),
  ('mois.11', 'fr', 'novembre', date '2026-11-16'),
  ('mois.11', 'en', 'November', date '2026-11-16'),
  ('mois.11', 'ar', 'نوفمبر', date '2026-11-16'),
  ('mois.12', 'fr', 'décembre', date '2026-11-16'),
  ('mois.12', 'en', 'December', date '2026-11-16'),
  ('mois.12', 'ar', 'ديسمبر', date '2026-11-16'),
  ('donnee.societe', 'fr', 'Société', date '2026-11-16'),
  ('donnee.societe', 'en', 'Company', date '2026-11-16'),
  ('donnee.societe', 'ar', 'الشركة', date '2026-11-16'),
  ('donnee.comptabilite', 'fr', 'Comptabilité', date '2026-11-16'),
  ('donnee.comptabilite', 'en', 'Accountant', date '2026-11-16'),
  ('donnee.comptabilite', 'ar', 'المحاسبة', date '2026-11-16'),
  ('donnee.demandeLe', 'fr', 'Demandé le', date '2026-11-16'),
  ('donnee.demandeLe', 'en', 'Requested on', date '2026-11-16'),
  ('donnee.demandeLe', 'ar', 'طُلب في', date '2026-11-16'),
  ('donnee.valableJusqua', 'fr', 'Valable jusqu''à', date '2026-11-16'),
  ('donnee.valableJusqua', 'en', 'Valid until', date '2026-11-16'),
  ('donnee.valableJusqua', 'ar', 'صالح حتى', date '2026-11-16');


-- Les paliers de l'impayé : leur ordre, leur couleur, et le paramètre de
-- recouvrement qui fixe leur jour (R4 : le jour reste dans `ref.socle_params`).
create table notif.paliers_impaye (
  code      text primary key check (code like 'impaye.%'),
  rang      integer not null unique check (rang > 0),
  signal    text not null check (signal in ('attend', 'retard')),
  parametre text not null check (parametre like 'recouvrement.%'),
  -- E34 : à ce palier, on peut répondre plutôt que payer (« on trouve une solution »).
  repondre  boolean not null
);
alter table notif.paliers_impaye enable row level security;
revoke all on notif.paliers_impaye from public, anon, authenticated;

insert into notif.paliers_impaye (code, rang, signal, parametre, repondre) values
  ('impaye.rappel',              1, 'attend', 'recouvrement.rappel_jours',           false),
  ('impaye.relance',             2, 'attend', 'recouvrement.relance_jours',          true),
  ('impaye.avis_de_suspension',  3, 'retard', 'recouvrement.avis_suspension_jours',  false),
  ('impaye.suspension',          4, 'retard', 'recouvrement.suspension_jours',       false);

-- Un palier dont le paramètre n'existe pas ne dessinerait pas son jour : refusé ici.
do $$
begin
  if exists (select 1 from notif.paliers_impaye pa
              where not exists (select 1 from ref.socle_params sp where sp.code = pa.parametre)) then
    raise exception 'notif.paliers_impaye : paramètre de recouvrement inconnu';
  end if;
end
$$;

-- Les textes d'une langue : pour chaque clé, la version en vigueur dans la
-- langue, sinon en français.
create function notif.libelles_du_courriel(p_locale text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(x.cle, x.texte), '{}'::jsonb)
    from (select distinct on (l.cle) l.cle, l.texte
            from notif.libelles_courriel l
           where l.locale in (p_locale, 'fr')
             and l.effective_from <= current_date
           order by l.cle, (l.locale = p_locale) desc, l.effective_from desc) x
$$;
revoke all on function notif.libelles_du_courriel(text) from public, anon, authenticated;
grant execute on function notif.libelles_du_courriel(text) to malica_api, authenticated;

-- La langue d'une personne, pour un courriel qui part avant toute session
-- (le mot de passe oublié) : celle de son profil, sinon le français.
create function notif.langue_de_la_personne(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select pr.locale from identity.profiles pr where pr.user_id = p_user), 'fr')
$$;
revoke all on function notif.langue_de_la_personne(uuid) from public, anon, authenticated;
grant execute on function notif.langue_de_la_personne(uuid) to malica_api;

-- Une date en toutes lettres, sans l'année : « 9 janvier », « 9 January », « 9 جانفي ».
-- Le nom du mois vient des textes du courriel (`mois.1` à `mois.12`).
create function notif.date_longue(p_date date, p_locale text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select extract(day from p_date)::int || ' ' ||
         (notif.libelles_du_courriel(p_locale) ->> ('mois.' || extract(month from p_date)::int))
$$;
revoke all on function notif.date_longue(date, text) from public, anon, authenticated;

-- La carte d'une invitation (maquettes E06, E07) : ce que le courriel montre
-- de la société — son matricule, son offre et qui la paie — et qui invite.
-- Lue par l'API juste après l'émission, avec le jeton qu'elle vient de recevoir.
create function notif.carte_d_invitation(p_jeton text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'matricule', nullif(btrim(o.legal_id), ''),
           'offre', (select ro.libelle
                       from facturation.licence_organisations lo
                       join facturation.licences l on l.id = lo.licence_id
                       join ref.offres ro on ro.code = l.offre_code and ro.effective_from <= current_date
                      where lo.tenant_id = o.id
                      order by ro.effective_from desc
                      limit 1),
           -- La comptabilité paie si elle est un payeur courant ; sinon la société.
           'payeur', (select case when bool_or(pc.payeur_type = 'cabinet') then 'comptabilite'
                                  when bool_or(pc.payeur_type = 'titulaire') then 'societe' end
                        from facturation.licence_organisations lo
                        join facturation.payeur_courant_v pc on pc.licence_id = lo.licence_id
                       where lo.tenant_id = o.id),
           'invitant', (select nullif(btrim(pr.display_name), '')
                          from identity.profiles pr where pr.user_id = i.invited_by),
           -- La comptabilité invitée, si l'adresse en tient déjà une sur Malica.
           'comptabiliteInvitee', (select c.name
                                     from auth.users u
                                     join identity.memberships ms on ms.user_id = u.id
                                     join identity.organizations c on c.id = ms.tenant_id
                                    where lower(u.email) = lower(i.email)
                                      and c.kind = 'cabinet' and c.archived_at is null
                                    order by ms.created_at
                                    limit 1))
    from identity.invitations i
    join identity.organizations o on o.id = i.tenant_id
   where auth.uid() is not null
     and i.invited_by = auth.uid()
     and i.token_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex')
$$;
revoke all on function notif.carte_d_invitation(text) from public, anon;
grant execute on function notif.carte_d_invitation(text) to authenticated;

-- --- 3. La file rend le genre, la société, l'objet, la frise et les textes ---

drop function notif.reserver_courriels(integer, interval);

create function notif.reserver_courriels(p_limite integer, p_duree interval)
returns table (envoi_id uuid, email text, locale text, titre text, corps text,
               action_libelle text, action_route text, ton text,
               code text, organisation text, donnees jsonb, frise jsonb,
               sujet text, libelles jsonb)
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
         notif.libelles_du_courriel(g.locale)
    from pris p
    join notif.gabarits g on g.id = p.gabarit_id
    join auth.users u on u.id = p.destinataire
    left join identity.organizations o on o.id = p.tenant_id
   order by p.cree_le;
end
$$;

revoke all on function notif.reserver_courriels(integer, interval) from public, anon, authenticated;
grant execute on function notif.reserver_courriels(integer, interval) to malica_api;

commit;
