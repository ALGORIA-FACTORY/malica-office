//! L'exonération TOTALE (zéro instance) exige que le HT porte son libellé, ou que les
//! lignes le ferment. Sans cela, sur une facture à deux tranches (0 % et 19 %) qui imprime
//! « 0,000 » et « exonérée », HT + droits = TTC fermait sur le « Total TTC » pris pour le HT
//! et le net pris pour le TTC : 100/B-15 (fictive), prouvée FAUSSE le 2 novembre 2026, sa
//! rangée « TVA 0 % » libellée « (exonérée) » — une mise en page courante, rien d'injecté.

mod commun;

use commun::jeux::{self, la_piece, par_variante};
use commun::*;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct SansVerite {}

/// Les repères de la mention en base (`20261105110000`), plus récents que l'instantané.
fn grille_en_base() -> (Value, Value) {
    let (mut g, p) = jeux::en_base();
    for c in g["champs"].as_array_mut().unwrap() {
        if c["code"] == "mention_suspension_exoneration" {
            c["reperes_fr"] = json!(["Vente en suspension de TVA", "Exonéré de TVA", "Exonération", "Article 11",
                                     "Suspension", "En suspension", "Exonéré", "Exonérée", "Exonérées", "Exonérés"]);
        }
    }
    (g, p)
}

/// 100/B-15 (couche de texte) : tranches 0 % (1 250,000) et 19 % (420,000 → 79,800), Total HT
/// 1 670,000, Total TTC 1 749,800, timbre 1,000, net 1 750,800 ; la rangée « TVA 0 % 0,000 »
/// libellée « % (exonérée) ».
fn b15_exoneree() -> Vec<Value> {
    let p = jeux::pieces::<SansVerite>().into_iter().find(|p| p.id == "100/B-15").expect("100/B-15");
    let mut j: Vec<Value> = p.jetons.iter().map(jeux::jeton).collect();
    let k = j.iter().position(|x| x["ordinal"] == 120 && x["texte"] == "%").expect("le « % » de la rangée TVA 0 %");
    j[k]["texte"] = json!("% (exonérée)");
    j
}

#[test]
fn deux_tranches_et_la_mention_ne_prouvent_pas_le_ttc_comme_ht() {
    let (g, p) = grille_en_base();
    let o = la_piece(&par_variante(&b15_exoneree(), &g, &p));
    // jamais prouvée avec un HT faux ; ici rien ne ferme de façon sûre : rendue à la chaîne
    if o["issue"] == "prouvee" {
        assert_eq!(o["champs"]["total_ht"]["valeur"], "1670000", "{o}");
    }
    assert_ne!(o["champs"]["total_ht"]["valeur"], "1749800", "{o}");
}

#[test]
fn le_refus_dit_sa_raison() {
    let (g, p) = grille_en_base();
    let outs = par_variante(&b15_exoneree(), &g, &p);
    assert!(
        outs.iter().any(|(_, o)| o["raison"] == "le total HT ne porte pas son libellé"),
        "{outs:?}"
    );
}

/// Une facture exonérée simple : mention, HT, « 0,000 », timbre, TTC.
fn exoneree(ht: &[Value]) -> Vec<Value> {
    let mut j = vec![jeton(0, "Exonéré de TVA - Article 11", 0.05, 0.40, &[])];
    j.extend_from_slice(ht);
    j.push(jeton(3, "TVA 0,000", 0.6, 0.64, &[(0, true)]));
    j.push(jeton(4, "Timbre 1,000", 0.6, 0.68, &[(1000, true)]));
    j.push(jeton(5, "Total TTC 501,000", 0.6, 0.72, &[(501000, true)]));
    j
}

#[test]
fn le_ht_libelle_en_plusieurs_jetons_reste_prouve() {
    let j = exoneree(&[
        jeton(10, "Total", 0.10, 0.60, &[]),
        jeton(11, "HT", 0.35, 0.60, &[]),
        jeton(1, "500,000", 0.60, 0.60, &[(500000, true)]),
    ]);
    let o = resoudre(j, grille_facture(), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(valeur(&o, "total_ht"), 500000);
}

#[test]
fn un_ht_sans_libelle_n_est_pas_prouve() {
    // le seul libellé à gauche du HT est celui du TTC, séparé par une autre valeur
    let j = exoneree(&[
        jeton(10, "Total TTC", 0.05, 0.60, &[]),
        jeton(12, "999,000", 0.30, 0.60, &[(999000, true)]),
        jeton(1, "500,000", 0.60, 0.60, &[(500000, true)]),
    ]);
    let o = resoudre(j, grille_facture(), pack_essai());
    assert_eq!(o["issue"], "aucune", "{o}");
    assert_eq!(o["raison"], "le total HT ne porte pas son libellé");
    assert_eq!(o["champs"]["total_ht"]["statut"], "signale");
}
