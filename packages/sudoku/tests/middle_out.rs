//! L'anneau 1 lu « du milieu vers les bords » (middle-out) : quand aucune rangée ne
//! manque, la stratégie de toujours prouve les lignes ; quand l'OCR rapide a perdu un
//! petit nombre isolé (la quantité « 1 » seule dans sa colonne), la règle du tableau,
//! apprise de la rangée la mieux expliquée, retrouve la cellule manquante, et la somme
//! exacte au total HT prouvé ferme le tableau.
//!
//! Deux lectures des mêmes 150 factures FICTIVES du dirigeant : l'OCR rapide (images,
//! `jeux_dirigeant_ocr.json`) et la couche de texte du PDF (`jeux_dirigeant_jetons.json`).
//! La grille et le pack sont ceux que la base livre ; L01 (lignes), E01 (parties) et E02
//! (ordre) y sont ajoutées ICI, en attendant la migration.
//!
//! Exigences :
//! - 0 ligne fausse : des lignes `prouve` valent la vérité, cellules déduites comprises ;
//! - la couche de texte ne régresse pas (≥ 84 pièces aux lignes prouvées) ;
//! - le centre et l'anneau 2 sont identiques, lecture par lecture, au témoin figé avant
//!   l'anneau middle-out (`middle_out_temoin.json`), et les lignes que la stratégie de
//!   toujours prouvait sont rendues à l'identique ;
//! - mutations : un chiffre changé dans un montant de ligne, un prix effacé, deux montants
//!   effacés ne produisent jamais de ligne fausse.
//!
//! Le témoin se refige (code d'avant le changement uniquement) par
//! `MIDDLE_OUT_TEMOIN=ecrire cargo test --release --test middle_out`.

mod commun;

use commun::donnees;
use commun::jeux::{self, jeton, jeu, la_piece, par_variante_avec};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const PREUVE_LIGNES: &str = "L01";
const TEMOIN: &str = "middle_out_temoin.json";
/// Les formes juridiques ignorées par la comparaison des noms (données d'essai).
const FORMES: [&str; 6] = ["SARL", "SUARL", "SA", "SAS", "SNC", "EURL"];

#[derive(Deserialize, Clone)]
struct LigneVraie {
    qte: f64,
    pu_ht: f64,
    montant_ht: f64,
}

#[derive(Deserialize, Clone, Default)]
struct Entete {
    mf_fournisseur: Option<String>,
    mf_client: Option<String>,
    fournisseur: Option<String>,
    client: Option<String>,
}

#[derive(Deserialize, Clone)]
struct Verite {
    lignes: Option<Vec<LigneVraie>>,
    #[serde(default)]
    entete: Entete,
}

/// Une coupe fournie par l'adaptateur, compactée : (coupe, gauche, [[v, forte]…]).
type DecoupeCompacte = (usize, i64, Vec<(i64, u8)>);

#[derive(Deserialize)]
struct Piece {
    id: String,
    verite: Verite,
    jetons: Vec<jeux::JetonCompact>,
    /// Les coupes des cases collées, par indice de jeton (OCR seulement).
    #[serde(default)]
    decoupes: BTreeMap<String, Vec<DecoupeCompacte>>,
}

/// Les deux lectures : (nom, fichier).
const LECTURES: [(&str, &str); 2] = [("ocr", "jeux_dirigeant_ocr.json"), ("texte", "jeux_dirigeant_jetons.json")];

fn pieces(fichier: &str) -> Vec<Piece> {
    serde_json::from_str(&donnees(fichier)).unwrap()
}

/// La grille en base avec L01, E01 et E02 ; le pack en base.
fn contexte() -> (Value, Value) {
    let (mut g, p) = jeux::en_base();
    let preuves = g["preuves"].as_array_mut().unwrap();
    preuves.push(jeux::preuve_lignes(PREUVE_LIGNES));
    preuves.push(json!({"code": "E01", "regle": "parties", "genre": "relation", "statut": "defaut_a_valider", "variante": null,
        "expression": {"op": "parties", "emetteur": "matricule_fiscal_emetteur", "client": "matricule_fiscal_client",
                       "nom_emetteur": "raison_sociale_emetteur", "nom_client": "nom_client", "numero": "numero_facture"}}));
    preuves.push(json!({"code": "E02", "regle": "émission avant échéance", "genre": "format", "statut": "defaut_a_valider",
        "variante": null, "expression": {"op": "ordre", "avant": "date_emission", "apres": "date_echeance"}}));
    (g, p)
}

fn norme_mf(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).flat_map(|c| c.to_uppercase()).collect()
}

/// Le dossier (client le plus fréquent du jeu) et ses tiers (un fournisseur sur deux), par jeu.
fn connus(pieces: &[Piece]) -> BTreeMap<String, Value> {
    let mut out = BTreeMap::new();
    let jeux_: BTreeSet<&str> = pieces.iter().map(|p| jeu(&p.id)).collect();
    for j in jeux_ {
        let du_jeu: Vec<&Entete> = pieces.iter().filter(|p| jeu(&p.id) == j).map(|p| &p.verite.entete).collect();
        let mut compte: BTreeMap<(String, String), u32> = BTreeMap::new();
        for e in &du_jeu {
            if let (Some(m), Some(c)) = (&e.mf_client, &e.client) {
                *compte.entry((norme_mf(m), c.clone())).or_default() += 1;
            }
        }
        let ((mf, rs), _) = compte.into_iter().max_by_key(|(_, n)| *n).unwrap();
        let mut fournisseurs: BTreeMap<String, String> = BTreeMap::new();
        for e in &du_jeu {
            if let (Some(m), Some(f)) = (&e.mf_fournisseur, &e.fournisseur) {
                if norme_mf(m) != mf {
                    fournisseurs.entry(norme_mf(m)).or_insert_with(|| f.clone());
                }
            }
        }
        let tiers: Vec<Value> = fournisseurs
            .iter()
            .enumerate()
            .filter(|(k, _)| k % 2 == 0)
            .map(|(k, (m, f))| json!({"code": format!("401{:03}", k + 1), "matricule": m, "raison_sociale": f}))
            .collect();
        out.insert(j.to_string(), json!({"dossier": {"matricule": mf, "raison_sociale": rs}, "tiers": tiers, "formes_juridiques": FORMES}));
    }
    out
}

/// Empreinte FNV-1a 64 bits d'une valeur JSON (clés triées : serde_json sans `preserve_order`).
fn empreinte(v: &Value) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in v.to_string().bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Le centre et l'anneau 2 : la sortie sans les lignes ni leur preuve.
fn centre(o: &Value) -> Value {
    let mut o = o.clone();
    o.as_object_mut().unwrap().remove("lignes");
    o["preuves"].as_object_mut().unwrap().remove(PREUVE_LIGNES);
    o
}

/// Les lignes sans le statut de cellule (absent de la stratégie de toujours).
fn lignes_sans_statut(o: &Value) -> Value {
    let mut l = o["lignes"].clone();
    if let Some(inst) = l["instances"].as_array_mut() {
        for i in inst {
            for (_, c) in i.as_object_mut().unwrap().iter_mut() {
                if let Some(c) = c.as_object_mut() {
                    c.remove("statut");
                }
            }
        }
    }
    l
}

fn mineures(x: f64) -> i64 {
    (x * 1000.0).round() as i64
}

/// Les lignes prouvées valent-elles la vérité (quantité, prix, montant ; cellules déduites comprises) ?
fn justes(o: &Value, v: &Verite) -> bool {
    let Some(vraies) = &v.lignes else { return false };
    let inst = o["lignes"]["instances"].as_array().unwrap();
    if inst.len() != vraies.len() {
        return false;
    }
    let n = |x: &Value| x["valeur"].as_str().unwrap().parse::<i64>().unwrap();
    let mut lues: Vec<(i64, i64, i64)> = inst.iter().map(|l| (n(&l["quantite"]), n(&l["prix"]), n(&l["montant"]))).collect();
    let mut attendues: Vec<(i64, i64, i64)> =
        vraies.iter().map(|l| (mineures(l.qte), mineures(l.pu_ht), mineures(l.montant_ht))).collect();
    lues.sort();
    attendues.sort();
    lues == attendues
}

/// Les cellules déduites d'une sortie : (champ, cellule).
fn deduites(o: &Value) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    for l in o["lignes"]["instances"].as_array().into_iter().flatten() {
        for k in ["quantite", "prix", "montant"] {
            if l[k]["statut"] == "deduit" {
                out.push((k.to_string(), l[k].clone()));
            }
        }
    }
    out
}

struct Jouee {
    piece: Value,
    variantes: Vec<(String, Value)>,
    us: u128,
}

fn jouer(jetons: &[Value], grille: &Value, pack: &Value, connus: &Value) -> Jouee {
    let (variantes, us) = par_variante_avec(jetons, grille, pack, Some(connus));
    Jouee { piece: la_piece(&variantes), variantes, us }
}

fn jetons_de(p: &Piece) -> Vec<Value> {
    let mut js: Vec<Value> = p.jetons.iter().map(jeton).collect();
    for (k, ds) in &p.decoupes {
        js[k.parse::<usize>().unwrap()]["decoupes"] = ds
            .iter()
            .map(|(coupe, gauche, droite)| {
                let droite: Vec<Value> = droite.iter().map(|(v, f)| json!({"v": v, "forte": *f == 1})).collect();
                json!({"coupe": coupe, "gauche": gauche, "droite": droite})
            })
            .collect();
    }
    js
}

/// Le témoin figé : par « lecture|pièce|variante », l'empreinte du centre (et de l'anneau 2),
/// et celle des lignes quand la stratégie de toujours les prouvait.
fn ecrire_temoin() {
    let (grille, pack) = contexte();
    let mut t: BTreeMap<String, Value> = BTreeMap::new();
    for (nom, fichier) in LECTURES {
        let ps = pieces(fichier);
        let cs = connus(&ps);
        for p in &ps {
            let j = jouer(&jetons_de(p), &grille, &pack, &cs[jeu(&p.id)]);
            for (v, o) in &j.variantes {
                let lignes = (o["lignes"]["statut"] == "prouve").then(|| empreinte(&lignes_sans_statut(o)));
                t.insert(format!("{nom}|{}|{v}", p.id), json!({"centre": empreinte(&centre(o)), "lignes": lignes}));
            }
        }
    }
    let chemin = format!("{}/tests/donnees/{TEMOIN}", env!("CARGO_MANIFEST_DIR"));
    std::fs::write(&chemin, serde_json::to_string_pretty(&t).unwrap()).unwrap();
    println!("témoin écrit : {chemin} ({} lectures × variantes)", t.len());
}

#[derive(Default)]
struct Bilan {
    pieces: u32,
    prouvees: u32,
    avec_deduites: u32,
    signalees: u32,
    absentes: u32,
    cellules_deduites: BTreeMap<String, u32>,
    temps: Vec<u128>,
}

#[test]
fn middle_out_zero_ligne_fausse_et_centre_inchange() {
    if std::env::var("MIDDLE_OUT_TEMOIN").as_deref() == Ok("ecrire") {
        ecrire_temoin();
        return;
    }
    let (grille, pack) = contexte();
    let temoin: BTreeMap<String, Value> = serde_json::from_str(&donnees(TEMOIN)).unwrap();
    let mut fautes: Vec<String> = Vec::new();
    let mut ecarts_centre: Vec<String> = Vec::new();
    let mut lignes_changees: Vec<String> = Vec::new();
    let mut lectures = 0u32;
    let mut prouvees_texte = 0u32;
    // Les pièces OCR aux lignes prouvées, pour les mutations.
    let mut a_muter: Vec<(usize, Value)> = Vec::new();
    let ocr = pieces(LECTURES[0].1);
    for (nom, fichier) in LECTURES {
        let ps = pieces(fichier);
        let cs = connus(&ps);
        let mut b = Bilan::default();
        for (ip, p) in ps.iter().enumerate() {
            let j = jouer(&jetons_de(p), &grille, &pack, &cs[jeu(&p.id)]);
            lectures += 1;
            b.pieces += 1;
            b.temps.push(j.us);
            for (v, o) in &j.variantes {
                let t = &temoin[&format!("{nom}|{}|{v}", p.id)];
                if t["centre"] != json!(empreinte(&centre(o))) {
                    ecarts_centre.push(format!("{nom} {} ({v})", p.id));
                }
                if let Some(e) = t["lignes"].as_str() {
                    if empreinte(&lignes_sans_statut(o)) != e || !deduites(o).is_empty() {
                        lignes_changees.push(format!("{nom} {} ({v})", p.id));
                    }
                }
            }
            let o = &j.piece;
            match o["lignes"]["statut"].as_str() {
                Some("prouve") => {
                    if justes(o, &p.verite) {
                        b.prouvees += 1;
                        let d = deduites(o);
                        if !d.is_empty() {
                            b.avec_deduites += 1;
                            assert_eq!(o["lignes"]["deduites"], json!(d.len()), "{} : compte des déduites", p.id);
                            for (k, c) in &d {
                                *b.cellules_deduites.entry(k.clone()).or_default() += 1;
                                assert!(c["refs"].as_array().unwrap().is_empty(), "{} : une déduite ne cite rien", p.id);
                                assert!(c["case"]["x1"].as_f64().unwrap() > c["case"]["x0"].as_f64().unwrap());
                            }
                        }
                        if nom == "ocr" {
                            a_muter.push((ip, o.clone()));
                        }
                    } else {
                        fautes.push(format!("{nom} {} : {}", p.id, o["lignes"]));
                    }
                }
                Some("signale") => b.signalees += 1,
                _ => b.absentes += 1,
            }
        }
        if nom == "texte" {
            prouvees_texte = b.prouvees;
        }
        b.temps.sort();
        let n_ded: u32 = b.cellules_deduites.values().sum();
        println!(
            "{:>5} : {} pièces — lignes prouvées {} (dont {} avec cellules déduites), signalées {}, absentes {} ; \
             cellules déduites {} {:?} ; temps médian {:.2} ms (moteur seul, toutes variantes)",
            nom.to_uppercase(),
            b.pieces,
            b.prouvees,
            b.avec_deduites,
            b.signalees,
            b.absentes,
            n_ded,
            b.cellules_deduites,
            b.temps[b.temps.len() / 2] as f64 / 1000.0
        );
    }
    println!("CENTRE et ANNEAU 2 : {lectures} lectures comparées au témoin, écarts {}", ecarts_centre.len());
    assert!(fautes.is_empty(), "lignes fausses prouvées : {fautes:#?}");
    assert!(ecarts_centre.is_empty(), "centre ou anneau 2 modifié : {ecarts_centre:?}");
    assert!(lignes_changees.is_empty(), "lignes de la stratégie de toujours modifiées : {lignes_changees:?}");
    assert!(prouvees_texte >= 84, "la couche de texte régresse : {prouvees_texte} < 84");
    assert!(!a_muter.is_empty(), "aucune pièce OCR aux lignes prouvées");

    mutations(&ocr, &a_muter, &grille, &pack);
}

/// L'indice, dans le plan, du jeton cité par une cellule.
fn indice(p: &Piece, cellule: &Value) -> Option<usize> {
    let r = cellule["refs"].as_array()?.first()?;
    p.jetons.iter().position(|j| j.0 as u64 == r["page"].as_u64().unwrap() && j.1 as u64 == r["ordinal"].as_u64().unwrap())
}

fn mutations(ocr: &[Piece], a_muter: &[(usize, Value)], grille: &Value, pack: &Value) {
    let cs = connus(ocr);
    let jouer_m = |p: &Piece, jetons: &[Value]| jouer(jetons, grille, pack, &cs[jeu(&p.id)]).piece;

    // (1) un chiffre changé dans un montant de ligne lu.
    let (mut n1, mut fausses1, mut encore1) = (0u32, Vec::new(), Vec::new());
    for (ip, o) in a_muter {
        let p = &ocr[*ip];
        for (il, l) in o["lignes"]["instances"].as_array().unwrap().iter().enumerate() {
            let Some(k) = indice(p, &l["montant"]) else { continue };
            let m: i64 = l["montant"]["valeur"].as_str().unwrap().parse().unwrap();
            let chiffres: Vec<u32> = m.abs().to_string().chars().map(|c| c.to_digit(10).unwrap()).collect();
            for pos in 0..chiffres.len() {
                let mut c = chiffres.clone();
                c[pos] = (c[pos] + 1) % 10;
                if pos == 0 && c[0] == 0 {
                    c[0] = 1;
                }
                let m2: i64 = m.signum() * c.iter().fold(0, |a, d| a * 10 + *d as i64);
                let mut jetons = jetons_de(p);
                for lec in jetons[k]["montants"].as_array_mut().unwrap() {
                    if lec["v"] == m {
                        lec["v"] = json!(m2);
                    }
                }
                n1 += 1;
                let om = jouer_m(p, &jetons);
                if om["lignes"]["statut"] == "prouve" {
                    if justes(&om, &p.verite) {
                        encore1.push(format!("{} ligne {il} chiffre {pos}", p.id));
                    } else {
                        fausses1.push(format!("{} ligne {il} chiffre {pos} : {}", p.id, om["lignes"]));
                    }
                }
            }
        }
    }
    println!(
        "MUTATION 1 (un chiffre d'un montant de ligne) : {n1} sur {} pièces — encore prouvées justes {} (montant redondant), fausses {}",
        a_muter.len(),
        encore1.len(),
        fausses1.len()
    );
    for e in encore1.iter().take(5) {
        println!("  encore prouvée juste : {e}");
    }

    // (2) un prix lu effacé : signalé, ou prouvé avec le prix déduit juste.
    let (mut n2, mut signalees2, mut deduits2, mut fausses2) = (0u32, 0u32, 0u32, Vec::new());
    for (ip, o) in a_muter {
        let p = &ocr[*ip];
        for (il, l) in o["lignes"]["instances"].as_array().unwrap().iter().enumerate() {
            let Some(k) = indice(p, &l["prix"]) else { continue };
            let mut jetons = jetons_de(p);
            jetons[k]["montants"] = json!([]);
            n2 += 1;
            let om = jouer_m(p, &jetons);
            if om["lignes"]["statut"] == "prouve" {
                if justes(&om, &p.verite) {
                    deduits2 += 1;
                } else {
                    fausses2.push(format!("{} ligne {il} : {}", p.id, om["lignes"]));
                }
            } else {
                signalees2 += 1;
            }
        }
    }
    println!("MUTATION 2 (un prix effacé) : {n2} — prouvées justes (prix déduit) {deduits2}, signalées {signalees2}, fausses {}", fausses2.len());

    // (3) deux montants de ligne effacés : signalé.
    let (mut n3, mut prouvees3) = (0u32, Vec::new());
    for (ip, o) in a_muter {
        let p = &ocr[*ip];
        let inst = o["lignes"]["instances"].as_array().unwrap();
        let cites: Vec<usize> = inst.iter().filter_map(|l| indice(p, &l["montant"])).collect();
        for a in 0..cites.len() {
            for b in a + 1..cites.len() {
                let mut jetons = jetons_de(p);
                jetons[cites[a]]["montants"] = json!([]);
                jetons[cites[b]]["montants"] = json!([]);
                n3 += 1;
                let om = jouer_m(p, &jetons);
                if om["lignes"]["statut"] == "prouve" {
                    prouvees3.push(format!("{} lignes {a},{b} : juste {} : {}", p.id, justes(&om, &p.verite), om["lignes"]));
                }
            }
        }
    }
    println!("MUTATION 3 (deux montants effacés) : {n3} — encore prouvées {}", prouvees3.len());
    assert!(n1 > 0 && n2 > 0 && n3 > 0);
    assert!(fausses1.is_empty(), "mutation 1, fausses preuves : {fausses1:#?}");
    assert!(fausses2.is_empty(), "mutation 2, fausses preuves : {fausses2:#?}");
    assert!(prouvees3.is_empty(), "mutation 3, lignes encore prouvées : {prouvees3:#?}");
}

/// La pièce 100/A-01 lue par l'OCR rapide (l'exemple du dirigeant), jouée avec une
/// retouche de ses jetons ; rend la pièce et ses jetons.
fn a01(retouche: impl Fn(&mut Vec<Value>)) -> (Value, Vec<Value>) {
    let (grille, pack) = contexte();
    let ps = pieces(LECTURES[0].1);
    let cs = connus(&ps);
    let p = ps.iter().find(|p| p.id == "100/A-01").unwrap();
    let mut jetons = jetons_de(p);
    retouche(&mut jetons);
    let o = jouer(&jetons, &grille, &pack, &cs[jeu(&p.id)]).piece;
    assert_eq!(o["issue"], "prouvee", "le centre de 100/A-01");
    (o, jetons)
}

fn ordinal_de(jetons: &[Value], texte: &str, y: f64) -> usize {
    jetons.iter().position(|j| j["texte"] == texte && (j["y0"].as_f64().unwrap() - y).abs() < 0.01).unwrap()
}

#[test]
fn middle_out_forme_d_une_cellule_deduite() {
    // « Switch … | 385,000 | 385,000 » et « Imprimante … | 1 150,000 | 2 300,000 » : la
    // quantité (1 et 2) n'a pas été vue par l'OCR ; « 24 ports », « 1 To », « 650VA » sont
    // dans la désignation, hors des colonnes.
    let (o, _) = a01(|_| {});
    let l = &o["lignes"];
    assert_eq!(l["statut"], "prouve", "{l}");
    assert_eq!(o["preuves"][PREUVE_LIGNES], "verifiee");
    assert_eq!(l["deduites"], 2);
    let i = l["instances"].as_array().unwrap();
    let valeurs: Vec<(String, String, String)> = i
        .iter()
        .map(|x| {
            let v = |k: &str| x[k]["valeur"].as_str().unwrap().to_string();
            (v("quantite"), v("prix"), v("montant"))
        })
        .collect();
    let attendu = [("1000", "385000", "385000"), ("20000", "260000", "5200000"), ("10000", "195000", "1950000"), ("2000", "1150000", "2300000")];
    assert_eq!(valeurs, attendu.map(|(a, b, c)| (a.to_string(), b.to_string(), c.to_string())));
    let q = &i[0]["quantite"];
    assert_eq!(q["statut"], "deduit");
    assert_eq!(q["refs"], json!([]));
    assert_eq!(q["case"]["page"], 1);
    // la case est sous la colonne des quantités lues (« 20 », « 10 »), dans la bande de la rangée
    let x0 = q["case"]["x0"].as_f64().unwrap();
    let x1 = q["case"]["x1"].as_f64().unwrap();
    assert!(x0 > 0.55 && x1 < 0.70, "{q}");
    assert_eq!(i[0]["prix"]["statut"], "lu");
    assert_eq!(i[0]["prix"]["refs"].as_array().unwrap().len(), 1);
    assert_eq!(i[1]["quantite"]["statut"], "lu");
    assert!(i[0]["designation"]["valeur"].as_str().unwrap().contains("24"));
    println!("{}", serde_json::to_string(&json!({"quantite": q, "prix": i[0]["prix"]})).unwrap());
}

#[test]
fn middle_out_montant_unique_deduit_par_l_ecart_au_total() {
    // le montant « 1950,000 » de l'onduleur effacé : 9 835 − (385 + 5 200 + 2 300) = 1 950 = 10 × 195
    let (o, _) = a01(|j| {
        let k = ordinal_de(j, "1950,000", 0.317);
        j[k]["montants"] = json!([]);
    });
    let l = &o["lignes"];
    assert_eq!(l["statut"], "prouve", "{l}");
    assert_eq!(l["deduites"], 3);
    let m = &l["instances"][2]["montant"];
    assert_eq!((m["valeur"].as_str(), m["statut"].as_str()), (Some("1950000"), Some("deduit")));

    // deux montants effacés (les deux rangées complètes) : rien ne se déduit, pas même la graine
    let (o, _) = a01(|j| {
        for (t, y) in [("1950,000", 0.317), ("5 200,000", 0.294)] {
            let k = ordinal_de(j, t, y);
            j[k]["montants"] = json!([]);
        }
    });
    assert_ne!(o["lignes"]["statut"], "prouve", "{}", o["lignes"]);
}

#[test]
fn middle_out_prix_deduit_et_tableau_a_remise() {
    // le prix « 260,000 » effacé : 5 200 / 20 = 260, exact
    let (o, _) = a01(|j| {
        let k = ordinal_de(j, "260,000", 0.294);
        j[k]["montants"] = json!([]);
    });
    let p = &o["lignes"]["instances"][1]["prix"];
    assert_eq!(o["lignes"]["statut"], "prouve");
    assert_eq!((p["valeur"].as_str(), p["statut"].as_str()), (Some("260000"), Some("deduit")));

    // un en-tête qui annonce une remise de ligne : une remise perdue fausserait la quantité
    // déduite, rien ne se déduit
    let (o, _) = a01(|j| {
        let k = ordinal_de(j, "Unité", 0.246);
        j[k]["texte"] = json!("Remise");
    });
    assert_eq!(o["lignes"]["statut"], "signale");
}

/// La pièce 100/A-02 lue par l'OCR rapide : aucune quantité vue, aucune rangée aux trois
/// cellules lues. Rend ses lignes, avec une retouche de ses jetons.
fn a02(retouche: impl Fn(&mut Vec<Value>)) -> Value {
    let (grille, pack) = contexte();
    let ps = pieces(LECTURES[0].1);
    let cs = connus(&ps);
    let p = ps.iter().find(|p| p.id == "100/A-02").unwrap();
    let mut jetons = jetons_de(p);
    retouche(&mut jetons);
    let o = jouer(&jetons, &grille, &pack, &cs[jeu(&p.id)]).piece;
    assert_eq!(o["issue"], "prouvee", "le centre de 100/A-02");
    o["lignes"].clone()
}

#[test]
fn middle_out_graine_ancree_par_l_en_tete() {
    // « Serveur … 8 vCPU / 32 Go | Mois | 420,000 | 420,000 » … : les quantités 1, 1, 2, 2
    // se déduisent sous l'en-tête « Qté | P.U. HT | Montant HT », le total 2 575,000 ferme
    let l = a02(|_| {});
    assert_eq!(l["statut"], "prouve", "{l}");
    assert_eq!(l["deduites"], 4);
    let q: Vec<&str> = l["instances"].as_array().unwrap().iter().map(|i| i["quantite"]["valeur"].as_str().unwrap()).collect();
    assert_eq!(q, ["1000", "1000", "2000", "2000"]);

    // sans l'étiquette des quantités dans l'en-tête, pas de graine déduite
    let l = a02(|j| {
        let k = ordinal_de(j, "Qté", 0.247);
        j[k]["texte"] = json!("Nb");
    });
    assert_eq!(l["statut"], "absent", "{l}");
}

/// Une pièce de l'OCR rapide, jouée avec une retouche de ses jetons : (sortie, vérité).
fn ocr(id: &str, retouche: impl Fn(&mut Vec<Value>)) -> (Value, Verite) {
    let (grille, pack) = contexte();
    let ps = pieces(LECTURES[0].1);
    let cs = connus(&ps);
    let p = ps.iter().find(|p| p.id == id).unwrap();
    let mut jetons = jetons_de(p);
    retouche(&mut jetons);
    let o = jouer(&jetons, &grille, &pack, &cs[jeu(&p.id)]).piece;
    assert_eq!(o["issue"], "prouvee", "le centre de {id}");
    (o, p.verite.clone())
}

fn par_ordinal(jetons: &[Value], page: u64, ordinal: u64) -> usize {
    jetons.iter().position(|j| j["page"] == page && j["ordinal"] == ordinal).unwrap()
}

#[test]
fn middle_out_tableau_sur_plusieurs_pages() {
    // 50/37 : 30 rangées en page 1, 15 en page 2 sous l'en-tête répété
    let (o, v) = ocr("50/37", |_| {});
    assert_eq!(o["lignes"]["statut"], "prouve", "{}", o["lignes"]);
    assert!(justes(&o, &v));
    assert_eq!(o["lignes"]["instances"].as_array().unwrap().len(), 45);
    // 100/D-19 : « À reporter : 11 925,000 » en bas de la page 1 n'est pas un article, et
    // vaut la somme courante (4 125 + 7 800)
    let (o, v) = ocr("100/D-19", |_| {});
    assert_eq!(o["lignes"]["statut"], "prouve", "{}", o["lignes"]);
    assert!(justes(&o, &v));
    // un report qui ne vaut plus la somme courante : le tableau ne ferme plus
    let (o, _) = ocr("100/D-19", |j| {
        let k = par_ordinal(j, 1, 74);
        j[k]["montants"] = json!([{"v": 11_926_000, "forte": true}]);
    });
    assert_ne!(o["lignes"]["statut"], "prouve", "{}", o["lignes"]);
}

#[test]
fn middle_out_remise_globale() {
    // 100/A-05 : Σ 627,000 − « Remise 5 % -31,350 » = Net HT 595,650
    let (o, v) = ocr("100/A-05", |_| {});
    let l = &o["lignes"];
    assert_eq!(l["statut"], "prouve", "{l}");
    assert!(justes(&o, &v));
    assert_eq!(l["remise_globale"], json!({"valeur": "31350", "refs": [{"page": 1, "ordinal": 81}]}));
    // la remise lue effacée : le taux de 5 % lu sur la rangée suffit (627 × 5 % = 31,350)
    let (o, _) = ocr("100/A-05", |j| {
        let k = par_ordinal(j, 1, 81);
        j[k]["montants"] = json!([]);
    });
    assert_eq!(o["lignes"]["remise_globale"]["refs"], json!([{"page": 1, "ordinal": 79}]), "{}", o["lignes"]);
    // ni montant ni taux de remise lus : rien ne ferme
    let (o, _) = ocr("100/A-05", |j| {
        for ord in [79, 81] {
            let k = par_ordinal(j, 1, ord);
            j[k]["montants"] = json!([]);
        }
    });
    assert_ne!(o["lignes"]["statut"], "prouve", "{}", o["lignes"]);
    // une remise lue fausse : rien ne ferme
    let (o, _) = ocr("100/A-05", |j| {
        for (ord, v) in [(79, json!([])), (81, json!([{"v": -31_340, "forte": true}]))] {
            let k = par_ordinal(j, 1, ord);
            j[k]["montants"] = v;
        }
    });
    assert_ne!(o["lignes"]["statut"], "prouve", "{}", o["lignes"]);
}

#[test]
fn middle_out_case_collee() {
    // 50/11 : « 1 » et « 2400,000 » lus « 12400,000 » (jeton 88). La quantité « 1 » de la
    // première rangée (jeton 57) est imprimée à la frontière des colonnes quantité et prix :
    // telle quelle, la pièce reste signalée ; replacée sous « QTÉ », la coupe la ferme.
    let (o, _) = ocr("50/11", |_| {});
    assert_ne!(o["lignes"]["statut"], "prouve");
    let replacer = |j: &mut Vec<Value>| {
        let k = par_ordinal(j, 1, 57);
        j[k]["x0"] = json!(0.757);
        j[k]["x1"] = json!(0.765);
    };
    let (o, v) = ocr("50/11", replacer);
    let l = &o["lignes"];
    assert_eq!(l["statut"], "prouve", "{l}");
    assert!(justes(&o, &v));
    let video = &l["instances"][3];
    let cite = json!([{"page": 1, "ordinal": 88}]);
    assert_eq!(video["quantite"], json!({"valeur": "1000", "refs": cite, "statut": "coupe", "coupe": 1}));
    assert_eq!(video["prix"], json!({"valeur": "2400000", "refs": cite, "statut": "coupe", "coupe": 1}));
    assert_eq!(l["remise_globale"]["valeur"], "406000");
    println!("{}", serde_json::to_string(&json!({"quantite": video["quantite"], "prix": video["prix"]})).unwrap());

    // Mutation : le jeton collé ramené dans la seule colonne des prix — la coupe ne sert plus.
    let (o, _) = ocr("50/11", |j| {
        replacer(j);
        let k = par_ordinal(j, 1, 88);
        j[k]["x0"] = json!(0.805);
        j[k]["x1"] = json!(0.86);
    });
    let coupes = o["lignes"]["instances"]
        .as_array()
        .map_or(0, |a| a.iter().filter(|i| i["quantite"]["statut"] == "coupe" || i["prix"]["statut"] == "coupe").count());
    assert_eq!(coupes, 0, "{}", o["lignes"]);
    assert_ne!(o["lignes"]["statut"], "prouve", "{}", o["lignes"]);
}
