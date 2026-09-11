import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refuserLaBaseDeTravail } from "./garde-base-de-test.ts";

/**
 * Un test qui écrit dans la base de travail est un bug, pas une commodité.
 *
 * Avant ce garde, chaque `npm test` créait un compte et deux organisations
 * dans `malica_local`, puis les archivait (R7 interdit de les supprimer) :
 * 1 075 comptes `@essai.local` et 842 organisations archivées au 11 septembre
 * 2026. Une remise à zéro du métier ne valait rien tant que la prochaine
 * exécution des tests la repolluait.
 */
describe("la garde de la base de test", () => {
  const url = (base: string) => `postgres://malica_api:secret@localhost:5432/${base}`;

  it("refuse une DATABASE_URL qui désigne la base de travail", () => {
    assert.throws(
      () => refuserLaBaseDeTravail({ DATABASE_URL: url("malica_local") }),
      /malica_local/,
    );
  });

  it("refuse aussi l'URL d'administration, dont les tests se servent pour archiver", () => {
    assert.throws(
      () =>
        refuserLaBaseDeTravail({
          DATABASE_URL: url("malica_test"),
          DATABASE_URL_ADMIN: url("malica_local"),
        }),
      /DATABASE_URL_ADMIN/,
    );
  });

  it("dit comment réparer : la commande qui monte la base de test", () => {
    assert.throws(
      () => refuserLaBaseDeTravail({ DATABASE_URL: url("malica_local") }),
      /npm run base-de-test/,
    );
  });

  it("laisse passer la base de test du poste", () => {
    assert.doesNotThrow(() =>
      refuserLaBaseDeTravail({
        DATABASE_URL: url("malica_test"),
        DATABASE_URL_ADMIN: url("malica_test"),
      }),
    );
  });

  it("laisse passer la base jetable de la CI", () => {
    assert.doesNotThrow(() => refuserLaBaseDeTravail({ DATABASE_URL: url("malica") }));
  });

  it("laisse passer une exécution sans base : les tests de base se sautent alors d'eux-mêmes", () => {
    assert.doesNotThrow(() => refuserLaBaseDeTravail({}));
  });
});
