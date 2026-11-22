-- L'échéance qui approche se dit une fois, et par jour.
--
-- ================================================================== POURQUOI
--
-- Tour du pilote, 22 novembre 2026 : quatre déclarations en retard, et l'écran
-- des alertes vide. Le gabarit `echeance.approche` existe depuis le 19 octobre
-- (20261019130000), mais rien ne l'émet.
--
-- Deux décisions du même jour :
--
--   « Une seule alerte quelques jours avant, sans rappel de retard. »
--   « L'échéance doit être groupée par jour — je ne veux pas la composition. »
--
-- Donc : UNE alerte par société et par JOUR d'échéance, qui dit la date et le
-- nombre de déclarations de ce jour, jamais leur liste. Et une seule fois : une
-- échéance déjà annoncée ne se répète pas, même si l'ordonnanceur repasse.
--
-- ================================================================== CE QUI SE FAIT
--
--   1. `notif.preavis` : combien de jours avant. Une donnée versionnée par date
--      d'effet, comme les gabarits — jamais un nombre écrit dans le code.
--   2. Les gabarits `app` fr/en/ar du code `echeance.approche`.
--   3. `notif.echeances_qui_approchent()` : pour chaque société et chaque jour
--      d'échéance encore à venir dans le préavis, une alerte, si elle n'a pas
--      déjà été dite. Appelée toutes les heures par l'API.
--
-- L'alerte ne part qu'à la société : la comptabilité engagée a son propre
-- calendrier, et `chez = proprietaire` la tient hors de l'audience.
-- Pas de push ici : le gabarit push d'octobre parle de pièces non lues, pas
-- d'une échéance groupée ; aucune diffusion n'est ouverte pour ce code.

begin;

-- --- 1. Le préavis ----------------------------------------------------------

create table notif.preavis (
  code       text not null,
  jours      smallint not null check (jours between 1 and 30),
  valid_from date not null,
  valid_to   date,
  primary key (code, valid_from),
  check (valid_to is null or valid_to > valid_from)
);
alter table notif.preavis enable row level security;
revoke all on notif.preavis from public, anon, authenticated;

insert into notif.preavis (code, jours, valid_from)
values ('echeance.approche', 3, date '2026-11-01');

-- --- 2. Les gabarits de l'application ---------------------------------------

insert into notif.gabarits
  (code, canal, locale, titre, corps, action_libelle, action_route, ton, effective_from)
values
  ('echeance.approche', 'app', 'fr',
   'Échéance le {{date}}',
   'Déclarations à déposer le {{date}} : {{nombre}}.',
   'Voir mes échéances', '/pme/echeances', 'alerte', date '2026-11-01'),
  ('echeance.approche', 'app', 'en',
   'Deadline on {{date}}',
   'Filings due on {{date}}: {{nombre}}.',
   'See my deadlines', '/pme/echeances', 'alerte', date '2026-11-01'),
  ('echeance.approche', 'app', 'ar',
   'أجل يوم {{date}}',
   'عدد التصاريح المطلوب إيداعها يوم {{date}}: {{nombre}}.',
   'عرض الآجال', '/pme/echeances', 'alerte', date '2026-11-01');

-- --- 3. L'émission ----------------------------------------------------------
--
-- Le jour est celui du DOSSIER (`public.jour_du_dossier` : le fuseau de sa
-- comptabilité, à défaut le sien) — une société de Dakar et une de Tunis n'ont
-- pas le même lendemain, et l'heure du serveur ne compte pas (R4). Un dossier
-- dont le fuseau n'est pas défini est passé : il ne fait pas taire les autres.

create or replace function notif.echeances_qui_approchent()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_jours  smallint;
  v_tenant uuid;
  v_jour   date;
  r        record;
  v_cle    text;
  v_dites  integer := 0;
  v_dest   integer := 0;
  v_passes integer := 0;
begin
  -- Deux API qui passent la même heure : la seconde attend, puis voit ce que
  -- la première a dit.
  perform pg_advisory_xact_lock(hashtext('notif.echeances_qui_approchent'));

  select p.jours into v_jours
    from notif.preavis p
   where p.code = 'echeance.approche'
     and p.valid_from <= current_date and (p.valid_to is null or p.valid_to > current_date)
   order by p.valid_from desc
   limit 1;
  if v_jours is null then
    return jsonb_build_object('preavis', null, 'dites', 0, 'destinataires', 0, 'passes', 0);
  end if;

  -- Un premier tri large (un jour de part et d'autre, pour les fuseaux), puis
  -- le jour exact de chaque dossier.
  for v_tenant in
    select distinct e.tenant_id
      from schedule.echeances e
      join identity.organizations o on o.id = e.tenant_id and o.archived_at is null
     where e.status = 'a_venir'
       and e.due_date between current_date - 1 and current_date + v_jours + 1
  loop
    begin
      v_jour := public.jour_du_dossier(v_tenant);
    exception when invalid_parameter_value then
      v_passes := v_passes + 1;
      continue;
    end;

    for r in
      select e.due_date, count(*)::int as nombre
        from schedule.echeances e
       where e.tenant_id = v_tenant
         and e.status = 'a_venir'
         and e.due_date between v_jour and v_jour + v_jours
       group by e.due_date
       order by e.due_date
    loop
      v_cle := 'echeance:' || v_tenant || ':' || r.due_date;
      continue when exists (
        select 1 from notif.envois n
         where n.tenant_id = v_tenant
           and n.code = 'echeance.approche'
           and n.sujet_cle = v_cle);
      v_dest := v_dest + notif.emettre(
        v_tenant, 'echeance.approche',
        jsonb_build_object(
          'date', to_char(r.due_date, 'DD/MM/YYYY'),
          'due_date', r.due_date::text,
          'nombre', r.nombre,
          'chez', 'proprietaire'),
        null, v_cle, (v_jours + 1) * interval '1 day');
      v_dites := v_dites + 1;
    end loop;
  end loop;

  return jsonb_build_object('preavis', v_jours, 'dites', v_dites,
                            'destinataires', v_dest, 'passes', v_passes);
end
$$;
revoke all on function notif.echeances_qui_approchent() from public, anon, authenticated;
grant execute on function notif.echeances_qui_approchent() to malica_api;

commit;
