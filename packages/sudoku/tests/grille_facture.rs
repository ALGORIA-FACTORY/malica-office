//! La grille facture minimale (codes réels du catalogue, preuves dans le langage
//! du contrat) sur des pièces synthétiques construites ici : la forme de la sortie,
//! les citations, et chacune des règles héritées de la référence mesurée.

mod commun;

use commun::*;
use serde_json::{json, Value};

fn avec_date(mut j: Value, iso: &str) -> Value {
    j["date"] = json!(iso);
    j
}

fn refs(o: &Value, champ: &str) -> Vec<u64> {
    o["champs"][champ]["refs"].as_array().unwrap().iter().map(|r| r["ordinal"].as_u64().unwrap()).collect()
}

/// Un taux, FODEC et timbre : HT 1 000,000 ; FODEC 1 % = 10,000 ;
/// TVA 19 % sur HT majoré du FODEC = 191,900 ; timbre 1,000 ; TTC 1 202,900.
fn piece_fodec() -> Vec<Value> {
    vec![
        jeton(0, "Matricule fiscal : 1234567A/A/M/000", 0.05, 0.05, &[]),
        avec_date(jeton(1, "Tunis, le 05/04/2026", 0.6, 0.05, &[]), "2026-04-05"),
        jeton(2, "Qté 3", 0.05, 0.30, &[(3000, false)]),
        jeton(3, "PU 333,334", 0.30, 0.30, &[(333334, true)]),
        jeton(4, "Total HT 1 000,000", 0.6, 0.60, &[(1000000, true)]),
        jeton(5, "FODEC 10,000", 0.6, 0.63, &[(10000, true)]),
        jeton(6, "TVA 19% 191,900", 0.6, 0.66, &[(191900, true)]),
        jeton(7, "Timbre fiscal 1,000", 0.6, 0.69, &[(1000, true)]),
        jeton(8, "Total TTC 1 202,900", 0.6, 0.72, &[(1202900, true)]),
        avec_date(jeton(9, "Échéance 05/05/2026", 0.05, 0.85, &[]), "2026-05-05"),
    ]
}

#[test]
fn un_taux_fodec_et_timbre_prouves_et_cites() {
    let o = resoudre(piece_fodec(), grille_facture(), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(o["solutions"], 1);
    for (champ, v, ord) in [
        ("total_ht", 1000000, 4),
        ("montant_fodec", 10000, 5),
        ("droit_timbre", 1000, 7),
        ("total_ttc", 1202900, 8),
    ] {
        assert_eq!(valeur(&o, champ), v, "{champ}");
        assert_eq!(refs(&o, champ), vec![ord], "{champ}");
        assert_eq!(o["champs"][champ]["statut"], "prouve", "{champ}");
    }
    let tva = &o["champs"]["montant_tva_par_taux"]["instances"];
    assert_eq!(tva, &json!([{"taux": "TVA19", "valeur": "191900", "refs": [{"page": 1, "ordinal": 6}]}]));
    let base = &o["champs"]["base_tva_par_taux"]["instances"];
    assert_eq!(base, &json!([{"taux": "TVA19", "valeur": "1000000", "refs": [{"page": 1, "ordinal": 4}]}]));
    for p in ["ttc", "tva", "timbre", "fodec", "mf", "echeance"] {
        assert_eq!(o["preuves"][p], "verifiee", "preuve {p}");
    }
    assert_eq!(o["preuves"]["lettres"], "non_evaluable");
    assert_eq!(o["champs"]["matricule_fiscal_emetteur"]["valeur"], "1234567A/A/M/000");
    assert_eq!(o["champs"]["matricule_fiscal_emetteur"]["statut"], "conforme");
    assert_eq!(o["champs"]["date_emission"]["valeur"], "2026-04-05");
    assert_eq!(o["champs"]["date_echeance"]["valeur"], "2026-05-05");
}

/// Deux taux, bases imprimées, ni timbre ni FODEC.
fn piece_deux_taux(bases: bool, ttc: i64) -> Vec<Value> {
    let mut j = vec![
        jeton(0, "Total HT 1 000,000", 0.6, 0.60, &[(1000000, true)]),
        jeton(2, "TVA 7% 28,000", 0.6, 0.64, &[(28000, true)]),
        jeton(4, "TVA 19% 114,000", 0.6, 0.68, &[(114000, true)]),
        jeton(5, "Total TTC", 0.6, 0.72, &[(ttc, true)]),
    ];
    if bases {
        j.push(jeton(1, "Base 7% 400,000", 0.3, 0.64, &[(400000, true)]));
        j.push(jeton(3, "Base 19% 600,000", 0.3, 0.68, &[(600000, true)]));
    }
    j
}

#[test]
fn deux_taux_bases_imprimees() {
    let o = resoudre(piece_deux_taux(true, 1142000), grille_facture(), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(tva(&o), vec![(70, 28000), (190, 114000)]);
    let bases: Vec<&str> = o["champs"]["base_tva_par_taux"]["instances"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["valeur"].as_str().unwrap())
        .collect();
    assert_eq!(bases, vec!["400000", "600000"]);
    // ni repère ni montant imprimé : les champs facultatifs sont absents, leurs preuves non évaluables
    assert_eq!(o["champs"]["droit_timbre"]["statut"], "absent");
    assert_eq!(o["champs"]["montant_fodec"]["statut"], "absent");
    assert_eq!(o["preuves"]["timbre"], "non_evaluable");
    assert_eq!(o["preuves"]["fodec"], "non_evaluable");
    assert_eq!(o["preuves"]["ttc"], "verifiee");
}

#[test]
fn deux_taux_bases_deduites_non_citees() {
    let o = resoudre(piece_deux_taux(false, 1142000), grille_facture(), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(tva(&o), vec![(70, 28000), (190, 114000)]);
    // une base seulement déduite n'est jamais émise sans citation
    for i in o["champs"]["base_tva_par_taux"]["instances"].as_array().unwrap() {
        assert!(i["valeur"].is_null() && i["refs"].as_array().unwrap().is_empty());
    }
}

#[test]
fn un_chiffre_casse_signale() {
    let o = resoudre(piece_deux_taux(true, 1142001), grille_facture(), pack_essai());
    assert_eq!(o["issue"], "aucune");
    assert_eq!(o["champs"]["total_ttc"]["statut"], "signale");
    assert!(o["champs"]["total_ttc"]["valeur"].is_null());
    assert_eq!(o["preuves"]["ttc"], "non_fermee");
}

#[test]
fn charge_fixe_imprimee_ne_peut_pas_etre_ecartee() {
    // 1,000 imprimé (lecture forte), sans libellé : le timbre est présent, et le TTC
    // qui l'ignore ne ferme plus.
    let mut j = piece_deux_taux(true, 1142000);
    j.push(jeton(6, "1,000", 0.8, 0.70, &[(1000, true)]));
    assert_eq!(resoudre(j.clone(), grille_facture(), pack_essai())["issue"], "aucune");
    // avec le bon TTC, le timbre est prouvé
    j[3] = jeton(5, "Total TTC", 0.6, 0.72, &[(1143000, true)]);
    let o = resoudre(j, grille_facture(), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(valeur(&o, "droit_timbre"), 1000);
}

#[test]
fn repere_lu_sans_montant_imprime() {
    // le libellé du timbre est lu, son montant non : le timbre est exigé, rien ne ferme
    let mut j = piece_deux_taux(true, 1142000);
    j.push(jeton(6, "Timbre fiscal", 0.05, 0.70, &[]));
    assert_eq!(resoudre(j, grille_facture(), pack_essai())["issue"], "aucune");
}

#[test]
fn la_solution_forte_l_emporte_sur_la_faible() {
    // Une solution forte (HT 1 000,000 ; TVA 190,000 ; TTC 1 190,000) et une solution
    // entièrement faible (lectures entières) : la forte est prouvée, seule. Les deux HT
    // portent le même libellé (exigé de toute preuve), pour que l'arithmétique seule départage.
    let j = vec![
        jeton(0, "Total HT 1 000,000", 0.6, 0.60, &[(1000000, true)]),
        jeton(1, "190,000", 0.6, 0.64, &[(190000, true)]),
        jeton(2, "1 190,000", 0.6, 0.68, &[(1190000, true)]),
        jeton(3, "Total HT 2000", 0.1, 0.30, &[(2000000, false)]),
        jeton(4, "380", 0.2, 0.30, &[(380000, false)]),
        jeton(5, "2380", 0.3, 0.30, &[(2380000, false)]),
    ];
    let o = resoudre(j.clone(), grille_facture(), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(valeur(&o, "total_ht"), 1000000);
    // sans la solution forte, la faible reste seule et prouvée
    let o = resoudre(j[3..].to_vec(), grille_facture(), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(valeur(&o, "total_ht"), 2000000);
}

#[test]
fn deux_solutions_fortes_ambigue() {
    // Deux factures complètes sur la même page : deux affectations ferment, rien ne tranche.
    let j = vec![
        jeton(0, "1 000,000", 0.6, 0.60, &[(1000000, true)]),
        jeton(1, "190,000", 0.6, 0.64, &[(190000, true)]),
        jeton(2, "1 190,000", 0.6, 0.68, &[(1190000, true)]),
        jeton(3, "2 000,000", 0.1, 0.30, &[(2000000, true)]),
        jeton(4, "380,000", 0.2, 0.30, &[(380000, true)]),
        jeton(5, "2 380,000", 0.3, 0.30, &[(2380000, true)]),
    ];
    let o = resoudre(j, grille_facture(), pack_essai());
    assert_eq!(o["issue"], "ambigue", "{o}");
    assert_eq!(o["solutions"], 2);
    assert_eq!(o["champs"]["total_ht"]["statut"], "signale");
    assert!(o["champs"]["total_ht"]["valeur"].is_null());
}

#[test]
fn exoneration_seulement_avec_mention_et_zero_imprime() {
    let j = vec![
        jeton(0, "Exonéré de TVA - Article 11", 0.05, 0.40, &[]),
        jeton(1, "Total HT 500,000", 0.6, 0.60, &[(500000, true)]),
        jeton(2, "TVA 0,000", 0.6, 0.64, &[(0, true)]),
        jeton(3, "Timbre 1,000", 0.6, 0.68, &[(1000, true)]),
        jeton(4, "Total TTC 501,000", 0.6, 0.72, &[(501000, true)]),
    ];
    let o = resoudre(j.clone(), grille_facture(), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(o["champs"]["montant_tva_par_taux"]["valeur"], "0");
    assert_eq!(refs(&o, "montant_tva_par_taux"), vec![2]);
    // sans la mention : aucune
    assert_eq!(resoudre(j[1..].to_vec(), grille_facture(), pack_essai())["issue"], "aucune");
    // un zéro seulement faible : aucune
    let mut faible = j.clone();
    faible[2] = jeton(2, "TVA 0", 0.6, 0.64, &[(0, false)]);
    assert_eq!(resoudre(faible, grille_facture(), pack_essai())["issue"], "aucune");
}

#[test]
fn total_seul_exige_des_lectures_fortes() {
    // Grille d'essai (hors catalogue : le catalogue n'a pas de champ « total TVA »)
    // pour le mode « total seul » : seule la TVA totale est imprimée, avec les bases.
    let grille = json!({
        "champs": [
            {"code": "total_ht", "type": "montant", "reperes_fr": ["Total HT"]},
            {"code": "total_ttc", "type": "montant"},
            {"code": "total_tva", "type": "montant"},
            {"code": "base_tva_par_taux", "type": "montant"},
            {"code": "montant_tva_par_taux", "type": "montant"}
        ],
        "preuves": [
            {"code": "ttc", "expression": {"op": "somme", "total": "total_ttc", "parties": ["total_ht", "montant_tva_par_taux"]}},
            {"code": "tva", "expression": {"op": "groupe_taux", "base": "base_tva_par_taux", "montant": "montant_tva_par_taux",
                                           "total_base": "total_ht", "total_montant": "total_tva", "bareme": "tva"}}
        ]
    });
    let j = vec![
        jeton(0, "Total HT 1 000,000", 0.6, 0.60, &[(1000000, true)]),
        jeton(1, "Base 13% 400,000", 0.3, 0.64, &[(400000, true)]),
        jeton(2, "Base 19% 600,000", 0.3, 0.68, &[(600000, true)]),
        jeton(3, "Total TVA 166,000", 0.6, 0.72, &[(166000, true)]),
        jeton(4, "Total TTC 1 166,000", 0.6, 0.76, &[(1166000, true)]),
    ];
    let o = resoudre(j.clone(), grille.clone(), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(valeur(&o, "total_tva"), 166000);
    for i in o["champs"]["montant_tva_par_taux"]["instances"].as_array().unwrap() {
        assert!(i["valeur"].is_null(), "montant recalculé, jamais émis : {i}");
    }
    let mut faible = j;
    faible[1] = jeton(1, "400", 0.3, 0.64, &[(400000, false)]);
    assert_eq!(resoudre(faible, grille, pack_essai())["issue"], "aucune");
}

#[test]
fn plafond_de_combinaisons() {
    let mut e: Value = serde_json::from_str(&entree(piece_fodec(), grille_facture(), pack_essai())).unwrap();
    e["plafond"] = json!(1);
    let o: Value = serde_json::from_str(&malica_sudoku::solve(&e.to_string())).unwrap();
    assert_eq!(o["issue"], "aucune");
    assert!(o["raison"].as_str().unwrap().contains("plafond"), "{o}");
}

#[test]
fn entree_invalide_et_preuve_non_traduite() {
    let o: Value = serde_json::from_str(&malica_sudoku::solve("{")).unwrap();
    assert_eq!(o["issue"], "aucune");
    assert!(o["raison"].as_str().unwrap().starts_with("entrée invalide"));
    let mut g = grille_facture();
    g["preuves"].as_array_mut().unwrap().push(json!({"code": "inconnue", "expression": {"op": "racine", "x": "total_ht"}}));
    g["preuves"].as_array_mut().unwrap().push(json!({"code": "a_traduire", "statut": "a_traduire",
        "expression": {"op": "egal", "a": "total_ht", "b": "total_ttc"}}));
    let o = resoudre(piece_fodec(), g, pack_essai());
    assert_eq!(o["issue"], "prouvee");
    assert_eq!(o["preuves"]["inconnue"], "non_evaluable");
    assert_eq!(o["preuves"]["a_traduire"], "non_evaluable");
}

/// La pièce au FODEC, avec un timbre imprimé `timbre` et le TTC qui le compte.
fn piece_timbre(timbre: i64, texte: &str) -> Vec<Value> {
    piece_fodec()
        .into_iter()
        .map(|j| match j["ordinal"].as_u64() {
            Some(7) => jeton(7, &format!("Timbre fiscal {texte}"), 0.6, 0.69, &[(timbre, true)]),
            Some(8) => {
                let ttc = 1201900 + timbre;
                jeton(8, "Total TTC", 0.6, 0.72, &[(ttc, true)])
            }
            _ => j,
        })
        .collect()
}

/// Le pack d'essai dont le timbre admet aussi les tranches d'un barème (`montants_admis`).
fn pack_bareme() -> Value {
    let mut p = pack_essai();
    p["charges"][0]["montants_admis"] = json!([1000, 1500, 2000]);
    p
}

#[test]
fn un_timbre_du_bareme_est_reconnu_un_montant_hors_bareme_non() {
    // Un montant admis par le barème au jour de la pièce : prouvé, et cité.
    let o = resoudre(piece_timbre(2000, "2,000"), grille_facture(), pack_bareme());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(valeur(&o, "droit_timbre"), 2000);
    assert_eq!(o["preuves"]["timbre"], "verifiee");
    // Sans barème, le droit standard seul : la même pièce n'est pas prouvée.
    let o = resoudre(piece_timbre(2000, "2,000"), grille_facture(), pack_essai());
    assert_ne!(o["issue"], "prouvee", "{o}");
    // Un montant qu'aucun barème n'admet n'est jamais prouvé.
    let o = resoudre(piece_timbre(3000, "3,000"), grille_facture(), pack_bareme());
    assert_ne!(o["issue"], "prouvee", "{o}");
    // Le droit standard reste admis.
    let o = resoudre(piece_fodec(), grille_facture(), pack_bareme());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(valeur(&o, "droit_timbre"), 1000);
}

#[test]
fn la_charge_d_assiette_nomme_son_bareme_dans_la_preuve() {
    // Sans la clé « assiette », le FODEC ne majore aucune base : la preuve n'est pas
    // traduite, la TVA (calculée sur HT + FODEC) ne ferme plus, rien n'est prouvé.
    let mut g = grille_facture();
    for p in g["preuves"].as_array_mut().unwrap() {
        if p["code"] == "fodec" {
            p["expression"].as_object_mut().unwrap().remove("assiette");
        }
    }
    let o = resoudre(piece_fodec(), g.clone(), pack_essai());
    assert_ne!(o["issue"], "prouvee", "{o}");
    // Un barème qui n'existe pas au pack : non traduite non plus.
    for p in g["preuves"].as_array_mut().unwrap() {
        if p["code"] == "fodec" {
            p["expression"]["assiette"] = json!("inconnu");
        }
    }
    let o = resoudre(piece_fodec(), g, pack_essai());
    assert_ne!(o["issue"], "prouvee", "{o}");
}
