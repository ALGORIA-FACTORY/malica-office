-- Flouci rejoint les prestataires de paiement en ligne (16 novembre 2026).
--
-- Une ligne, pas du code : l'adaptateur `flouci` de l'API (paiement/
-- prestataires.ts) parle à son API ; la tour le choisit comme les autres
-- (`plateforme.paiement_regler`) et y règle l'adresse de son API
-- (https://developers.flouci.com : la même pour le bac à sable et la
-- production, seules les clés changent). Ses deux clés restent dans
-- l'environnement du serveur (FLOUCI_CLE_PUBLIQUE, FLOUCI_CLE_PRIVEE).
--
-- Flouci accepte les cartes Visa et Mastercard ; sa page propose aussi le
-- portefeuille Flouci. Le portefeuille comme moyen distinct, avec son logo,
-- viendra avec son fichier (public/paiement/) : un moyen sans logo ne s'inscrit
-- pas (`moyens_paiement.logo not null`). Sa page n'a pas de langue réglable :
-- `langue` reste vide. Pas de logo de prestataire non plus, pour la même raison
-- que le moyen : la page dit « Paiement sécurisé par Flouci » en toutes lettres.

insert into facturation.prestataires_paiement
  (code, adaptateur, ouvre_le_paiement, fait_entrer_argent, exige_url_api, langue, logo,
   moyen_encaissement_defaut, rang)
values
  ('flouci', 'flouci', true, true, true, null, null, 'carte',
   (select max(rang) + 1 from facturation.prestataires_paiement));

insert into facturation.moyens_par_prestataire (prestataire, moyen) values
  ('flouci', 'visa'),
  ('flouci', 'mastercard');

insert into ref.labels (ns, key, locale, value) values
  ('prestataire_paiement', 'flouci', 'fr', 'Flouci'),
  ('prestataire_paiement', 'flouci', 'en', 'Flouci'),
  ('prestataire_paiement', 'flouci', 'ar', 'فلوسي');

-- --- Les devises qu'un prestataire traite ------------------------------------
--
-- Flouci ne traite que le dinar. Ce n'est pas au code de le dire (R4 : aucun
-- code devise en TypeScript) : une ligne par prestataire et par devise, et la
-- base refuse le moyen avant que l'API ne demande un lien. Les prestataires
-- déjà inscrits gardent ce qu'ils admettaient : toutes les devises du
-- référentiel.

create table facturation.devises_par_prestataire (
  prestataire text not null references facturation.prestataires_paiement (code),
  devise      text not null references ref.devises (code),
  primary key (prestataire, devise)
);

comment on table facturation.devises_par_prestataire is
  'Les devises qu''un prestataire de paiement en ligne traite. Sans ligne, aucune.';

alter table facturation.devises_par_prestataire enable row level security;
revoke all on table facturation.devises_par_prestataire from public, anon;
grant select on table facturation.devises_par_prestataire to authenticated;
create policy devises_par_prestataire_lire on facturation.devises_par_prestataire
  for select to authenticated using (true);

insert into facturation.devises_par_prestataire (prestataire, devise)
select p.code, d.code
  from facturation.prestataires_paiement p
 cross join ref.devises d
 where p.ouvre_le_paiement and p.code <> 'flouci';

insert into facturation.devises_par_prestataire (prestataire, devise) values
  ('flouci', 'TND');

-- La règle d'admission lit désormais aussi la devise : un moyen que ce
-- prestataire accepte, dans une devise qu'il ne traite pas, n'est pas payable
-- ici — même refus que pour un moyen indisponible.
CREATE OR REPLACE FUNCTION public.paiement_moyen_admis(p_moyen text, p_prestataire text, p_devise text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v jsonb;
begin
  if not facturation.moyen_admis(p_moyen, p_prestataire) then
    raise exception 'paiement.moyen_indisponible' using errcode = 'check_violation';
  end if;
  select jsonb_build_object('iso_numerique', d.iso_numerique, 'exposant', d.exposant) into v
    from ref.devises d where d.code = p_devise;
  if v is null then
    raise exception '%', app.refus_avec_valeurs('refus.referentiel.devise_inconnue', 'devise', (p_devise)::text) using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from facturation.devises_par_prestataire dp
                  where dp.prestataire = p_prestataire and dp.devise = p_devise) then
    raise exception 'paiement.moyen_indisponible' using errcode = 'check_violation';
  end if;
  return v;
end
$function$;
