//! Le code commun des tests : le pack d'essai, la grille facture d'essai, et la
//! conversion des lignes OCR des bancs en jetons. La LECTURE des montants vit ici,
//! dans le code de test, jamais dans le moteur : elle reproduit la lecture de
//! l'implémentation de référence mesurée (mode « virgule perdue »), à la place
//! du treillis TypeScript qui la fera en production.
#![allow(dead_code)]

pub mod jeux;

use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

/// Le pack d'essai : il n'existe que dans les tests (R4).
pub fn pack_essai() -> Value {
    json!({
        "decimales": 3,
        "tolerance": 1,
        "baremes": {"tva": [
            {"code": "TVA7", "ppm": 70000},
            {"code": "TVA13", "ppm": 130000},
            {"code": "TVA19", "ppm": 190000}
        ]},
        "charges": [
            {"code": "DROIT_TIMBRE", "montant_fixe": 1000, "taux_ppm": null, "assiette_tva": false},
            {"code": "FODEC", "montant_fixe": null, "taux_ppm": 10000, "assiette_tva": true}
        ],
        "formats": {"matricule_fiscal": "[0-9]{7}[A-Za-z]/[ABPDN]/[MCPNE]/[0-9]{3}"}
    })
}

/// Le taux d'un code du barème d'essai, en pour mille (l'unité de la vérité des bancs).
pub fn pour_mille(code: &str) -> i64 {
    let p = pack_essai();
    p["baremes"]["tva"].as_array().unwrap().iter().find(|t| t["code"] == code).unwrap()["ppm"].as_i64().unwrap() / 1000
}

/// La grille facture d'essai : codes et repères du catalogue `grille_tunisie.json`,
/// preuves écrites dans le langage du contrat §2.
pub fn grille_facture() -> Value {
    json!({
        "code": "facture",
        "champs": [
            {"code": "total_ht", "type": "montant", "reperes_fr": ["Total HT", "Net HT", "Montant HT"], "reperes_ar": ["المبلغ دون اعتبار الأداءات"]},
            {"code": "total_ttc", "type": "montant", "reperes_fr": ["Total TTC", "Net TTC", "TTC"], "reperes_ar": ["المبلغ الجملي"]},
            {"code": "base_tva_par_taux", "type": "montant", "reperes_fr": ["Base", "Assiette", "Base TVA"], "reperes_ar": []},
            {"code": "montant_tva_par_taux", "type": "montant", "reperes_fr": ["TVA", "Montant TVA"], "reperes_ar": ["الأداء على القيمة المضافة"]},
            {"code": "montant_fodec", "type": "montant", "reperes_fr": ["FODEC", "F.O.D.E.C"], "reperes_ar": []},
            {"code": "droit_timbre", "type": "montant", "reperes_fr": ["Timbre", "Timbre fiscal", "Droit de timbre"], "reperes_ar": ["معلوم الطابع"]},
            {"code": "mention_suspension_exoneration", "type": "texte", "reperes_fr": ["Vente en suspension de TVA", "Exonéré de TVA", "Exonération", "Article 11"], "reperes_ar": []},
            {"code": "matricule_fiscal_emetteur", "type": "identifiant", "format_code": "matricule_fiscal", "reperes_fr": ["MF", "Matricule fiscal", "M.F.", "Identifiant fiscal"], "reperes_ar": ["المعرف الجبائي"]},
            {"code": "date_emission", "type": "date", "reperes_fr": ["Date facture", "Tunis, le", "Le"], "reperes_ar": ["التاريخ"]},
            {"code": "date_echeance", "type": "date", "reperes_fr": ["Échéance", "Payable le"], "reperes_ar": []}
        ],
        "preuves": [
            {"code": "ttc", "regle": "total_ht + FODEC + somme TVA + droit de timbre = total_ttc", "genre": "arithmetique",
             "expression": {"op": "somme", "total": "total_ttc", "parties": ["total_ht", "montant_tva_par_taux", "montant_fodec?", "droit_timbre?"]}},
            {"code": "tva", "regle": "Pour chaque taux : base_tva x taux = montant_tva", "genre": "arithmetique",
             "expression": {"op": "groupe_taux", "base": "base_tva_par_taux", "montant": "montant_tva_par_taux",
                            "total_base": "total_ht", "bareme": "tva", "exoneration": "mention_suspension_exoneration"}},
            {"code": "timbre", "regle": "droit de timbre du pack", "genre": "arithmetique",
             "expression": {"op": "charge", "montant": "droit_timbre", "code": "DROIT_TIMBRE"}},
            {"code": "fodec", "regle": "FODEC = taux du pack x total HT", "genre": "arithmetique",
             "expression": {"op": "charge", "montant": "montant_fodec", "code": "FODEC", "base": "total_ht"}},
            {"code": "mf", "regle": "Matricule fiscal au format tunisien", "genre": "format",
             "expression": {"op": "format", "champ": "matricule_fiscal_emetteur", "format": "matricule_fiscal"}},
            {"code": "echeance", "regle": "émission avant échéance", "genre": "format",
             "expression": {"op": "ordre", "avant": "date_emission", "apres": "date_echeance"}},
            {"code": "lettres", "regle": "Montant en chiffres = montant en lettres", "genre": "recoupement", "expression": null}
        ]
    })
}

// ---------- Lecture des lignes OCR (reprise de la référence, mode « virgule perdue ») ----------

#[derive(Deserialize, Clone)]
pub struct Ligne {
    pub text: String,
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

#[derive(Deserialize, Clone)]
pub struct Releve {
    pub lignes: Vec<Ligne>,
}

pub struct Lecteur {
    re_nombre: Regex,
    re_int: Regex,
    re_dec: Regex,
    re_pt_virg: Regex,
    re_virg_pt: Regex,
    re_dec_longue: Regex,
    re_points: Regex,
    re_fin: Regex,
    re_debut: Regex,
    re_date: Regex,
}

impl Lecteur {
    pub fn new() -> Self {
        Lecteur {
            re_nombre: Regex::new(r"\d[\d .,]*\d|\d").unwrap(),
            re_int: Regex::new(r"^\d+$").unwrap(),
            re_dec: Regex::new(r"^(\d+)[.,](\d{1,3})$").unwrap(),
            re_pt_virg: Regex::new(r"^(\d{1,3}(?:\.\d{3})+),(\d{1,3})$").unwrap(),
            re_virg_pt: Regex::new(r"^(\d{1,3}(?:,\d{3})+)\.(\d{1,3})$").unwrap(),
            re_dec_longue: Regex::new(r"^\d+[.,]\d{4,}$").unwrap(),
            re_points: Regex::new(r"^\d{1,3}(\.\d{3}){2,}$").unwrap(),
            re_fin: Regex::new(r"(?:^|\s)(\d{1,3})$").unwrap(),
            re_debut: Regex::new(r"^(\d{3}[.,]\d{1,3})").unwrap(),
            re_date: Regex::new(r"(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4})").unwrap(),
        }
    }

    /// Lectures (valeur en millimes, faible) d'un bloc sans espace.
    fn un_bloc(&self, t: &str) -> Vec<(i64, bool)> {
        let mut v = Vec::new();
        let millimes = |ent: &str, dec: &str| -> Option<i64> {
            let e: i64 = ent.replace(['.', ','], "").parse().ok()?;
            let mut d = dec.to_string();
            while d.len() < 3 {
                d.push('0');
            }
            Some(e * 1000 + d.parse::<i64>().ok()?)
        };
        if self.re_int.is_match(t) {
            if let Ok(n) = t.parse::<i64>() {
                if t.len() <= 9 {
                    v.push((n * 1000, true));
                }
                if t.len() >= 5 && t.len() <= 12 {
                    v.push((n, true));
                }
            }
        } else if self.re_dec_longue.is_match(t) {
            if let Ok(n) = t.replace(['.', ','], "").parse::<i64>() {
                v.push((n, true));
            }
        } else if let Some(c) = self.re_dec.captures(t) {
            if let Some(m) = millimes(&c[1], &c[2]) {
                v.push((m, false));
            }
            if c[2].len() == 3 && c[1].len() <= 3 {
                if let Ok(n) = format!("{}{}", &c[1], &c[2]).parse::<i64>() {
                    v.push((n * 1000, true));
                }
            }
        } else if let Some(c) = self.re_pt_virg.captures(t) {
            if let Some(m) = millimes(&c[1], &c[2]) {
                v.push((m, false));
            }
        } else if let Some(c) = self.re_virg_pt.captures(t) {
            if let Some(m) = millimes(&c[1], &c[2]) {
                v.push((m, false));
            }
        } else if self.re_points.is_match(t) {
            if let Ok(n) = t.replace('.', "").parse::<i64>() {
                v.push((n, true));
            }
        }
        v
    }

    fn lectures(&self, s: &str) -> Vec<(i64, bool)> {
        let mut v = Vec::new();
        let groupes: Vec<&str> = s.split(' ').filter(|g| !g.is_empty()).collect();
        for k in 0..groupes.len() {
            let suffixe = &groupes[k..];
            let ok = suffixe.iter().skip(1).all(|g| g.chars().take_while(|c| c.is_ascii_digit()).count() == 3)
                && (suffixe.len() == 1 || suffixe[0].chars().all(|c| c.is_ascii_digit()) && suffixe[0].len() <= 3);
            if ok {
                v.extend(self.un_bloc(&suffixe.concat()));
            }
            if k < groupes.len() - 1 && groupes[k].chars().all(|c| c.is_ascii_digit()) {
                if let Ok(n) = groupes[k].parse::<i64>() {
                    v.push((n * 1000, true));
                }
            }
        }
        v.sort();
        v.dedup();
        v
    }

    /// Les montants lus d'une ligne : (valeur, forte).
    fn montants(&self, t: &str) -> Vec<(i64, bool)> {
        let mut out = Vec::new();
        for m in self.re_nombre.find_iter(t) {
            let avant = t[..m.start()].chars().last();
            let apres = t[m.end()..].trim_start().chars().next();
            let colle = |ch: Option<char>| ch.is_some_and(|c| c.is_alphabetic() || c == '/' || c == '-' || c == '°');
            if colle(avant) || colle(t[m.end()..].chars().next()) {
                continue;
            }
            if apres == Some('%') {
                continue;
            }
            for (val, faible) in self.lectures(m.as_str().trim_end_matches(['.', ','])) {
                if val > 0 {
                    out.push((val, !faible));
                }
            }
        }
        out
    }

    fn date(&self, t: &str) -> Option<String> {
        let c = self.re_date.captures(t)?;
        let (j, m, a): (u32, u32, u32) = (c[1].parse().ok()?, c[2].parse().ok()?, c[3].parse().ok()?);
        if !(1..=12).contains(&m) || !(1..=31).contains(&j) {
            return None;
        }
        Some(format!("{a:04}-{m:02}-{j:02}"))
    }

    /// Un relevé OCR devient un plan de jetons : une ligne, un jeton.
    pub fn jetons(&self, lignes: &[Ligne]) -> Vec<Value> {
        let mut montants: Vec<Vec<(i64, bool)>> = lignes.iter().map(|l| self.montants(&l.text)).collect();
        // Un montant coupé en deux boîtes sur la même ligne : « 5 » puis « 650,000 » ;
        // la lecture recollée, faible, est portée par la seconde boîte.
        for a in lignes {
            for (ib, b) in lignes.iter().enumerate() {
                let h = (a.y1 - a.y0).max(1e-6);
                let recouvre = (a.y1.min(b.y1) - a.y0.max(b.y0)) / h;
                let ecart = b.x0 - a.x1;
                if recouvre > 0.5 && ecart > 0.0 && ecart < 2.0 * h {
                    if let (Some(ca), Some(cb)) = (self.re_fin.captures(a.text.trim()), self.re_debut.captures(b.text.trim())) {
                        for (val, _) in self.un_bloc(&format!("{}{}", &ca[1], &cb[1])) {
                            if val > 0 {
                                montants[ib].push((val, false));
                            }
                        }
                    }
                }
            }
        }
        lignes
            .iter()
            .enumerate()
            .map(|(i, l)| {
                let ms: Vec<Value> = montants[i].iter().map(|(v, f)| json!({"v": v, "forte": f})).collect();
                json!({"page": 1, "ordinal": i, "texte": l.text, "x0": l.x0, "y0": l.y0, "x1": l.x1, "y1": l.y1,
                       "montants": ms, "date": self.date(&l.text)})
            })
            .collect()
    }
}

pub fn entree(jetons: Vec<Value>, grille: Value, pack: Value) -> String {
    json!({"jetons": jetons, "grille": grille, "pack": pack}).to_string()
}

pub fn resoudre(jetons: Vec<Value>, grille: Value, pack: Value) -> Value {
    serde_json::from_str(&malica_sudoku::solve(&entree(jetons, grille, pack))).unwrap()
}

/// Un jeton synthétique : un libellé suivi d'un montant, à la ligne y.
pub fn jeton(ordinal: u32, texte: &str, x0: f64, y: f64, montants: &[(i64, bool)]) -> Value {
    let ms: Vec<Value> = montants.iter().map(|(v, f)| json!({"v": v, "forte": f})).collect();
    json!({"page": 1, "ordinal": ordinal, "texte": texte, "x0": x0, "y0": y, "x1": x0 + 0.2, "y1": y + 0.02,
           "montants": ms, "date": null})
}

pub fn donnees(nom: &str) -> String {
    std::fs::read_to_string(format!("{}/tests/donnees/{nom}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

pub fn releves(nom: &str) -> HashMap<String, Releve> {
    serde_json::from_str(&donnees(nom)).unwrap()
}

/// La valeur rendue d'un champ, en entier ; 0 si absent.
pub fn valeur(o: &Value, champ: &str) -> i64 {
    o["champs"][champ]["valeur"].as_str().map_or(0, |s| s.parse().unwrap())
}

/// Les montants de TVA rendus, en (taux pour mille, montant), triés.
pub fn tva(o: &Value) -> Vec<(i64, i64)> {
    let mut v: Vec<(i64, i64)> = o["champs"]["montant_tva_par_taux"]["instances"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|i| (pour_mille(i["taux"].as_str().unwrap()), i["valeur"].as_str().map_or(0, |s| s.parse().unwrap())))
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}
