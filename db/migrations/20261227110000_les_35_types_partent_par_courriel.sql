-- Les 35 types d'événement partent par courriel, dans un gabarit commun.
--
-- ================================================================== POURQUOI
--
-- Recette du 14 novembre 2026 : presque aucun courriel n'est parti pour les
-- événements de mandat, d'accès, de place et de pièce. Le moteur écrit une
-- ligne par destinataire et par canal, mais `notif.diffusions` ne désignait,
-- pour le courriel, que les quatre paliers de relance d'impayé. Et même désignés,
-- un genre n'aurait pas pu partir sans son gabarit `email` (`notif.poster`
-- lève alors « gabarit absent », et le moteur ne le dit qu'au journal).
--
-- Ce fichier pose, pour chacun des 35 genres émis vers une personne :
--   1. une ligne `notif.diffusions` (canal `email`, gabarit de même nom) ;
--   2. trois gabarits `email` (fr, en, ar), titre et corps, dans la langue de la
--      personne — c'est le texte, donnée versionnée, jamais du code ;
--   3. un ton (`succes`, `erreur`, `alerte`, `en_cours`, `neutre`) : la couleur
--      fonctionnelle du courriel. Une donnée, pour qu'on puisse la changer sans
--      déploiement.
--
-- Hors de ce fichier, et voulu : `pv.envoye`, `facture.emise` et `ecriture.proposed`
-- ne sont pas dans les 35. Les genres de paiement et d'invitation n'ont pas de
-- producteur dans le moteur ; ils ne partent donc pas (voir le rapport de lot).
--
-- ================================================================== R11
--
-- Toutes les dates de validité sont écrites en littéral (`date '2026-11-14'`).
-- `ton` a un défaut de colonne (schéma) : il n'est jamais omis dans une insertion.
--
-- ================================================================== R7
--
-- Aucun fait n'est réécrit. Le ton des cinq gabarits de courriel déjà présents
-- (quatre relances, l'invitation) est posé une fois, ici : c'est de l'habillage,
-- pas un fait comptable.

begin;

-- --- 1. Le ton du courriel ----------------------------------------------------

alter table notif.gabarits
  add column if not exists ton text not null default 'neutre'
  constraint gabarits_ton_connu check (ton in ('neutre', 'succes', 'erreur', 'alerte', 'en_cours'));

-- Le courriel se compose du gabarit commun à partir de `titre` et `corps` : le
-- HTML n'est plus stocké par gabarit. La contrainte qui exigeait `corps_html`
-- et `sujet` ne sert donc plus ; le sujet est le titre rendu.
alter table notif.gabarits drop constraint if exists gabarits_email_a_un_sujet;

update notif.gabarits set ton = 'alerte'  where canal = 'email' and code in ('impaye.relance', 'impaye.rappel');
update notif.gabarits set ton = 'erreur'  where canal = 'email' and code in ('impaye.suspension', 'impaye.avis_de_suspension');
update notif.gabarits set ton = 'en_cours' where canal = 'email' and code = 'invitation.recue';

-- --- 2. Les gabarits des 35 types (fr, en, ar) --------------------------------
--
-- Les jetons `{{…}}` ne sont posés que lorsque le producteur les fournit :
--   cabinet, client, offre, email (acces, mandat, place) ; theme (conseil).
-- Les autres textes ne nomment aucune personne ni aucune pièce.

insert into notif.gabarits
  (code, canal, locale, titre, corps, action_libelle, action_route, ton, effective_from)
values
  -- acces.* ------------------------------------------------------------------
  ('acces.propose', 'email', 'fr', 'Une prise en charge de votre abonnement est proposée', '{{cabinet}} propose de prendre en charge votre abonnement {{offre}}. Vous répondez depuis Malica : accepter ou refuser.', 'Ouvrir dans Malica', '/pme/notifications', 'alerte', date '2026-11-14'),
  ('acces.propose', 'email', 'en', 'A subscription take-over is proposed', '{{cabinet}} proposes to take over your {{offre}} subscription. Accept or decline in Malica.', 'Open in Malica', '/pme/notifications', 'alerte', date '2026-11-14'),
  ('acces.propose', 'email', 'ar', 'يقترح تكفّل بمحاسبة اشتراككم', 'يقترح {{cabinet}} أن يتكفّل باشتراككم ({{offre}}). أجيبوا من Malica: قبول أو رفض.', 'فتح في Malica', '/pme/notifications', 'alerte', date '2026-11-14'),
  ('acces.accepte', 'email', 'fr', '{{client}} a accepté la prise en charge', 'L''abonnement {{offre}} est désormais pris en charge par votre cabinet. Il figure dans votre liste de clients.', 'Ouvrir dans Malica', '/cabinet/notifications', 'succes', date '2026-11-14'),
  ('acces.accepte', 'email', 'en', '{{client}} accepted the take-over', 'The {{offre}} subscription is now carried by your firm. It appears in your client list.', 'Open in Malica', '/cabinet/notifications', 'succes', date '2026-11-14'),
  ('acces.accepte', 'email', 'ar', 'قبِل {{client}} التكفّل', 'أصبح اشتراك {{offre}} متكفّلاً به من محاسبتكم، وهو مدرج في قائمة عملائكم.', 'فتح في Malica', '/cabinet/notifications', 'succes', date '2026-11-14'),
  ('acces.refuse', 'email', 'fr', '{{client}} a refusé la prise en charge', 'La proposition de prise en charge de l''abonnement {{offre}} a été refusée. Il reste à la charge du client.', 'Ouvrir dans Malica', '/cabinet/notifications', 'erreur', date '2026-11-14'),
  ('acces.refuse', 'email', 'en', '{{client}} declined the take-over', 'The proposal to take over the {{offre}} subscription was declined. It stays with the client.', 'Open in Malica', '/cabinet/notifications', 'erreur', date '2026-11-14'),
  ('acces.refuse', 'email', 'ar', 'رفض {{client}} التكفّل', 'رُفض اقتراح التكفّل باشتراك {{offre}}. يبقى الاشتراك على عاتق العميل.', 'فتح في Malica', '/cabinet/notifications', 'erreur', date '2026-11-14'),
  ('acces.monte', 'email', 'fr', 'Votre abonnement a été monté d''offre', 'Votre abonnement passe à l''offre {{offre}}, décidé par {{cabinet}}. Le détail figure dans votre espace.', 'Ouvrir dans Malica', '/pme/notifications', 'en_cours', date '2026-11-14'),
  ('acces.monte', 'email', 'en', 'Your subscription was moved up', 'Your subscription moved up to {{offre}}, decided by {{cabinet}}. Details are in your space.', 'Open in Malica', '/pme/notifications', 'en_cours', date '2026-11-14'),
  ('acces.monte', 'email', 'ar', 'رُفع اشتراككم إلى عرض أعلى', 'صار اشتراككم على العرض {{offre}} بقرار من {{cabinet}}. التفاصيل في فضائكم.', 'فتح في Malica', '/pme/notifications', 'en_cours', date '2026-11-14'),
  ('acces.arrete', 'email', 'fr', 'La prise en charge de votre abonnement prend fin', '{{cabinet}} arrête la prise en charge de votre abonnement {{offre}}. Il repasse à votre charge.', 'Ouvrir dans Malica', '/pme/notifications', 'alerte', date '2026-11-14'),
  ('acces.arrete', 'email', 'en', 'The take-over of your subscription ends', '{{cabinet}} has ended the take-over of your {{offre}} subscription. It is back in your charge.', 'Open in Malica', '/pme/notifications', 'alerte', date '2026-11-14'),
  ('acces.arrete', 'email', 'ar', 'انتهى التكفّل باشتراككم', 'أوقف {{cabinet}} التكفّل باشتراككم ({{offre}}). يعود الاشتراك على عاتقكم.', 'فتح في Malica', '/pme/notifications', 'alerte', date '2026-11-14'),
  ('acces.repris', 'email', 'fr', 'Votre abonnement repasse à votre charge', '{{cabinet}} ne prend plus en charge votre abonnement {{offre}}. Vous le réglez désormais directement.', 'Ouvrir dans Malica', '/pme/notifications', 'en_cours', date '2026-11-14'),
  ('acces.repris', 'email', 'en', 'Your subscription is back in your charge', '{{cabinet}} no longer carries your {{offre}} subscription. You now pay it directly.', 'Open in Malica', '/pme/notifications', 'en_cours', date '2026-11-14'),
  ('acces.repris', 'email', 'ar', 'عاد اشتراككم على عاتقكم', 'لم يعد {{cabinet}} يتكفّل باشتراككم ({{offre}}). تسدّدونه مباشرة منذ الآن.', 'فتح في Malica', '/pme/notifications', 'en_cours', date '2026-11-14'),
  ('acces.descente_demandee', 'email', 'fr', 'Une descente d''offre est proposée', '{{cabinet}} propose de faire passer votre abonnement à l''offre {{offre}}. Elle ne prend effet qu''après votre accord.', 'Ouvrir dans Malica', '/pme/notifications', 'alerte', date '2026-11-14'),
  ('acces.descente_demandee', 'email', 'en', 'A plan downgrade is proposed', '{{cabinet}} proposes moving your subscription to {{offre}}. It takes effect only once you agree.', 'Open in Malica', '/pme/notifications', 'alerte', date '2026-11-14'),
  ('acces.descente_demandee', 'email', 'ar', 'اقتُرح خفض العرض', 'يقترح {{cabinet}} نقل اشتراككم إلى العرض {{offre}}. لا يسري الخفض إلا بموافقتكم.', 'فتح في Malica', '/pme/notifications', 'alerte', date '2026-11-14'),
  ('acces.descente_acceptee', 'email', 'fr', '{{client}} a accepté la descente de son abonnement', 'L''abonnement passe à l''offre {{offre}}, comme proposé.', 'Ouvrir dans Malica', '/cabinet/notifications', 'succes', date '2026-11-14'),
  ('acces.descente_acceptee', 'email', 'en', '{{client}} accepted the downgrade', 'The subscription moved to {{offre}}, as proposed.', 'Open in Malica', '/cabinet/notifications', 'succes', date '2026-11-14'),
  ('acces.descente_acceptee', 'email', 'ar', 'قبِل {{client}} خفض اشتراكه', 'انتقل الاشتراك إلى العرض {{offre}} كما اقتُرح.', 'فتح في Malica', '/cabinet/notifications', 'succes', date '2026-11-14'),
  ('acces.descente_refusee', 'email', 'fr', '{{client}} a refusé la descente de son abonnement', 'L''abonnement reste à son offre actuelle.', 'Ouvrir dans Malica', '/cabinet/notifications', 'erreur', date '2026-11-14'),
  ('acces.descente_refusee', 'email', 'en', '{{client}} declined the downgrade', 'The subscription stays on its current plan.', 'Open in Malica', '/cabinet/notifications', 'erreur', date '2026-11-14'),
  ('acces.descente_refusee', 'email', 'ar', 'رفض {{client}} خفض اشتراكه', 'بقي الاشتراك على عرضه الحالي.', 'فتح في Malica', '/cabinet/notifications', 'erreur', date '2026-11-14'),
  -- mandat.* -----------------------------------------------------------------
  ('mandat.propose', 'email', 'fr', 'Un mandat de comptabilité vous est proposé', '{{cabinet}} propose de tenir votre comptabilité. Acceptez ou refusez le mandat depuis Malica.', 'Ouvrir dans Malica', '/', 'alerte', date '2026-11-14'),
  ('mandat.propose', 'email', 'en', 'An accounting mandate is proposed', '{{cabinet}} proposes to keep your accounts. Accept or decline the mandate in Malica.', 'Open in Malica', '/', 'alerte', date '2026-11-14'),
  ('mandat.propose', 'email', 'ar', 'اقتُرح عقد مسك المحاسبة', 'يقترح {{cabinet}} مسك محاسبتكم. اقبلوا العقد أو ارفضوه من Malica.', 'فتح في Malica', '/', 'alerte', date '2026-11-14'),
  ('mandat.accepte', 'email', 'fr', 'Le mandat a été accepté', 'Le mandat de comptabilité entre {{client}} et {{cabinet}} est accepté. Le dossier est désormais tenu par ce cabinet.', 'Ouvrir dans Malica', '/', 'succes', date '2026-11-14'),
  ('mandat.accepte', 'email', 'en', 'The mandate was accepted', 'The accounting mandate between {{client}} and {{cabinet}} is accepted. The file is now kept by this firm.', 'Open in Malica', '/', 'succes', date '2026-11-14'),
  ('mandat.accepte', 'email', 'ar', 'قُبل عقد المسك', 'قُبل عقد مسك المحاسبة بين {{client}} و{{cabinet}}. صار الملف في عهدة هذه المحاسبة.', 'فتح في Malica', '/', 'succes', date '2026-11-14'),
  ('mandat.refuse', 'email', 'fr', 'Le mandat a été refusé', 'La proposition de mandat entre {{client}} et {{cabinet}} a été refusée.', 'Ouvrir dans Malica', '/', 'erreur', date '2026-11-14'),
  ('mandat.refuse', 'email', 'en', 'The mandate was declined', 'The mandate proposal between {{client}} and {{cabinet}} was declined.', 'Open in Malica', '/', 'erreur', date '2026-11-14'),
  ('mandat.refuse', 'email', 'ar', 'رُفض عقد المسك', 'رُفض اقتراح العقد بين {{client}} و{{cabinet}}.', 'فتح في Malica', '/', 'erreur', date '2026-11-14'),
  ('mandat.revoque', 'email', 'fr', 'Le mandat de comptabilité a pris fin', 'Le mandat entre {{client}} et {{cabinet}} a pris fin.', 'Ouvrir dans Malica', '/', 'erreur', date '2026-11-14'),
  ('mandat.revoque', 'email', 'en', 'The accounting mandate has ended', 'The mandate between {{client}} and {{cabinet}} has ended.', 'Open in Malica', '/', 'erreur', date '2026-11-14'),
  ('mandat.revoque', 'email', 'ar', 'انتهى عقد المسك', 'انتهى العقد بين {{client}} و{{cabinet}}.', 'فتح في Malica', '/', 'erreur', date '2026-11-14'),
  ('mandat.succede', 'email', 'fr', 'Le dossier a changé de comptabilité', 'La comptabilité du dossier est confiée à une autre comptabilité. Le mandat précédent prend fin.', 'Ouvrir dans Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('mandat.succede', 'email', 'en', 'The file changed accounting firm', 'The accounts of this file were entrusted to another firm. The previous mandate ends.', 'Open in Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('mandat.succede', 'email', 'ar', 'تغيّرت محاسبة الملف', 'أُسندت محاسبة الملف إلى محاسبة أخرى، وينتهي العقد السابق.', 'فتح في Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('mandat.lettre_au_confrere', 'email', 'fr', 'Une lettre de mission est disponible', 'Une lettre concernant un dossier est disponible dans Malica.', 'Ouvrir dans Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('mandat.lettre_au_confrere', 'email', 'en', 'A mission letter is available', 'A letter concerning a file is available in Malica.', 'Open in Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('mandat.lettre_au_confrere', 'email', 'ar', 'رسالة مهمة متاحة', 'رسالة متعلقة بملف متاحة في Malica.', 'فتح في Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  -- place.* ------------------------------------------------------------------
  ('place.donnee', 'email', 'fr', 'Une place a été ouverte dans votre équipe', '{{cabinet}} a ouvert une place pour {{email}} dans votre équipe Malica. Cette personne peut rejoindre l''espace.', 'Ouvrir dans Malica', '/pme/notifications', 'en_cours', date '2026-11-14'),
  ('place.donnee', 'email', 'en', 'A seat was opened in your team', '{{cabinet}} opened a seat for {{email}} in your Malica team. The person can join the space.', 'Open in Malica', '/pme/notifications', 'en_cours', date '2026-11-14'),
  ('place.donnee', 'email', 'ar', 'فُتح مكان في فريقكم', 'فتح {{cabinet}} مكاناً لـ{{email}} في فريقكم على Malica. يمكنه الانضمام إلى الفضاء.', 'فتح في Malica', '/pme/notifications', 'en_cours', date '2026-11-14'),
  ('place.suggeree', 'email', 'fr', '{{cabinet}} suggère d''inviter quelqu''un', 'Une invitation pour {{email}} est suggérée. Vous décidez de son envoi depuis Malica.', 'Ouvrir dans Malica', '/pme/notifications', 'alerte', date '2026-11-14'),
  ('place.suggeree', 'email', 'en', '{{cabinet}} suggests inviting someone', 'An invitation for {{email}} is suggested. You decide whether to send it from Malica.', 'Open in Malica', '/pme/notifications', 'alerte', date '2026-11-14'),
  ('place.suggeree', 'email', 'ar', 'يقترح {{cabinet}} دعوة شخص', 'اقتُرحت دعوة {{email}}. أنتم تقررون إرسالها من Malica.', 'فتح في Malica', '/pme/notifications', 'alerte', date '2026-11-14'),
  -- piece.* ------------------------------------------------------------------
  ('piece.a_valider', 'email', 'fr', 'Des pièces attendent votre validation', 'Des pièces ont été déposées dans votre dossier et attendent votre validation dans Malica.', 'Ouvrir dans Malica', '/pme/notifications', 'alerte', date '2026-11-14'),
  ('piece.a_valider', 'email', 'en', 'Documents await your approval', 'Documents were filed in your file and await your approval in Malica.', 'Open in Malica', '/pme/notifications', 'alerte', date '2026-11-14'),
  ('piece.a_valider', 'email', 'ar', 'مستندات تنتظر تأكيدكم', 'أُودعت مستندات في ملفكم وتنتظر تأكيدكم في Malica.', 'فتح في Malica', '/pme/notifications', 'alerte', date '2026-11-14'),
  ('piece.demande', 'email', 'fr', 'Une demande concerne une pièce', 'Un client demande le retour ou l''effacement d''une pièce transmise. Répondez-y dans Malica.', 'Ouvrir dans Malica', '/cabinet/notifications', 'alerte', date '2026-11-14'),
  ('piece.demande', 'email', 'en', 'A request concerns a document', 'A client asks for the return or deletion of a document sent. Reply in Malica.', 'Open in Malica', '/cabinet/notifications', 'alerte', date '2026-11-14'),
  ('piece.demande', 'email', 'ar', 'طلب بشأن مستند', 'يطلب عميل إعادة مستند أو حذفه. أجيبوا عليه في Malica.', 'فتح في Malica', '/cabinet/notifications', 'alerte', date '2026-11-14'),
  ('piece.demande_tranchee', 'email', 'fr', 'Votre demande sur une pièce a reçu une réponse', 'Votre comptabilité a répondu à votre demande sur une pièce. Le détail est dans Malica.', 'Ouvrir dans Malica', '/pme/notifications', 'neutre', date '2026-11-14'),
  ('piece.demande_tranchee', 'email', 'en', 'Your request on a document has an answer', 'Your accounting firm answered your request on a document. Details are in Malica.', 'Open in Malica', '/pme/notifications', 'neutre', date '2026-11-14'),
  ('piece.demande_tranchee', 'email', 'ar', 'ردّت المحاسبة على طلبكم', 'ردّت محاسبتكم على طلبكم بشأن مستند. التفاصيل في Malica.', 'فتح في Malica', '/pme/notifications', 'neutre', date '2026-11-14'),
  ('piece.retournee', 'email', 'fr', 'Une pièce vous a été retournée', 'Votre comptabilité a retourné une pièce pour complément. Ouvrez-la dans Malica pour voir ce qui manque.', 'Ouvrir dans Malica', '/pme/notifications', 'erreur', date '2026-11-14'),
  ('piece.retournee', 'email', 'en', 'A document was returned to you', 'Your accounting firm returned a document for completion. Open it in Malica to see what is missing.', 'Open in Malica', '/pme/notifications', 'erreur', date '2026-11-14'),
  ('piece.retournee', 'email', 'ar', 'أُعيد إليكم مستند', 'أعادت محاسبتكم مستنداً لاستكمال ما. افتحوه في Malica لمعرفة الناقص.', 'فتح في Malica', '/pme/notifications', 'erreur', date '2026-11-14'),
  ('piece.retournee_par_le_proprietaire', 'email', 'fr', 'Une pièce a été retournée', 'Le propriétaire du dossier a retourné une pièce. Le détail est dans Malica.', 'Ouvrir dans Malica', '/', 'erreur', date '2026-11-14'),
  ('piece.retournee_par_le_proprietaire', 'email', 'en', 'A document was returned', 'The owner of the file returned a document. Details are in Malica.', 'Open in Malica', '/', 'erreur', date '2026-11-14'),
  ('piece.retournee_par_le_proprietaire', 'email', 'ar', 'أُعيد مستند', 'أعاد مالك الملف مستنداً. التفاصيل في Malica.', 'فتح في Malica', '/', 'erreur', date '2026-11-14'),
  ('piece.supprimee_par_le_proprietaire', 'email', 'fr', 'Une pièce a été retirée', 'Le propriétaire du dossier a retiré une de vos pièces. Le détail est dans Malica.', 'Ouvrir dans Malica', '/', 'erreur', date '2026-11-14'),
  ('piece.supprimee_par_le_proprietaire', 'email', 'en', 'A document was removed', 'The owner of the file removed one of your documents. Details are in Malica.', 'Open in Malica', '/', 'erreur', date '2026-11-14'),
  ('piece.supprimee_par_le_proprietaire', 'email', 'ar', 'أُزيل مستند', 'أزال مالك الملف أحد مستنداتكم. التفاصيل في Malica.', 'فتح في Malica', '/', 'erreur', date '2026-11-14'),
  ('piece.recue_du_siege', 'email', 'fr', 'Une pièce a été reçue', 'Une pièce a été reçue du siège. Elle est disponible dans Malica.', 'Ouvrir dans Malica', '/pme/notifications', 'en_cours', date '2026-11-14'),
  ('piece.recue_du_siege', 'email', 'en', 'A document was received', 'A document was received from head office. It is available in Malica.', 'Open in Malica', '/pme/notifications', 'en_cours', date '2026-11-14'),
  ('piece.recue_du_siege', 'email', 'ar', 'وصل مستند', 'وصل مستند من المقر. وهو متاح في Malica.', 'فتح في Malica', '/pme/notifications', 'en_cours', date '2026-11-14'),
  ('piece.partagee', 'email', 'fr', 'Une pièce a été partagée avec la comptabilité', 'Le client a partagé une pièce avec votre cabinet. Elle est prête à être traitée dans Malica.', 'Ouvrir dans Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('piece.partagee', 'email', 'en', 'A document was shared with the accounting firm', 'The client shared a document with your firm. It is ready to process in Malica.', 'Open in Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('piece.partagee', 'email', 'ar', 'شورك مستند مع المحاسبة', 'شارك العميل مستنداً مع محاسبتكم. صار جاهزاً للمعالجة في Malica.', 'فتح في Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('piece.gardee', 'email', 'fr', 'Une pièce retournée a été gardée', 'Le client a gardé une pièce retournée dans sa société.', 'Ouvrir dans Malica', '/cabinet/notifications', 'neutre', date '2026-11-14'),
  ('piece.gardee', 'email', 'en', 'A returned document was kept', 'The client kept a returned document in the company.', 'Open in Malica', '/cabinet/notifications', 'neutre', date '2026-11-14'),
  ('piece.gardee', 'email', 'ar', 'احتُفظ بمستند أُعيد', 'احتفظ العميل بمستند أُعيد إليه داخل شركته.', 'فتح في Malica', '/cabinet/notifications', 'neutre', date '2026-11-14'),
  ('piece.supprimee', 'email', 'fr', 'Une pièce retournée a été supprimée', 'Le client a supprimé une pièce retournée.', 'Ouvrir dans Malica', '/cabinet/notifications', 'erreur', date '2026-11-14'),
  ('piece.supprimee', 'email', 'en', 'A returned document was deleted', 'The client deleted a returned document.', 'Open in Malica', '/cabinet/notifications', 'erreur', date '2026-11-14'),
  ('piece.supprimee', 'email', 'ar', 'حُذف مستند أُعيد', 'حذف العميل مستنداً أُعيد إليه.', 'فتح في Malica', '/cabinet/notifications', 'erreur', date '2026-11-14'),
  ('piece.archivee', 'email', 'fr', 'Une pièce a été retirée des documents', 'Le client a retiré une pièce de ses documents. Elle reste consultable dans Malica.', 'Ouvrir dans Malica', '/cabinet/notifications', 'neutre', date '2026-11-14'),
  ('piece.archivee', 'email', 'en', 'A document was removed from the records', 'The client removed a document from their records. It remains viewable in Malica.', 'Open in Malica', '/cabinet/notifications', 'neutre', date '2026-11-14'),
  ('piece.archivee', 'email', 'ar', 'أُزيل مستند من الوثائق', 'أزال العميل مستنداً من وثائقه. يبقى متاحاً للاطلاع في Malica.', 'فتح في Malica', '/cabinet/notifications', 'neutre', date '2026-11-14'),
  ('piece.remplacee', 'email', 'fr', 'Une nouvelle photo a été envoyée', 'Le client a remplacé la photo d''une pièce. La nouvelle version est dans Malica.', 'Ouvrir dans Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('piece.remplacee', 'email', 'en', 'A new photo was sent', 'The client replaced the photo of a document. The new version is in Malica.', 'Open in Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('piece.remplacee', 'email', 'ar', 'أُرسلت صورة جديدة', 'استبدل العميل صورة مستند. النسخة الجديدة متاحة في Malica.', 'فتح في Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('piece.renvoyee', 'email', 'fr', 'Une pièce retournée a été renvoyée', 'Le client a renvoyé une pièce que vous aviez retournée. Elle est à traiter dans Malica.', 'Ouvrir dans Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('piece.renvoyee', 'email', 'en', 'A returned document was sent back', 'The client sent back a document you had returned. It is to be processed in Malica.', 'Open in Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('piece.renvoyee', 'email', 'ar', 'أُعيد إرسال مستند', 'أعاد العميل إرسال مستند كنتم أعدتموه. يُعالَج في Malica.', 'فتح في Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('piece.reponse_client', 'email', 'fr', 'Le client a répondu sur une pièce', 'Le client a répondu à votre demande sur une pièce. Le texte est dans Malica.', 'Ouvrir dans Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('piece.reponse_client', 'email', 'en', 'The client replied on a document', 'The client replied to your request on a document. The text is in Malica.', 'Open in Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('piece.reponse_client', 'email', 'ar', 'ردّ العميل على مستند', 'ردّ العميل على طلبكم بشأن مستند. النص في Malica.', 'فتح في Malica', '/cabinet/notifications', 'en_cours', date '2026-11-14'),
  ('piece.validee', 'email', 'fr', 'Une pièce a été prise en charge', 'Votre comptabilité a pris en charge une pièce de votre dossier. Elle est traitée dans Malica.', 'Ouvrir dans Malica', '/pme/notifications', 'succes', date '2026-11-14'),
  ('piece.validee', 'email', 'en', 'A document was taken over by the firm', 'The accounting firm took over a document of your file. It is being processed in Malica.', 'Open in Malica', '/pme/notifications', 'succes', date '2026-11-14'),
  ('piece.validee', 'email', 'ar', 'أُخذ مستند في عهدة المحاسبة', 'أخذت محاسبتكم مستنداً من ملفكم في عهدتها. يُعالَج في Malica.', 'فتح في Malica', '/pme/notifications', 'succes', date '2026-11-14'),
  -- conseil.* ----------------------------------------------------------------
  ('conseil.arbitrage', 'email', 'fr', 'Une réponse attend un arbitrage', 'Une réponse de Malica sur {{theme}} attend la relecture de votre comptable.', 'Ouvrir dans Malica', '/', 'alerte', date '2026-11-14'),
  ('conseil.arbitrage', 'email', 'en', 'An answer awaits arbitration', 'An answer from Malica on {{theme}} awaits review by your accountant.', 'Open in Malica', '/', 'alerte', date '2026-11-14'),
  ('conseil.arbitrage', 'email', 'ar', 'رد ينتظر التحكيم', 'رد Malica بشأن {{theme}} ينتظر مراجعة محاسبتكم.', 'فتح في Malica', '/', 'alerte', date '2026-11-14'),
  ('conseil.repondu', 'email', 'fr', 'Malica a répondu à votre question', 'Une réponse sur {{theme}} est disponible dans Malica. Votre comptable est en copie.', 'Ouvrir dans Malica', '/', 'en_cours', date '2026-11-14'),
  ('conseil.repondu', 'email', 'en', 'Malica answered your question', 'An answer on {{theme}} is available in Malica. Your accountant is copied.', 'Open in Malica', '/', 'en_cours', date '2026-11-14'),
  ('conseil.repondu', 'email', 'ar', 'ردّ Malica على سؤالكم', 'الرد بشأن {{theme}} متاح في Malica. محاسبتكم على علم به.', 'فتح في Malica', '/', 'en_cours', date '2026-11-14'),
  ('conseil.decide', 'email', 'fr', 'Votre comptable a répondu à votre question', 'La décision sur {{theme}} est prise. La réponse est dans Malica.', 'Ouvrir dans Malica', '/', 'succes', date '2026-11-14'),
  ('conseil.decide', 'email', 'en', 'Your accountant answered your question', 'A decision on {{theme}} has been made. The answer is in Malica.', 'Open in Malica', '/', 'succes', date '2026-11-14'),
  ('conseil.decide', 'email', 'ar', 'ردّت محاسبتكم على سؤالكم', 'تم القرار بشأن {{theme}}. الرد متاح في Malica.', 'فتح في Malica', '/', 'succes', date '2026-11-14');

-- --- 3. Les diffusions : chacun des 35 genres part par courriel -----------------

insert into notif.diffusions (code, canal, gabarit, valid_from) values
  ('acces.propose', 'email', 'acces.propose', date '2026-11-14'),
  ('acces.accepte', 'email', 'acces.accepte', date '2026-11-14'),
  ('acces.refuse', 'email', 'acces.refuse', date '2026-11-14'),
  ('acces.monte', 'email', 'acces.monte', date '2026-11-14'),
  ('acces.arrete', 'email', 'acces.arrete', date '2026-11-14'),
  ('acces.repris', 'email', 'acces.repris', date '2026-11-14'),
  ('acces.descente_demandee', 'email', 'acces.descente_demandee', date '2026-11-14'),
  ('acces.descente_acceptee', 'email', 'acces.descente_acceptee', date '2026-11-14'),
  ('acces.descente_refusee', 'email', 'acces.descente_refusee', date '2026-11-14'),
  ('mandat.propose', 'email', 'mandat.propose', date '2026-11-14'),
  ('mandat.accepte', 'email', 'mandat.accepte', date '2026-11-14'),
  ('mandat.refuse', 'email', 'mandat.refuse', date '2026-11-14'),
  ('mandat.revoque', 'email', 'mandat.revoque', date '2026-11-14'),
  ('mandat.succede', 'email', 'mandat.succede', date '2026-11-14'),
  ('mandat.lettre_au_confrere', 'email', 'mandat.lettre_au_confrere', date '2026-11-14'),
  ('place.donnee', 'email', 'place.donnee', date '2026-11-14'),
  ('place.suggeree', 'email', 'place.suggeree', date '2026-11-14'),
  ('piece.a_valider', 'email', 'piece.a_valider', date '2026-11-14'),
  ('piece.demande', 'email', 'piece.demande', date '2026-11-14'),
  ('piece.demande_tranchee', 'email', 'piece.demande_tranchee', date '2026-11-14'),
  ('piece.retournee', 'email', 'piece.retournee', date '2026-11-14'),
  ('piece.retournee_par_le_proprietaire', 'email', 'piece.retournee_par_le_proprietaire', date '2026-11-14'),
  ('piece.supprimee_par_le_proprietaire', 'email', 'piece.supprimee_par_le_proprietaire', date '2026-11-14'),
  ('piece.recue_du_siege', 'email', 'piece.recue_du_siege', date '2026-11-14'),
  ('piece.partagee', 'email', 'piece.partagee', date '2026-11-14'),
  ('piece.gardee', 'email', 'piece.gardee', date '2026-11-14'),
  ('piece.supprimee', 'email', 'piece.supprimee', date '2026-11-14'),
  ('piece.archivee', 'email', 'piece.archivee', date '2026-11-14'),
  ('piece.remplacee', 'email', 'piece.remplacee', date '2026-11-14'),
  ('piece.renvoyee', 'email', 'piece.renvoyee', date '2026-11-14'),
  ('piece.reponse_client', 'email', 'piece.reponse_client', date '2026-11-14'),
  ('piece.validee', 'email', 'piece.validee', date '2026-11-14'),
  ('conseil.arbitrage', 'email', 'conseil.arbitrage', date '2026-11-14'),
  ('conseil.repondu', 'email', 'conseil.repondu', date '2026-11-14'),
  ('conseil.decide', 'email', 'conseil.decide', date '2026-11-14');

-- --- 4. La file des courriels rend le ton -----------------------------------
--
-- La même file qu'avant (ordre, verrou `skip locked`, relances fermées par la
-- tour), plus le ton. Le type de retour change : il faut la reposer.

drop function if exists notif.courriels_a_remettre(integer);

create function notif.courriels_a_remettre(p_limite integer)
returns table (envoi_id uuid, email text, locale text, titre text, corps text,
               action_libelle text, action_route text, ton text)
language sql
volatile
security definer
set search_path = ''
as $$
  -- Le sujet du courriel est le titre rendu par `notif.poster` (ses jetons
  -- remplacés). Le ton vient du gabarit : le courriel commun s'en colore.
  --
  -- Les lignes rendues sont VERROUILLÉES jusqu'à la fin de la transaction de
  -- l'appelant, qui envoie et inscrit dans la même transaction : deux API
  -- qui tournent ne remettent jamais le même courriel (`skip locked`).
  --
  -- Les relances fermées par la tour ne partent plus, même décidées avant.
  with reglage as (select plateforme.relances_reglage() as r),
  dus as (
    select e.id
      from notif.envois_v e, reglage
     where e.canal = 'email'
       and e.etat in ('a_remettre', 'a_reessayer')
       and (e.code not like 'impaye.%' or (reglage.r ->> 'actives')::boolean)
       and e.tentatives < coalesce((reglage.r ->> 'tentatives_max')::int, 0)
  ),
  pris as (
    select n.id, n.destinataire, n.gabarit_id, n.titre_rendu, n.corps_rendu, n.cree_le
      from notif.envois n
     where n.id in (select id from dus)
     order by n.cree_le
     limit p_limite
       for update of n skip locked
  )
  select p.id, u.email::text, g.locale, p.titre_rendu, p.corps_rendu,
         g.action_libelle, g.action_route, g.ton
    from pris p
    join notif.gabarits g on g.id = p.gabarit_id
    join auth.users u on u.id = p.destinataire
   order by p.cree_le
$$;

revoke all on function notif.courriels_a_remettre(integer) from public, anon, authenticated;
grant execute on function notif.courriels_a_remettre(integer) to malica_api;

commit;
