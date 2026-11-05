//! Les experts non-montant du moteur, sur une petite grille synthétique :
//! - la preuve `lettres` : le montant que l'adaptateur a lu en toutes lettres égale le total
//!   prouvé (`verifiee`), ou la pièce n'est plus prouvée mais SIGNALÉE (100/D-04) ; un avoir
//!   écrit ses lettres sans signe ;
//! - l'anneau 3 : un champ que nulle preuve ne lit, lu derrière son repère — `conforme` au
//!   mieux, `signale` si son libellé est collé dans le jeton (l'OCR y colle autre chose) ;
//!   une liste par son vocabulaire ; une présence seulement signalée ;
//! - deux matricules au même format ne s'attribuent pas sans l'anneau 2.

mod commun;

use commun::*;
use serde_json::{json, Value};

fn grille() -> Value {
    json!({
        "code": "facture",
        "champs": [
            {"code": "total_ht", "type": "montant", "reperes_fr": ["Total HT"], "expert": "montant", "parcelle": "Totaux"},
            {"code": "tva", "type": "montant", "reperes_fr": ["TVA"], "expert": "montant", "parcelle": "Totaux"},
            {"code": "total_ttc", "type": "montant", "reperes_fr": ["Total TTC"], "expert": "montant", "parcelle": "Totaux"},
            {"code": "en_lettres", "type": "texte", "reperes_fr": ["à la somme de"], "expert": "libelle", "parcelle": "Totaux"},
            {"code": "numero", "type": "identifiant", "reperes_fr": ["Facture N°", "N°"], "expert": "reference", "parcelle": "Références"},
            {"code": "devise", "type": "liste", "reperes_fr": ["DT", "TND", "USD"], "expert": "libelle", "parcelle": "Totaux",
             "valeurs": [{"code": "TND", "formes": ["TND", "DT", "Dinar"]}, {"code": "USD", "formes": ["USD", "$"]}]},
            // une liste sans domaine : son repère vu se signale, aucune valeur ne se rend
            {"code": "statut", "type": "liste", "reperes_fr": ["Statut"], "expert": "libelle", "parcelle": "En-tête"},
            {"code": "cachet", "type": "booleen", "reperes_fr": ["Cachet"], "expert": "presence", "parcelle": "Signature"},
            {"code": "mf_emetteur", "type": "identifiant", "reperes_fr": ["Matricule fiscal"], "format_code": "matricule_fiscal", "expert": "identifiant", "parcelle": "En-tête"},
            {"code": "mf_client", "type": "identifiant", "reperes_fr": ["Matricule fiscal"], "format_code": "matricule_fiscal", "expert": "identifiant", "parcelle": "Client"}
        ],
        "preuves": [
            {"code": "T", "expression": {"op": "taux", "montant": "tva", "base": "total_ht", "bareme": "tva"}},
            {"code": "S", "expression": {"op": "somme", "total": "total_ttc", "parties": ["total_ht", "tva"]}},
            {"code": "L", "expression": {"op": "lettres", "champ": "en_lettres", "egal_a": ["total_ttc"]}}
        ]
    })
}

/// Une facture de 1 000,000 HT à 19 % : 1 190,000 TTC, signée « en lettres » de `lettres`.
fn facture(signe: i64, lettres: Option<i64>) -> Vec<Value> {
    let mut j = vec![
        jeton(0, "Total HT", 0.5, 0.50, &[]),
        jeton(1, "1000,000", 0.75, 0.50, &[(signe * 1_000_000, true)]),
        jeton(2, "TVA", 0.5, 0.53, &[]),
        jeton(3, "190,000", 0.75, 0.53, &[(signe * 190_000, true)]),
        jeton(4, "Total TTC", 0.5, 0.56, &[]),
        jeton(5, "1190,000", 0.75, 0.56, &[(signe * 1_190_000, true)]),
        jeton(6, "Mille cent quatre-vingt-dix dinars", 0.1, 0.62, &[]),
    ];
    if let Some(v) = lettres {
        j[6]["lettres"] = json!({"v": v, "fin": 6});
    }
    j
}

#[test]
fn les_lettres_qui_valent_le_total_le_prouvent() {
    let o = resoudre(facture(1, Some(1_190_000)), grille(), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(o["preuves"]["L"], "verifiee");
    assert_eq!(o["champs"]["en_lettres"]["statut"], "prouve");
    assert_eq!(
        o["champs"]["en_lettres"]["refs"],
        json!([{"page": 1, "ordinal": 6}])
    );
}

#[test]
fn les_lettres_qui_contredisent_les_chiffres_signalent_la_piece() {
    let o = resoudre(facture(1, Some(3_200_000)), grille(), pack_essai());
    assert_eq!(o["issue"], "signalee", "{o}");
    assert_eq!(o["preuves"]["L"], "echec");
    assert_eq!(o["champs"]["total_ttc"]["statut"], "signale");
    // les valeurs restent citées : la pièce se vérifie, elle ne se perd pas
    assert_eq!(valeur(&o, "total_ttc"), 1_190_000);
    assert_eq!(o["champs"]["en_lettres"]["valeur"], "3200000");
}

#[test]
fn sans_lettres_lues_rien_ne_change() {
    let o = resoudre(facture(1, None), grille(), pack_essai());
    assert_eq!(o["issue"], "prouvee");
    assert_eq!(o["preuves"]["L"], "non_evaluable");
}

#[test]
fn un_avoir_ecrit_ses_lettres_sans_signe() {
    let o = resoudre(facture(-1, Some(1_190_000)), grille(), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(o["preuves"]["L"], "verifiee");
}

#[test]
fn l_anneau_3_lit_derriere_le_repere_et_signale_le_libelle_colle() {
    let mut j = facture(1, None);
    j.push(jeton(7, "Facture N°", 0.05, 0.05, &[]));
    j.push(jeton(8, "FA-2026-001", 0.26, 0.05, &[]));
    j.push(jeton(9, "DT", 0.97, 0.56, &[]));
    j.push(jeton(10, "Cachet", 0.6, 0.90, &[]));
    let o = resoudre(j.clone(), grille(), pack_essai());
    assert_eq!(o["champs"]["numero"]["valeur"], "FA-2026-001", "{o}");
    assert_eq!(o["champs"]["numero"]["statut"], "conforme");
    // une liste à domaine rend un CODE de son domaine, jamais le mot imprimé
    assert_eq!(o["champs"]["devise"]["valeur"], "TND");
    assert_eq!(o["champs"]["devise"]["statut"], "conforme");
    // un cachet ne se constate pas dans un texte : son repère le signale
    assert_eq!(o["champs"]["cachet"]["statut"], "signale");
    assert!(o["champs"]["cachet"]["valeur"].is_null());

    // le libellé collé dans le jeton : une valeur qui a la forme d'une référence est
    // conforme (banc du 5 novembre 2026) ; ce que l'OCR y colle de plus la garde signalée
    let mut colle = facture(1, None);
    colle.push(jeton(7, "N°FA-2026-001", 0.05, 0.05, &[]));
    let o = resoudre(colle, grille(), pack_essai());
    assert_eq!(o["champs"]["numero"]["valeur"], "FA-2026-001", "{o}");
    assert_eq!(o["champs"]["numero"]["statut"], "conforme");
    let mut colle = facture(1, None);
    colle.push(jeton(7, "N°FA-2026-001juin", 0.05, 0.05, &[]));
    let o = resoudre(colle, grille(), pack_essai());
    assert_eq!(o["champs"]["numero"]["statut"], "signale", "{o}");

    // une liste sans domaine : « Statut » imprimé n'est pas une valeur
    let mut st = facture(1, None);
    st.push(jeton(7, "Statut", 0.05, 0.05, &[]));
    st.push(jeton(8, ":", 0.12, 0.05, &[]));
    st.push(jeton(9, "active", 0.14, 0.05, &[]));
    let o = resoudre(st, grille(), pack_essai());
    assert!(o["champs"]["statut"]["valeur"].is_null(), "{o}");
    assert_eq!(o["champs"]["statut"]["statut"], "signale");

    // deux devises imprimées : signalée
    j.push(jeton(11, "(USD)", 0.6, 0.70, &[]));
    let o = resoudre(j, grille(), pack_essai());
    assert_eq!(o["champs"]["devise"]["statut"], "signale");
}

#[test]
fn deux_matricules_au_meme_format_ne_s_attribuent_pas_sans_l_anneau_2() {
    let mut j = facture(1, None);
    j.push(jeton(
        7,
        "Matricule fiscal : 1876543W/A/M/000",
        0.05,
        0.10,
        &[],
    ));
    let o = resoudre(j, grille(), pack_essai());
    // le seul matricule lu peut être celui du client : il n'est l'émetteur de personne
    assert_eq!(o["champs"]["mf_emetteur"]["statut"], "signale", "{o}");
    assert_eq!(o["champs"]["mf_client"]["statut"], "signale");
}
