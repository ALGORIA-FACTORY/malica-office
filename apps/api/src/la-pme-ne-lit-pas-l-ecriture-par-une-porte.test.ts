/**
 * « La PME ne voit jamais les écritures » (lot S2), éprouvée par les deux
 * chemins que la revue indépendante du 6 novembre 2026 a trouvés ouverts,
 * dans un dossier confié à un cabinet engagé :
 *
 * 1. `fait_consigner` lit l'objet « sous la RLS de l'appelant » ; mais la
 *    porte appartient au portier, et la politique `*_sel_porte` lui rend
 *    l'écriture du cabinet. Le propriétaire de la PME consigne donc un fait
 *    `reglement.qualifie` sur l'écriture d'achat du cabinet (qui n'est pas un
 *    règlement), apprend qu'elle existe, puis relit ce fait (exception
 *    `reglement.%` du journal d'audit).
 *
 * 2. `socle_totaux_par_classe` se dit « par mois », mais prend des bornes
 *    libres : borné à un seul jour, il rend le débit et le crédit, classe par
 *    classe, des écritures de CE jour — l'écriture elle-même dès qu'elle est
 *    seule ce jour-là.
 *
 *   node --experimental-strip-types --test src/la-pme-ne-lit-pas-l-ecriture-par-une-porte.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { office } from "./depots/office.ts";

describe(
  "la PME ne lit pas l'écriture du cabinet par une porte",
  { skip: !BASE_CONFIGUREE },
  () => {
    let s: SocieteDEssai;

    before(async () => {
      s = await monterUneSociete(`porte-s2-${Date.now()}`);
    });

    after(async () => {
      try {
        await s?.fermer();
      } finally {
        await fermerLePool();
      }
    });

    const chezLeComptable = async () => {
      const id = await s.deposer("sami", "entite");
      await s.lire("sami", id);
      await s.fait("sami", "collab.envoyer", id);
      await s.fait("amel", "collab.envoyer", id);
      return id;
    };

    it("le propriétaire ne consigne pas un fait sur l'écriture d'achat du cabinet", async () => {
      const ecriture = await s.priseEnCharge(await chezLeComptable());
      for (const qui of ["amel", "bilel", "sami"] as const) {
        await assert.rejects(
          sousIdentiteDuServeur(s.gens[qui].id, (db) =>
            db.query(`select public.fait_consigner('reglement.qualifie', $1, '{}'::jsonb)`, [
              ecriture,
            ]),
          ),
          /refus\./,
          `${qui} : la porte trouve une écriture qu'il ne voit pas`,
        );
      }
    });

    /*
     * L'inventaire des portes du portier qui prennent une écriture en argument
     * (lot S2, après la revue) : aucune ne trouve, pour une personne de la PME,
     * l'écriture que le cabinet a inscrite. Le portier ne lit au-delà de son
     * appelant que ce que celui-ci a écrit (`20261205092700`).
     */
    it("aucune porte de la PME ne trouve l'écriture du cabinet", async () => {
      const ecriture = await s.priseEnCharge(await chezLeComptable());
      const motif = Object.values(s.motifs)[0]!;
      const portes: Array<[string, string, unknown[]]> = [
        ["book", "select public.socle_ecriture_book($1)", [ecriture]],
        ["contre_passer", "select public.socle_ecriture_contre_passer($1, $2)", [ecriture, motif]],
        [
          "review",
          "select public.socle_ecriture_review($1, 'retourne', $2, 'x')",
          [ecriture, motif],
        ],
        [
          "fait_consigner · forcee",
          "select public.fait_consigner('ecriture.forcee', $1, '{}'::jsonb)",
          [ecriture],
        ],
      ];
      for (const qui of ["amel", "bilel", "sami", "sonia"] as const)
        for (const [nom, sql, args] of portes)
          await assert.rejects(
            sousIdentiteDuServeur(s.gens[qui].id, (db) => db.query(sql, args)),
            /refus\.|permission denied|42501/,
            `${qui} · ${nom}`,
          );
      // L'écriture n'a pas bougé : inscrite, ni contre-passée ni revue.
      const { rows } = await s.admin.query<{ status: string; n: string }>(
        `select e.status, (select count(*) from socle.ecritures r where r.reverses_id = e.id)::text as n
           from socle.ecritures e where e.id = $1`,
        [ecriture],
      );
      assert.deepEqual(rows[0], { status: "booked", n: "0" });
    });

    it("les totaux par classe ne se bornent pas à un jour", async () => {
      // Le 2 octobre, par la fixture ; la seconde reprend ses comptes et sa
      // devise, au 20 octobre et pour moitié.
      const premiere = await s.priseEnCharge(await chezLeComptable());
      const { rows: modele } = await s.admin.query<{
        journal: string;
        devise: string;
        account_code: string;
        tax_code: string | null;
        debit: string;
        credit: string;
      }>(
        `select e.journal, e.devise, l.account_code, l.tax_code,
              (l.debit / 2)::text as debit, (l.credit / 2)::text as credit
         from socle.ecritures e join socle.ecriture_lignes l on l.ecriture_id = e.id
        where e.id = $1 order by l.ordinal`,
        [premiere],
      );
      const autre = await chezLeComptable();
      await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
        db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [autre]),
      );
      const e = await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
        office.propose(db, {
          pieceId: autre,
          journal: modele[0]!.journal,
          date: "2026-10-20",
          libelle: "Seconde facture",
          packVersionId: s.pack,
          devise: modele[0]!.devise,
          lignes: modele.map((l) => ({
            account_code: l.account_code,
            libelle: "Ligne",
            debit: l.debit,
            credit: l.credit,
            tax_code: l.tax_code,
          })),
        }),
      );
      await sousIdentiteDuServeur(s.gens.expert.id, (db) => office.book(db, e));

      const totaux = (du: string, au: string) =>
        s.fait("amel", "office.totauxParClasse", s.pme, du, au);
      const mois = await totaux("2026-10-01", "2026-10-31");
      let jour: unknown;
      try {
        jour = await totaux("2026-10-20", "2026-10-20");
      } catch {
        return; // refuser des bornes qui ne sont pas des mois suffit
      }
      assert.deepEqual(
        jour,
        mois,
        "un jour seul isole les montants de l'écriture de ce jour, classe par classe",
      );
    });
  },
);
