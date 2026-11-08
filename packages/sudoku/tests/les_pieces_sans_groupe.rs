//! Les pièces sans groupe de taux (ticket, bulletin de paie, relevé…) : ce que le moteur
//! exige d'elles pour les dire prouvées (banc sans IA du 8 novembre 2026).
//!
//! - le total d'une somme porte son libellé, ou la base de chaque taux porte le sien, ou le
//!   total est le plus grand montant de la pièce (50/05 : un article pris pour le TTC) ;
//! - le montant d'une rubrique se lit au bout de sa rangée, et un libellé de plusieurs mots
//!   rendus un par un annonce son champ (algoria-140) ;
//! - une somme dont les termes s'annulent deux à deux n'est pas une solution (algoria-136).

mod commun;

use commun::*;
use serde_json::{json, Value};

/// Une rangée de mots (un jeton par mot), puis ses montants, à partir de `x`.
fn rangee(o: &mut u32, y: f64, mots: &[&str], montants: &[(f64, i64)]) -> Vec<Value> {
    let mut v = Vec::new();
    for (k, m) in mots.iter().enumerate() {
        let mut j = jeton(*o, m, 0.02 + 0.07 * k as f64, y, &[]);
        j["x1"] = json!(0.02 + 0.07 * k as f64 + 0.06);
        v.push(j);
        *o += 1;
    }
    for (x, m) in montants {
        let mut j = jeton(*o, &format!("{m}"), *x, y, &[(*m, true)]);
        j["x1"] = json!(x + 0.1);
        v.push(j);
        *o += 1;
    }
    v
}

fn grille_ticket() -> Value {
    json!({
        "code": "ticket_caisse",
        "champs": [
            {"code": "total_ht", "type": "montant", "reperes_fr": ["Total HT", "Montant HT"]},
            {"code": "ventilation_tva", "type": "montant", "reperes_fr": ["Dont TVA", "TVA"]},
            {"code": "total_ttc", "type": "montant", "reperes_fr": ["TOTAL", "Total TTC", "À payer"]}
        ],
        "preuves": [
            {"code": "T01", "expression": {"op": "somme", "total": "total_ttc", "parties": ["total_ht", "ventilation_tva"]}},
            {"code": "T02", "expression": {"op": "taux", "montant": "ventilation_tva", "base": "total_ht", "bareme": "tva"}}
        ]
    })
}

#[test]
fn un_article_n_est_pas_le_total_d_un_ticket_a_deux_taux() {
    // 50/05 : « EAU 13.322 », « TVA 7 HT 12.450 0.872 », « TOTAL TTC 99.404 » ;
    // 12,450 × 7 % = 0,872 et 12,450 + 0,872 = 13,322 : une somme et un taux qui ferment.
    let mut o = 0;
    let mut j = Vec::new();
    j.extend(rangee(&mut o, 0.30, &["EAU", "MIN"], &[(0.6, 13322)]));
    j.extend(rangee(&mut o, 0.40, &["TOTAL", "TTC"], &[(0.6, 99404)]));
    j.extend(rangee(
        &mut o,
        0.50,
        &["A", "TVA", "HT"],
        &[(0.4, 72338), (0.6, 13744)],
    ));
    j.extend(rangee(
        &mut o,
        0.53,
        &["B", "TVA", "HT"],
        &[(0.4, 12450), (0.6, 872)],
    ));
    let s = resoudre(j, grille_ticket(), pack_essai());
    assert_ne!(s["issue"], "prouvee", "{s}");
    assert_ne!(s["champs"]["total_ttc"]["statut"], "prouve", "{s}");
}

#[test]
fn un_ticket_a_un_taux_se_prouve_par_son_total() {
    let mut o = 0;
    let mut j = Vec::new();
    j.extend(rangee(&mut o, 0.30, &["Article"], &[(0.6, 106935)]));
    j.extend(rangee(&mut o, 0.40, &["TOTAL", "TTC"], &[(0.6, 106935)]));
    j.extend(rangee(
        &mut o,
        0.50,
        &["TVA"],
        &[(0.4, 89861), (0.6, 17074)],
    ));
    let s = resoudre(j, grille_ticket(), pack_essai());
    assert_eq!(s["issue"], "prouvee", "{s}");
    assert_eq!(valeur(&s, "total_ttc"), 106935);
    assert_eq!(valeur(&s, "total_ht"), 89861);
    assert_eq!(valeur(&s, "ventilation_tva"), 17074);
}

fn grille_paie() -> Value {
    json!({
        "code": "bulletin_paie",
        "champs": [
            {"code": "salaire_base", "type": "montant", "reperes_fr": ["Salaire de base", "Base"]},
            {"code": "indemnite_transport", "type": "montant", "reperes_fr": ["Indemnité de transport"]},
            {"code": "indemnite_presence", "type": "montant", "reperes_fr": ["Indemnité de présence"]},
            {"code": "pret_employeur", "type": "montant", "reperes_fr": ["Prêt"]},
            {"code": "salaire_brut", "type": "montant", "reperes_fr": ["Salaire brut", "Brut"]},
            {"code": "retenue_cnss_salarie", "type": "montant", "reperes_fr": ["Cotisation CNSS"]},
            {"code": "retenue_irpp", "type": "montant", "reperes_fr": ["IRPP"]},
            {"code": "net_a_payer", "type": "montant", "reperes_fr": ["Net à payer"]}
        ],
        "preuves": [
            {"code": "P01a", "expression": {"op": "somme", "total": "salaire_brut",
              "parties": ["salaire_base", "indemnite_transport?", "indemnite_presence?"]}},
            {"code": "P03a", "expression": {"op": "somme", "total": "net_a_payer",
              "parties": ["salaire_brut", "-retenue_cnss_salarie", "-retenue_irpp", "-pret_employeur?"]}}
        ]
    })
}

#[test]
fn une_rubrique_de_paie_se_lit_au_bout_de_sa_rangee() {
    // algoria-140 : la base et le taux d'une cotisation s'impriment entre son libellé et
    // son montant ; « Indemnité | de | transport » est rendu mot à mot ; « présent » n'est
    // pas « Prêt ».
    let mut o = 0;
    let mut j = Vec::new();
    j.extend(rangee(
        &mut o,
        0.20,
        &["Salaire", "de", "base"],
        &[(0.8, 4063000)],
    ));
    j.extend(rangee(
        &mut o,
        0.22,
        &["Indemnité", "de", "transport"],
        &[(0.8, 89000)],
    ));
    j.extend(rangee(
        &mut o,
        0.24,
        &["Indemnité", "de", "présence"],
        &[(0.8, 48000)],
    ));
    j.extend(rangee(
        &mut o,
        0.26,
        &["SALAIRE", "BRUT"],
        &[(0.8, 4200000)],
    ));
    j.extend(rangee(
        &mut o,
        0.28,
        &["Cotisation", "CNSS"],
        &[(0.4, 4200000), (0.6, 9180), (0.8, 385560)],
    ));
    j.extend(rangee(
        &mut o,
        0.30,
        &["Retenue", "IRPP"],
        &[(0.4, 43773280), (0.8, 909032)],
    ));
    j.extend(rangee(
        &mut o,
        0.32,
        &["NET", "À", "PAYER"],
        &[(0.8, 2905408)],
    ));
    j.extend(rangee(
        &mut o,
        0.40,
        &["Arrêté", "le", "présent", "bulletin"],
        &[],
    ));
    let s = resoudre(j, grille_paie(), pack_essai());
    assert_eq!(s["issue"], "prouvee", "{s}");
    assert_eq!(valeur(&s, "salaire_brut"), 4200000);
    assert_eq!(valeur(&s, "indemnite_transport"), 89000);
    assert_eq!(valeur(&s, "indemnite_presence"), 48000);
    assert_eq!(valeur(&s, "retenue_cnss_salarie"), 385560);
    assert_eq!(valeur(&s, "retenue_irpp"), 909032);
    assert_eq!(valeur(&s, "net_a_payer"), 2905408);
}

#[test]
fn une_somme_qui_s_annule_n_est_pas_une_solution() {
    // algoria-136 : 199 049,541 imprimé deux fois (dernier solde de la liste, solde final),
    // 3,610 deux fois (la TVA sur commissions). Sans la garde, deux lectures : la vraie, et
    // 1 300 000 pour les deux soldes, 3,610 pour les deux totaux.
    let grille = json!({
        "code": "releve_bancaire",
        "champs": [
            {"code": "solde_initial", "type": "montant", "reperes_fr": ["Solde au"]},
            {"code": "solde_final", "type": "montant", "reperes_fr": ["Solde au"]},
            {"code": "total_debits", "type": "montant", "reperes_fr": ["Total débit"]},
            {"code": "total_credits", "type": "montant", "reperes_fr": ["Total crédit"]}
        ],
        "preuves": [
            {"code": "P01a", "expression": {"op": "somme", "total": "solde_final",
              "parties": ["solde_initial", "total_credits", "-total_debits"]}}
        ]
    });
    let mut o = 0;
    let mut j = Vec::new();
    j.extend(rangee(&mut o, 0.20, &["SOLDE", "AU"], &[(0.8, 1000000)]));
    j.extend(rangee(&mut o, 0.24, &["FRAIS"], &[(0.8, 1300000)]));
    // 3,610 imprimé deux fois, sous le libellé de chacun des deux totaux
    j.extend(rangee(
        &mut o,
        0.28,
        &["Total", "crédit", "commissions"],
        &[(0.8, 3610)],
    ));
    j.extend(rangee(
        &mut o,
        0.30,
        &["Total", "débit", "commissions"],
        &[(0.8, 3610)],
    ));
    j.extend(rangee(&mut o, 0.32, &["Total", "débit"], &[(0.8, 200000)]));
    j.extend(rangee(&mut o, 0.36, &["Total", "crédit"], &[(0.8, 500000)]));
    j.extend(rangee(&mut o, 0.40, &["Solde", "au"], &[(0.8, 1300000)]));
    let s = resoudre(j, grille, pack_essai());
    assert_eq!(s["issue"], "prouvee", "{s}");
    assert_eq!(valeur(&s, "solde_initial"), 1000000);
    assert_eq!(valeur(&s, "solde_final"), 1300000);
    assert_eq!(valeur(&s, "total_credits"), 500000);
    assert_eq!(valeur(&s, "total_debits"), 200000);
}
