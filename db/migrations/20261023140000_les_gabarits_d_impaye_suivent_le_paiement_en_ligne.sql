-- Les gabarits d'impayé suivent le paiement en ligne (23 octobre 2026).
--
-- Trois écarts relevés dans `notif.gabarits` depuis les lots A à C :
--   * « TND » écrit dans le texte de cinq gabarits : la devise est celle de
--     la facture, elle se passe en variable (`{{devise}}`), comme le montant ;
--   * la suspension n'arrête plus seulement les lectures, mais aussi l'envoi au
--     cabinet et l'export (20261023100000), et elle se lève d'elle-même quand
--     les factures en retard sont réglées en ligne (20261023130000) : les
--     phrases le disent, sans promettre la reprise au paiement d'UNE facture ;
--   * la facture du cabinet se paie depuis sa console : son gabarit est à part
--     (`facture.emise.cabinet`), l'envoyeur choisira selon le payeur ;
--   * `plafond.atteint` est une notification POUSSÉE sur le téléphone, donc
--     dans l'application Android, et elle invitait à passer à l'offre
--     suivante — un achat, que les règles de Google Play veulent hors de
--     l'application. La nouvelle version ne vend rien.
--
-- Les gabarits n'existaient qu'en français : chacun reçoit aussi sa version
-- anglaise et arabe. Rien ne se réécrit (R7) : une nouvelle version, datée, que
-- la lecture « la dernière en vigueur » choisit.
--
-- NB : aucun envoyeur ne lit encore ces gabarits — ni courriel ni notification
-- ne part aujourd'hui. Ils sont prêts pour lui.

insert into notif.gabarits
  (code, canal, locale, sujet, titre, corps, action_libelle, action_route, corps_html, effective_from)
values
  -- facture.emise
  ('facture.emise', 'email', 'fr', 'Malica Office — facture {{numero}}', 'Votre facture {{numero}}',
   'Votre abonnement {{offre}} pour {{periode}} : {{ttc}} {{devise}} TTC, à régler avant le {{echeance}}. Vous pouvez la payer en ligne depuis vos réglages.',
   'Voir et payer la facture', '/pme/reglages', '<!-- posé par le gabarit e-mail, voir design/emails/ -->', date '2026-10-23'),
  ('facture.emise', 'email', 'en', 'Malica Office — invoice {{numero}}', 'Your invoice {{numero}}',
   'Your {{offre}} subscription for {{periode}}: {{ttc}} {{devise}} incl. VAT, due by {{echeance}}. You can pay it online from your settings.',
   'View and pay the invoice', '/pme/reglages', '<!-- posé par le gabarit e-mail, voir design/emails/ -->', date '2026-10-23'),
  ('facture.emise', 'email', 'ar', 'Malica Office — الفاتورة {{numero}}', 'فاتورتكم {{numero}}',
   'اشتراككم {{offre}} عن {{periode}}: {{ttc}} {{devise}} شامل الأداء، يُدفع قبل {{echeance}}. يمكنكم دفعها عبر الإنترنت من إعداداتكم.',
   'عرض الفاتورة ودفعها', '/pme/reglages', '<!-- posé par le gabarit e-mail, voir design/emails/ -->', date '2026-10-23'),

  -- facture.emise.cabinet : la facture mensuelle du CABINET se paie depuis sa
  -- console (« Abonnements des clients »), pas depuis les réglages d'une société.
  ('facture.emise.cabinet', 'email', 'fr', 'Malica Office — facture {{numero}}', 'Votre facture du mois {{numero}}',
   'Les abonnements de vos clients pour {{periode}} : {{ttc}} {{devise}} TTC, à régler avant le {{echeance}}. Vous pouvez la payer en ligne depuis « Abonnements des clients ».',
   'Voir et payer la facture', '/cabinet/abonnements', '<!-- posé par le gabarit e-mail, voir design/emails/ -->', date '2026-10-23'),
  ('facture.emise.cabinet', 'email', 'en', 'Malica Office — invoice {{numero}}', 'Your monthly invoice {{numero}}',
   'Your clients'' subscriptions for {{periode}}: {{ttc}} {{devise}} incl. VAT, due by {{echeance}}. You can pay it online from “Client subscriptions”.',
   'View and pay the invoice', '/cabinet/abonnements', '<!-- posé par le gabarit e-mail, voir design/emails/ -->', date '2026-10-23'),
  ('facture.emise.cabinet', 'email', 'ar', 'Malica Office — الفاتورة {{numero}}', 'فاتورتكم الشهرية {{numero}}',
   'اشتراكات حرفائكم عن {{periode}}: {{ttc}} {{devise}} شامل الأداء، تُدفع قبل {{echeance}}. يمكنكم دفعها عبر الإنترنت من «اشتراكات الحرفاء».',
   'عرض الفاتورة ودفعها', '/cabinet/abonnements', '<!-- posé par le gabarit e-mail, voir design/emails/ -->', date '2026-10-23'),

  -- impaye.rappel
  ('impaye.rappel', 'email', 'fr', 'Facture {{numero}} — échéance passée', 'Votre facture {{numero}} est échue',
   'Elle arrivait à échéance le {{echeance}} — {{reste}} {{devise}} restent dus. Rien ne change pour l''instant : je continue à lire.',
   'Régler maintenant', '/pme/reglages', '<!-- design/emails/construire.py -->', date '2026-10-23'),
  ('impaye.rappel', 'email', 'en', 'Invoice {{numero}} — past due', 'Your invoice {{numero}} is past due',
   'It was due on {{echeance}} — {{reste}} {{devise}} remain outstanding. Nothing changes for now: I keep reading.',
   'Pay now', '/pme/reglages', '<!-- design/emails/construire.py -->', date '2026-10-23'),
  ('impaye.rappel', 'email', 'ar', 'الفاتورة {{numero}} — حلّ أجلها', 'حلّ أجل فاتورتكم {{numero}}',
   'كان أجلها {{echeance}} — يبقى {{reste}} {{devise}} مستحقًا. لا شيء يتغير الآن: أواصل القراءة.',
   'الدفع الآن', '/pme/reglages', '<!-- design/emails/construire.py -->', date '2026-10-23'),

  -- impaye.relance
  ('impaye.relance', 'email', 'fr', 'Relance — facture {{numero}}', '{{jours}} jours — facture {{numero}}',
   '{{reste}} {{devise}} restent dus. Si quelque chose bloque de votre côté, répondez à ce message : on trouve une solution, c''est plus simple que de laisser courir.',
   'Régler maintenant', '/pme/reglages', '<!-- design/emails/construire.py -->', date '2026-10-23'),
  ('impaye.relance', 'email', 'en', 'Reminder — invoice {{numero}}', '{{jours}} days — invoice {{numero}}',
   '{{reste}} {{devise}} remain outstanding. If something is holding you up, reply to this message: we will find a solution, it is simpler than letting it run.',
   'Pay now', '/pme/reglages', '<!-- design/emails/construire.py -->', date '2026-10-23'),
  ('impaye.relance', 'email', 'ar', 'تذكير — الفاتورة {{numero}}', '{{jours}} يومًا — الفاتورة {{numero}}',
   'يبقى {{reste}} {{devise}} مستحقًا. إن كان شيء يعيقكم، ردّوا على هذه الرسالة: سنجد حلًا، فهذا أبسط من ترك الأمر يطول.',
   'الدفع الآن', '/pme/reglages', '<!-- design/emails/construire.py -->', date '2026-10-23'),

  -- impaye.avis_de_suspension
  ('impaye.avis_de_suspension', 'email', 'fr', 'Facture {{numero}} — suspension le {{date_suspension}}', 'Je suspendrai le service le {{date_suspension}}',
   'La facture {{numero}} reste due depuis {{jours}} jours. Au {{date_suspension}}, j''arrête les lectures, l''envoi au cabinet et l''export — mais la caméra reste ouverte et vos pièces vous attendent. Rien ne sera perdu, et tout reprend dès que les factures en retard sont réglées.',
   'Régler maintenant', '/pme/reglages', '<!-- design/emails/construire.py -->', date '2026-10-23'),
  ('impaye.avis_de_suspension', 'email', 'en', 'Invoice {{numero}} — suspension on {{date_suspension}}', 'I will suspend the service on {{date_suspension}}',
   'Invoice {{numero}} has been outstanding for {{jours}} days. On {{date_suspension}}, I stop reading, sending to your accountant and exporting — but the camera stays open and your documents wait for you. Nothing will be lost, and everything resumes as soon as the overdue invoices are settled.',
   'Pay now', '/pme/reglages', '<!-- design/emails/construire.py -->', date '2026-10-23'),
  ('impaye.avis_de_suspension', 'email', 'ar', 'الفاتورة {{numero}} — إيقاف في {{date_suspension}}', 'سأوقف الخدمة في {{date_suspension}}',
   'الفاتورة {{numero}} مستحقة منذ {{jours}} يومًا. في {{date_suspension}} أوقف القراءة والإرسال إلى المحاسب والتصدير — لكن الكاميرا تبقى مفتوحة ووثائقكم في انتظاركم. لن يضيع شيء، ويعود كل شيء فور تسديد الفواتير المتأخرة.',
   'الدفع الآن', '/pme/reglages', '<!-- design/emails/construire.py -->', date '2026-10-23'),

  -- impaye.suspension
  ('impaye.suspension', 'email', 'fr', 'Service suspendu — facture {{numero}}', 'Les lectures, l''envoi et l''export sont suspendus',
   'La facture {{numero}} reste due depuis {{jours}} jours. Continuez à photographier : {{en_attente}} pièces vous attendent déjà. Dès que les factures en retard sont réglées en ligne, tout reprend de soi-même.',
   'Régler et reprendre', '/pme/reglages', '<!-- design/emails/construire.py -->', date '2026-10-23'),
  ('impaye.suspension', 'email', 'en', 'Service suspended — invoice {{numero}}', 'Reading, sending and export are suspended',
   'Invoice {{numero}} has been outstanding for {{jours}} days. Keep photographing: {{en_attente}} documents are already waiting. As soon as the overdue invoices are paid online, everything resumes on its own.',
   'Pay and resume', '/pme/reglages', '<!-- design/emails/construire.py -->', date '2026-10-23'),
  ('impaye.suspension', 'email', 'ar', 'الخدمة موقوفة — الفاتورة {{numero}}', 'القراءة والإرسال والتصدير موقوفة',
   'الفاتورة {{numero}} مستحقة منذ {{jours}} يومًا. واصلوا التصوير: {{en_attente}} وثيقة في الانتظار. فور تسديد الفواتير المتأخرة عبر الإنترنت يعود كل شيء من تلقاء نفسه.',
   'الدفع والاستئناف', '/pme/reglages', '<!-- design/emails/construire.py -->', date '2026-10-23'),

  -- plafond.atteint : poussée sur le téléphone, donc sans rien vendre.
  ('plafond.atteint', 'push', 'fr', null, 'Vos {{droit}} lectures sont prises',
   'Continuez à photographier — rien n''est perdu. Je les lirai le 1er.',
   'Voir mon forfait', '/pme/reglages', null, date '2026-10-23'),
  ('plafond.atteint', 'push', 'en', null, 'Your {{droit}} readings are used',
   'Keep photographing — nothing is lost. I will read them on the 1st.',
   'See my plan', '/pme/reglages', null, date '2026-10-23'),
  ('plafond.atteint', 'push', 'ar', null, 'استُهلكت قراءاتكم الـ{{droit}}',
   'واصلوا التصوير — لا شيء يضيع. سأقرؤها في اليوم الأول من الشهر.',
   'عرض باقتي', '/pme/reglages', null, date '2026-10-23');
