-- Un prénom salue, un nom facture, et ce ne sont pas le même champ.
--
-- ================================================================== POURQUOI
--
-- Relevé en service le 19 octobre 2026, sur un téléphone : l'accueil disait
-- « Bon après-midi. » — sans personne. Le commentaire de l'écran l'assumait :
-- « le salut, sans prénom : le compte n'en porte pas en base ».
--
-- C'était faux. `identity.profiles` porte `display_name` depuis le 24 août.
-- Ce qui manquait n'était pas la donnée, c'était le fil : le Socle n'expose
-- qu'un `Compte { id, email }`, et l'écran n'a donc jamais vu de nom.
--
-- Mais y brancher le salut aurait été une faute, et la base le dit elle-même.
-- `display_name` est le nom du DESTINATAIRE sur la facture — `facturation.
-- factures.destinataire_nom` s'en remplit, et l'émission refuse sans lui :
--
--     'le titulaire % n''a pas de nom (identity.profiles.display_name) :
--      une facture sans destinataire n''est pas une facture'
--
-- Saluer quelqu'un par son prénom et le nommer sur une facture sont deux
-- actes différents. « Bon après-midi Wissem » est juste ; une facture au nom
-- de « Wissem » est une mention légale fausse. Un seul champ ne peut pas
-- porter les deux sans que l'un des deux soit faux.
--
-- =========================================== DEUX CHAMPS, ET UN TROISIÈME DÉDUIT
--
-- `prenom` et `nom` s'écrivent ; `display_name` se COMPOSE des deux. C'est la
-- même règle que partout ici — ce qui se déduit ne se stocke pas deux fois —
-- et elle a une conséquence qui compte : la facturation ne bouge pas d'une
-- ligne. Les sept endroits qui lisent `display_name` continuent de lire ce
-- qu'ils lisaient, et il devient simplement juste.
--
-- L'ordre est « Prénom Nom » : c'est la forme commerciale française, celle
-- qu'une facture tunisienne porte pour une personne physique. L'ordre
-- administratif « NOM Prénom » appartient aux pièces d'identité, pas aux
-- factures. Le jour où il faudrait le retourner, c'est une ligne — c'est
-- précisément ce que la composition achète.
--
-- ===================================== CE QUI EXISTE DÉJÀ N'EST PAS ÉCRASÉ
--
-- Des profils portent un `display_name` saisi à l'inscription (`auth.ts` le
-- pose en créant le compte) sans qu'aucun `prenom` n'existe. Ces lignes-là
-- gardent leur nom tel quel : la composition ne s'applique QUE lorsque l'un
-- des deux nouveaux champs est renseigné. Sinon une migration effacerait le
-- destinataire de factures déjà émissibles, et l'émission se mettrait à
-- refuser pour des comptes qui marchaient hier.
--
-- ============================================================== REJEU (R11)
--
-- `add column if not exists`, `create or replace`, `drop trigger if exists`
-- avant `create trigger` : le fichier se rejoue sur une base déjà à jour sans
-- rien changer. Aucune date n'est calculée ici.

begin;

-- ------------------------------------------------------------ les deux champs
alter table identity.profiles add column if not exists prenom text;
alter table identity.profiles add column if not exists nom    text;

comment on column identity.profiles.prenom is
  'Le prénom, et il ne sert qu''à parler à la personne : le salut de '
  'l''accueil, une adresse directe. Jamais une mention légale.';

comment on column identity.profiles.nom is
  'Le nom de famille. Avec le prénom, il compose `display_name`, qui est le '
  'destinataire de la facture.';

comment on column identity.profiles.display_name is
  'Le nom porté par la facture (`facturation.factures.destinataire_nom`). Il '
  'se COMPOSE de `prenom` et `nom` dès que l''un des deux est renseigne ; les '
  'profils anterieurs, qui n''ont que lui, le gardent tel quel.';

-- ------------------------------------------- `display_name` se compose
create or replace function identity.nom_d_affichage_se_compose()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_compose text;
begin
  -- Tant que ni l'un ni l'autre n'est donné, on ne touche à RIEN : un profil
  -- ancien garde le nom qu'il porte, et sa facture reste émissible.
  if coalesce(btrim(new.prenom), '') = '' and coalesce(btrim(new.nom), '') = '' then
    return new;
  end if;

  v_compose := btrim(coalesce(btrim(new.prenom), '') || ' ' || coalesce(btrim(new.nom), ''));

  -- `btrim` sur la concaténation suffit : un seul des deux donné produit ce
  -- seul mot, sans espace pendant.
  new.display_name := nullif(v_compose, '');
  return new;
end;
$$;

comment on function identity.nom_d_affichage_se_compose() is
  'Le nom de facture se deduit du prenom et du nom. Ce qui se deduit ne se '
  'stocke pas deux fois, et la facturation continue de lire `display_name`.';

drop trigger if exists profiles_nom_compose on identity.profiles;
create trigger profiles_nom_compose
  before insert or update of prenom, nom on identity.profiles
  for each row execute function identity.nom_d_affichage_se_compose();

commit;
