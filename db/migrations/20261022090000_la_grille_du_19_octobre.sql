-- La grille du 19 octobre : tranchée par le dirigeant, écrite en une ligne de plus.
--
-- ================================================================== POURQUOI
--
-- La grille du 17 octobre avait été posée avant d'être confrontée au marché.
-- Le 19, le dirigeant l'a reprise ligne par ligne contre Fatoora, Swiver,
-- Swifto et Facture Tunisie, puis contre la façon dont ChatGPT et Lovable
-- vendent l'IA. Ce qu'il a tranché :
--
--   |          | prix HT | personnes | lectures | sociétés | siège en plus     | société en plus |
--   | Basic    |  9 DT   | 1         |  30      | 1        | —                 | —               |
--   | Solo     | 19 DT   | 1         |  70      | 1        | jamais            | —               |
--   | Team     | 34 DT   | 3         | 140      | 1        | 8 DT, +40, ∞      | —               |
--   | Premium  | 59 DT   | 5         | 280      | 2        | 8 DT, +40, ∞      | 29 DT, +140, ∞  |
--
-- Au coût mesuré d'une lecture (0,040 DT, 11 octobre), un client qui consomme
-- TOUT garde 87 · 85 · 84 · 81 %. La lecture coûte moins cher à chaque étage
-- (0,300 → 0,271 → 0,243 → 0,211) : aucune offre n'est moins intéressante que
-- celle du dessous, et à prix égal l'offre du dessus gagne toujours.
--
-- « Personnes » compte le propriétaire ; `sieges_inclus` ne compte que les
-- collaborateurs (le titulaire ne consomme pas de place, 20261018090000) :
-- d'où 0 · 0 · 2 · 4.
--
-- La société en plus apporte 140 lectures et non 120 : la base compte les
-- lectures PAR SOCIÉTÉ, et Premium = 280 pour deux. Une société vaut une
-- société — c'est ce qui a été dit au dirigeant.
--
-- ===================================================== UNE LIGNE DE PLUS, DATÉE
--
-- Rien n'est réécrit. Les lignes du 17 restent, et une licence garde la grille
-- en vigueur le jour où son forfait a commencé (`ref.offre_a`) : une hausse ne
-- réécrit pas un abonnement en cours. La date est ÉCRITE (R11) — le 19, jour
-- où la grille a été tranchée, et non le jour où ce fichier est joué.
--
-- ============================================= « SANS PLAFOND » S'ÉCRIT VIDE
--
-- Le dirigeant veut des sièges et des sociétés sans limite sur Team et
-- Premium. Un très grand nombre aurait été une constante déguisée, qu'un écran
-- aurait fini par afficher (« 32 767 places »). Vide veut dire « aucun
-- plafond », et les deux contrôles qui existaient le lisent déjà ainsi —
-- `if v_occupe >= v_max` et `if organisations >= organisations_max` ne lèvent
-- pas sur une valeur vide. Un seul disait le contraire, `siege_inviter`, qui
-- remplaçait le vide par zéro : il est repris ci-dessous, à l'identique sauf
-- cette condition.
--
-- ============================================================== REJEU (R11)
--
-- `drop not null` est idempotent, l'insertion a `on conflict do nothing`, la
-- fonction est un `create or replace` qui garde ses droits.

begin;

alter table ref.offres alter column sieges_max drop not null;
alter table ref.offres alter column organisations_max drop not null;

comment on column ref.offres.sieges_max is
  'Collaborateurs au plus, siege en plus compris. VIDE = sans plafond '
  '(20261022090000) : le declencheur et siege_inviter le lisent ainsi.';
comment on column ref.offres.organisations_max is
  'Societes au plus. VIDE = sans plafond (20261022090000).';

insert into ref.offres
  (code, libelle, prix_mensuel_ht, lectures_par_organisation,
   sieges_inclus, sieges_max, prix_siege_sup, lectures_par_siege_sup,
   organisations_incluses, organisations_max, prix_organisation_sup,
   rang, effective_from)
values
  ('basic',   'Basic',    9.000,  30, 0, 0,    0.000,  0, 1, 1,     0.000, 1, date '2026-10-19'),
  ('solo',    'Solo',    19.000,  70, 0, 0,    0.000,  0, 1, 1,     0.000, 2, date '2026-10-19'),
  ('team',    'Team',    34.000, 140, 2, null, 8.000, 40, 1, 1,     0.000, 3, date '2026-10-19'),
  ('premium', 'Premium', 59.000, 140, 4, null, 8.000, 40, 2, null, 29.000, 4, date '2026-10-19')
on conflict (code, effective_from) do nothing;

create or replace function public.siege_inviter(p_tenant uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
  v_max     smallint;
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'seul le dirigeant invite un siege' using errcode = '42501';
  end if;

  v_licence := facturation.licence_de(p_tenant);

  -- Une organisation sans licence n'a pas de plafond à opposer : le
  -- déclencheur fait de même, pour la même raison.
  if v_licence is not null then
    select sieges_max into v_max from facturation.droits_v where licence_id = v_licence;
    -- `sieges_max` vide veut dire SANS PLAFOND (20261022090000). L'ancien
    -- `coalesce(v_max, 0)` en faisait zéro : la moindre invitation aurait été
    -- refusée sur Team et Premium. Le déclencheur `memberships_place_disponible`
    -- lisait déjà le vide comme « sans limite » — les deux portes disent pareil.
    if v_max is not null and facturation.places_occupees(v_licence) >= v_max then
      raise exception 'cette offre porte % place(s) ; elles sont prises', v_max
        using errcode = 'check_violation',
              hint = 'Passer à l''offre supérieure, ou libérer une place.';
    end if;
  end if;

  return public.cabinet_inviter(p_tenant, p_email, 'collaborateur');
end
$$;

commit;
