//! La preuve PARTIELLE d'une facture : son noyau — total HT, TVA par taux, total TTC hors
//! timbre — peut fermer alors qu'un autre montant de la pièce est faux ou illisible.
//!
//! 10 novembre 2026, facture manuscrite sur le staging (pièce ca4ab8f3) : le net à payer
//! « 17851,000 » relevé « 17851,200 ». Le HT, la TVA à 19 % et le TTC tenaient ensemble ;
//! les deux variantes de la grille exigent le net à payer ou le TTC timbre compris, et
//! refusaient donc tout. La variante « noyau » ne demande que ce qui se prouve.
//!
//! Elle vient de la base (preuve M05 de la grille facture, `partielle`) ; elle ne dit
//! rien de la pièce entière : l'adaptateur garde la pièce « à vérifier » (décision du
//! dirigeant, 10 novembre 2026). Exigences :
//! - le noyau ferme sur la pièce du 10 novembre, et n'affirme pas le net à payer ;
//! - une TVA qui ne tient à aucun taux du pack ne ferme rien ;
//! - sur les deux jeux du dirigeant, aucun noyau prouvé ne contredit la pièce.

mod commun;

use commun::donnees;
use commun::jeux::{en_base, en_base_avec_les_preuves_partielles, jeton, la_piece, par_variante, Piece};
use serde::Deserialize;
use serde_json::{json, Value};

/// La grille de la base avec le noyau (`avec`), et la même sans lui (`grille`) : ce que le
/// moteur jouait avant la preuve partielle. Le noyau est la preuve que la base dit partielle,
/// jamais un nom écrit ici.
fn grilles() -> (Value, Value, Value) {
    let (avec, pack) = en_base_avec_les_preuves_partielles();
    let (grille, _) = en_base();
    (grille, avec, pack)
}

fn ligne(ordinal: u32, texte: &str, y: f64, montants: &[(i64, bool)]) -> Value {
    let ms: Vec<Value> = montants
        .iter()
        .map(|(v, f)| json!({"v": v, "forte": f}))
        .collect();
    json!({"page": 1, "ordinal": ordinal, "texte": texte, "x0": 0.6, "y0": y, "x1": 0.8,
           "y1": y + 0.02, "montants": ms, "date": null})
}

/// Le pied de la facture du 10 novembre : le HT et le timbre lus, la TVA en lecture faible,
/// le TTC lu, et le net à payer relevé faux.
fn pied(tva: &[(i64, bool)]) -> Vec<Value> {
    vec![
        ligne(0, "Total HT 15000,000", 0.60, &[(15_000_000, true)]),
        ligne(1, "TVA 19 % 2850,000", 0.64, tva),
        ligne(2, "Total TTC 17850,000", 0.68, &[(17_850_000, true)]),
        ligne(3, "Timbre fiscal 1,000", 0.72, &[(1_000, true)]),
        ligne(4, "NET À PAYER 17851,200", 0.76, &[(17_851_200, true)]),
    ]
}

fn le_noyau(jouees: &[(String, Value)]) -> &Value {
    &jouees.iter().find(|(v, _)| v == "noyau").unwrap().1
}

#[test]
fn le_noyau_ferme_quand_le_net_a_payer_est_faux() {
    let (grille, avec, pack) = grilles();
    let jetons = pied(&[(2_850_000, false)]);
    // Sans le noyau, rien ne ferme : le net à payer faux emporte toute la pièce.
    assert_ne!(
        la_piece(&par_variante(&jetons, &grille, &pack))["issue"],
        "prouvee"
    );
    let jouees = par_variante(&jetons, &avec, &pack);
    let o = le_noyau(&jouees);
    assert_eq!(o["issue"], "prouvee", "{o}");
    let c = &o["champs"];
    assert_eq!(c["total_ht"]["valeur"], "15000000");
    assert_eq!(c["total_ttc"]["valeur"], "17850000");
    assert_eq!(c["droit_timbre"]["valeur"], "1000");
    let tva = &c["montant_tva_par_taux"]["instances"][0];
    assert_eq!(tva["taux"], "TVA19", "{o}");
    assert_eq!(tva["valeur"], "2850000");
    // Chaque valeur cite son jeton (R2), et le net à payer faux n'est pas affirmé.
    assert_eq!(tva["refs"], json!([{"page": 1, "ordinal": 1}]));
    assert_ne!(c["net_a_payer"]["statut"], "prouve", "{o}");
    // Les variantes entières, elles, ne ferment toujours pas.
    for (v, o) in &jouees {
        assert!(v == "noyau" || o["issue"] != "prouvee", "{v} : {o}");
    }
}

#[test]
fn une_tva_qui_ne_tient_a_aucun_taux_ne_ferme_rien() {
    let (_, avec, pack) = grilles();
    // 2 860,000 n'est 7, 13 ni 19 % de 15 000,000, et ne ferme pas le TTC.
    let jouees = par_variante(&pied(&[(2_860_000, true)]), &avec, &pack);
    assert_ne!(le_noyau(&jouees)["issue"], "prouvee");
}

#[derive(Deserialize)]
struct LigneVraie {
    montant_ht: f64,
}

#[derive(Deserialize)]
struct Verite {
    lignes: Option<Vec<LigneVraie>>,
}

/// Les pièces que seul le noyau prouve, et celles dont le HT prouvé contredit la pièce : le
/// HT est la somme des lignes vraies, ou cette somme moins une remise que la pièce imprime.
fn gagnees_et_contredites(fichier: &str) -> (usize, Vec<String>) {
    let pieces: Vec<Piece<Verite>> = serde_json::from_str(&donnees(fichier)).unwrap();
    let (grille, avec, pack) = grilles();
    let mut gagnees = 0;
    let mut contredites = vec![];
    for p in &pieces {
        let jetons: Vec<Value> = p.jetons.iter().map(jeton).collect();
        if la_piece(&par_variante(&jetons, &grille, &pack))["issue"] == "prouvee" {
            continue;
        }
        let jouees = par_variante(&jetons, &avec, &pack);
        let o = le_noyau(&jouees);
        if o["issue"] != "prouvee" {
            continue;
        }
        gagnees += 1;
        let Some(lignes) = &p.verite.lignes else {
            continue;
        };
        let somme: i64 = lignes
            .iter()
            .map(|l| (l.montant_ht * 1000.0).round() as i64)
            .sum();
        let ht: i64 = o["champs"]["total_ht"]["valeur"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        let remise_imprimee = p
            .jetons
            .iter()
            .flat_map(|j| j.7.iter())
            .any(|(v, _)| *v < 0 && somme + v == ht);
        if ht != somme && !remise_imprimee {
            contredites.push(format!("{} : HT prouvé {ht}, lignes {somme}", p.id));
        }
    }
    (gagnees, contredites)
}

#[test]
fn sur_les_jeux_du_dirigeant_aucun_noyau_ne_contredit_la_piece() {
    for fichier in ["jeux_dirigeant_jetons.json", "jeux_dirigeant_ocr.json"] {
        let (gagnees, contredites) = gagnees_et_contredites(fichier);
        assert!(contredites.is_empty(), "{fichier} : {contredites:?}");
        // Mesuré le 10 novembre 2026 : 12 pièces sur la couche de texte, 14 sur l'OCR.
        assert!(gagnees >= 10, "{fichier} : {gagnees} pièces gagnées");
    }
}
