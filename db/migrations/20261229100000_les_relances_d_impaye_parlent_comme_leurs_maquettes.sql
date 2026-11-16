-- ======================================================================
--  Les relances d'impayé parlent comme leurs maquettes (E33 à E36,
--  13 novembre 2026, adoptées le 16 novembre).
--
--  Le titre dit ce qui s'est passé en une phrase ; le montant et la frise des
--  paliers vivent dans la carte que dessine le courriel (`frise`), plus dans le
--  texte. L'objet garde la référence de la facture. La devise reste un jeton
--  (R4), jamais un code écrit.
--
--  R7 : rien n'est réécrit — une nouvelle version de chaque gabarit, datée.
--  R11 : la date de validité est un littéral ; le ton est écrit, jamais omis.
-- ======================================================================

begin;

insert into notif.gabarits
  (code, canal, locale, sujet, titre, corps, action_libelle, action_route, corps_html, ton, effective_from)
values
  -- E33 · impaye.rappel
  ('impaye.rappel', 'email', 'fr', 'Facture {{numero}} — échéance passée', 'Votre facture est échue.',
   'Elle arrivait à échéance le {{echeance}}. Rien ne change pour l''instant : je continue à lire.',
   'Régler maintenant', '/pme/reglages', null, 'alerte', date '2026-11-16'),
  ('impaye.rappel', 'email', 'en', 'Invoice {{numero}} — past due', 'Your invoice is past due.',
   'It was due on {{echeance}}. Nothing changes for now: I keep reading.',
   'Pay now', '/pme/reglages', null, 'alerte', date '2026-11-16'),
  ('impaye.rappel', 'email', 'ar', 'الفاتورة {{numero}} — حلّ أجلها', 'حلّ أجل فاتورتكم.',
   'كان أجلها {{echeance}}. لا شيء يتغير الآن: أواصل القراءة.',
   'الدفع الآن', '/pme/reglages', null, 'alerte', date '2026-11-16'),

  -- E34 · impaye.relance
  ('impaye.relance', 'email', 'fr', 'Relance — facture {{numero}}', '{{jours}} jours — {{reste}} {{devise}} restent dus.',
   'Si quelque chose bloque de votre côté, répondez à ce message : on trouve une solution, c''est plus simple que de laisser courir.',
   'Régler maintenant', '/pme/reglages', null, 'alerte', date '2026-11-16'),
  ('impaye.relance', 'email', 'en', 'Reminder — invoice {{numero}}', '{{jours}} days — {{reste}} {{devise}} outstanding.',
   'If something is holding you up, reply to this message: we will find a solution, it is simpler than letting it run.',
   'Pay now', '/pme/reglages', null, 'alerte', date '2026-11-16'),
  ('impaye.relance', 'email', 'ar', 'تذكير — الفاتورة {{numero}}', '{{jours}} يومًا — يبقى {{reste}} {{devise}} مستحقًا.',
   'إن كان شيء يعيقكم، ردّوا على هذه الرسالة: سنجد حلًا، فهذا أبسط من ترك الأمر يطول.',
   'الدفع الآن', '/pme/reglages', null, 'alerte', date '2026-11-16'),

  -- E35 · impaye.avis_de_suspension
  ('impaye.avis_de_suspension', 'email', 'fr', 'Suspension le {{date_suspension}} — facture {{numero}}',
   'Je suspendrai le service le {{date_suspension}}.',
   'Au {{date_suspension}}, j''arrête les lectures, l''envoi à la comptabilité et l''export. La caméra reste ouverte et vos pièces vous attendent : rien ne sera perdu.',
   'Régler maintenant', '/pme/reglages', null, 'erreur', date '2026-11-16'),
  ('impaye.avis_de_suspension', 'email', 'en', 'Suspension on {{date_suspension}} — invoice {{numero}}',
   'I will suspend the service on {{date_suspension}}.',
   'On {{date_suspension}}, I stop reading, sending to your accountant and exporting. The camera stays open and your documents wait for you: nothing will be lost.',
   'Pay now', '/pme/reglages', null, 'erreur', date '2026-11-16'),
  ('impaye.avis_de_suspension', 'email', 'ar', 'إيقاف في {{date_suspension}} — الفاتورة {{numero}}',
   'سأوقف الخدمة في {{date_suspension}}.',
   'في {{date_suspension}} أوقف القراءة والإرسال إلى المحاسب والتصدير. تبقى الكاميرا مفتوحة ووثائقكم في انتظاركم: لن يضيع شيء.',
   'الدفع الآن', '/pme/reglages', null, 'erreur', date '2026-11-16'),

  -- E36 · impaye.suspension
  ('impaye.suspension', 'email', 'fr', 'Lectures, envoi et export suspendus', 'Le service est suspendu.',
   'Continuez à photographier : {{en_attente}} pièces vous attendent déjà. Dès que les factures en retard sont réglées, tout reprend de soi-même.',
   'Régler et reprendre', '/pme/reglages', null, 'erreur', date '2026-11-16'),
  ('impaye.suspension', 'email', 'en', 'Reading, sending and export suspended', 'The service is suspended.',
   'Keep photographing: {{en_attente}} documents are already waiting. As soon as the overdue invoices are paid, everything resumes on its own.',
   'Pay and resume', '/pme/reglages', null, 'erreur', date '2026-11-16'),
  ('impaye.suspension', 'email', 'ar', 'القراءة والإرسال والتصدير موقوفة', 'الخدمة موقوفة.',
   'واصلوا التصوير: {{en_attente}} وثيقة في الانتظار. فور تسديد الفواتير المتأخرة يعود كل شيء من تلقاء نفسه.',
   'الدفع والاستئناف', '/pme/reglages', null, 'erreur', date '2026-11-16');

commit;
