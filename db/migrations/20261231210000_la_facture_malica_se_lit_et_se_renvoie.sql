-- La facture de Malica Office se lit, s'imprime et se renvoie.
--
-- Suite de 20261231200000 (la série MO-TN-I11). La facture PDF reproduit le modèle du
-- dirigeant : l'émetteur (« DE »), le client (« À »), les lignes, les totaux, le montant en
-- toutes lettres, l'objet, les conditions de paiement et les coordonnées bancaires. Le PDF se
-- dessine dans le navigateur (canevas → PDF, comme le reçu) ; la base ne rend que des valeurs.
--
-- Ce que cette migration ajoute :
--   1. `ref.devises_ecrites` : le nom d'une devise et de sa subdivision pour écrire un montant
--      en toutes lettres (« dinars », « millimes »), par langue — singulier, pluriel, et pour
--      l'arabe le duel et l'accusatif du nom compté. Aucun nom de devise n'est écrit dans le
--      code (R4) ; le lecteur de lettres garde son lexique (`ref.devises_en_lettres`).
--   2. `facturation.entete_de_facture` : ce que la facture imprime au-delà de ses propres
--      lignes — l'émetteur en vigueur au jour de l'émission, l'adresse, le RNE, le site, les
--      conditions de paiement et la banque du réglage EN VIGUEUR (le client paie toujours sur
--      le compte du jour), les noms de la devise. Lisible par qui lit la facture : l'opérateur,
--      le titulaire, le payeur — et nul autre (même prédicat que `facturation_factures_sel`).
--      La facture et ses lignes, elles, se lisent sous la RLS de l'appelant (dépôt).
--   3. `plateforme.factures_regler` : la tour règle la série et ce que la facture imprime.
--      Daté (aujourd'hui ou plus tard), motivé, en ajout seul, réservé à l'opérateur.
--   4. `plateforme.facture_renvoyer` : la tour renvoie le courriel d'une facture de PME déjà
--      émise. Une fois par facture dans la fenêtre du moteur (24 heures) : un second clic ne
--      double ni l'avis dans l'application, ni le courriel.
--
-- _Gardé par_ apps/api/src/facturation/la-facture-malica-a-sa-serie.test.ts.

begin;

-- --------------------------------------------------------------- 1. Les noms des devises
create table ref.devises_ecrites (
  id         uuid primary key default gen_random_uuid(),
  devise     text not null references ref.devises (code),
  langue     text not null check (langue in ('fr', 'en', 'ar')),
  unite      text not null check (unite in ('majeure', 'mineure')),
  singulier  text not null check (length(btrim(singulier)) > 0),
  pluriel    text not null check (length(btrim(pluriel)) > 0),
  -- L'arabe compte autrement : deux (المثنى), et de onze à quatre-vingt-dix-neuf (تمييز منصوب).
  duel       text,
  accusatif  text,
  valid_from date not null,
  valid_to   date,
  constraint devises_ecrites_cle unique (devise, langue, unite, valid_from),
  check (valid_to is null or valid_to >= valid_from),
  check (langue <> 'ar' or (duel is not null and accusatif is not null))
);

comment on table ref.devises_ecrites is
  'Les noms d''une devise et de sa subdivision, pour ÉCRIRE un montant en toutes lettres '
  '(facture). Par langue ; l''arabe porte aussi le duel et l''accusatif du nom compté.';

alter table ref.devises_ecrites enable row level security;
alter table ref.devises_ecrites force row level security;
create policy ref_devises_ecrites_sel on ref.devises_ecrites
  for select to authenticated using (true);
revoke all on ref.devises_ecrites from public, anon;
grant select on ref.devises_ecrites to authenticated;

insert into ref.devises_ecrites
  (devise, langue, unite, singulier, pluriel, duel, accusatif, valid_from)
values
  ('TND', 'fr', 'majeure', 'dinar',   'dinars',   null, null, date '2026-01-01'),
  ('TND', 'fr', 'mineure', 'millime', 'millimes', null, null, date '2026-01-01'),
  ('TND', 'en', 'majeure', 'dinar',   'dinars',   null, null, date '2026-01-01'),
  ('TND', 'en', 'mineure', 'millime', 'millimes', null, null, date '2026-01-01'),
  ('TND', 'ar', 'majeure', 'دينار', 'دنانير', 'ديناران', 'دينارا', date '2026-01-01'),
  ('TND', 'ar', 'mineure', 'مليم', 'مليمات', 'مليمان', 'مليما', date '2026-01-01'),
  ('EUR', 'fr', 'majeure', 'euro',    'euros',    null, null, date '2026-01-01'),
  ('EUR', 'fr', 'mineure', 'centime', 'centimes', null, null, date '2026-01-01'),
  ('EUR', 'en', 'majeure', 'euro',    'euros',    null, null, date '2026-01-01'),
  ('EUR', 'en', 'mineure', 'cent',    'cents',    null, null, date '2026-01-01');

-- --------------------------------------------------------------- 2. L'en-tête imprimé
create function facturation.entete_de_facture(p_facture uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f          record;
  e          record;
  r          plateforme.reglages_factures;
  v_exposant smallint;
  v_lettres  jsonb;
begin
  -- Qui lit la facture lit son en-tête ; les autres ne savent pas qu'elle existe.
  select x.id, x.emise_le, x.devise into f
    from facturation.factures x
   where x.id = p_facture
     and ((select app.is_platform())
          or x.payeur_personne = (select auth.uid())
          or x.licence_id in (select l.id from facturation.licences l
                               where l.titulaire = (select auth.uid()))
          or x.payeur_tenant_id in (select app.member_orgs()));
  if f.id is null then
    raise exception 'refus.introuvable.facture' using errcode = 'no_data_found';
  end if;

  -- L'émetteur est celui du jour de l'émission : c'est lui qui a émis.
  select o.name, o.legal_id, o.adresse into e
    from facturation.emetteurs em
    join identity.organizations o on o.id = em.organisation_id
   where em.valide_des <= f.emise_le
   order by em.valide_des desc limit 1;

  -- Ce qu'on imprime de lui, et où le payer : le réglage en vigueur aujourd'hui.
  select x.* into r
    from plateforme.reglages_factures x
   where x.valide_des <= current_date
   order by x.valide_des desc, x.rang desc limit 1;

  select d.exposant into v_exposant from ref.devises d where d.code = f.devise;

  select jsonb_object_agg(u.langue, u.noms) into v_lettres
    from (select de.langue,
                 jsonb_object_agg(de.unite, jsonb_build_object(
                   'singulier', de.singulier, 'pluriel', de.pluriel,
                   'duel', de.duel, 'accusatif', de.accusatif)) as noms
            from (select distinct on (x.langue, x.unite) x.*
                    from ref.devises_ecrites x
                   where x.devise = f.devise
                     and x.valid_from <= f.emise_le
                     and (x.valid_to is null or x.valid_to >= f.emise_le)
                   order by x.langue, x.unite, x.valid_from desc) de
           group by de.langue) u;

  return jsonb_build_object(
    'emetteur', case when e.name is null then null else jsonb_build_object(
      'nom', e.name,
      'matricule', e.legal_id,
      'adresse', coalesce(nullif(btrim(r.adresse), ''), e.adresse),
      'rne', r.rne,
      'site_web', r.site_web) end,
    'conditions_paiement', r.conditions_paiement,
    'banque', case when coalesce(r.banque_rib, r.banque_iban) is null then null
                   else jsonb_build_object(
                     'titulaire', r.banque_titulaire, 'banque', r.banque_nom,
                     'agence', r.banque_agence, 'rib', r.banque_rib, 'iban', r.banque_iban,
                     'bic', r.banque_bic, 'devise', r.banque_devise) end,
    'exposant', v_exposant,
    'lettres', v_lettres);
end
$$;
revoke all on function facturation.entete_de_facture(uuid) from public, anon;
grant execute on function facturation.entete_de_facture(uuid) to authenticated;

comment on function facturation.entete_de_facture(uuid) is
  'Ce que la facture imprime au-delà de ses lignes : émetteur du jour d''émission, réglage '
  'd''impression en vigueur (adresse, RNE, site, conditions, banque), noms de la devise. '
  'Lisible par l''opérateur, le titulaire ou le payeur de la facture ; refus pour tout autre.';

-- --------------------------------------------------------------- 3. La tour règle
create function plateforme.factures_regler(p_reglage jsonb, p_valide_des date, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_serie    text := upper(btrim(coalesce(p_reglage ->> 'serie', '')));
  v_chiffres integer;
  v_devise   text := nullif(upper(btrim(coalesce(p_reglage ->> 'banque_devise', ''))), '');
  v_id       uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  p_motif := nullif(btrim(coalesce(p_motif, '')), '');
  if p_motif is null then
    raise exception 'refus.motif.a_dire' using errcode = 'check_violation';
  end if;
  -- Une décision vaut pour aujourd'hui ou plus tard : on ne réécrit pas une facture passée.
  if p_valide_des is null or p_valide_des < current_date then
    raise exception 'refus.facturation.reglage_date' using errcode = 'check_violation';
  end if;
  v_chiffres := case when coalesce(p_reglage ->> 'chiffres', '') ~ '^\d{1,2}$'
                     then (p_reglage ->> 'chiffres')::integer end;
  if v_serie !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' or length(v_serie) > 32
     or v_chiffres is null or v_chiffres not between 4 and 9 then
    raise exception 'refus.facturation.serie_invalide' using errcode = 'check_violation';
  end if;
  if v_devise is not null and not exists (select 1 from ref.devises d where d.code = v_devise) then
    raise exception 'refus.facturation.devise_inconnue' using errcode = 'check_violation';
  end if;

  insert into plateforme.reglages_factures
    (serie, chiffres, adresse, rne, site_web, conditions_paiement,
     banque_titulaire, banque_nom, banque_agence, banque_rib, banque_iban, banque_bic,
     banque_devise, valide_des, motif, decide_par)
  values
    (v_serie, v_chiffres,
     nullif(btrim(p_reglage ->> 'adresse'), ''),
     nullif(btrim(p_reglage ->> 'rne'), ''),
     nullif(btrim(p_reglage ->> 'site_web'), ''),
     nullif(btrim(p_reglage ->> 'conditions_paiement'), ''),
     nullif(btrim(p_reglage ->> 'banque_titulaire'), ''),
     nullif(btrim(p_reglage ->> 'banque_nom'), ''),
     nullif(btrim(p_reglage ->> 'banque_agence'), ''),
     nullif(btrim(p_reglage ->> 'banque_rib'), ''),
     nullif(btrim(p_reglage ->> 'banque_iban'), ''),
     nullif(btrim(p_reglage ->> 'banque_bic'), ''),
     v_devise, p_valide_des, p_motif, auth.uid())
  returning id into v_id;

  return jsonb_build_object('reglage_id', v_id, 'serie', v_serie, 'valide_des', p_valide_des);
end
$$;
revoke all on function plateforme.factures_regler(jsonb, date, text) from public, anon;
grant execute on function plateforme.factures_regler(jsonb, date, text) to authenticated;

comment on function plateforme.factures_regler(jsonb, date, text) is
  'La tour règle les factures : série, chiffres du compteur, adresse, RNE, site, conditions de '
  'paiement, coordonnées bancaires. Daté (aujourd''hui ou plus tard), motivé, en ajout seul.';

-- --------------------------------------------------------------- 4. La tour renvoie
create function plateforme.facture_renvoyer(p_facture uuid, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- La fenêtre du doublon : celle du moteur (`notif.poster`), dite une fois ici.
  v_fenetre interval := interval '24 hours';
  f         record;
  v_cle     text := 'facture:' || p_facture::text;
  v_avant   uuid[];
  v_envoi   record;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  p_motif := nullif(btrim(coalesce(p_motif, '')), '');
  if p_motif is null then
    raise exception 'refus.motif.a_dire' using errcode = 'check_violation';
  end if;
  select x.id, x.numero, x.payeur_type, x.payeur_personne, x.licence_id into f
    from facturation.factures x where x.id = p_facture;
  if f.id is null then
    raise exception 'refus.introuvable.facture' using errcode = 'no_data_found';
  end if;
  if f.payeur_type <> 'titulaire' then
    raise exception 'refus.facturation.renvoi_pme_seulement' using errcode = 'check_violation';
  end if;

  -- Déjà décidé dans la fenêtre (parti, ou en attente du travailleur) : rien de plus.
  if exists (select 1 from notif.envois_v e
              where e.destinataire = f.payeur_personne and e.code = 'facture.emise.pme'
                and e.canal = 'email' and e.sujet_cle = v_cle
                and e.decision = 'a_remettre' and e.etat <> 'refuse'
                and e.cree_le > now() - v_fenetre) then
    return jsonb_build_object('facture_id', f.id, 'numero', f.numero, 'deja', true);
  end if;

  -- Les envois d'avant : celui que ce renvoi pose est le seul qui n'y est pas (dans une même
  -- transaction, `cree_le` ne les départage pas).
  select coalesce(array_agg(e.id), '{}') into v_avant
    from notif.envois e
   where e.destinataire = f.payeur_personne and e.code = 'facture.emise.pme'
     and e.canal = 'email' and e.sujet_cle = v_cle;

  perform facturation.avertir_de_la_facture(f.id, v_fenetre);

  select e.decision, e.motif_abandon into v_envoi
    from notif.envois e
   where e.destinataire = f.payeur_personne and e.code = 'facture.emise.pme'
     and e.canal = 'email' and e.sujet_cle = v_cle
     and e.id <> all (v_avant)
   limit 1;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id,
                               payload)
  select lo.tenant_id, auth.uid(), 'facture.renvoyee', 'facturation', 'factures', f.id,
         jsonb_build_object('numero', f.numero, 'motif', p_motif,
                            'decision', v_envoi.decision, 'abandon', v_envoi.motif_abandon)
    from facturation.licence_organisations lo
   where lo.licence_id = f.licence_id
   order by lo.tenant_id limit 1;

  return jsonb_build_object('facture_id', f.id, 'numero', f.numero, 'deja', false,
                            'poste', coalesce(v_envoi.decision = 'a_remettre', false),
                            'abandon', v_envoi.motif_abandon);
end
$$;
revoke all on function plateforme.facture_renvoyer(uuid, text) from public, anon;
grant execute on function plateforme.facture_renvoyer(uuid, text) to authenticated;

comment on function plateforme.facture_renvoyer(uuid, text) is
  'La tour renvoie le courriel d''une facture de PME déjà émise (facture.emise.pme). Motivé, '
  'tracé au journal ; une fois par facture dans la fenêtre du moteur.';

commit;
