//! Les champs non numériques (date, identifiant) : candidats = jetons dont la
//! valeur respecte le format fourni en entrée — ou que le lecteur du pack y a lue
//! (`identifiants`, `date` sur plusieurs jetons) ; ancrage = un libellé repère du
//! champ sur le jeton avant la valeur, juste à gauche ou juste au-dessus.
//! Statut `conforme` si une seule valeur valide ANCRÉE, sinon `signale` ; `absent`
//! quand aucun jeton ne porte de valeur valide.

use crate::entree::{Champ, Jeton, Pack};
use crate::reperes::{reperes_de, Plan, MOTS_D_UN_LIBELLE};
use regex::Regex;

pub struct Lecture {
    pub valeur: String,
    pub jeton: usize,
    /// Le dernier jeton de la valeur (le même, quand elle tient dans un jeton).
    pub fin: usize,
    pub ancree: bool,
}

/// Le dernier jeton d'une valeur portée par le jeton `i` et qui s'étend jusqu'à l'ordinal
/// `fin` sur la même page ; `i` lui-même quand elle tient dans un jeton.
pub(crate) fn jusqua(jetons: &[Jeton], i: usize, fin: Option<u32>) -> usize {
    let Some(f) = fin else { return i };
    let page = jetons[i].page;
    (i..jetons.len().min(i + 16))
        .take_while(|&k| jetons[k].page == page)
        .find(|&k| jetons[k].ordinal == f)
        .unwrap_or(i)
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
    // une cellule d'une parcelle répétée n'est pas un champ de la pièce
    if champ.repetee {
        return false;
    }
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
                        let fin = jusqua(plan.jetons, i, j.date_fin);
                        lectures.push(Lecture { valeur: d.clone(), jeton: i, fin, ancree: plan.ancre_valeur(i, fin, &reperes, None, true, MOTS_D_UN_LIBELLE) });
                    }
                }
            }
        }
        "identifiant" => {
            let code = champ.format_code.as_deref().unwrap_or_default();
            let motif = pack.formats.get(code).ok_or_else(|| format!("format « {code} » absent du pack"))?;
            let re = Regex::new(motif).map_err(|e| format!("format « {code} » invalide : {e}"))?;
            for (i, j) in plan.jetons.iter().enumerate() {
                // Ce que le lecteur du pack a lu dans le jeton (normalisé : étiquette collée,
                // chiffres arabes, « l » pour « 1 ») l'emporte sur le motif brut.
                let normalises: Vec<_> = j.identifiants.iter().filter(|x| x.format == code).collect();
                if !normalises.is_empty() {
                    for x in normalises {
                        let fin = jusqua(plan.jetons, i, Some(x.fin));
                        lectures.push(Lecture { valeur: x.valeur.clone(), jeton: i, fin, ancree: plan.ancre_valeur(i, fin, &reperes, None, true, MOTS_D_UN_LIBELLE) });
                    }
                    continue;
                }
                for m in re.find_iter(&j.texte) {
                    if m.as_str().is_empty() {
                        continue;
                    }
                    let ancree = plan.ancre(i, &reperes, Some(&j.texte[..m.start()]), true);
                    lectures.push(Lecture { valeur: m.as_str().to_string(), jeton: i, fin: i, ancree });
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
    // Une valeur n'est celle du champ que si un repère du champ la désigne. Une date ou un
    // identifiant sans libellé n'est à aucun champ en particulier : banc sans IA du
    // 4 novembre 2026, la seule date d'une attestation (« 1053.1.14 », une adresse lue
    // de travers) était rendue comme date d'entrée, de sortie, de naissance et de
    // signature à la fois. Sans ancre, le champ se tait (signalé : une valeur existe).
    let ancrees: Vec<&Lecture> = lectures.iter().filter(|l| l.ancree).collect();
    if ancrees.is_empty() {
        return Ok(Issue::Signale);
    }
    // L'identifiant d'une PARTIE (le champ a un rôle) quand la page en porte plusieurs : le
    // libellé « matricule fiscal » ne dit pas de qui. Banc du 4 novembre 2026, bail : le
    // matricule du preneur, seul suivi de son libellé, était rendu comme celui du bailleur.
    // La partie se décide par l'identité (anneau 2), pas par le voisin.
    if champ.genre == "identifiant" && champ.role.is_some() && distinctes(&lectures.iter().collect::<Vec<_>>()) > 1 {
        return Ok(Issue::Signale);
    }
    if distinctes(&ancrees) == 1 {
        let l = ancrees[0];
        return Ok(Issue::Conforme(Lecture { valeur: l.valeur.clone(), jeton: l.jeton, fin: l.fin, ancree: l.ancree }));
    }
    Ok(Issue::Signale)
}

/// La valeur respecte-t-elle entièrement le motif nommé ?
pub fn respecte(valeur: &str, motif: &str) -> Result<bool, String> {
    let re = Regex::new(&format!("^(?:{motif})$")).map_err(|e| format!("format invalide : {e}"))?;
    Ok(re.is_match(valeur))
}
