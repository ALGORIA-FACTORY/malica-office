-- L'option du mois de TVA d'une pièce se lit au jour de sa facture (13 novembre 2026).
--
-- ================================================================= LE DÉFAUT
--
-- Revue de #163 (P1). La lecture du mois (`office.bookedExtracts`,
-- `office.extraitsTransmis`) résolvait `mois_tva.date` UNE fois, à la FIN de la
-- fenêtre demandée. Un cabinet qui change d'option entre l'encaissement et la
-- facture voyait une même pièce changer de mois selon le rapport lu : une
-- prestation de septembre, encaissée en entier en août, comptait en août
-- (`exigibilite_calculee`, lu le 31 août) ET en septembre
-- (`date_facture_alerte`, en vigueur au 1er septembre, lu le 30 septembre) —
-- ou dans aucun des deux, l'option changée dans l'autre sens.
--
-- ================================================================= LA RÈGLE
--
-- L'option applicable à une pièce est celle en vigueur au JOUR DE SA FACTURE
-- (le `p_jour` de `app.jour_d_imputation_tva` : la date de l'écriture, à
-- défaut celle du document). C'est la date que la proposition lit déjà
-- (`proposition.ts`, réglages « au jour de la pièce ») : la réserve que voit
-- le cabinet et le mois où la pièce pèse ne peuvent plus diverger. Elle ne
-- dépend ni de la fenêtre lue, ni des règlements (ajoutés ou annulés après
-- coup), ni de la déclaration : chaque lecture mensuelle range la pièce dans
-- un seul mois.
--
-- Cette fonction rend, une fois par lecture, l'historique de ce qui décide du
-- mois : chaque jour où le pack, l'option (défaut du pack ou décision datée du
-- cabinet, R7 : ajout seulement) ou les natures de vente peuvent changer, avec
-- le pack et l'option résolus ce jour-là PAR LE RÉSOLVEUR (`app.reglage_comptable`,
-- qui porte aussi le contrôle de droits) — jamais une seconde définition.
-- L'appelant retient, pour chaque pièce, la dernière ligne au plus tard le
-- jour de sa facture : le coût suit le nombre de décisions, pas de pièces.
--
-- REJEU (R11) : aucune horloge, aucune écriture.

begin;

create function app.historique_du_mois_de_tva(p_dossier uuid, p_reglage text)
returns table (du date, pack uuid, regle text)
language plpgsql
stable
security definer
set search_path = ''
rows 8
as $$
#variable_conflict use_column
begin
  -- Les mêmes droits que `app.reglage_comptable`, dits d'abord : même les
  -- seules DATES des décisions d'un dossier ne se lisent pas hors de lui.
  if p_dossier is null
     or not (p_dossier in (select app.member_orgs() union select app.engaged_orgs())
             or app.is_platform()) then
    raise exception 'refus.reglage_comptable.droits' using errcode = '42501';
  end if;
  return query
  with packs as (
    select jp.id, jp.effective_from
      from ref.jurisdiction_packs jp
      join identity.organizations o on o.jurisdiction = jp.jurisdiction
     where o.id = p_dossier
  ),
  jours as (
    select p.effective_from as du from packs p
    union
    select b.du
      from ref.socle_params s
      join packs p on p.id = s.pack_version_id
      cross join lateral (values (s.valid_from), (s.valid_to + 1)) b(du)
     where s.code = p_reglage and b.du is not null
    union
    -- Les jours d'effet des décisions pour le dossier ou pour son cabinet,
    -- lus au-delà de la RLS (le dirigeant ne voit pas les décisions du
    -- cabinet pour lui-même). Seulement des DATES : une date de trop ne
    -- change rien (la valeur vient du résolveur), d'où un filtre large, qui
    -- ne recopie pas la portée de `app.decisions_en_vigueur`.
    select r.valid_from
      from parametrage.reglages_comptables r
      join packs p on p.id = r.pack_version_id
     where r.code = p_reglage
       and r.portee_id in (p_dossier, app.cabinet_du_parametrage(p_dossier))
    union
    -- Les natures et leurs motifs : l'exigibilité d'un article en dépend.
    select b.du
      from ref.natures_de_vente n
      join packs p on p.id = n.pack_version_id
      cross join lateral (values (n.valid_from), (n.valid_to + 1)) b(du)
     where b.du is not null
    union
    select b.du
      from ref.motifs_de_nature_de_vente m
      join packs p on p.id = m.pack_version_id
      cross join lateral (values (m.valid_from), (m.valid_to + 1)) b(du)
     where b.du is not null
  )
  select j.du, x.pack,
         (select r.valeur from app.reglage_comptable(p_dossier, x.pack, j.du) r
           where r.code = p_reglage)
    from jours j
    cross join lateral (select app.pack_du_dossier(p_dossier, j.du) as pack) x
   where x.pack is not null
   order by j.du;
end
$$;

revoke all on function app.historique_du_mois_de_tva(uuid, text) from public, anon;
grant execute on function app.historique_du_mois_de_tva(uuid, text) to authenticated;

commit;
