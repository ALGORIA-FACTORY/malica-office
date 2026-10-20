-- Les recharges sont cumulables et sans expiration (20 octobre 2026).
--
-- Décision : le crédit supplémentaire est cumulable et reste valable sans
-- expiration ; acheté par la PME seule, jamais en Basic (inchangé : la
-- garde `offre_sans_recharge` et le gel en Basic restent).
--
-- Tout se décide dans le référentiel daté, pas dans le code :
--   • `ref.recharges.validite_mois` NUL veut dire « sans échéance » ;
--   • les quatre paliers reçoivent une version du 20 octobre 2026, identique
--     sauf la validité ;
--   • `recharges_v` ne déclare une recharge expirée que si le palier EN
--     VIGUEUR a encore une validité : les recharges déjà achetées, dont la
--     ligne ne se réécrit pas (R7), cessent ainsi d'expirer d'elles-mêmes ;
--   • `recharge_inscrire` pose l'échéance « infinity » quand le palier n'en a pas.
--
-- REJEU (R11) : `on conflict do nothing`, `create or replace`.

begin;

alter table ref.recharges alter column validite_mois drop not null;

insert into ref.recharges (code, libelle, prix_ht, lectures, validite_mois, rang, effective_from)
select r.code, r.libelle, r.prix_ht, r.lectures, null, r.rang, date '2026-10-20'
  from ref.recharges r
 where r.effective_from = (select max(x.effective_from) from ref.recharges x where x.code = r.code)
   and r.effective_from < date '2026-10-20'
on conflict do nothing;

create or replace view facturation.recharges_v with (security_invoker = true) as
 select r.id as recharge_id,
    r.licence_id,
    r.recharge_code,
    r.lectures,
    r.prix_ht,
    r.achetee_le,
    r.expire_le,
    r.origine,
    (r.lectures - coalesce(u.n, 0::bigint))::integer as restantes,
    (not ech.expiree) and coalesce(o.recharges_permises, false) as utilisable,
    (not ech.expiree) and not coalesce(o.recharges_permises, false) as gelee,
    ech.expiree
   from facturation.recharges r
     left join lateral ( select count(*) as n
           from facturation.lectures l
          where l.recharge_id = r.id) u on true
     left join lateral ( select r.expire_le < current_date
                                and (ref.recharge_a(r.recharge_code, current_date)).validite_mois is not null
                                as expiree) ech on true
     left join facturation.forfait_courant_v h on h.licence_id = r.licence_id
     left join lateral ref.offre_a(h.offre_code, h.offre_depuis) o(id, code, libelle, prix_mensuel_ht, lectures_par_organisation, sieges_inclus, sieges_max, prix_siege_sup, lectures_par_siege_sup, organisations_incluses, organisations_max, prix_organisation_sup, effective_from, created_at, rang, recharges_permises) on true;

CREATE OR REPLACE FUNCTION facturation.recharge_inscrire(p_licence uuid, p_code text, p_origine text, p_par uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_palier ref.recharges;
  v_id     uuid;
begin
  v_palier := ref.recharge_a(p_code, current_date);
  if v_palier.code is null then
    raise exception 'recharge_refusee:palier_inconnu' using errcode = 'check_violation';
  end if;

  insert into facturation.recharges
    (licence_id, recharge_code, lectures, prix_ht, achetee_le, expire_le, origine, achetee_par)
  values
    (p_licence, v_palier.code, v_palier.lectures, v_palier.prix_ht, current_date,
     case when v_palier.validite_mois is null then 'infinity'::date
          else (current_date + make_interval(months => v_palier.validite_mois))::date end, p_origine, p_par)
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  select lo.tenant_id, p_par, 'recharge.achetee', 'facturation', 'recharges', v_id,
         jsonb_build_object('palier', v_palier.code, 'origine', p_origine,
                            'lectures', v_palier.lectures, 'prix_ht', v_palier.prix_ht)
    from facturation.licence_organisations lo
   where lo.licence_id = p_licence
   order by lo.tenant_id
   limit 1;

  return v_id;
end
$function$;

commit;
