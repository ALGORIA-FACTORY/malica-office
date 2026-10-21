-- Un siège se lit par son adresse, jamais par son identifiant.
--
-- Recette du 21 octobre 2026 : sans nom d'usage, les réglages de la PME
-- montraient l'identifiant technique du membre (un uuid). Le dirigeant ne
-- reconnaît personne à son uuid ; il reconnaît une adresse.
--
-- L'adresse passe par `app.email_du_membre`, qui ne rend que l'adresse d'un
-- membre partageant une organisation avec l'appelant : la vue n'ouvre pas
-- `auth.users`. La colonne s'ajoute EN FIN de vue (`create or replace view`
-- n'accepte que cela) ; les droits accordés sur la vue restent.
create or replace view public.licence_sieges_v with (security_invoker = true) as
select
  m.user_id,
  p.display_name as nom,
  m.role,
  m.tenant_id,
  o.name         as organisation,
  app.email_du_membre(m.user_id) as email
from facturation.licences l
join facturation.licence_organisations lo on lo.licence_id = l.id
join identity.memberships m               on m.tenant_id = lo.tenant_id
join identity.organizations o             on o.id = m.tenant_id
left join identity.profiles p             on p.user_id = m.user_id
where l.titulaire = auth.uid();

comment on view public.licence_sieges_v is
  'Les membres de toutes les organisations de la licence dont l''appelant est '
  'titulaire, avec leur adresse (par `app.email_du_membre`). Le dirigeant y '
  'figure (il n''occupe pas de place) ; la place se lit dans '
  '`mon_forfait().sieges_occupes`.';
