//! Le même moteur, deux autres grilles du catalogue (R5 : un seul moteur, N grilles) :
//! le relevé bancaire et le bulletin de paie, sur des pièces synthétiques. Une seule
//! équation de somme ne suffit pas à distinguer les champs (a + b − c = d admet ses
//! permutations) : ce sont les libellés repères du catalogue qui les ancrent.

mod commun;

use commun::*;
use serde_json::{json, Value};

fn grille_releve() -> Value {
    json!({
        "code": "releve_bancaire",
        "champs": [
            {"code": "solde_initial", "type": "montant", "reperes_fr": ["Solde précédent", "Ancien solde", "Solde au", "Solde reporté"]},
            {"code": "solde_final", "type": "montant", "reperes_fr": ["Nouveau solde", "Solde final", "Solde au", "Solde créditeur/débiteur au"]},
            {"code": "total_debits", "type": "montant", "reperes_fr": ["Total débit", "Total mouvements débit"]},
            {"code": "total_credits", "type": "montant", "reperes_fr": ["Total crédit"]},
            {"code": "periode_debut", "type": "date", "reperes_fr": ["Du", "Période du"]},
            {"code": "periode_fin", "type": "date", "reperes_fr": ["Au", "Arrêté au"]}
        ],
        "preuves": [
            {"code": "soldes", "regle": "solde_initial + total_credits − total_debits = solde_final",
             "expression": {"op": "somme", "total": "solde_final", "parties": ["solde_initial", "total_credits", "-total_debits"]}},
            {"code": "periode", "regle": "periode_debut ≤ periode_fin",
             "expression": {"op": "ordre", "avant": "periode_debut", "apres": "periode_fin"}}
        ]
    })
}

fn releve(solde_final: i64) -> Vec<Value> {
    let mut du = jeton(0, "Période du 01/03/2026", 0.05, 0.10, &[]);
    du["date"] = json!("2026-03-01");
    let mut au = jeton(1, "Arrêté au 31/03/2026", 0.5, 0.10, &[]);
    au["date"] = json!("2026-03-31");
    vec![
        du,
        au,
        jeton(
            2,
            "Solde précédent 1 250,000",
            0.5,
            0.20,
            &[(1250000, true)],
        ),
        jeton(3, "Virement reçu 1 900,500", 0.05, 0.30, &[(1900500, true)]),
        jeton(4, "Retrait DAB 600,250", 0.05, 0.33, &[(600250, true)]),
        jeton(5, "Chèque 1 500,000", 0.05, 0.36, &[(1500000, true)]),
        jeton(6, "Virement reçu 1 500,000", 0.05, 0.39, &[(1500000, true)]),
        jeton(7, "Total débit 2 100,250", 0.5, 0.60, &[(2100250, true)]),
        jeton(8, "Total crédit 3 400,500", 0.5, 0.63, &[(3400500, true)]),
        jeton(9, "Nouveau solde", 0.5, 0.66, &[(solde_final, true)]),
    ]
}

#[test]
fn releve_bancaire_prouve_puis_signale() {
    let o = resoudre(releve(2550250), grille_releve(), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(valeur(&o, "solde_initial"), 1250000);
    assert_eq!(valeur(&o, "total_credits"), 3400500);
    assert_eq!(valeur(&o, "total_debits"), 2100250);
    assert_eq!(valeur(&o, "solde_final"), 2550250);
    assert_eq!(
        o["champs"]["solde_final"]["refs"],
        json!([{"page": 1, "ordinal": 9}])
    );
    assert_eq!(o["preuves"]["soldes"], "verifiee");
    assert_eq!(o["preuves"]["periode"], "verifiee");
    // un chiffre cassé dans le nouveau solde : signalé, aucune valeur émise
    let o = resoudre(releve(2550260), grille_releve(), pack_essai());
    assert_eq!(o["issue"], "aucune", "{o}");
    assert_eq!(o["champs"]["solde_final"]["statut"], "signale");
    assert!(o["champs"]["solde_final"]["valeur"].is_null());
}

fn grille_paie() -> Value {
    json!({
        "code": "bulletin_paie",
        "champs": [
            {"code": "salaire_base", "type": "montant", "reperes_fr": ["Salaire de base", "Base"]},
            {"code": "salaire_brut", "type": "montant", "reperes_fr": ["Salaire brut", "Brut", "Total brut"]},
            {"code": "total_retenues", "type": "montant", "reperes_fr": ["Total retenues"]},
            {"code": "net_a_payer", "type": "montant", "reperes_fr": ["Net à payer", "Net", "Salaire net"]}
        ],
        "preuves": [
            {"code": "net", "regle": "net_a_payer = salaire_brut − total_retenues",
             "expression": {"op": "somme", "total": "net_a_payer", "parties": ["salaire_brut", "-total_retenues"]}}
        ]
    })
}

fn bulletin(net: i64) -> Vec<Value> {
    vec![
        jeton(
            0,
            "Salaire de base 1 600,000",
            0.05,
            0.20,
            &[(1600000, true)],
        ),
        jeton(
            1,
            "Prime de rendement 250,000",
            0.05,
            0.23,
            &[(250000, true)],
        ),
        jeton(2, "Salaire brut 1 850,000", 0.05, 0.30, &[(1850000, true)]),
        jeton(3, "Retenue CNSS 170,385", 0.05, 0.40, &[(170385, true)]),
        jeton(4, "IRPP 210,500", 0.05, 0.43, &[(210500, true)]),
        jeton(5, "CSS 9,250", 0.05, 0.46, &[(9250, true)]),
        jeton(6, "Total retenues 390,135", 0.05, 0.50, &[(390135, true)]),
        jeton(7, "Net à payer", 0.05, 0.60, &[(net, true)]),
    ]
}

#[test]
fn bulletin_de_paie_prouve_puis_signale() {
    let o = resoudre(bulletin(1459865), grille_paie(), pack_essai());
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(valeur(&o, "salaire_brut"), 1850000);
    assert_eq!(valeur(&o, "total_retenues"), 390135);
    assert_eq!(valeur(&o, "net_a_payer"), 1459865);
    // un champ qu'aucune preuve n'emploie n'est pas rendu
    assert!(o["champs"].get("salaire_base").is_none());
    // Un chiffre cassé dans le net : signalé. (Mesuré : sans les repères, l'équation
    // seule rend « ambiguë » dans les deux cas — 4 affectations sur la pièce juste,
    // 2 sur la pièce cassée, dont la coïncidence brut − prime = base.)
    let o = resoudre(bulletin(1459875), grille_paie(), pack_essai());
    assert_eq!(o["issue"], "aucune", "{o}");
    assert_eq!(o["champs"]["net_a_payer"]["statut"], "signale");
}
