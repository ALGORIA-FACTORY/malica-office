-- L'impayé arrête aussi la pièce déposée « transmise » (21 octobre 2026).
--
-- Campagne de validation :
--   ANO-022 — la règle du 20 octobre (« défaut de paiement : la transmission
--     au cabinet s'arrête ») était tenue par `capture_piece_set_vis` seulement.
--     Une pièce ENREGISTRÉE directement en `partage` passait. La garde se pose
--     donc sur la table : toute pièce qui naît transmise y passe.
-- REJEU (R11) : `create or replace`, `drop trigger if exists`.

begin;

create or replace function app.une_piece_transmise_exige_une_licence_active()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.vis = 'partage'::app.vis_t
     and coalesce((select c.statut from facturation.licence_organisations lo
                     join facturation.consommation_v c on c.licence_id = lo.licence_id
                    where lo.tenant_id = new.tenant_id), 'active') <> 'active'
  then
    raise exception 'Transmission suspendue : un paiement de votre abonnement est en retard. Réglez-le pour transmettre de nouveau.'
      using errcode = 'check_violation', hint = 'licence.impayee';
  end if;
  return new;
end $function$;

drop trigger if exists une_piece_transmise_exige_une_licence_active on capture.pieces;
create trigger une_piece_transmise_exige_une_licence_active
  before insert on capture.pieces
  for each row execute function app.une_piece_transmise_exige_une_licence_active();

commit;
