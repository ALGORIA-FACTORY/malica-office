//! L'exonération PARTIELLE (`groupe_taux.exoneration_partielle`), sur la pièce qui l'a
//! demandée : 50/14 (fictive), deux billets d'avion exonérés à 0 % et des frais de
//! service à 19 % — Total HT 3 370,000, « TVA 19 % (base 80,000) » 15,200, timbre
//! 1,000, TTC 3 386,200 ; « Le transport aérien international est exonéré de TVA ».
//!
//! Exigences :
//! - prouvée juste, la part exonérée (3 290,000) établie par les lignes, et rendue comme
//!   une instance de la ventilation sous le taux nul que la grille désigne (`taux_exonere`) ;
//! - sans `taux_exonere`, la ventilation est incomplète : elle est signalée, pas affirmée,
//!   et la pièce n'est pas prouvée ;
//! - la clé absente, rien ne change : la pièce n'est pas prouvée ;
//! - jamais sans les lignes, ni sans la mention, ni quand une cellule ne ferme pas.

mod commun;

use commun::jeux::{self, la_piece, par_variante};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct SansVerite {}

const ID: &str = "50/14";

/// Le plan de 50/14 (couche de texte, recollage, treillis de production).
fn plan() -> Vec<Value> {
    let p = jeux::pieces::<SansVerite>()
        .into_iter()
        .find(|p| p.id == ID)
        .expect("50/14 dans le jeu");
    p.jetons.iter().map(jeux::jeton).collect()
}

/// La grille de la base, avec ou sans la preuve des lignes, et P03 avec ou sans la clé
/// (qui nomme alors la part exonérée par le taux nul EXO du pack).
fn contexte(lignes: bool, partielle: bool) -> (Value, Value) {
    let (mut g, mut p) = jeux::en_base();
    p["taux_nuls"] = json!({"tva": ["EXO", "EXPORT"]});
    // L'instantané est antérieur aux repères de la mention en base (`20261105110000` :
    // « Exonéré », « Exonérée »…) ; la pièce imprime « exonéré de TVA. », en trois jetons.
    for c in g["champs"].as_array_mut().unwrap() {
        if c["code"] == "mention_suspension_exoneration" {
            c["reperes_fr"] = json!([
                "Vente en suspension de TVA",
                "Exonéré de TVA",
                "Exonération",
                "Article 11",
                "Suspension",
                "En suspension",
                "Exonéré",
                "Exonérée",
                "Exonérées",
                "Exonérés"
            ]);
        }
    }
    let preuves = g["preuves"].as_array_mut().unwrap();
    for x in preuves.iter_mut() {
        if x["code"] == "P03" && partielle {
            x["expression"]["exoneration_partielle"] = json!(true);
            x["expression"]["taux_exonere"] = json!("EXO");
        }
    }
    if lignes {
        preuves.push(jeux::preuve_lignes("L01"));
    }
    (g, p)
}

fn jouer(jetons: &[Value], lignes: bool, partielle: bool) -> Value {
    let (g, p) = contexte(lignes, partielle);
    la_piece(&par_variante(jetons, &g, &p))
}

/// L'indice du jeton dont le texte est `t` (le premier, ou le `n`-ième).
fn indice(jetons: &[Value], t: &str, n: usize) -> usize {
    jetons
        .iter()
        .enumerate()
        .filter(|(_, j)| j["texte"] == t)
        .nth(n)
        .map(|(i, _)| i)
        .unwrap_or_else(|| panic!("jeton « {t} »"))
}

fn valeur<'a>(o: &'a Value, champ: &str) -> &'a str {
    o["champs"][champ]["valeur"].as_str().unwrap_or("")
}

#[test]
fn prouvee_juste_par_les_lignes() {
    let o = jouer(&plan(), true, true);
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(valeur(&o, "total_ht"), "3370000");
    assert_eq!(valeur(&o, "total_ttc"), "3386200");
    assert_eq!(valeur(&o, "droit_timbre"), "1000");
    let tva = &o["champs"]["montant_tva_par_taux"]["instances"];
    assert_eq!(tva.as_array().unwrap().len(), 2, "{tva}");
    assert_eq!(tva[0]["taux"], "TVA19");
    assert_eq!(tva[0]["valeur"], "15200");
    assert_eq!(tva[1]["taux"], "EXO");
    assert_eq!(tva[1]["valeur"], "0");
    let bases = &o["champs"]["base_tva_par_taux"]["instances"];
    assert_eq!(bases[0]["valeur"], "80000");
    assert_eq!(bases[1]["taux"], "EXO");
    assert_eq!(bases[1]["valeur"], "3290000");
    assert_eq!(o["lignes"]["statut"], "prouve");
    assert_eq!(o["lignes"]["taux_par_base"], "verifiee");
    // la part exonérée : les lignes sans taux, 2 × 1 645,000
    let sans_taux: i64 = o["lignes"]["instances"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|l| l["taux"].is_null())
        .map(|l| {
            l["montant"]["valeur"]
                .as_str()
                .unwrap()
                .parse::<i64>()
                .unwrap()
        })
        .sum();
    assert_eq!(sans_taux, 3_290_000);
}

#[test]
fn sans_taux_exonere_la_ventilation_n_est_pas_affirmee() {
    let (mut g, p) = contexte(true, true);
    for x in g["preuves"].as_array_mut().unwrap() {
        if x["code"] == "P03" {
            x["expression"]
                .as_object_mut()
                .unwrap()
                .remove("taux_exonere");
        }
    }
    // la ventilation non affirmée, les lignes n'ont plus de base par taux à vérifier : la
    // part exonérée n'est pas établie, la pièce n'est pas prouvée…
    let o = la_piece(&par_variante(&sans_zero_pour_cent(plan()), &g, &p));
    assert_ne!(o["issue"], "prouvee", "{o}");
    assert_eq!(o["champs"]["base_tva_par_taux"]["statut"], "signale");
    assert_eq!(o["champs"]["montant_tva_par_taux"]["statut"], "signale");
    // … sauf quand le taux nul est imprimé : la part se prouve, son code se tait
    let o = la_piece(&par_variante(&plan(), &g, &p));
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(o["champs"]["base_tva_par_taux"]["statut"], "signale");
}

#[test]
fn un_taux_exonere_hors_des_taux_nuls_est_refuse() {
    let (mut g, p) = contexte(true, true);
    for x in g["preuves"].as_array_mut().unwrap() {
        if x["code"] == "P03" {
            x["expression"]["taux_exonere"] = json!("TVA19");
        }
    }
    assert_ne!(la_piece(&par_variante(&plan(), &g, &p))["issue"], "prouvee");
}

#[test]
fn la_cle_absente_rien_ne_change() {
    assert_ne!(jouer(&plan(), true, false)["issue"], "prouvee");
}

#[test]
fn jamais_sans_les_lignes() {
    let o = jouer(&plan(), false, true);
    assert_eq!(o["issue"], "aucune", "{o}");
    assert_eq!(
        o["raison"],
        "exonération partielle non confirmée par les lignes"
    );
    assert_eq!(o["champs"]["total_ht"]["statut"], "signale");
    assert_eq!(o["preuves"]["P03"], "non_fermee");
}

/// Le plan sans aucun taux nul imprimé : les « % » qui suivent un « 0 » sont effacés.
fn sans_zero_pour_cent(mut j: Vec<Value>) -> Vec<Value> {
    for k in 1..j.len() {
        if j[k]["texte"] == "%" && j[k - 1]["texte"] == "0" {
            j[k]["texte"] = json!("");
        }
    }
    j
}

#[test]
fn sans_mention_le_taux_nul_imprime_prouve_la_part_et_tait_son_code() {
    // Décision du dirigeant (5 novembre 2026) : une ventilation qui imprime son taux nul
    // (« 0 % ») établit la part exonérée, que les lignes confirment ; sans mention, son
    // code (EXO ou EXPORT) n'est pas affirmé.
    let mut j = plan();
    let k = indice(&j, "exonéré", 0);
    j[k]["texte"] = json!("soumis");
    let o = jouer(&j, true, true);
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(valeur(&o, "total_ht"), "3370000");
    assert_eq!(o["champs"]["base_tva_par_taux"]["statut"], "signale");
    assert_eq!(o["champs"]["montant_tva_par_taux"]["statut"], "signale");
}

#[test]
fn jamais_sans_la_mention_ni_le_taux_nul() {
    let mut j = sans_zero_pour_cent(plan());
    let k = indice(&j, "exonéré", 0);
    j[k]["texte"] = json!("soumis");
    assert_ne!(jouer(&j, true, true)["issue"], "prouvee");
}

#[test]
fn une_ligne_qui_ne_ferme_pas_ne_prouve_rien() {
    // un billet lu 1 646,000 dans sa colonne montant : Σ lignes ≠ total HT
    let mut j = plan();
    let k = indice(&j, "1 645,000", 3);
    j[k]["texte"] = json!("1 646,000");
    j[k]["montants"] = json!([{"v": 1_646_000, "forte": true}]);
    assert_ne!(jouer(&j, true, true)["issue"], "prouvee");
}

#[test]
fn un_taux_de_ligne_perdu_ne_prouve_rien() {
    // le « 19 » des frais de service illisible : Σ lignes à 19 % ≠ base imprimée
    let mut j = plan();
    let k = indice(&j, "19", 0);
    j[k]["texte"] = json!("x");
    j[k]["montants"] = json!([]);
    assert_ne!(jouer(&j, true, true)["issue"], "prouvee");
}

#[test]
fn la_cle_sans_mention_declaree_n_est_pas_traduite() {
    let (mut g, p) = contexte(true, true);
    for x in g["preuves"].as_array_mut().unwrap() {
        if x["code"] == "P03" {
            x["expression"]
                .as_object_mut()
                .unwrap()
                .remove("exoneration");
        }
    }
    assert_ne!(la_piece(&par_variante(&plan(), &g, &p))["issue"], "prouvee");
}

/// La grille avec la mention d'export, qui nomme EXPORT (`autres_exonerations`).
fn jouer_avec_l_export(jetons: &[Value]) -> Value {
    let (mut g, p) = contexte(true, true);
    let champs = g["champs"].as_array_mut().unwrap();
    if let Some(c) = champs.iter_mut().find(|c| c["code"] == "mention_export") {
        c["reperes_fr"] = json!(["Export", "Exportation", "En suspension"]);
    } else {
        let mut c = champs
            .iter()
            .find(|c| c["code"] == "mention_suspension_exoneration")
            .expect("mention")
            .clone();
        c["code"] = json!("mention_export");
        c["reperes_fr"] = json!(["Export", "Exportation", "En suspension"]);
        champs.push(c);
    }
    for x in g["preuves"].as_array_mut().unwrap() {
        if x["code"] == "P03" {
            x["expression"]["autres_exonerations"] = json!({"mention_export": "EXPORT"});
        }
    }
    la_piece(&par_variante(jetons, &g, &p))
}

#[test]
fn le_taux_nul_suit_la_mention_imprimee() {
    // Décision du dirigeant (5 novembre 2026) : « exonéré » → EXO ; « export »,
    // « exportation », « en suspension » → EXPORT.
    let o = jouer_avec_l_export(&plan());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(
        o["champs"]["base_tva_par_taux"]["instances"][1]["taux"],
        "EXO"
    );
    // la même pièce, sous la mention d'export
    let mut j = plan();
    let k = indice(&j, "exonéré", 0);
    j[k]["texte"] = json!("Exportation");
    let o = jouer_avec_l_export(&j);
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(
        o["champs"]["base_tva_par_taux"]["instances"][1]["taux"],
        "EXPORT"
    );
    // les deux mentions imprimées : la part exonérée n'est pas nommée
    let mut j = plan();
    let mut export = j[k].clone();
    export["ordinal"] = json!(9002);
    export["texte"] = json!("Exportation");
    export["y0"] = json!(0.98);
    export["y1"] = json!(0.99);
    j.push(export);
    let o = jouer_avec_l_export(&j);
    assert_eq!(o["champs"]["base_tva_par_taux"]["statut"], "signale", "{o}");
}
