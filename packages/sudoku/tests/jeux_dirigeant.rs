//! L'anneau 1 — les lignes d'articles — sur les deux jeux de factures FICTIVES du
//! dirigeant (« 100/… » : 100 pièces en 5 lots ; « 50/… » : 50 achats), déjà au format
//! d'entrée du moteur (couche de texte du PDF, recollage, treillis de production).
//! La grille et le pack sont ceux que la base livre (`grille_facture_en_base.json`) ;
//! la preuve `lignes` y est ajoutée ICI, en attendant la migration.
//!
//! Exigences :
//! - 0 ligne fausse prouvée (quantité, prix, montant, et taux quand il est rendu) ;
//! - l'issue du centre est identique avec et sans la preuve `lignes`, sur toutes les pièces ;
//! - un chiffre changé dans un montant de ligne prouvée ne produit aucune fausse preuve.

mod commun;

use commun::jeux::{self, jeton, jeu, la_piece, par_variante};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// Code de la preuve des lignes dans la grille d'essai.
const PREUVE: &str = "L01";

#[derive(Deserialize, Clone)]
struct LigneVraie {
    qte: f64,
    pu_ht: f64,
    montant_ht: f64,
    #[serde(default)]
    taux_tva: Option<f64>,
}

#[derive(Deserialize, Clone)]
struct Verite {
    lignes: Option<Vec<LigneVraie>>,
}

type Piece = jeux::Piece<Verite>;

fn pieces() -> Vec<Piece> {
    jeux::pieces()
}

/// La grille facture et le pack livrés par la base ; `avec_lignes` ajoute la preuve L01.
fn contexte(avec_lignes: bool) -> (Value, Value) {
    let (mut grille, pack) = jeux::en_base();
    if avec_lignes {
        grille["preuves"]
            .as_array_mut()
            .unwrap()
            .push(jeux::preuve_lignes(PREUVE));
    }
    (grille, pack)
}

/// Les variantes, et le temps passé dans le moteur seul (µs), hors construction du JSON d'entrée.
fn par_variante_chrono(
    jetons: &[Value],
    grille: &Value,
    pack: &Value,
) -> (Vec<(String, Value)>, u128) {
    jeux::par_variante_avec(jetons, grille, pack, None)
}

fn mineures(x: f64) -> i64 {
    (x * 1000.0).round() as i64
}

/// Les lignes prouvées sont-elles exactement les vraies ? (quantité, prix, montant ; taux s'il est rendu)
fn justes(o: &Value, v: &Verite, ppm: &BTreeMap<String, i64>) -> bool {
    let Some(vraies) = &v.lignes else {
        return false;
    };
    let inst = o["lignes"]["instances"].as_array().unwrap();
    if inst.len() != vraies.len() {
        return false;
    }
    let n = |x: &Value| x["valeur"].as_str().unwrap().parse::<i64>().unwrap();
    let mut lues: Vec<(i64, i64, i64, Option<i64>)> = inst
        .iter()
        .map(|l| {
            (
                n(&l["quantite"]),
                n(&l["prix"]),
                n(&l["montant"]),
                l["taux"]["code"].as_str().map(|c| ppm[c]),
            )
        })
        .collect();
    let mut attendues: Vec<(i64, i64, i64, i64)> = vraies
        .iter()
        .map(|l| {
            (
                mineures(l.qte),
                mineures(l.pu_ht),
                mineures(l.montant_ht),
                (l.taux_tva.unwrap_or(0.0) * 10_000.0).round() as i64,
            )
        })
        .collect();
    lues.sort();
    attendues.sort();
    lues.iter()
        .zip(&attendues)
        .all(|(l, a)| l.0 == a.0 && l.1 == a.1 && l.2 == a.2 && l.3.is_none_or(|t| t == a.3))
}

fn sans_lignes(o: &Value) -> Value {
    let mut o = o.clone();
    o.as_object_mut().unwrap().remove("lignes");
    o["preuves"].as_object_mut().unwrap().remove(PREUVE);
    o
}

/// Par jeu : prouvées justes, prouvées fausses, signalées, absentes, temps moteur (µs) avec et sans lignes.
type Bilan = (u32, u32, u32, u32, Vec<u128>, Vec<u128>);

#[test]
fn jeux_dirigeant_lignes_prouvees_sans_fausse_preuve() {
    let (grille, pack) = contexte(true);
    let (grille_centre, _) = contexte(false);
    let ppm: BTreeMap<String, i64> = pack["baremes"]["tva"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| {
            (
                t["code"].as_str().unwrap().to_string(),
                t["ppm"].as_i64().unwrap(),
            )
        })
        .collect();
    let pieces = pieces();
    assert_eq!(
        pieces.len(),
        134,
        "150 pièces, dont 16 scans sans jetons, écartés"
    );

    // (prouvées justes, prouvées fausses, signalées, absentes, temps en µs avec lignes, sans)
    let mut stats: BTreeMap<&str, Bilan> = BTreeMap::new();
    let mut centres_changes = Vec::new();
    let mut fausses = Vec::new();
    let mut taux_bases: BTreeMap<String, u32> = BTreeMap::new();
    let mut prouvees: Vec<(usize, Value)> = Vec::new();
    let mut signalees: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut absentes: Vec<String> = Vec::new();
    let mut promues: Vec<String> = Vec::new();
    for (ip, p) in pieces.iter().enumerate() {
        let jetons: Vec<Value> = p.jetons.iter().map(jeton).collect();
        let (jouees, us) = par_variante_chrono(&jetons, &grille, &pack);
        let o = la_piece(&jouees);

        // Le centre, rejoué sans la preuve : identique, variante par variante — sauf une
        // promotion : un total HT sans son libellé, que des lignes JUSTES ferment
        // exactement (lib.rs, « le total HT porte son libellé, ou les lignes le ferment »).
        let (centre, us_centre) = par_variante_chrono(&jetons, &grille_centre, &pack);
        let promue = |a: &Value, b: &Value| {
            a["issue"] == "prouvee"
                && b["raison"] == "le total HT ne porte pas son libellé"
                && a["lignes"]["statut"] == "prouve"
                && justes(a, &p.verite, &ppm)
        };
        let mut promue_ici = false;
        for ((v, a), (_, b)) in jouees.iter().zip(&centre) {
            if sans_lignes(a) != *b {
                if promue(a, b) {
                    promue_ici = true;
                } else {
                    centres_changes.push(format!("{} ({v})", p.id));
                }
            }
        }
        if la_piece(&centre)["issue"] != o["issue"] {
            if promue_ici {
                promues.push(p.id.clone());
            } else {
                centres_changes.push(format!("{} (issue)", p.id));
            }
        }

        let e = stats.entry(jeu(&p.id)).or_default();
        e.4.push(us);
        e.5.push(us_centre);
        match o["lignes"]["statut"].as_str().unwrap() {
            "prouve" => {
                *taux_bases
                    .entry(o["lignes"]["taux_par_base"].as_str().unwrap().to_string())
                    .or_default() += 1;
                if justes(&o, &p.verite, &ppm) {
                    e.0 += 1;
                    prouvees.push((ip, o.clone()));
                } else {
                    e.1 += 1;
                    fausses.push(format!("{} : {}", p.id, o["lignes"]));
                }
            }
            "signale" => {
                e.2 += 1;
                let raison = format!(
                    "{} / centre {}",
                    o["preuves"][PREUVE].as_str().unwrap(),
                    o["issue"].as_str().unwrap()
                );
                signalees.entry(raison).or_default().push(p.id.clone());
            }
            _ => {
                e.3 += 1;
                absentes.push(p.id.clone());
            }
        }
    }
    for (j, (pj, pf, s, a, t, tc)) in &mut stats {
        t.sort();
        tc.sort();
        println!(
            "JEU {j:>3} : {} pièces — lignes prouvées justes {pj}, prouvées fausses {pf}, signalées {s}, absentes {a} ; \
             temps médian par pièce {:.2} ms avec les lignes, {:.2} ms sans (moteur seul, les deux variantes ; max {:.2} ms)",
            t.len(),
            t[t.len() / 2] as f64 / 1000.0,
            tc[tc.len() / 2] as f64 / 1000.0,
            *t.last().unwrap() as f64 / 1000.0
        );
    }
    println!("Σ par taux = base (lignes prouvées) : {taux_bases:?}");
    for (raison, ids) in &signalees {
        println!("  signalées — preuve {raison} : {} {ids:?}", ids.len());
    }
    println!("  absentes (aucune rangée q × p = m) : {absentes:?}");
    println!("  centres promus par des lignes justes qui ferment le HT : {promues:?}");
    assert!(
        centres_changes.is_empty(),
        "centre modifié par la preuve lignes : {centres_changes:?}"
    );
    assert!(fausses.is_empty(), "lignes fausses prouvées : {fausses:#?}");
    assert!(!prouvees.is_empty(), "aucune pièce aux lignes prouvées");

    // Mutation : un chiffre changé dans chaque montant de ligne prouvée.
    let (mut mutations, mut fausses_mut, mut justes_mut) = (0u32, Vec::new(), Vec::new());
    for (ip, o) in &prouvees {
        let p = &pieces[*ip];
        for (il, l) in o["lignes"]["instances"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            let m: i64 = l["montant"]["valeur"].as_str().unwrap().parse().unwrap();
            let r = &l["montant"]["refs"][0];
            let k = p
                .jetons
                .iter()
                .position(|j| {
                    j.0 as u64 == r["page"].as_u64().unwrap()
                        && j.1 as u64 == r["ordinal"].as_u64().unwrap()
                })
                .unwrap();
            let signe = m.signum();
            let chiffres: Vec<u32> = m
                .abs()
                .to_string()
                .chars()
                .map(|c| c.to_digit(10).unwrap())
                .collect();
            for pos in 0..chiffres.len() {
                let mut c = chiffres.clone();
                c[pos] = (c[pos] + 1) % 10;
                if pos == 0 && c[0] == 0 {
                    c[0] = 1;
                }
                let m2: i64 = signe * c.iter().fold(0, |a, d| a * 10 + *d as i64);
                let mut jetons: Vec<Value> = p.jetons.iter().map(jeton).collect();
                for lec in jetons[k]["montants"].as_array_mut().unwrap() {
                    if lec["v"] == m {
                        lec["v"] = json!(m2);
                    }
                }
                mutations += 1;
                let om = la_piece(&par_variante(&jetons, &grille, &pack));
                if om["lignes"]["statut"] == "prouve" {
                    if justes(&om, &p.verite, &ppm) {
                        justes_mut.push(format!("{} ligne {il} chiffre {pos}", p.id));
                    } else {
                        fausses_mut.push(format!(
                            "{} ligne {il} chiffre {pos} : {}",
                            p.id, om["lignes"]
                        ));
                    }
                }
            }
        }
    }
    println!(
        "MUTATIONS des montants de ligne : {mutations} sur {} pièces — prouvées justes {} (montant redondant sur la rangée), \
         fausses preuves {}",
        prouvees.len(),
        justes_mut.len(),
        fausses_mut.len()
    );
    for j in justes_mut.iter().take(10) {
        println!("  encore prouvée juste : {j}");
    }
    assert!(mutations > 0);
    assert!(
        fausses_mut.is_empty(),
        "fausses preuves après mutation : {fausses_mut:#?}"
    );
}

/// La forme de la sortie, sur une pièce synthétique : trois lignes, une remise, un taux.
#[test]
fn lignes_forme_de_la_sortie() {
    let (grille, pack) = contexte(true);
    let j = |o: u32, t: &str, x: f64, y: f64, ms: &[(i64, bool)]| {
        let ms: Vec<Value> = ms
            .iter()
            .map(|(v, f)| json!({"v": v, "forte": f}))
            .collect();
        json!({"page": 1, "ordinal": o, "texte": t, "x0": x, "y0": y, "x1": x + 0.05, "y1": y + 0.01, "montants": ms, "date": null})
    };
    let jetons = vec![
        j(0, "Clavier", 0.05, 0.30, &[]),
        j(1, "2", 0.50, 0.30, &[(2000, false)]),
        j(2, "100,000", 0.60, 0.30, &[(100000, true)]),
        j(3, "19%", 0.70, 0.30, &[]),
        j(4, "200,000", 0.80, 0.30, &[(200000, true)]),
        j(5, "Écran", 0.05, 0.33, &[]),
        j(6, "(remise", 0.12, 0.33, &[]),
        j(7, "10", 0.18, 0.33, &[(10000, false)]),
        j(8, "%)", 0.23, 0.33, &[]),
        j(9, "1", 0.50, 0.33, &[(1000, false)]),
        j(10, "500,000", 0.60, 0.33, &[(500000, true)]),
        j(11, "19", 0.70, 0.33, &[(19000, false)]),
        j(12, "%", 0.74, 0.33, &[]),
        j(13, "450,000", 0.80, 0.33, &[(450000, true)]),
        j(14, "Total HT", 0.55, 0.50, &[]),
        j(15, "650,000", 0.80, 0.50, &[(650000, true)]),
        j(16, "TVA 19 %", 0.55, 0.53, &[]),
        j(17, "123,500", 0.80, 0.53, &[(123500, true)]),
        j(18, "Timbre fiscal", 0.55, 0.56, &[]),
        j(19, "1,000", 0.80, 0.56, &[(1000, true)]),
        j(20, "Total TTC", 0.55, 0.59, &[]),
        j(21, "774,500", 0.80, 0.59, &[(774500, true)]),
    ];
    let jouees = par_variante(&jetons, &grille, &pack);
    let o = la_piece(&jouees);
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(o["preuves"][PREUVE], "verifiee", "{o}");
    let l = &o["lignes"];
    assert_eq!(l["statut"], "prouve");
    assert_eq!(l["taux_par_base"], "verifiee");
    let i = l["instances"].as_array().unwrap();
    assert_eq!(i.len(), 2);
    assert_eq!(
        i[0]["designation"],
        json!({"valeur": "Clavier", "refs": [{"page": 1, "ordinal": 0}]})
    );
    assert_eq!(
        i[0]["quantite"],
        json!({"valeur": "2000", "refs": [{"page": 1, "ordinal": 1}]})
    );
    assert_eq!(i[0]["remise"], Value::Null);
    assert_eq!(
        i[0]["taux"],
        json!({"code": "TVA19", "refs": [{"page": 1, "ordinal": 3}]})
    );
    assert_eq!(
        i[1]["remise"],
        json!({"valeur": "10000", "refs": [{"page": 1, "ordinal": 7}]})
    );
    assert_eq!(
        i[1]["montant"],
        json!({"valeur": "450000", "refs": [{"page": 1, "ordinal": 13}]})
    );
    assert_eq!(i[1]["taux"]["code"], "TVA19");
    println!(
        "{}",
        serde_json::to_string(&json!({"lignes": l, "preuves": o["preuves"]})).unwrap()
    );

    // Un montant de ligne qui ne ferme plus la somme : les lignes sont signalées, le centre ne bouge pas.
    let mut faux = jetons.clone();
    faux[13]["montants"] = json!([{"v": 460000, "forte": true}]);
    let of = la_piece(&par_variante(&faux, &grille, &pack));
    assert_eq!(of["issue"], "prouvee");
    assert_eq!(of["lignes"]["statut"], "signale");
    assert_eq!(of["preuves"][PREUVE], "echec");
}
