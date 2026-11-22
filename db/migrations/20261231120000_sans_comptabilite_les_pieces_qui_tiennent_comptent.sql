-- Sans comptabilité, les pièces qui tiennent comptent — en estimation.
--
-- ================================================================== POURQUOI
--
-- Pilote, 22 novembre 2026 : une société SANS comptabilité (ni mandat, ni comptable
-- interne) ne voit jamais ses charges ni sa TVA du mois. Ses pièces restent « lues » :
-- personne ne leur propose d'écriture, et `pieces_qui_comptent_v` n'admettait que les
-- pièces proposées, comptabilisées ou supervisées (ANO-005, 21 octobre 2026 : « la TVA
-- comptait des pièces que personne n'avait confirmées »).
--
-- Décision du dirigeant, 22 novembre 2026 : pour une société sans comptabilité, une pièce
-- lue dont le jugement FERME (`capture.analyses`, état « tranche » : ses montants tiennent,
-- prouvés) compte aux charges et à la TVA, marquée ESTIMATION (`estimation`) tant
-- qu'aucun comptable ne l'a reprise. Dès qu'une comptabilité tient les livres, la règle
-- d'ANO-005 revient : seule la pièce confirmée compte.
--
-- Repris de 20261104130000 ; une colonne EN FIN (`estimation`), et un cas de plus.
--
-- _Gardé par_ apps/api/src/le-crayon-corrige-les-totaux.test.ts,
-- « sans comptabilité, une pièce qui tient compte aux charges, en estimation ».

begin;

create or replace view public.pieces_qui_comptent_v with (security_invoker = true) as
  select p.id, p.tenant_id, p.vis, p.status, p.document_kind, p.transmise_le, p.created_at,
         case when pe.lisible then 'cabinet' else 'lecture' end as source,
         p.status = 'lue' as estimation
    from capture.pieces p
    join ref.document_types t on t.code = p.document_kind
    left join app.pieces_prises_en_charge() pe on pe.piece_id = p.id
   where t.porte_ecriture
     and p.vis <> 'personnel'::app.vis_t
     and p.doublon_de is null
     and (p.status in ('proposee', 'comptabilisee', 'supervisee')
          or (p.status = 'lue'
              and not app.livres_tenus_par_le_cabinet(p.tenant_id)
              and (select a.normalisation ->> 'etat' from capture.analyses a
                    where a.piece_id = p.id order by a.created_at desc limit 1) = 'tranche'))
     -- Une version précédente n'entre dans aucune déclaration : c'est la
     -- photo qui l'a remplacée qui compte.
     and not exists (select 1 from capture.remplacements r where r.piece_id = p.id);

comment on view public.pieces_qui_comptent_v is
  'La pièce qui entre dans les chiffres du mois (charges, TVA) : type qui porte écriture, dans la société, sans doublon, confirmée ou prise en charge — ou, sans comptabilité, lue et dont le jugement ferme (`estimation`). `source` : « cabinet » (forcée, son écriture se lit comme une facture) ou « lecture ».';

commit;

-- ================================================================== RETOUR
--
-- Rejouer la vue de 20261104130000_seules_les_portes_ecrivent.sql (`drop view` d'abord : une
-- colonne se retire), puis :
-- delete from app.migrations where nom = '20261231120000_sans_comptabilite_les_pieces_qui_tiennent_comptent.sql';
