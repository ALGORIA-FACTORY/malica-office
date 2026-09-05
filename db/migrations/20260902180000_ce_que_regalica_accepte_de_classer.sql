-- ============================================================================
-- Ce que Regalica accepte de classer, et ce qu'elle refuse de comptabiliser.
-- ============================================================================
--
-- CE QUI SE PASSAIT AVANT
--
-- Le type d'un document n'existait nulle part. `capture.pieces` porte l'origine
-- (photo, PDF), le nombre de pages, l'empreinte — jamais la NATURE de ce qui a
-- été photographié.
--
-- Le mot `document_kind` n'apparaissait qu'à l'autre bout de la chaîne, dans
-- les correspondances comptables, avec deux valeurs :
--
--     check (document_kind = any (array['facture_achat', 'facture_vente']))
--
-- et l'API comblait le vide par un défaut :
--
--     [input.packId, input.documentKind ?? 'facture_achat']
--
-- Conséquence : un procès-verbal d'assemblée, un brouillon, la photo d'un
-- paysage — tout devenait une facture d'achat, et cherchait un compte de
-- charge. Rien, dans la base, ne pouvait s'y opposer.
--
-- ============================================ CE QUE CETTE MIGRATION ÉTABLIT
--
-- Trois choses, et le verrou est la troisième :
--
--   1. `ref.document_types` — le vocabulaire. Quels documents existent, à
--      quelle famille ils appartiennent, et ce que chacun autorise.
--
--   2. `capture.pieces.document_kind` — chaque pièce porte son type, et l'état
--      de ce type : à déterminer, à confirmer, confirmé.
--
--   3. Le verrou dans `socle.assert_bookable()` — une écriture ne PEUT PAS
--      être comptabilisée si la pièce n'est pas d'un type qui porte écriture,
--      ou si son type n'est pas confirmé.
--
-- Le verrou est en base et non dans le code : R6. Un écran qui oublie la règle,
-- un appel RPC direct, une reprise de données — aucun ne peut passer outre.
--
-- ==================================== DEUX DÉCISIONS, ET CE QUI LES A TRANCHÉES
--
-- « Que faire d'un document jugé inutile ? »
--
--   On l'ENREGISTRE, et on le classe `non_comptable`. Rien ne se perd : un
--   document mal jugé reste dans le coffre, visible, rattrapable. Il ne part
--   pas au cabinet et ne devient jamais une écriture.
--
--   Le refus pur et simple avait été écarté : un classement automatique qui se
--   trompe ferait disparaître une pièce que le client croyait déposée, et il ne
--   le découvrirait qu'au contrôle.
--
-- « Que faire quand Regalica hésite ? »
--
--   Elle DEMANDE. Le type reste `a_confirmer`, et le verrou empêche toute
--   écriture jusqu'à la réponse. C'est R2 : rien d'inventé — et ici, un type
--   deviné est un compte comptable faux.
--
-- ============================================== SUR LES FONDEMENTS, HONNÊTEMENT
--
-- `ref.regimes_fiscaux` cite, pour chaque catégorie, le paramètre fiscal déjà
-- en base qui l'atteste. Ce niveau d'exigence est tenu ici pour ce qui est
-- vraiment une règle de droit, et il ne l'est PAS pour le reste :
--
--   — `facture_achat` et `facture_vente` sont attestés en base : ce sont les
--     deux seules valeurs que `ref.account_mappings` accepte aujourd'hui, avec
--     leurs comptes.
--
--   — `carte_identification_fiscale` est attestée par le référentiel, cité
--     mot pour mot dans la migration de la fiche fiscale (Article 52-I-a).
--
--   — pour TOUS LES AUTRES, le fondement nomme le code qui régit le document,
--     SANS numéro d'article. Nommer le Code des sociétés commerciales est
--     vérifiable ; inventer « article 128 » ne l'est pas, et dans un produit
--     fiscal une référence fausse est pire qu'une référence absente.
--
--   Ces fondements-là sont à affiner par l'expert, article par article. La
--   colonne est `not null` et non vide : aucun type ne peut entrer sans dire
--   d'où il vient.
--
-- ================================================== CE QUE CECI NE FAIT PAS
--
-- `porte_ecriture` n'est vrai que là où une correspondance comptable EXISTE —
-- les deux factures. Un bulletin de paie ou un relevé bancaire sont utiles au
-- comptable et lui sont transmis, mais Regalica ne prétend pas encore en tirer
-- une écriture. Le jour où `ref.account_mappings` en portera une, il suffira de
-- passer le drapeau à vrai : la règle est en données, pas en code.
-- ============================================================================

begin;

-- ------------------------------------------------------------ le vocabulaire

create table if not exists ref.document_types (
  code          text primary key,
  famille       text not null,
  libelle       text not null,
  fondement     text not null,

  -- Peut devenir une écriture comptable. Vrai seulement si une correspondance
  -- existe dans ref.account_mappings — sinon la promesse serait creuse.
  porte_ecriture boolean not null,
  -- Part au cabinet. Un document utile au comptable, même sans écriture.
  transmissible  boolean not null,

  rang          smallint not null,
  created_at    timestamptz not null default now(),

  constraint document_types_famille_check
    check (famille in ('comptable', 'fiscal_social', 'juridique', 'non_comptable')),
  constraint document_types_fondement_non_vide
    check (length(trim(fondement)) > 0),
  constraint document_types_libelle_non_vide
    check (length(trim(libelle)) > 0),
  -- Ce qui n'est pas comptable ne porte rien et ne part nulle part. La
  -- cohérence est dans la contrainte, pas dans la discipline de celui qui insère.
  constraint document_types_non_comptable_coherent
    check (famille <> 'non_comptable' or (porte_ecriture = false and transmissible = false)),
  -- Un type qui porte écriture est nécessairement transmissible.
  constraint document_types_ecriture_implique_transmission
    check (porte_ecriture = false or transmissible = true)
);

alter table ref.document_types enable row level security;
alter table ref.document_types force row level security;
drop policy if exists document_types_sel on ref.document_types;
create policy document_types_sel on ref.document_types for select to authenticated using (true);
grant select on ref.document_types to authenticated;

insert into ref.document_types (code, famille, libelle, fondement, porte_ecriture, transmissible, rang) values
  -- ---------------------------------------------------------- le quotidien
  ('facture_achat', 'comptable', 'Facture d''achat',
   'ref.account_mappings — seule valeur, avec facture_vente, que la table des correspondances comptables accepte',
   true, true, 10),
  ('facture_vente', 'comptable', 'Facture de vente',
   'ref.account_mappings — seule valeur, avec facture_achat, que la table des correspondances comptables accepte',
   true, true, 20),
  ('avoir', 'comptable', 'Avoir',
   'Code de la TVA — mentions de la facture rectificative. Article à préciser par l''expert.',
   false, true, 30),
  ('ticket_caisse', 'comptable', 'Ticket de caisse ou reçu',
   'Code de la TVA — pièce justificative de dépense. Article à préciser par l''expert.',
   false, true, 40),
  ('bon_livraison', 'comptable', 'Bon de livraison',
   'Code de commerce — document d''accompagnement de la marchandise. Article à préciser par l''expert.',
   false, true, 50),
  ('releve_bancaire', 'comptable', 'Relevé bancaire',
   'Code de commerce — relevé du compte tenu par l''établissement. Article à préciser par l''expert.',
   false, true, 60),
  ('note_frais', 'comptable', 'Note de frais',
   'Code de l''IRPP et de l''IS — justification des charges déductibles. Article à préciser par l''expert.',
   false, true, 70),

  -- ------------------------------------------------------ le fiscal et le social
  ('declaration_tva', 'fiscal_social', 'Déclaration de TVA',
   'Code de la TVA — déclaration mensuelle. Article à préciser par l''expert.',
   false, true, 110),
  ('declaration_impot', 'fiscal_social', 'Déclaration d''impôt',
   'Code de l''IRPP et de l''IS — déclaration annuelle. Article à préciser par l''expert.',
   false, true, 120),
  ('acompte_provisionnel', 'fiscal_social', 'Acompte provisionnel',
   'Code de l''IRPP et de l''IS — acomptes provisionnels. Article à préciser par l''expert.',
   false, true, 130),
  ('bulletin_paie', 'fiscal_social', 'Bulletin de paie',
   'Code du travail — bulletin remis au salarié. Article à préciser par l''expert.',
   false, true, 140),
  ('declaration_cnss', 'fiscal_social', 'Déclaration CNSS',
   'Régime de sécurité sociale — déclaration employeur. Texte à préciser par l''expert.',
   false, true, 150),
  ('carte_identification_fiscale', 'fiscal_social', 'Carte d''identification fiscale',
   'Article 52-I-a — RAS_HONORAIRES_REEL_CONDITION : la carte est la preuve du régime réel',
   false, true, 160),

  -- ------------------------------------------------------ le juridique
  ('pv_ago', 'juridique', 'PV d''assemblée générale ordinaire',
   'Code des sociétés commerciales — procès-verbal d''assemblée générale ordinaire. Article à préciser par l''expert.',
   false, true, 210),
  ('pv_age', 'juridique', 'PV d''assemblée générale extraordinaire',
   'Code des sociétés commerciales — procès-verbal d''assemblée générale extraordinaire. Article à préciser par l''expert.',
   false, true, 220),
  ('statuts', 'juridique', 'Statuts de la société',
   'Code des sociétés commerciales — statuts. Article à préciser par l''expert.',
   false, true, 230),
  ('extrait_rne', 'juridique', 'Extrait du registre national des entreprises',
   'Loi relative au registre national des entreprises — extrait. Texte à préciser par l''expert.',
   false, true, 240),
  ('contrat', 'juridique', 'Contrat',
   'Code des obligations et des contrats — convention entre les parties. Article à préciser par l''expert.',
   false, true, 250),
  ('bail', 'juridique', 'Bail',
   'Code des obligations et des contrats — louage de choses. Article à préciser par l''expert.',
   false, true, 260),

  -- ------------------------------------------------------ ce qui n'entre nulle part
  ('non_comptable', 'non_comptable', 'Document non comptable',
   'Aucun : c''est précisément la catégorie de ce qu''aucun texte ne rattache à la comptabilité du dossier.',
   false, false, 900)
on conflict (code) do nothing;

-- ------------------------------------------------------ la pièce porte son type

alter table capture.pieces
  add column if not exists document_kind text references ref.document_types(code),
  add column if not exists document_kind_statut text not null default 'a_determiner';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pieces_document_kind_statut_check'
  ) then
    alter table capture.pieces add constraint pieces_document_kind_statut_check
      check (document_kind_statut in ('a_determiner', 'a_confirmer', 'confirme'));
  end if;

  -- Un type confirmé suppose qu'il y ait un type. L'inverse est permis : on
  -- peut avoir lu « facture » sans en être sûr.
  if not exists (
    select 1 from pg_constraint where conname = 'pieces_document_kind_coherent'
  ) then
    alter table capture.pieces add constraint pieces_document_kind_coherent
      check (document_kind_statut = 'a_determiner' or document_kind is not null);
  end if;
end
$$;

comment on column capture.pieces.document_kind is
  'Le type lu par Regalica, ou choisi par l''utilisateur. Null tant qu''on ne sait pas.';
comment on column capture.pieces.document_kind_statut is
  'a_determiner : pas encore lue. a_confirmer : lue, mais Regalica n''est pas sûre. confirme : établi.';

create index if not exists pieces_document_kind_idx
  on capture.pieces (tenant_id, document_kind, document_kind_statut);

-- ---------------------------------------------------- la reprise de l'existant
--
-- Sans elle, le verrou poserait ce qu'il fallait éviter : une pièce DÉJÀ lue et
-- reconnue comme facture deviendrait incomptabilisable, faute d'un type qu'on
-- n'avait simplement jamais rangé au bon endroit.
--
-- Le type était déjà là, dans le résultat de lecture. On le remonte sur la
-- pièce, et seulement s'il fait partie du vocabulaire — rien n'est deviné, rien
-- n'est écrasé.
update capture.pieces p
   set document_kind = e.payload->>'document_kind',
       document_kind_statut = 'confirme'
  from capture.extractions e
 where e.piece_id = p.id
   and p.document_kind is null
   and e.payload->>'document_kind' in (select code from ref.document_types);

-- ------------------------------------------------------------------ le verrou

create or replace function socle.assert_bookable()
returns trigger
language plpgsql
security definer
set search_path = socle, identity, capture, ref, app, pg_catalog
as $$
declare
  v_debit  numeric(38,3);
  v_credit numeric(38,3);
  v_count  integer;
  v_mode   app.validation_mode_t;
  v_kind   text;
  v_statut text;
  v_porte  boolean;
begin
  if new.status = 'booked' and (old.status is distinct from 'booked') then
    select count(*), coalesce(sum(l.debit),0), coalesce(sum(l.credit),0)
      into v_count, v_debit, v_credit
      from socle.ecriture_lignes l where l.ecriture_id = new.id;

    if v_count = 0 then
      raise exception 'R5 : une ecriture sans ligne ne peut pas etre comptabilisee'
        using errcode = 'check_violation';
    end if;
    if v_debit <> v_credit then
      raise exception 'R5 : desequilibre debit=% credit=%', v_debit, v_credit
        using errcode = 'check_violation';
    end if;

    /*
     * Ce qui a été photographié doit être un document qui porte écriture, et
     * son type doit être ÉTABLI.
     *
     * Sans cela, un procès-verbal d'assemblée ou un brouillon devenait une
     * facture d'achat par simple valeur par défaut, et cherchait un compte de
     * charge. La règle est ici et non dans l'écran : un écran s'oublie.
     *
     * Une écriture sans pièce reste possible — une écriture d'à-nouveaux, une
     * régularisation. C'est le rattachement à une pièce qui est contrôlé, pas
     * son existence.
     */
    if new.piece_id is not null then
      select p.document_kind, p.document_kind_statut
        into v_kind, v_statut
        from capture.pieces p where p.id = new.piece_id;

      if v_statut is distinct from 'confirme' then
        raise exception 'R2 : le type de la piece n''est pas confirme (%), aucune ecriture ne peut en decouler',
          coalesce(v_statut, 'inconnu')
          using errcode = 'check_violation';
      end if;

      select t.porte_ecriture into v_porte
        from ref.document_types t where t.code = v_kind;

      if coalesce(v_porte, false) = false then
        raise exception 'R2 : un document de type % ne porte pas d''ecriture comptable',
          coalesce(v_kind, 'inconnu')
          using errcode = 'check_violation';
      end if;
    end if;

    select o.validation_mode into v_mode
      from identity.organizations o where o.id = new.tenant_id;
    new.booked_autonome := (v_mode = 'autonome');
  end if;

  if new.review_outcome is not null and new.reviewed_by is not null then
    select o.validation_mode into v_mode
      from identity.organizations o where o.id = new.tenant_id;
    if v_mode = 'mandate' and new.reviewed_by = new.booked_by then
      raise exception 'chk_ecr_4eyes : en mode mandat, le superviseur ne peut pas etre celui qui a comptabilise'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

revoke all on function socle.assert_bookable() from public;

commit;
