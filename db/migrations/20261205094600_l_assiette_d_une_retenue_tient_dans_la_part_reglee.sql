-- L'assiette d'une retenue tient dans la part réglée, et la part réglée dans la facture.
--
-- ================================================================== POURQUOI
--
-- Seconde vérification du lot S5b (`un-reglement-ne-s-invente-ni-retenue-ni-date.test.ts`,
-- « une retenue déclarée ne s'assied pas sur une assiette plus grande que la part
-- réglée ») : la retenue se lit dans la qualification du paiement (`reglement.qualifie`),
-- mais l'assiette déclarée (`baseReglee`, `assietteIR`, `tvaReglee`) n'était bornée ni
-- par la part brute que le règlement éteint, ni par la facture. Une PME déclarait une
-- assiette de 100 000 : 15 000 de retenue « déclarée » pour 10 payés sur une facture de
-- 1 470,126.
--
-- ================================================================== CE QUI CHANGE
--
-- `app.un_reglement_est_ce_que_son_paiement_dit()` refuse en plus (même motif,
-- `refus.ecriture.reglement_hors_paiement`) :
--   - une assiette déclarée négative ou plus grande que la part brute éteinte chez le
--     tiers (le payé plus les retenues) ;
--   - une part brute éteinte plus grande que ce que l'écriture vivante de la pièce porte
--     au tiers (la facture), quand la pièce en a une.
-- Corps repris de 20261205093900 ; seules ces deux bornes s'ajoutent, juste avant la fin.
--
-- REJEU (R11) : aucune donnée de référence n'est écrite ; `create or replace`.

create or replace function app.un_reglement_est_ce_que_son_paiement_dit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p          capture.paiements%rowtype;
  v_m          ref.payment_means%rowtype;
  v_sens       text;
  v_exposant   integer;
  v_paye       numeric;
  v_q          jsonb;
  v_codes      text[];
  v_tresorerie text[];
  v_tiers      text[];
  v_attendues  text[];
  v_retenues   numeric;
  v_ligne_tres uuid;
  v_ligne_tiers uuid;
  v_montant_tiers numeric;
  v_autres     text[];
  v_declarees  boolean;
begin
  -- Une proposition remplacée dans la même transaction n'a plus rien à dire.
  if new.nature <> 'reglement' or new.reverses_id is not null
     or not exists (select 1 from socle.ecritures e where e.id = new.id) then
    return null;
  end if;

  select * into v_p from capture.paiements where id = new.paiement_id;
  select p.document_kind into v_sens
    from capture.pieces p where p.id = app.version_courante(new.piece_id);
  select * into v_m from ref.payment_means m
   where m.pack_version_id = v_p.pack_version_id and m.code = v_p.moyen_code
     and m.valid_from <= v_p.paye_le and (m.valid_to is null or m.valid_to >= v_p.paye_le);
  select d.exposant into v_exposant from ref.devises d where d.code = v_p.devise;

  if v_p.id is null or v_m.id is null or v_p.montant_mineur is null or v_exposant is null
     or v_sens not in ('facture_achat', 'facture_vente')
     or v_p.devise is distinct from new.devise
     or new.journal is distinct from v_m.journal_code
     or new.date_ecriture is distinct from v_p.paye_le then
    raise exception 'refus.ecriture.reglement_hors_paiement' using errcode = 'check_violation';
  end if;

  v_paye := v_p.montant_mineur / power(10::numeric, v_exposant);

  -- La trésorerie : le compte du moyen, par son rôle quand le moyen en nomme un.
  v_tresorerie := case
    when (case when v_sens = 'facture_vente' then v_m.role_vente else v_m.role_achat end) is null
      then array[case when v_sens = 'facture_vente' then v_m.tresorerie_account_vente
                      else v_m.tresorerie_account end]
    else array(select app.comptes_du_role(
                 new.tenant_id,
                 case when v_sens = 'facture_vente' then v_m.role_vente else v_m.role_achat end,
                 v_p.pack_version_id,
                 case when v_sens = 'facture_vente' then v_m.tresorerie_account_vente
                      else v_m.tresorerie_account end))
  end;
  -- Le tiers : celui de l'écriture vivante de la pièce ; sans elle, celui du pack.
  v_tiers := array(select distinct t.account_code
                     from app.comptes_du_tiers_de_la_piece(new.piece_id, v_sens) t);
  if cardinality(v_tiers) = 0 then
    v_tiers := array(select distinct m.counterparty_account from ref.account_mappings m
                      where m.pack_version_id = v_p.pack_version_id and m.document_kind = v_sens);
  end if;

  -- La trésorerie et le tiers : une ligne chacun.
  select min(l.id::text)::uuid into v_ligne_tres
    from socle.ecriture_lignes l
   where l.ecriture_id = new.id and l.account_code = any (v_tresorerie)
     and ((v_sens = 'facture_achat' and l.credit = v_paye and l.debit = 0)
       or (v_sens = 'facture_vente' and l.debit = v_paye and l.credit = 0))
  having count(*) = 1;
  select min(l.id::text)::uuid, min(case when v_sens = 'facture_achat' then l.debit else l.credit end)
    into v_ligne_tiers, v_montant_tiers
    from socle.ecriture_lignes l
   where l.ecriture_id = new.id and l.account_code = any (v_tiers)
     and ((v_sens = 'facture_achat' and l.debit > 0 and l.credit = 0)
       or (v_sens = 'facture_vente' and l.credit > 0 and l.debit = 0))
  having count(*) = 1;
  if v_ligne_tres is null or v_ligne_tiers is null then
    raise exception 'refus.ecriture.reglement_hors_paiement' using errcode = 'check_violation';
  end if;

  -- Les retenues : celles que le paiement déclare, et rien d'autre.
  select a.payload -> 'qualification' into v_q
    from audit.event_log a
   where a.object_id = new.id and a.action = 'reglement.qualifie'
   order by a.at desc limit 1;
  v_codes := case when jsonb_typeof(v_q -> 'codes') = 'array'
                  then array(select jsonb_array_elements_text(v_q -> 'codes'))
                  else '{}'::text[] end;
  with taux as (
    select r.code, r.taux, r.famille,
           case when r.base = 'tva' then nullif(v_q ->> 'tvaReglee', '')::numeric
                else coalesce(nullif(v_q ->> 'assietteIR', '')::numeric,
                              nullif(v_q ->> 'baseReglee', '')::numeric) end as assiette
      from ref.retenues_au_reglement(
             (select o.jurisdiction from identity.organizations o where o.id = new.tenant_id),
             v_p.paye_le) r
     where r.code = any (v_codes)
       and r.sens in ('tous', case when v_sens = 'facture_achat' then 'achat' else 'vente' end)
  ), attendues as (
    select (select c from app.comptes_du_role(
              new.tenant_id,
              case when t.famille = 'tva' then 'TVA_RETENUE_SUBIE'
                   when v_sens = 'facture_achat' then 'RETENUE_SOURCE_OPEREE'
                   else 'RETENUE_SOURCE_SUBIE' end,
              v_p.pack_version_id, null) c) as compte,
           app.arrondi_au_pair(t.assiette * t.taux, v_exposant) as montant
      from taux t
  )
  select array(select a.compte || '|' || trim_scale(a.montant)::text from attendues a
                order by 1),
         coalesce((select sum(a.montant) from attendues a), 0),
         (select count(*) from attendues) = cardinality(v_codes)
            and not exists (select 1 from attendues a where a.compte is null or a.montant is null
                                                       or a.montant <= 0)
    into v_attendues, v_retenues, v_declarees
    from (select 1) x;
  if v_declarees is not true then
    raise exception 'refus.ecriture.reglement_hors_paiement' using errcode = 'check_violation';
  end if;

  v_autres := array(
    select l.account_code || '|' ||
           trim_scale(case when v_sens = 'facture_achat' then l.credit else l.debit end)::text
      from socle.ecriture_lignes l
     where l.ecriture_id = new.id and l.id not in (v_ligne_tres, v_ligne_tiers)
       and ((v_sens = 'facture_achat' and l.credit > 0 and l.debit = 0)
         or (v_sens = 'facture_vente' and l.debit > 0 and l.credit = 0))
     order by 1);
  if v_autres is distinct from v_attendues
     or (select count(*) from socle.ecriture_lignes l where l.ecriture_id = new.id)
        <> 2 + cardinality(v_attendues)
     or v_montant_tiers <> v_paye + v_retenues then
    raise exception 'refus.ecriture.reglement_hors_paiement' using errcode = 'check_violation';
  end if;
  -- L'assiette déclarée tient dans la part brute éteinte ; la part brute, dans la facture.
  if exists (select 1
               from (values (nullif(v_q ->> 'baseReglee', '')::numeric),
                            (nullif(v_q ->> 'assietteIR', '')::numeric),
                            (nullif(v_q ->> 'tvaReglee', '')::numeric)) d(assiette)
              where d.assiette is not null
                and (d.assiette < 0 or d.assiette > v_montant_tiers))
     or v_montant_tiers > coalesce(
          (select sum(t.montant) from app.comptes_du_tiers_de_la_piece(new.piece_id, v_sens) t
            where t.account_code = any (v_tiers)),
          v_montant_tiers) then
    raise exception 'refus.ecriture.reglement_hors_paiement' using errcode = 'check_violation';
  end if;
  return null;
end
$$;

revoke all on function app.un_reglement_est_ce_que_son_paiement_dit() from public, anon, authenticated;
