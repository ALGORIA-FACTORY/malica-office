-- Ce qui compte dans les chiffres du mois (21 octobre 2026).
--
-- Campagne de validation du 21 octobre, ANO-005 (FP-001, FP-003, B-002,
-- B-003, TF-004). « Vos charges » additionnait toutes les pièces lues : la
-- vente, le doublon, la pièce de l'espace personnel, l'avoir. « Votre TVA »
-- comptait des pièces transmises que personne n'avait confirmées.
--
-- Une seule définition, en base, de la pièce qui compte :
--   - son type porte une écriture (`ref.document_types.porte_ecriture`) —
--     un avoir, un ticket, un bon de livraison n'entrent dans aucun total
--     tant que le référentiel ne leur donne pas d'écriture ;
--   - elle est dans la société (pas dans l'espace personnel) ;
--   - elle n'est pas le doublon d'une autre ;
--   - elle est CONFIRMÉE : proposée, confirmée, comptabilisée ou supervisée.
--     Lue mais pas confirmée, retournée, à revalider : elle attend.
-- Les charges et la TVA du mois la lisent ; aucune requête ne la redéfinit.
-- `security_invoker` : chacun n'y voit que ce que la RLS lui montre.
-- REJEU (R11) : `create or replace view`.

begin;

create or replace view public.pieces_qui_comptent_v with (security_invoker = true) as
  select p.id, p.tenant_id, p.vis, p.status, p.document_kind, p.transmise_le, p.created_at
    from capture.pieces p
    join ref.document_types t on t.code = p.document_kind
   where t.porte_ecriture
     and p.vis <> 'personnel'::app.vis_t
     and p.doublon_de is null
     and p.status in ('proposee', 'confirmee', 'comptabilisee', 'supervisee');

grant select on public.pieces_qui_comptent_v to authenticated;

comment on view public.pieces_qui_comptent_v is
  'La pièce qui entre dans les chiffres du mois (charges, TVA) : type qui porte écriture, dans la société, sans doublon, confirmée. Une seule définition (ANO-005, 21 octobre 2026).';

commit;
