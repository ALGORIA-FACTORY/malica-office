-- La retenue imprimée sur la facture se lit, et le règlement paie le net (21 novembre 2026).
--
-- ================================================================== POURQUOI
--
-- Au pilote, la note d'honoraires de MAP imprime : HT 400,000 · TVA 19 % 76,000 ·
-- TTC 476,000 · « Retenue à la source 3 % -14,280 » · timbre 1,000 · « Net à payer
-- 462,720 ». Le sudoku la PROUVAIT déjà par M04 (variante ttc_hors_timbre : net = TTC +
-- timbre + retenue imprimée en négatif), puis tendait le net à payer à la chaîne comme
-- s'il était le TTC : 400 + 76 + 1 = 477 ≠ 462,720, et la facture « ne tenait pas ».
--
-- ================================================================== CE QUI CHANGE
--
--   1. La preuve M04 nomme sa retenue (`"retenue": "montant_retenue_source"`), comme
--      elle nomme déjà son total (`"role": "ttc"`, 20261115110000) : le moteur sait
--      quel champ retrancher, sans code de champ dans l'adaptateur.
--   2. `capture.retenue_lue_mineur` : la retenue que la dernière analyse a retenue
--      (`normalisation.montants.retenue`), en unités mineures — la sœur de
--      `capture.ttc_mineur`.
--   3. Un premier règlement complet, sans montant dit, paie le NET (TTC − retenue
--      lue) : c'est l'argent qui sort. L'écriture de la facture ne change pas (le
--      fournisseur reste crédité du TTC, timbre compris) ; la retenue se qualifie au
--      règlement par le comptable, que l'écran pré-remplit.
--
-- Corps de `capture.un_reglement_dit_vrai` repris de 20261229120000 (clés `refus.paiement.*`) ; seul le montant
-- d'un règlement sans montant (le solde) change. SECURITY DEFINER et propriétaire gardés.
--
-- R4 : aucun taux ici — le taux se reconnaît au référentiel (`ref.retenues_au_reglement`).
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

-- --- 1. La preuve M04 nomme sa retenue ------------------------------------------------------------

update ref.grille_preuves p
   set expression = p.expression || '{"retenue": "montant_retenue_source"}'::jsonb
  from ref.grilles g
 where g.id = p.grille_id and g.code = 'facture' and p.code = 'M04'
   and p.expression ->> 'op' = 'somme' and p.expression ->> 'role' = 'ttc';

do $$
declare n integer;
begin
  select count(*) into n from ref.grille_preuves p join ref.grilles g on g.id = p.grille_id
   where g.code = 'facture' and p.expression ? 'retenue';
  if n <> (select count(*) from ref.grilles where code = 'facture') then
    raise exception 'grille facture : % preuve(s) qui nomment leur retenue, 1 par grille attendue', n;
  end if;
end $$;

-- --- 2. La retenue que la lecture a retenue -------------------------------------------------------

create or replace function capture.retenue_lue_mineur(p_piece uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  -- La DERNIÈRE analyse de la dernière extraction fait foi, comme pour le TTC.
  select case when d.retenue ~ '^[0-9]+$' then d.retenue::bigint end
    from (
      select a.normalisation -> 'montants' ->> 'retenue' as retenue
        from capture.extractions e
        join capture.analyses a on a.extraction_id = e.id
       where e.piece_id = p_piece
         and e.created_at = (select max(x.created_at) from capture.extractions x where x.piece_id = p_piece)
       order by a.created_at desc
       limit 1
    ) d
$$;

comment on function capture.retenue_lue_mineur(uuid) is
  'La retenue à la source que la facture imprime et déduit, telle que la dernière analyse '
  'l''a retenue (unités mineures) ; nulle sans retenue imprimée.';

-- --- 3. Un règlement complet paie le net -----------------------------------------------------------

create or replace function capture.un_reglement_dit_vrai()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ttc  bigint;
  v_paye bigint;
  v_retenue_eteinte bigint;
  v_courante uuid;
  v_versions uuid[];
begin
  -- Une annulation n'est pas un règlement : elle a ses propres gardes, et elle
  -- reste sur la pièce du règlement qu'elle annule.
  if new.annule_paiement_id is not null then
    return new;
  end if;

  -- La pièce appartient au dossier inscrit : la politique d'insertion vérifie
  -- le dossier, pas la pièce, et cette fonction lit (et éteint) au-delà de la
  -- RLS de l'appelant (revue Codex de #101).
  if not exists (select 1 from capture.pieces x
                  where x.id = new.piece_id and x.tenant_id = new.tenant_id) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  v_courante := app.version_courante(new.piece_id);
  select array_agg(v) into v_versions from app.versions_de_la_piece(new.piece_id) v;

  -- Un règlement nouveau ne s'inscrit pas sur une version gelée : c'est la
  -- même facture, il va à sa version courante — avec son établissement et son
  -- côté. La file hors ligne peut porter un identifiant d'avant la reprise ;
  -- la refuser ferait perdre un règlement réel (« rien ne bloque »).
  if new.piece_id <> v_courante then
    select c.id, c.entity_id, c.vis into new.piece_id, new.entity_id, new.vis
      from capture.pieces c where c.id = v_courante;
  end if;

  -- Une seule inscription à la fois par pièce — toutes versions : deux appuis
  -- simultanés, sur l'ancienne et la nouvelle photo, ne passent pas tous deux
  -- la règle du dépassement.
  perform pg_advisory_xact_lock(hashtextextended(v_courante::text, 0));

  if new.moyen_code = 'non_paye' then
    if exists (select 1 from capture.paiements p
                where p.piece_id = any (v_versions) and p.annule_paiement_id is null
                  and p.moyen_code <> 'non_paye'
                  and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
      raise exception 'refus.paiement.deja_regle' using errcode = 'check_violation';
    end if;
    if exists (select 1 from capture.paiements p
                where p.piece_id = any (v_versions) and p.annule_paiement_id is null
                  and p.moyen_code = 'non_paye'
                  and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
      raise exception 'refus.paiement.deja_non_paye' using errcode = 'check_violation';
    end if;
    new.montant_mineur := null;
    new.paye_le := null;
    return new;
  end if;

  v_ttc := capture.ttc_mineur(v_courante);
  -- Ce qui est DÉJÀ éteint (`app.reglements_vivants`).
  select coalesce(sum(r.eteint_mineur), 0) into v_paye from app.reglements_vivants(v_versions) r;

  if new.montant_mineur is null then
    if v_ttc is null then
      raise exception 'refus.paiement.montant_requis' using errcode = 'check_violation';
    end if;
    -- Le solde paie le NET : la retenue que la facture imprime et déduit
    -- reste au comptable, qui la qualifie au règlement. Ce qu'un règlement
    -- déjà qualifié en a éteint (sa dette éteinte au-delà de son montant) ne
    -- se retranche plus ; un acompte non qualifié laisse la retenue entière
    -- (revue Codex de #416 : 100,000 puis le solde rendait 377,000 au lieu de
    -- 362,720).
    select coalesce(sum(greatest(
             round(app.dette_eteinte(p.id) * power(10, d.exposant))::bigint - p.montant_mineur, 0)), 0)
      into v_retenue_eteinte
      from capture.paiements p
      join ref.devises d on d.code = p.devise
     where p.piece_id = any (v_versions) and p.annule_paiement_id is null
       and p.moyen_code <> 'non_paye' and p.montant_mineur is not null
       and app.dette_eteinte(p.id) is not null
       and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id);
    new.montant_mineur := v_ttc - v_paye
      - greatest(coalesce(capture.retenue_lue_mineur(v_courante), 0) - v_retenue_eteinte, 0);
    if new.montant_mineur <= 0 then
      raise exception 'refus.paiement.deja_solde' using errcode = 'check_violation';
    end if;
  end if;

  if new.montant_mineur <= 0 then
    raise exception 'refus.paiement.montant_positif' using errcode = 'check_violation';
  end if;

  if v_ttc is not null and v_paye + new.montant_mineur > v_ttc then
    raise exception 'refus.paiement.depasse_le_total' using errcode = 'check_violation';
  end if;

  if new.paye_le is null then
    new.paye_le := current_date;
  end if;
  if new.paye_le > current_date + 1 then
    raise exception 'refus.paiement.date_future' using errcode = 'check_violation';
  end if;

  if exists (select 1 from capture.paiements p
              where p.piece_id = any (v_versions) and p.annule_paiement_id is null
                and p.moyen_code = new.moyen_code
                and p.montant_mineur = new.montant_mineur
                and p.paye_le is not distinct from new.paye_le
                and p.created_at > now() - interval '10 seconds'
                and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
    raise exception 'refus.paiement.en_double' using errcode = 'check_violation';
  end if;

  return new;
end
$function$;

commit;
