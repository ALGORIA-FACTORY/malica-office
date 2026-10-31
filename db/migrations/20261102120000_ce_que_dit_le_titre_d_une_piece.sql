-- Ce que le titre imprimé d'une pièce dit de sa nature vit en table
-- (30 octobre 2026, revue de la PR 144).
--
-- ========================================================== LE CONSTAT
--
-- Le contrôle de la nature (`apps/api/src/scan/controles.ts`) portait sa
-- propre liste de titres, écrite en TypeScript : proforma, devis, bon de
-- livraison, bon de commande. Elle ne connaissait pas l'AVOIR. Une pièce
-- titrée « AVOIR », aux montants imprimés en positif, se proposait donc comme
-- un ACHAT — au débit ce qui va au crédit —, alors que `ref.document_types`
-- porte le type `avoir` (porte_ecriture = false) et que rien ne le lisait.
--
-- ========================================================== LA RÈGLE
--
-- Un titre reconnu dit la nature de la pièce, et le refus qui va avec. Une
-- ligne nomme le motif du titre (expression régulière de JavaScript, lue sans
-- casse par le contrôle), le type
-- de `ref.document_types` quand il existe, le statut du contrôle (« rejet » :
-- ce n'est pas une pièce comptable ; « anomalie » : c'en est une, que le
-- cabinet saisit), et la phrase du refus, où « {titre} » est le titre lu.
--
-- Les écritures d'un avoir ne sont pas encore conçues : il ne se propose pas,
-- il se dit, et le cabinet le saisit. Jamais en achat.

create table ref.titres_de_piece (
  motif         text primary key check (length(btrim(motif)) > 0),
  document_type text references ref.document_types (code),
  statut        text not null check (statut in ('rejet', 'anomalie')),
  refus         text not null check (length(btrim(refus)) > 0),
  rang          smallint not null unique
);

comment on table ref.titres_de_piece is
  'Ce que le titre imprimé d''une pièce dit de sa nature, et le refus qui va avec : '
  'une pièce qui n''est pas comptable, ou un avoir que le cabinet saisit.';

insert into ref.titres_de_piece (motif, document_type, statut, refus, rang) values
  ('pro\s*-?\s*forma', null, 'rejet',
   'Le document est une facture proforma (titre « {titre} ») : ce n''est pas une pièce comptable, il ne se comptabilise pas.', 1),
  ('\bdevis\b', null, 'rejet',
   'Le document est un devis (titre « {titre} ») : ce n''est pas une pièce comptable, il ne se comptabilise pas.', 2),
  ('bon\s+de\s+livraison', 'bon_livraison', 'rejet',
   'Le document est un bon de livraison (titre « {titre} ») : ce n''est pas une pièce comptable, il ne se comptabilise pas.', 3),
  ('bon\s+de\s+commande', null, 'rejet',
   'Le document est un bon de commande (titre « {titre} ») : ce n''est pas une pièce comptable, il ne se comptabilise pas.', 4),
  ('\bavoir\b', 'avoir', 'anomalie',
   'Avoir : à saisir par le cabinet (titre « {titre} »).', 5);

alter table ref.titres_de_piece enable row level security;
alter table ref.titres_de_piece force row level security;
revoke all on table ref.titres_de_piece from public, anon;
grant select on table ref.titres_de_piece to authenticated;
create policy ref_titres_de_piece_sel on ref.titres_de_piece
  for select to authenticated using (true);
