//! Les champs non numériques (date, identifiant) : candidats = jetons dont la
//! valeur respecte le format fourni en entrée ; ancrage = un libellé repère du
//! champ sur le jeton avant la valeur, juste à gauche ou juste au-dessus.
//! Statut `conforme` si une seule valeur valide (ancrée de préférence), sinon
//! `signale` ; `absent` quand aucun jeton ne porte de valeur valide.

use crate::entree::{Champ, Pack};
use crate::reperes::{reperes_de, Plan};
use regex::Regex;

pub struct Lecture {
    pub valeur: String,
    pub jeton: usize,
    pub ancree: bool,
}

pub enum Issue {
    Conforme(Lecture),
    Signale,
    Absent,
}

pub(crate) fn iso_valide(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

/// Les types non numériques que le moteur sait lire : la date, et l'identifiant
/// dont le format est fourni par le pack. Les autres ne sont pas émis.
pub fn traite(champ: &Champ, pack: &Pack) -> bool {
    match champ.genre.as_str() {
        "date" => true,
        "identifiant" => champ.format_code.as_ref().is_some_and(|f| pack.formats.contains_key(f)),
        _ => false,
    }
}

pub fn lire(champ: &Champ, pack: &Pack, plan: &Plan) -> Result<Issue, String> {
    let reperes = reperes_de(champ);
    let mut lectures: Vec<Lecture> = Vec::new();
    match champ.genre.as_str() {
        "date" => {
            for (i, j) in plan.jetons.iter().enumerate() {
                if let Some(d) = &j.date {
                    if iso_valide(d) {
                        lectures.push(Lecture { valeur: d.clone(), jeton: i, ancree: plan.ancre(i, &reperes, None, true) });
                    }
                }
            }
        }
        "identifiant" => {
            let code = champ.format_code.as_deref().unwrap_or_default();
            let motif = pack.formats.get(code).ok_or_else(|| format!("format « {code} » absent du pack"))?;
            let re = Regex::new(motif).map_err(|e| format!("format « {code} » invalide : {e}"))?;
            for (i, j) in plan.jetons.iter().enumerate() {
                for m in re.find_iter(&j.texte) {
                    if m.as_str().is_empty() {
                        continue;
                    }
                    let ancree = plan.ancre(i, &reperes, Some(&j.texte[..m.start()]), true);
                    lectures.push(Lecture { valeur: m.as_str().to_string(), jeton: i, ancree });
                }
            }
        }
        _ => return Ok(Issue::Absent),
    }
    if lectures.is_empty() {
        return Ok(Issue::Absent);
    }
    let distinctes = |l: &[&Lecture]| {
        let mut v: Vec<&str> = l.iter().map(|x| x.valeur.as_str()).collect();
        v.sort();
        v.dedup();
        v.len()
    };
    let ancrees: Vec<&Lecture> = lectures.iter().filter(|l| l.ancree).collect();
    let toutes: Vec<&Lecture> = lectures.iter().collect();
    let retenues = if ancrees.is_empty() { toutes } else { ancrees };
    let n = distinctes(&retenues);
    if n == 1 {
        let l = retenues[0];
        return Ok(Issue::Conforme(Lecture { valeur: l.valeur.clone(), jeton: l.jeton, ancree: l.ancree }));
    }
    Ok(Issue::Signale)
}

/// La valeur respecte-t-elle entièrement le motif nommé ?
pub fn respecte(valeur: &str, motif: &str) -> Result<bool, String> {
    let re = Regex::new(&format!("^(?:{motif})$")).map_err(|e| format!("format invalide : {e}"))?;
    Ok(re.is_match(valeur))
}
