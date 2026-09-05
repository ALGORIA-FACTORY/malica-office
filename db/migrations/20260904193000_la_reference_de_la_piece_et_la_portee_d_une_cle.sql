-- =====================================================================================
--  Regalica Office — Deux refus lisibles et une référence qui en est une.
--
--  POURQUOI, trouvé par les épreuves de bout en bout :
--    · une clé d'API créée sans portée tombait sur la contrainte de la table,
--      dont le message porte un nom interne : l'écran affichait « erreur
--      interne ». La fonction refuse désormais avec une phrase ;
--    · le FEC portait l'identifiant technique de la pièce en `PieceRef`. Un
--      fichier légal cite la référence du document — le numéro de facture que
--      la lecture a relevé — ou rien, jamais un identifiant de base.
--
--  Idempotent.
-- =====================================================================================

-- --- 1. Une clé porte au moins une portée connue -------------------------------------------
create or replace function public.api_key_creer(p_tenant uuid, p_libelle text, p_portees text[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_secret text;
  v_cle    text;
  v_id     uuid;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  if app.api_tenant() is not null then
    raise exception 'une cle ne cree pas de cle' using errcode = '42501';
  end if;
  if not exists (select 1 from identity.organizations o
                  where o.id = p_tenant and o.kind = 'cabinet' and o.archived_at is null) then
    raise exception 'seul un cabinet porte une cle d''API' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_libelle, ''))) = 0 then
    raise exception 'la cle doit porter un nom' using errcode = '22023';
  end if;
  if p_portees is null or cardinality(p_portees) = 0 then
    raise exception 'une cle porte au moins une portee' using errcode = '22023';
  end if;
  if not (p_portees <@ array['ecritures.lire', 'pieces.deposer']::text[]) then
    raise exception 'une portee demandee n''existe pas' using errcode = '22023';
  end if;

  v_secret := encode(extensions.gen_random_bytes(24), 'hex');
  v_cle    := 'rgo_live_' || v_secret;

  insert into identity.api_keys (tenant_id, libelle, prefixe, suffixe, empreinte, portees)
  values (p_tenant, btrim(p_libelle), left(v_secret, 8), right(v_secret, 4),
          encode(sha256(convert_to(v_cle, 'UTF8')), 'hex'), p_portees)
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'api_key.creee', 'identity', 'api_keys', v_id,
          jsonb_build_object('libelle', btrim(p_libelle), 'prefixe', left(v_secret, 8),
                             'portees', to_jsonb(p_portees)));

  return jsonb_build_object('id', v_id, 'cle', v_cle,
                            'prefixe', left(v_secret, 8), 'suffixe', right(v_secret, 4));
end $$;

revoke all on function public.api_key_creer(uuid, text, text[]) from public, anon;
grant execute on function public.api_key_creer(uuid, text, text[]) to authenticated;

-- --- 2. La référence de la pièce dans l'export --------------------------------------------
-- La lecture relève les références du document (`references` de l'extrait :
-- numéro de facture, de bon, de commande…). L'export cite celle qui nomme le
-- document — un numéro de facture d'abord —, ou rien.
create or replace function public.export_lignes_lire(p_cabinet uuid, p_client uuid, p_du date, p_au date)
returns table (
  client_tenant_id uuid,
  client_nom       text,
  client_legal_id  text,
  ecriture_id      uuid,
  numero           bigint,
  journal          text,
  journal_libelle  text,
  date_ecriture    date,
  ordinal          smallint,
  compte           text,
  compte_libelle   text,
  piece_ref        text,
  piece_date       date,
  ecriture_libelle text,
  ligne_libelle    text,
  debit            numeric,
  credit           numeric,
  tax_code         text,
  valide_le        date,
  devise           text,
  pack_version_id  uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mandats uuid[] := array(select app.export_mandats(p_cabinet, p_client));
begin
  return query
    select e.tenant_id,
           o.name,
           o.legal_id,
           e.id,
           dense_rank() over (partition by e.tenant_id, e.journal
                              order by e.date_ecriture, e.booked_at, e.id),
           e.journal,
           coalesce(j.libelle, e.journal),
           e.date_ecriture,
           l.ordinal,
           l.account_code,
           coalesce(
             (select pa.label from parametrage.accounts pa
               where pa.tenant_id = p_cabinet and pa.account_code = l.account_code),
             (select ra.label from ref.accounts ra
               where ra.pack_version_id = e.pack_version_id and ra.account_code = l.account_code),
             ''),
           coalesce(
             (select r.valeur
                from capture.extractions x
                cross join lateral jsonb_each_text(coalesce(x.payload -> 'references', '{}'::jsonb))
                     as r(cle, valeur)
               where x.piece_id = e.piece_id and x.contract = 'extract.v1'
                 and length(btrim(r.valeur)) > 0
               order by x.created_at desc,
                        (r.cle ~* 'invoice|facture|numero|number') desc,
                        r.cle
               limit 1),
             ''),
           coalesce(
             (select case when x.payload ->> 'document_date' ~ '^\d{4}-\d{2}-\d{2}$'
                          then (x.payload ->> 'document_date')::date end
                from capture.extractions x
               where x.piece_id = e.piece_id and x.contract = 'extract.v1'
               order by x.created_at desc limit 1),
             p.created_at::date,
             e.date_ecriture),
           e.libelle,
           l.libelle,
           l.debit::numeric,
           l.credit::numeric,
           l.tax_code,
           coalesce(e.booked_at::date, e.date_ecriture),
           e.devise,
           e.pack_version_id
      from socle.ecritures e
      join socle.ecriture_lignes l on l.ecriture_id = e.id
      join identity.organizations o on o.id = e.tenant_id
      left join ref.journals j on j.code = e.journal
      left join capture.pieces p on p.id = e.piece_id
     where e.status = 'booked'
       and e.tenant_id = any(v_mandats)
       and e.date_ecriture between p_du and p_au
     order by o.name, e.tenant_id, e.date_ecriture, e.booked_at, e.id, l.ordinal;
end $$;

revoke all on function public.export_lignes_lire(uuid, uuid, date, date) from public, anon;
grant execute on function public.export_lignes_lire(uuid, uuid, date, date) to authenticated;
