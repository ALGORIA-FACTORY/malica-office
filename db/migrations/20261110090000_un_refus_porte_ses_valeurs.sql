-- Un refus porte ses valeurs (audit d'intégrité, 1er novembre 2026).
--
-- Un refus se dit par une CLÉ du dictionnaire (« refus.plan.compte_livre ») :
-- l'écran la dit dans la langue de la personne. Certains citent une valeur —
-- le compte, la date, le seuil —, qui ne se traduit pas : elle suit la clé,
-- encodée comme une requête d'URL, `refus.plan.compte_livre?compte=401`.
-- C'est la forme que l'API et l'écran relisent déjà (`refusAvecValeurs` et
-- `lireUnRefus`, `@malica/socle/refus-a-dire`) ; cette fonction en est le
-- miroir côté base, pour `raise exception '%', app.refus_avec_valeurs(…)`.
--
-- La valeur est ENCODÉE octet par octet (UTF-8, `%XX`) : un libellé de compte
-- qui porte « & », « = », « + » ou « % » couperait sinon la requête, et l'écran
-- citerait une valeur fausse. Les noms, eux, sont des littéraux du code
-- (`[a-z_]`) : ils passent tels quels. Une valeur absente se dit vide.
--
--   app.refus_avec_valeurs('refus.x', 'compte', '401', 'libelle', 'Fournisseurs & co')
--     → refus.x?compte=401&libelle=Fournisseurs%20%26%20co

begin;

create function app.refus_avec_valeurs(p_cle text, variadic p_valeurs text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_cle || coalesce('?' || string_agg(
           p_valeurs[i] || '=' || (
             select coalesce(string_agg(
                      case when o between 48 and 57 or o between 65 and 90
                                or o between 97 and 122 or o in (42, 45, 46, 95)
                           then chr(o)
                           else '%' || upper(lpad(to_hex(o), 2, '0')) end,
                      '' order by j), '')
               from generate_series(1, octet_length(coalesce(p_valeurs[i + 1], ''))) as j,
                    get_byte(convert_to(coalesce(p_valeurs[i + 1], ''), 'UTF8'), j - 1) as o),
           '&' order by i), '')
    from generate_series(1, coalesce(array_length(p_valeurs, 1), 0), 2) as i
$$;

comment on function app.refus_avec_valeurs(text, text[]) is
  'La clé d''un refus et les valeurs qu''il cite, encodées comme une requête d''URL (lireUnRefus).';

commit;
