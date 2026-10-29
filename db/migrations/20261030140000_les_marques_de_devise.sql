-- Les marques de devise imprimées vivent en table (30 octobre 2026).
--
-- ========================================================== LE CONSTAT
--
-- Une facture tunisienne écrit « 1 234,560 D.T. », « 1 234,560 DT »,
-- « د.ت 1 234,560 » ou « 1 234,560 TND. ». Les deux lecteurs de montants ne
-- les reconnaissaient pas de la même façon :
--
--   - la normalisation du scan (`scan/normaliser-montants.ts`) portait une
--     liste de marques écrite en TypeScript (DT, TND, D.T, DINARS, د.ت) —
--     relevée comme constante en dur lors de la revue de #135 ;
--   - la lecture au plan de jetons (`malica/lecture/montants.ts`) effaçait
--     toute lettre comme une décoration, et le point d'une abréviation
--     restait collé au nombre : « 1 234,560 D.T. » se lisait 1 234 560 dinars,
--     mille fois trop.
--
-- ========================================================== LA RÈGLE
--
-- Une marque n'est retirée d'un montant que si le RÉFÉRENTIEL la connaît :
-- le code ISO 4217 de `ref.devises`, ou une ligne de cette table. Tout autre
-- mot à côté d'un nombre (« art. 9 », « N° 12. », « TVA 19 % ») en fait un
-- texte, pas un montant. Les deux lecteurs lisent cette même liste.
--
-- La comparaison ignore la casse, les points et les espaces : « D.T. » et
-- « DT. » désignent la même marque. Les formes sont pourtant écrites telles
-- qu'on les imprime, pour qu'un lecteur de cette table les reconnaisse.
--
-- Une marque ne dit pas quelle est la devise de la pièce — c'est la lecture
-- qui le dit — seulement qu'elle est une décoration du montant.

create table ref.devises_marques (
  marque text primary key check (length(btrim(marque)) > 0),
  devise text not null references ref.devises (code)
);

comment on table ref.devises_marques is
  'Les marques imprimées d''une devise, en plus de son code ISO 4217 : ce qu''un '
  'lecteur de montants retire comme décoration, et rien d''autre.';

insert into ref.devises_marques (marque, devise) values
  ('DT',     'TND'),
  ('DT.',    'TND'),
  ('D.T',    'TND'),
  ('D.T.',   'TND'),
  ('TND.',   'TND'),
  ('DINAR',  'TND'),
  ('DINARS', 'TND'),
  ('د.ت',    'TND'),
  ('د.ت.',   'TND'),
  ('€',      'EUR');

alter table ref.devises_marques enable row level security;
alter table ref.devises_marques force row level security;
revoke all on table ref.devises_marques from public, anon;
grant select on table ref.devises_marques to authenticated;
create policy ref_devises_marques_sel on ref.devises_marques
  for select to authenticated using (true);
