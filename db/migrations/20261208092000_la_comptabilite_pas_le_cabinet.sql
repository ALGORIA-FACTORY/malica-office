-- La comptabilité, pas le cabinet (8 novembre 2026).
--
-- ================================================================ LA DÉCISION
--
-- Du dirigeant, le 8 novembre 2026 : « pas de cabinet c'est la comptabilité ».
-- Dans tout texte montré à quelqu'un — l'application de la PME comme la
-- console de la comptabilité —, la partie qui tient les livres ne s'appelle
-- plus « cabinet » : elle est « la comptabilité » (« votre comptabilité »).
-- En anglais « the accountant », en arabe « المحاسبة » / « محاسبكم ».
--
-- Les dictionnaires de l'écran (`packages/socle/src/messages-*.ts`) changent
-- dans le même lot. Restent ici les textes que la BASE porte et montre :
--
--   * les libellés de `ref.labels` qui nommaient le cabinet (fr, en, ar) ;
--   * le refus d'un avoir reconnu par son titre (`ref.titres_de_piece`) ;
--   * trois gabarits de notification (`notif.gabarits`) en français.
--
-- Rien ne change de CODE : les clés (`detachement_cabinet`,
-- `derogation_cabinet`, `refus_saisie_cabinet`…) restent ce qu'elles sont.
-- Ne change pas non plus ce qui nomme un AUTRE cabinet : celui d'un
-- commissaire aux comptes, ou le « cabinet / logiciel émetteur » d'une
-- facture — ce n'est pas la comptabilité du dossier.
--
-- ==================================================================== REJEU
--
-- R11 : aucune date du jour, aucun aléa. Les libellés se corrigent par
-- `replace` sur leur clé, si bien qu'un rejeu ne change rien. Les gabarits
-- ne se réécrivent pas (R7) : une version nouvelle, datée en littéral, que la
-- lecture « la dernière en vigueur » choisit. Un contrôle final échoue si un
-- texte visé dit encore « cabinet ».

begin;

-- --- 1. Les libellés du référentiel --------------------------------------------------------------

update ref.labels set value = replace(value, 'Détachement du cabinet', 'Détachement par la comptabilité')
 where ns = 'licence_motif_suspension' and key = 'detachement_cabinet' and locale = 'fr';
update ref.labels set value = replace(value, 'Firm detached the client', 'Accountant detached the client')
 where ns = 'licence_motif_suspension' and key = 'detachement_cabinet' and locale = 'en';
update ref.labels set value = replace(value, 'فصل المكتب للملف', 'فصل المحاسبة للملف')
 where ns = 'licence_motif_suspension' and key = 'detachement_cabinet' and locale = 'ar';

update ref.labels set value = replace(value, 'Dérogation du cabinet', 'Dérogation de la comptabilité')
 where ns = 'origine_du_cours' and key = 'derogation_cabinet' and locale = 'fr';
update ref.labels set value = replace(value, 'Firm override', 'Accountant override')
 where ns = 'origine_du_cours' and key = 'derogation_cabinet' and locale = 'en';
update ref.labels set value = replace(value, 'استثناء من المكتب', 'استثناء من المحاسبة')
 where ns = 'origine_du_cours' and key = 'derogation_cabinet' and locale = 'ar';

update ref.labels set value = replace(value, 'Saisi par le cabinet', 'Saisi par la comptabilité')
 where ns = 'origine_du_cours' and key = 'saisie' and locale = 'fr';
update ref.labels set value = replace(value, 'Entered by the firm', 'Entered by the accountant')
 where ns = 'origine_du_cours' and key = 'saisie' and locale = 'en';
update ref.labels set value = replace(value, 'أدخله المكتب', 'أدخلته المحاسبة')
 where ns = 'origine_du_cours' and key = 'saisie' and locale = 'ar';

update ref.labels set value = replace(value, 'saisi à la main par le cabinet', 'saisi à la main par la comptabilité')
 where ns = 'reglage_comptable_option' and key = 'avoirs.traitement:refus_saisie_cabinet' and locale = 'fr';
update ref.labels set value = replace(value, 'entered by hand by the firm', 'entered by hand by the accountant')
 where ns = 'reglage_comptable_option' and key = 'avoirs.traitement:refus_saisie_cabinet' and locale = 'en';
update ref.labels set value = replace(value, 'ويُدخله المكتب يدويا', 'وتُدخله المحاسبة يدويا')
 where ns = 'reglage_comptable_option' and key = 'avoirs.traitement:refus_saisie_cabinet' and locale = 'ar';

update ref.labels set value = replace(value, 'Durée choisie par le cabinet', 'Durée choisie par la comptabilité')
 where ns = 'reglage_comptable_option' and key = 'conservation.duree:duree_cabinet' and locale = 'fr';
update ref.labels set value = replace(value, 'Period chosen by the firm', 'Period chosen by the accountant')
 where ns = 'reglage_comptable_option' and key = 'conservation.duree:duree_cabinet' and locale = 'en';
update ref.labels set value = replace(value, 'مدة يختارها المكتب', 'مدة تختارها المحاسبة')
 where ns = 'reglage_comptable_option' and key = 'conservation.duree:duree_cabinet' and locale = 'ar';

update ref.labels set value = replace(value, 'Un compte unique choisi par le cabinet', 'Un compte unique choisi par la comptabilité')
 where ns = 'reglage_comptable_option' and key = 'ventes.compte:unique_cabinet' and locale = 'fr';
update ref.labels set value = replace(value, 'A single account chosen by the firm', 'A single account chosen by the accountant')
 where ns = 'reglage_comptable_option' and key = 'ventes.compte:unique_cabinet' and locale = 'en';
update ref.labels set value = replace(value, 'حساب واحد يختاره المكتب', 'حساب واحد تختاره المحاسبة')
 where ns = 'reglage_comptable_option' and key = 'ventes.compte:unique_cabinet' and locale = 'ar';

update ref.labels set value = replace(value, 'le cabinet classe le tiers', 'la comptabilité classe le tiers')
 where ns = 'reglage_sujet_incertain' and key = 'timbre' and locale = 'fr';
update ref.labels set value = replace(value, 'the firm classifies the third party', 'the accountant classifies the third party')
 where ns = 'reglage_sujet_incertain' and key = 'timbre' and locale = 'en';
update ref.labels set value = replace(value, 'يصنّفه المكتب', 'تصنّفه المحاسبة')
 where ns = 'reglage_sujet_incertain' and key = 'timbre' and locale = 'ar';

update ref.labels set value = replace(value, 'sous-compte du cabinet', 'sous-compte de la comptabilité')
 where ns = 'reglage_sujet_pratique' and key = 'comptes_immo' and locale = 'fr';
update ref.labels set value = replace(value, 'a firm sub-account', 'an accountant''s sub-account')
 where ns = 'reglage_sujet_pratique' and key = 'comptes_immo' and locale = 'en';
update ref.labels set value = replace(value, 'حساب فرعي للمكتب', 'حساب فرعي للمحاسبة')
 where ns = 'reglage_sujet_pratique' and key = 'comptes_immo' and locale = 'ar';

-- « Beaucoup de cabinets » parle de la pratique de la profession : des comptables.
update ref.labels set value = replace(value, 'beaucoup de cabinets passent', 'beaucoup de comptables passent')
 where ns = 'reglage_sujet_pratique' and key = 'immobilisation' and locale = 'fr';
update ref.labels set value = replace(value, 'many firms expense', 'many accountants expense')
 where ns = 'reglage_sujet_pratique' and key = 'immobilisation' and locale = 'en';

update ref.labels set value = replace(value, 'le client ou le cabinet l''a corrigée', 'le client ou la comptabilité l''a corrigée')
 where ns = 'reglage_sujet_pratique' and key = 'lecture' and locale = 'fr';
update ref.labels set value = replace(value, 'the client or the firm has corrected', 'the client or the accountant has corrected')
 where ns = 'reglage_sujet_pratique' and key = 'lecture' and locale = 'en';
update ref.labels set value = replace(value, 'الحريف أو المكتب', 'الحريف أو المحاسبة')
 where ns = 'reglage_sujet_pratique' and key = 'lecture' and locale = 'ar';

update ref.labels set value = replace(value, 'Écriture forcée par le cabinet', 'Écriture forcée par la comptabilité')
 where ns = 'rejet_motif' and key = 'ecriture_forcee' and locale = 'fr';

-- --- 2. Le refus d'un avoir reconnu par son titre ------------------------------------------------

update ref.titres_de_piece set refus = replace(refus, 'à saisir par le cabinet', 'à saisir par la comptabilité')
 where refus like '%à saisir par le cabinet%';

-- --- 3. Les gabarits de notification : une version nouvelle ---------------------------------------

insert into notif.gabarits
  (code, canal, locale, sujet, titre, corps, action_libelle, action_route, corps_html, effective_from)
select g.code, g.canal, g.locale, g.sujet, g.titre,
       replace(replace(g.corps, 'l''envoi au cabinet', 'l''envoi à votre comptabilité'),
               'prêtes à partir au cabinet', 'prêtes à partir à votre comptabilité'),
       g.action_libelle, g.action_route, g.corps_html, date '2026-11-08'
  from notif.gabarits g
 where g.locale = 'fr'
   and g.code in ('impaye.avis_de_suspension', 'piece.a_valider')
   and g.corps like '%cabinet%'
   and g.effective_from = (select max(h.effective_from) from notif.gabarits h
                            where h.code = g.code and h.canal = g.canal and h.locale = g.locale)
on conflict (code, canal, locale, effective_from) do nothing;

-- --- 4. Rien de ce qui est visé ne dit encore « cabinet » ----------------------------------------

do $$
declare
  reste text;
begin
  select string_agg(ns || '.' || key || ' (' || locale || ')', ', ') into reste
    from ref.labels
   where (ns, key) in (('licence_motif_suspension', 'detachement_cabinet'),
                       ('origine_du_cours', 'derogation_cabinet'),
                       ('origine_du_cours', 'saisie'),
                       ('reglage_comptable_option', 'avoirs.traitement:refus_saisie_cabinet'),
                       ('reglage_comptable_option', 'conservation.duree:duree_cabinet'),
                       ('reglage_comptable_option', 'ventes.compte:unique_cabinet'),
                       ('reglage_sujet_incertain', 'timbre'),
                       ('reglage_sujet_pratique', 'comptes_immo'),
                       ('reglage_sujet_pratique', 'immobilisation'),
                       ('reglage_sujet_pratique', 'lecture'),
                       ('rejet_motif', 'ecriture_forcee'))
     and (value ~* 'cabinet|\mfirms?\M' or value ~ 'المكتب|مكتب ');
  if reste is not null then
    raise exception 'la comptabilité, pas le cabinet : libellés restés en l''état : %', reste;
  end if;

  if exists (select 1 from ref.titres_de_piece where refus like '%cabinet%') then
    raise exception 'la comptabilité, pas le cabinet : un refus de ref.titres_de_piece dit encore « cabinet »';
  end if;

  if exists (select 1 from notif.gabarits g
              where g.locale = 'fr' and g.corps like '%cabinet%'
                and g.effective_from = (select max(h.effective_from) from notif.gabarits h
                                         where h.code = g.code and h.canal = g.canal and h.locale = g.locale)) then
    raise exception 'la comptabilité, pas le cabinet : un gabarit en vigueur dit encore « cabinet »';
  end if;
end $$;

commit;
