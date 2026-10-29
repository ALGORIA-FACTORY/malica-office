-- Le journal du jour nomme la pièce par sa version courante (29 octobre 2026).
--
-- Lot 1 (#127) : une photo reprise REMPLACE l'ancienne, et l'écriture garde la
-- pièce qu'elle nomme — un règlement saisi sur la version A s'inscrit sur A
-- même quand B l'a remplacée (`socle_ecriture_propose`, 20261029160000). Le
-- journal du jour menait alors à A, une version que le cabinet ne lit plus.
-- Il nomme désormais la version courante (`app.version_courante`) : le fait
-- de l'écriture (son `piece_id`) ne bouge pas, seul le lien affiché suit.
--
-- Corps repris de 20261029210000 ; seule la colonne `piece_id` change.
-- REJEU (R11) : `create or replace`, même signature, même type de retour.

begin;

create or replace function public.journal_du_jour_lire(p_cabinet uuid, p_client uuid, p_jour date)
returns table (
  client_tenant_id uuid,
  client_nom       text,
  ecriture_id      uuid,
  journal          text,
  journal_libelle  text,
  journal_rang     smallint,
  piece_id         uuid,
  ecriture_libelle text,
  ordinal          smallint,
  compte           text,
  compte_libelle   text,
  debit            numeric,
  credit           numeric,
  devise           text,
  origine          text,
  inscrite_le      timestamptz,
  heure            text,
  par              text,
  reverses_id      uuid,
  contre_passee_le timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mandats uuid[] := array(select app.export_mandats(p_cabinet, p_client));
  v_fuseau  text := app.fuseau_du_cabinet(p_cabinet);
  v_debut   timestamptz := p_jour::timestamp at time zone v_fuseau;
  v_fin     timestamptz := (p_jour + 1)::timestamp at time zone v_fuseau;
begin
  return query
    with candidats as (
      -- Inscrites ce jour-là (prises en charge, forcées, contre-passations)…
      select x.id from socle.ecritures x
       where x.tenant_id = any(v_mandats) and x.status = 'booked'
         and x.booked_at >= v_debut and x.booked_at < v_fin
      union
      -- … ou validées ce jour-là.
      select a.object_id from audit.event_log a
       where a.tenant_id = any(v_mandats) and a.action = 'ecriture.validee'
         and a.object_table = 'ecritures' and a.at >= v_debut and a.at < v_fin
    ),
    du_jour as (
      select e.*, p.origine as v_origine, p.prise_le as v_inscrite_le, p.par as v_par
        from candidats c
        join socle.ecritures e on e.id = c.id
        cross join lateral app.ecriture_prise_en_charge(p_cabinet, e.id) p
       where e.status = 'booked'
         and e.vis = 'partage'::app.vis_t
         and e.tenant_id = any(v_mandats)
         and p.prise_le >= v_debut and p.prise_le < v_fin
    )
    select d.tenant_id,
           o.name,
           d.id,
           d.journal,
           coalesce(j.libelle, d.journal),
           j.rang,
           app.version_courante(d.piece_id),
           d.libelle,
           l.ordinal,
           l.account_code,
           coalesce(
             (select pa.label from parametrage.accounts pa
               where pa.tenant_id = p_cabinet and pa.account_code = l.account_code),
             (select ra.label from ref.accounts ra
               where ra.pack_version_id = d.pack_version_id and ra.account_code = l.account_code),
             l.libelle),
           l.debit::numeric,
           l.credit::numeric,
           d.devise,
           d.v_origine,
           d.v_inscrite_le,
           to_char(d.v_inscrite_le at time zone v_fuseau, 'HH24:MI'),
           (select coalesce(nullif(btrim(concat_ws(' ', pr.prenom, pr.nom)), ''),
                            nullif(btrim(pr.display_name), ''),
                            u.email::text)
              from auth.users u
              left join identity.profiles pr on pr.user_id = u.id
             where u.id = d.v_par
               and exists (select 1 from identity.memberships m
                            where m.tenant_id = p_cabinet and m.user_id = u.id)),
           d.reverses_id,
           (select r.booked_at from socle.ecritures r
             where r.reverses_id = d.id and r.status = 'booked'
             order by r.booked_at limit 1)
      from du_jour d
      join socle.ecriture_lignes l on l.ecriture_id = d.id
      join identity.organizations o on o.id = d.tenant_id
      left join ref.journals j on j.code = d.journal
     order by j.rang nulls last, d.journal, d.v_inscrite_le, o.name, d.id, l.ordinal;
end $$;
revoke all on function public.journal_du_jour_lire(uuid, uuid, date) from public, anon;
grant execute on function public.journal_du_jour_lire(uuid, uuid, date) to authenticated;

commit;
