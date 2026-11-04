//! La photo d'une facture MyTek (2 novembre 2026), réduite à ses totaux et à son tableau.
//!
//! Trois traits de la pièce, chacun une règle du moteur :
//! - « TOTAL HT: 428,731 » est imprimé timbre compris ; la base juste (427,731) est sous
//!   « Base TVA ». À un seul taux, la base imprimée porte le libellé du HT.
//! - le TTC « 510,000 » a été relevé « 810,000 » ; « Cinq Cent Dix Dinars » est écrit en
//!   toutes lettres. Quand rien ne ferme, les lettres donnent le total — et seulement lui.
//! - les prix sont imprimés TTC (« PU TTC 32,000 ») et les montants HT (« 26,891 ») : la
//!   ligne se prouve par q × PU TTC ÷ (1 + taux) = montant, quand la grille le déclare.

mod commun;

use commun::*;
use serde_json::{json, Value};

/// La grille d'essai, avec le montant en lettres et la preuve qui le relie au total.
fn grille(prix_ttc: bool) -> Value {
    let mut g = grille_facture();
    let champs = g["champs"].as_array_mut().unwrap();
    champs.push(json!({"code": "montant_en_lettres", "type": "texte", "reperes_fr": ["à la somme de"]}));
    champs.push(json!({"code": "designation", "type": "texte", "reperes_fr": ["Désignation"]}));
    champs.push(json!({"code": "quantite", "type": "nombre", "reperes_fr": ["Qté"]}));
    champs.push(json!({"code": "prix_unitaire_ht", "type": "montant", "reperes_fr": ["P.U. HT"]}));
    champs.push(json!({"code": "prix_unitaire_ttc", "type": "montant", "reperes_fr": ["PU TTC"]}));
    champs.push(json!({"code": "montant_ligne_ht", "type": "montant", "reperes_fr": ["Montant HT"]}));
    let preuves = g["preuves"].as_array_mut().unwrap();
    preuves.retain(|p| p["code"] != "lettres");
    preuves.push(json!({"code": "lettres", "expression": {"op": "lettres", "champ": "montant_en_lettres", "egal_a": ["total_ttc"]}}));
    let mut lignes = json!({"op": "lignes", "designation": "designation", "quantite": "quantite",
                            "prix": "prix_unitaire_ht", "montant": "montant_ligne_ht", "total": "total_ht"});
    if prix_ttc {
        lignes["prix_ttc"] = json!("prix_unitaire_ttc?");
    }
    preuves.push(json!({"code": "lignes", "expression": lignes}));
    g
}

/// Le pied de la facture : `ttc` relevé, et le montant en lettres s'il est lu.
fn pied(ttc: i64, lettres: Option<i64>) -> Vec<Value> {
    let mut j = vec![
        jeton(20, "TOTAL HT:", 0.05, 0.60, &[]),
        jeton(21, "Base TVA", 0.30, 0.60, &[]),
        jeton(22, "Montant TVA", 0.55, 0.60, &[]),
        jeton(23, "428,731", 0.05, 0.63, &[(428_731, true)]),
        jeton(24, "427,731", 0.30, 0.63, &[(427_731, true)]),
        jeton(25, "81,269", 0.55, 0.63, &[(81_269, true)]),
        jeton(26, "Timbre fiscal: 1,000", 0.80, 0.66, &[(1_000, true)]),
        jeton(27, "Total avec Timbre:428,731", 0.80, 0.69, &[(428_731, true)]),
        jeton(28, "TTC:", 0.80, 0.75, &[]),
        jeton(29, "810,000", 1.01, 0.75, &[(ttc, true)]),
        jeton(30, "Arrêtée la présente pièce à la somme de:", 0.05, 0.80, &[]),
        jeton(31, "Cinq", 0.26, 0.80, &[]),
        jeton(32, "Cent", 0.37, 0.80, &[]),
        jeton(33, "Dix", 0.48, 0.80, &[]),
        jeton(34, "Dinars.", 0.59, 0.80, &[]),
    ];
    if let Some(v) = lettres {
        j[11]["lettres"] = json!({"v": v, "fin": 34});
    }
    j
}

/// Le tableau : cinq lignes, PU TTC à 19 %, montants HT. `office` : le PU relevé de la
/// première ligne (349,000 imprimé).
fn tableau(office: i64) -> Vec<Value> {
    let rangee = |o: u32, y: f64, q: i64, pu: i64, m: i64| {
        vec![
            jeton(o, "Article", 0.05, y, &[]),
            jeton(o + 1, &q.to_string(), 0.30, y, &[(q * 1000, false)]),
            jeton(o + 2, "PU", 0.52, y, &[(pu, true)]),
            jeton(o + 3, "M", 0.74, y, &[(m, true)]),
            jeton(o + 4, "19", 0.96, y, &[]),
        ]
    };
    let mut j = vec![
        jeton(0, "Désignation", 0.05, 0.20, &[]),
        jeton(1, "Qté", 0.30, 0.20, &[]),
        jeton(2, "PU TTC", 0.52, 0.20, &[]),
        jeton(3, "Montant", 0.74, 0.20, &[]),
    ];
    j.extend(rangee(100, 0.24, 1, office, 293_276));
    j.extend(rangee(110, 0.28, 2, 32_000, 53_782));
    j.extend(rangee(120, 0.32, 1, 32_000, 26_891));
    j.extend(rangee(130, 0.36, 1, 32_000, 26_891));
    j.extend(rangee(140, 0.40, 1, 32_000, 26_891));
    j
}

fn ordinaux(o: &Value, champ: &str) -> Vec<u64> {
    o["champs"][champ]["refs"].as_array().unwrap().iter().map(|r| r["ordinal"].as_u64().unwrap()).collect()
}

#[test]
fn le_ttc_mal_releve_se_lit_dans_les_lettres() {
    let o = resoudre(pied(810_000, Some(510_000)), grille(false), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(o["par_lettres"], "total_ttc");
    assert_eq!(valeur(&o, "total_ttc"), 510_000);
    assert_eq!(ordinaux(&o, "total_ttc"), vec![31, 32, 33, 34], "le total cite toute la phrase en lettres");
    assert_eq!(valeur(&o, "total_ht"), 427_731, "la base juste, pas le « Total HT » timbre compris");
    assert_eq!(valeur(&o, "droit_timbre"), 1_000);
    assert_eq!(o["preuves"]["lettres"], "verifiee");
}

#[test]
fn sans_lettres_la_piece_reste_non_prouvee() {
    let o = resoudre(pied(810_000, None), grille(false), pack_essai());
    assert_ne!(o["issue"], "prouvee", "{o}");
    assert!(o.get("par_lettres").is_none());
}

#[test]
fn des_lettres_que_l_arithmetique_ne_ferme_pas_ne_donnent_rien() {
    let o = resoudre(pied(810_000, Some(600_000)), grille(false), pack_essai());
    assert_ne!(o["issue"], "prouvee", "{o}");
    assert!(o.get("par_lettres").is_none());
}

#[test]
fn un_ttc_bien_releve_se_prouve_sans_les_lettres() {
    let o = resoudre(pied(510_000, Some(510_000)), grille(false), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert!(o.get("par_lettres").is_none());
    assert_eq!(ordinaux(&o, "total_ttc"), vec![29]);
    assert_eq!(o["preuves"]["lettres"], "verifiee");
}

#[test]
fn les_prix_ttc_prouvent_les_lignes_quand_la_grille_les_declare() {
    let mut j = pied(510_000, Some(510_000));
    j.extend(tableau(349_000));
    let o = resoudre(j.clone(), grille(true), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    let l = &o["lignes"];
    assert_eq!(l["statut"], "prouve", "{l}");
    let inst = l["instances"].as_array().unwrap();
    assert_eq!(inst.len(), 5);
    assert_eq!(inst[1]["quantite"]["valeur"], "2000");
    assert_eq!(inst[1]["prix"]["valeur"], "32000");
    assert_eq!(inst[1]["prix_ttc"], true, "le prix lu est TTC");
    assert_eq!(inst[0]["montant"]["valeur"], "293276", "349 ÷ 1,19 = 293,277, imprimé 293,276 : au millime près");

    // Sans la déclaration, la grille ne lit que des prix HT : les lignes ne se prouvent pas.
    let o = resoudre(j, grille(false), pack_essai());
    assert_ne!(o["lignes"]["statut"], "prouve", "{}", o["lignes"]);
}

#[test]
fn un_prix_mal_releve_laisse_les_lignes_signalees_mais_pas_le_pied() {
    // 349,000 relevé 340,000 : la ligne ne ferme plus ; le pied, lui, se prouve.
    let mut j = pied(810_000, Some(510_000));
    j.extend(tableau(340_000));
    let o = resoudre(j, grille(true), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(valeur(&o, "total_ttc"), 510_000);
    assert_ne!(o["lignes"]["statut"], "prouve");
}

#[test]
fn le_libelle_de_la_base_ne_suffit_pas_sans_les_lettres() {
    // Le TTC bien relevé, mais aucune lettre lue : la base sous « Base TVA » ne tient pas
    // lieu du libellé du HT à elle seule. Les lignes, quand elles ferment, le font.
    let o = resoudre(pied(510_000, None), grille(true), pack_essai());
    assert_ne!(o["issue"], "prouvee", "{o}");
    assert_eq!(o["raison"], "le total HT ne porte pas son libellé");

    let mut j = pied(510_000, None);
    j.extend(tableau(349_000));
    let o = resoudre(j, grille(true), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(valeur(&o, "total_ht"), 427_731);
}

#[test]
fn un_prix_ttc_ne_ferme_qu_au_taux_imprime_sur_sa_rangee() {
    // 1 × 107,000 TTC = 100,000 HT à 7 % ; la rangée imprime « 19% » : ce n'est pas une lecture.
    let rangee = |taux: &str| {
        vec![
            jeton(0, "Désignation", 0.05, 0.20, &[]),
            jeton(1, "Qté", 0.30, 0.20, &[]),
            jeton(2, "PU TTC", 0.52, 0.20, &[]),
            jeton(3, "Montant", 0.74, 0.20, &[]),
            jeton(10, "Article", 0.05, 0.24, &[]),
            jeton(11, "1", 0.30, 0.24, &[(1000, false)]),
            jeton(12, "PU", 0.52, 0.24, &[(107_000, true)]),
            jeton(13, "M", 0.74, 0.24, &[(100_000, true)]),
            jeton(14, taux, 0.96, 0.24, &[]),
            jeton(20, "Total HT 100,000", 0.05, 0.60, &[(100_000, true)]),
            jeton(21, "TVA 7% 7,000", 0.05, 0.63, &[(7_000, true)]),
            jeton(22, "Total TTC 107,000", 0.05, 0.66, &[(107_000, true)]),
        ]
    };
    let lignes = |taux: &str| {
        let o = resoudre(rangee(taux), grille(true), pack_essai());
        o["lignes"].clone()
    };
    let au_bon_taux = lignes("7%");
    assert_eq!(au_bon_taux["statut"], "prouve", "{au_bon_taux}");
    assert_eq!(au_bon_taux["instances"][0]["prix_ttc"], true);
    let au_mauvais = lignes("19%");
    assert_ne!(au_mauvais["statut"], "prouve", "{au_mauvais}");
}
