-- ======================================================================
--  Le crayon d'une facture lue : les lignes se corrigent (10 novembre 2026).
--
--  Suite de `20261212090000` (le pied). Pour chaque ligne : le libellé, la
--  quantité, le prix unitaire HT, le montant HT, le code TVA. Même porte, même
--  table, même règle : une PRÉCISION (R7), nommée par son chemin de citation
--  (`articles[0].quantity`), datée et signée ; la lecture reste.
--
--  Ce que la base borne :
--    - un montant (prix unitaire, montant HT) : les décimales de la devise du
--      référentiel, jamais arrondi (R4) — la règle du pied ;
--    - une quantité : des chiffres, au plus six décimales (borne technique) ;
--    - un libellé : non vide, au plus 200 caractères comme un nom ;
--    - un code TVA : un code du référentiel en vigueur à la DATE de la pièce
--      (le pack de la juridiction du dossier). Aucun taux ne se saisit (R4).
--
--  Seule la liste des chemins et le corps de la borne changent : la porte,
--  `capture_precision_persist`, n'est pas touchée.
-- ======================================================================

begin;

create or replace function app.est_un_champ_de_lecture(p_champ text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_champ ~ ('^(totals\.(base_ht|vat|ttc)'
                    || '|other_charges\[[0-9]{1,3}\]\.amount'
                    || '|articles\[[0-9]{1,3}\]\.(designation|quantity|unit_price_ht|total_ht|tax_code))$')
$$;

comment on function app.est_un_champ_de_lecture(text) is
  'Les champs de la lecture qu''une personne peut préciser, nommés par leur chemin de citation : le pied de la facture et ses lignes. Aucune valeur réglementaire : seulement la forme des chemins.';

create or replace function app.precision_de_lecture(p_piece uuid, p_champ text, p_valeur text)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_devise  text;
  v_dec     smallint;
  v_texte   text := btrim(coalesce(p_valeur, ''));
  v_chemin  text[] := app.chemin_de_lecture(p_champ);
  v_jour    date;
  v_pack    uuid;
begin
  select x.payload into v_payload
    from capture.extractions x
   where x.piece_id = p_piece
   order by x.created_at desc limit 1;
  if v_payload is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  -- Une ligne qui n'existe pas dans la lecture ne se précise pas.
  if array_length(v_chemin, 1) = 3
     and (jsonb_typeof(v_payload -> v_chemin[1]) is distinct from 'array'
          or v_chemin[2]::int >= jsonb_array_length(v_payload -> v_chemin[1])) then
    raise exception 'refus.precision.ligne_inconnue' using errcode = 'check_violation';
  end if;

  -- Un libellé : tel que la personne le lit sur sa pièce, les blancs resserrés.
  if v_chemin[array_length(v_chemin, 1)] = 'designation' then
    v_texte := btrim(regexp_replace(v_texte, '\s+', ' ', 'g'));
    if v_texte = '' then
      raise exception 'refus.precision.libelle_vide' using errcode = 'check_violation';
    end if;
    if length(v_texte) > 200 then
      raise exception '%', app.refus_avec_valeurs('refus.precision.libelle_trop_long', 'max', '200')
        using errcode = 'check_violation';
    end if;
    return v_texte;
  end if;

  -- Une quantité : des chiffres et un point, au plus six décimales (borne technique).
  if v_chemin[array_length(v_chemin, 1)] = 'quantity' then
    if v_texte !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then
      raise exception 'refus.precision.quantite_illisible' using errcode = 'check_violation';
    end if;
    return trim_scale(v_texte::numeric)::text;
  end if;

  -- Un code de TVA : un code du référentiel, à la date de la pièce — celle qui
  -- est lue, à défaut celle que la personne a donnée, à défaut la réception.
  if v_chemin[array_length(v_chemin, 1)] = 'tax_code' then
    v_jour := coalesce(
      case when v_payload ->> 'document_date' ~ '^\d{4}-\d{2}-\d{2}$'
           then (v_payload ->> 'document_date')::date end,
      (select q.valeur::date from capture.precisions q
        where q.piece_id = p_piece and q.champ = 'document_date'
          and q.valeur ~ '^\d{4}-\d{2}-\d{2}$'
        order by q.decided_at desc limit 1),
      (select v.recue_le::date from public.pieces_v v where v.id = p_piece));
    select j.id into v_pack
      from capture.pieces p
      join identity.organizations o on o.id = p.tenant_id
      join ref.jurisdiction_packs j on j.jurisdiction = o.jurisdiction
     where p.id = p_piece and j.effective_from <= v_jour
     order by j.effective_from desc limit 1;
    if not exists (select 1 from ref.tva_rates t
                    where t.pack_version_id = v_pack and t.code = v_texte
                      and t.valid_from <= v_jour
                      and (t.valid_to is null or t.valid_to >= v_jour)) then
      raise exception '%', app.refus_avec_valeurs('refus.precision.code_tva_inconnu', 'code', left(v_texte, 40))
        using errcode = 'check_violation';
    end if;
    return v_texte;
  end if;

  -- Un montant : les décimales sont celles de la devise de la pièce — lue, à
  -- défaut celle du dossier.
  v_devise := coalesce(
    nullif(upper(v_payload ->> 'currency'), ''),
    (select o.currency from capture.pieces p
       join identity.organizations o on o.id = p.tenant_id
      where p.id = p_piece));
  select d.exposant into v_dec from ref.devises d where d.code = v_devise;
  if v_dec is null then
    raise exception '%', app.refus_avec_valeurs('refus.precision.devise_inconnue', 'devise', coalesce(v_devise, ''))
      using errcode = 'check_violation';
  end if;

  -- Un montant s'écrit en chiffres et un point décimal : l'écran a déjà lu la
  -- saisie de la personne (« 2 850,000 » devient « 2850.000 »). Borne technique.
  if v_texte !~ '^[0-9]{1,15}(\.[0-9]+)?$' then
    raise exception 'refus.precision.montant_illisible' using errcode = 'check_violation';
  end if;
  -- Un montant ne s'arrondit pas en silence.
  if substr(split_part(v_texte, '.', 2), v_dec + 1) ~ '[1-9]' then
    raise exception '%', app.refus_avec_valeurs('refus.precision.montant_trop_precis', 'max', v_dec::text)
      using errcode = 'check_violation';
  end if;
  return round(v_texte::numeric, v_dec)::text;
end
$$;

comment on function app.precision_de_lecture(uuid, text, text) is
  'Borne la saisie d''une personne sur un champ de la lecture : un montant aux décimales de la devise du référentiel, une quantité, un libellé, un code de TVA du référentiel à la date de la pièce. Rend la valeur à inscrire.';

commit;
