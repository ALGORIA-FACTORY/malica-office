//! Une lecture SUBSTITUÉE (« 1 » ↔ « 7 », la faute d'OCR la plus fréquente — diagnostic
//! du 8 novembre 2026) n'est qu'une hypothèse de plus, faible, et seulement pour un jeton
//! que le pack dit incertain. L'arithmétique de la pièce la choisit ; la lecture seule,
//! jamais.
mod commun;

use commun::{grille_facture, jeton, pack_essai, resoudre, valeur};
use serde_json::{json, Value};

/// La facture du diagnostic : le timbre « 1,000 » lu « 7,000 » par l'OCR, et le TTC
/// imprimé juste. Avec « 7,000 » seul, rien ne ferme ; la substitution « 1,000 » ferme.
fn piece(timbre_lu: &[(i64, bool, bool)], confiance_du_timbre: f64) -> Vec<Value> {
    vec![
        jeton(0, "Total HT 1 000,000", 0.6, 0.60, &[(1_000_000, true)]),
        jeton(1, "TVA 19% 190,000", 0.6, 0.64, &[(190_000, true)]),
        json!({"page": 1, "ordinal": 2, "texte": "Timbre fiscal 7,000", "x0": 0.6, "y0": 0.68,
               "x1": 0.8, "y1": 0.70, "date": null, "confiance": confiance_du_timbre,
               "montants": timbre_lu.iter()
                   .map(|(v, f, s)| json!({"v": v, "forte": f, "substituee": s}))
                   .collect::<Vec<_>>()}),
        jeton(3, "Total TTC 1 191,000", 0.6, 0.72, &[(1_191_000, true)]),
    ]
}

fn pack(confiance_du_texte: f64) -> Value {
    let mut p = pack_essai();
    p["confiance_du_texte"] = json!(confiance_du_texte);
    p
}

#[test]
fn une_substitution_sur_un_jeton_incertain_ferme_la_piece() {
    // Le timbre lu à 0,55, sous la confiance du texte (0,80) : la lecture « 1,000 » est admise.
    let o = resoudre(
        piece(&[(7_000, true, false), (1_000, false, true)], 0.55),
        grille_facture(),
        pack(0.80),
    );
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(valeur(&o, "droit_timbre"), 1_000, "{o}");
    assert_eq!(valeur(&o, "total_ttc"), 1_191_000);
}

#[test]
fn une_substitution_sur_un_jeton_sur_de_lui_est_ecartee() {
    // Le même timbre lu à 0,98 : l'OCR est sûr de son « 7 », la substitution ne compte pas.
    let o = resoudre(
        piece(&[(7_000, true, false), (1_000, false, true)], 0.98),
        grille_facture(),
        pack(0.80),
    );
    assert_ne!(o["issue"], "prouvee", "{o}");
}

#[test]
fn une_substitution_n_est_jamais_forte() {
    // Marquée forte par erreur par l'adaptateur, elle redevient faible : seule l'arithmétique
    // la retient, et face à la lecture imprimée « 7,000 » (forte) elle ne l'emporte que si
    // la pièce ferme par elle.
    let o = resoudre(
        piece(&[(7_000, true, false), (1_000, true, true)], 0.55),
        grille_facture(),
        pack(0.80),
    );
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(valeur(&o, "droit_timbre"), 1_000, "{o}");
}

#[test]
fn sans_seuil_dans_le_pack_rien_n_est_incertain_et_la_substitution_est_ecartee() {
    let o = resoudre(
        piece(&[(7_000, true, false), (1_000, false, true)], 0.55),
        grille_facture(),
        pack_essai(),
    );
    assert_ne!(o["issue"], "prouvee", "{o}");
}
