-- L'ancien fil est repris dans le moteur, puis retiré.
--
-- Suite de 20261226140000 et 20261226150000 : plus rien n'y écrit. Cette
-- migration reprend ce qu'il contenait, ligne par ligne et personne par
-- personne, puis retire ce qui ne sert plus.
--
-- ============================================================ LA REPRISE
--
-- Chaque ligne de `collab.notifications` devient une ligne `app` par personne qui
-- la lirait AUJOURD'HUI (`notif.audience`, la règle de lecture jouée par
-- candidat), à la date où elle avait été écrite. Les deux faits que l'ancien fil
-- réécrivait deviennent des faits de plus :
--
--   - « lue » : la lecture propre de la personne (`collab.notification_lectures`),
--     ou, pour un membre de la société, la lecture de la ligne — comme l'ancien
--     lecteur la lui prêtait ;
--   - « tranchée » : la décision (`payload.tranchee`), qui valait aussi lecture.
--
-- Une personne qui n'avait aucun accès aujourd'hui à la ligne ne la reçoit pas :
-- c'est la règle de lecture, et elle ne se contourne pas pour une reprise.
--
-- ============================================================ LE RETRAIT
--
-- L'ancien lecteur (`app.notifications_des_societes`), la vue
-- (`public.notifications_v`), la table et les lectures qui s'y rattachaient. Les
-- droits d'insertion du portier sur l'ancienne table partent avec elle : aucune
-- de ses portes n'y écrit plus.

begin;

-- --- 1. La reprise -----------------------------------------------------------

do $$
declare
  n        record;
  v_dest   uuid;
  v_envoi  uuid;
  v_lue    timestamptz;
  v_membre boolean;
  v_donnees jsonb;
  v_rendu  text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_du_cabinet boolean;
begin
  for n in select * from collab.notifications order by created_at, id loop
    v_donnees := n.payload - 'tranchee';
    for v_dest in select a from notif.audience(n.tenant_id, v_donnees, n.user_id) a loop
      -- Revue de #402 (Codex, P1) : l'ancien lecteur n'ouvrait une ligne à un expert que si elle
      -- était adressée à SA comptabilité (ou à personne) et écrite depuis le début de son mandat
      -- (`app.notification_du_cabinet`, 20261222130000). `notif.audience` ne reçoit ni l'adresse
      -- ni la date : la reprise les rejoue ici, sous l'identité de la personne, sans quoi le
      -- cabinet d'aujourd'hui recevrait ce qui était adressé à son prédécesseur.
      perform set_config('request.jwt.claim.sub', v_dest::text, true);
      v_membre := n.tenant_id in (select app.member_orgs());
      v_du_cabinet := v_membre or app.notification_du_cabinet(n.tenant_id, n.cabinet_id, n.created_at);
      perform set_config('request.jwt.claim.sub', v_rendu, true);
      if not v_du_cabinet then
        continue;
      end if;

      insert into notif.envois (tenant_id, destinataire, code, canal, sujet_cle, decision, donnees, cree_le)
      values (n.tenant_id, v_dest, n.kind, 'app',
              coalesce(n.payload ->> 'piece_id', n.tenant_id::text),
              'a_remettre', v_donnees, n.created_at)
      returning id into v_envoi;
      insert into notif.remises (envoi_id, resultat, tente_le) values (v_envoi, 'remis', n.created_at);

      select coalesce(
               (select l.lu_le from collab.notification_lectures l
                 where l.notification_id = n.id and l.user_id = v_dest),
               case when v_membre then n.read_at end)
        into v_lue;

      if n.payload ? 'tranchee' then
        insert into notif.suites (envoi_id, tenant_id, destinataire, nature, issue, cree_le)
        values (v_envoi, n.tenant_id, v_dest, 'tranchee', n.payload ->> 'tranchee',
                coalesce(n.read_at, n.created_at));
      elsif v_lue is not null then
        insert into notif.suites (envoi_id, tenant_id, destinataire, nature, cree_le)
        values (v_envoi, n.tenant_id, v_dest, 'lue', v_lue);
      end if;
    end loop;
  end loop;
end
$$;

-- --- 2. Le retrait -----------------------------------------------------------

drop view if exists public.notifications_v;
drop function if exists app.notifications_des_societes(uuid[]);
drop table if exists collab.notification_lectures;
drop table if exists collab.notifications;

commit;
