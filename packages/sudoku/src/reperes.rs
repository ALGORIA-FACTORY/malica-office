//! Les libellés repères : comparés sans accents, sans casse et sans espaces
//! (l'OCR colle souvent les mots : « Matriculefiscal: »), et l'ancrage d'un
//! jeton à un repère — sur le jeton lui-même avant la valeur, sur le jeton
//! juste à gauche sur la même ligne, ou sur le jeton juste au-dessus (ces
//! voisins n'ancrent que s'ils sont de purs libellés, sans montant ni date).

use crate::entree::{Champ, Jeton};

pub fn normaliser(s: &str) -> String {
    s.chars()
        .flat_map(|c| c.to_lowercase())
        .filter(|c| !c.is_whitespace())
        .map(|c| match c {
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'à' | 'â' | 'ä' => 'a',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'û' | 'ù' | 'ü' => 'u',
            'ç' => 'c',
            _ => c,
        })
        .collect()
}

/// Les repères d'un champ, normalisés, sans les vides.
pub fn reperes_de(champ: &Champ) -> Vec<String> {
    champ
        .reperes_fr
        .iter()
        .chain(champ.reperes_ar.iter())
        .map(|r| normaliser(r))
        .filter(|r| !r.is_empty())
        .collect()
}

/// Le plan des jetons avec, pour chacun, son texte normalisé et ses voisins
/// immédiats à gauche (même ligne) et au-dessus (même colonne).
pub struct Plan<'a> {
    pub jetons: &'a [Jeton],
    pub normes: Vec<String>,
    gauche: Vec<Option<usize>>,
    dessus: Vec<Option<usize>>,
}

impl<'a> Plan<'a> {
    pub fn new(jetons: &'a [Jeton]) -> Self {
        let normes = jetons.iter().map(|j| normaliser(&j.texte)).collect();
        let n = jetons.len();
        let mut gauche = vec![None; n];
        let mut dessus = vec![None; n];
        for (i, a) in jetons.iter().enumerate() {
            let ha = (a.y1 - a.y0).max(f64::EPSILON);
            let la = (a.x1 - a.x0).max(f64::EPSILON);
            let mut meilleur_g: Option<(usize, f64)> = None;
            let mut meilleur_d: Option<(usize, f64)> = None;
            for (k, b) in jetons.iter().enumerate() {
                if k == i || b.page != a.page {
                    continue;
                }
                let hb = (b.y1 - b.y0).max(f64::EPSILON);
                let recouvre_v = (a.y1.min(b.y1) - a.y0.max(b.y0)) / ha.min(hb);
                // juste à gauche : même ligne (recouvrement vertical majoritaire), le plus proche
                if recouvre_v > 0.5 && b.x1 <= a.x0 + 0.25 * ha && b.x0 < a.x0
                    && meilleur_g.is_none_or(|(_, x)| b.x1 > x) {
                        meilleur_g = Some((k, b.x1));
                    }
                // juste au-dessus : recouvrement horizontal, le plus proche verticalement
                let lb = (b.x1 - b.x0).max(f64::EPSILON);
                let recouvre_h = (a.x1.min(b.x1) - a.x0.max(b.x0)) / la.min(lb);
                if recouvre_h > 0.0 && b.y1 <= a.y0 + 0.25 * ha && b.y0 < a.y0
                    && meilleur_d.is_none_or(|(_, y)| b.y1 > y) {
                        meilleur_d = Some((k, b.y1));
                    }
            }
            gauche[i] = meilleur_g.map(|(k, _)| k);
            dessus[i] = meilleur_d.map(|(k, _)| k);
        }
        Plan { jetons, normes, gauche, dessus }
    }

    /// Un repère est-il lu sur une RANGÉE qui porte un montant, à gauche de ce montant ?
    ///
    /// C'est la présence d'un champ facultatif : « Retenue à la source … -153,153 »
    /// l'annonce, une mention de bas de page (« retenue à la source applicable au-delà
    /// de 1 000 DT ») ou un titre (« Facture d'acompte ») ne l'annonce pas — mesuré le
    /// 31/10/2026 sur le jeu de 100 factures (B-16, C-19).
    pub fn annonce_chiffree(&self, reperes: &[String]) -> bool {
        if reperes.is_empty() {
            return false;
        }
        self.jetons.iter().enumerate().any(|(i, a)| {
            if a.montants.is_empty() {
                return false;
            }
            let ha = (a.y1 - a.y0).max(f64::EPSILON);
            self.jetons.iter().enumerate().any(|(k, b)| {
                if k == i || b.page != a.page || b.x0 >= a.x0 {
                    return false;
                }
                let hb = (b.y1 - b.y0).max(f64::EPSILON);
                let recouvre_v = (a.y1.min(b.y1) - a.y0.max(b.y0)) / ha.min(hb);
                recouvre_v > 0.5 && reperes.iter().any(|r| self.normes[k].contains(r.as_str()))
            }) || reperes.iter().any(|r| self.normes[i].contains(r.as_str()))
                // ou en tête de sa colonne, juste au-dessus
                || self.dessus[i].is_some_and(|k| reperes.iter().any(|r| self.normes[k].contains(r.as_str())))
        })
    }

    /// Le jeton `i` porte-t-il son libellé, imprimé juste avant lui sur sa rangée ? Sur le
    /// jeton lui-même (« Total HT 500,000 »), ou dans la suite de purs mots (ni montant, ni
    /// date, ni chiffre) qui le précède sans interruption dans le sens de lecture : à gauche
    /// (« Total | HT | 1 670,000 ») ou, sur une pièce de droite à gauche, à droite. Une autre
    /// valeur entre le libellé et `i` coupe la suite : sur « Total HT 1 670,000 Total TTC
    /// 1 749,800 », 1 749,800 n'est pas ancré par « Total HT ».
    pub fn libelle_avant(&self, i: usize, reperes: &[String]) -> bool {
        if reperes.is_empty() {
            return false;
        }
        let contient = |t: &str| reperes.iter().any(|r| t.contains(r.as_str()));
        if contient(&self.normes[i]) {
            return true;
        }
        let a = &self.jetons[i];
        let ha = (a.y1 - a.y0).max(f64::EPSILON);
        let meme_rangee = |b: &Jeton| {
            let hb = (b.y1 - b.y0).max(f64::EPSILON);
            b.page == a.page && (a.y1.min(b.y1) - a.y0.max(b.y0)) / ha.min(hb) > 0.5
        };
        let libelle = |b: &Jeton| b.montants.is_empty() && b.date.is_none() && !b.texte.chars().any(|c| c.is_ascii_digit());
        // De la valeur vers l'extérieur, mot à mot. Les mots d'un libellé latin restent dans
        // l'ordre visuel même quand la pièce s'aligne à droite (« 178,000 | Total | HT »), et
        // une couche de texte de droite à gauche les rend en miroir (« 178,000 | HT | Total ») :
        // la suite se lit dans les deux ordres.
        let suite_lue = |mut cote: Vec<usize>| {
            let (mut vers, mut depuis) = (String::new(), String::new());
            for k in cote.drain(..) {
                if !libelle(&self.jetons[k]) {
                    return false;
                }
                vers.push_str(&self.normes[k]);
                depuis.insert_str(0, &self.normes[k]);
                if contient(&vers) || contient(&depuis) {
                    return true;
                }
            }
            false
        };
        let ordre = |x: &usize, y: &usize| self.jetons[*x].x0.partial_cmp(&self.jetons[*y].x0).unwrap_or(std::cmp::Ordering::Equal);
        let mut gauche: Vec<usize> = (0..self.jetons.len())
            .filter(|&k| k != i && meme_rangee(&self.jetons[k]) && self.jetons[k].x1 <= a.x0 + 0.25 * ha)
            .collect();
        gauche.sort_by(|x, y| ordre(y, x));
        let mut droite: Vec<usize> = (0..self.jetons.len())
            .filter(|&k| k != i && meme_rangee(&self.jetons[k]) && self.jetons[k].x0 >= a.x1 - 0.25 * ha)
            .collect();
        droite.sort_by(ordre);
        suite_lue(gauche) || suite_lue(droite)
    }

    /// Un repère est-il lu quelque part sur la pièce ?
    pub fn annonce(&self, reperes: &[String]) -> bool {
        !reperes.is_empty() && self.normes.iter().any(|t| reperes.iter().any(|r| t.contains(r.as_str())))
    }

    /// Le jeton `i` est-il ancré par l'un des repères ? `avant` : le texte brut du
    /// jeton qui précède la valeur, quand on connaît sa position ; sinon tout le jeton.
    /// `dessus` : le jeton juste au-dessus compte aussi (en-tête de colonne).
    pub fn ancre(&self, i: usize, reperes: &[String], avant: Option<&str>, dessus: bool) -> bool {
        if reperes.is_empty() {
            return false;
        }
        let contient = |t: &str| reperes.iter().any(|r| t.contains(r.as_str()));
        let propre = match avant {
            Some(a) => contient(&normaliser(a)),
            None => contient(&self.normes[i]),
        };
        // un voisin n'ancre que s'il est un pur libellé : il ne porte lui-même ni montant ni date
        let libelle = |k: usize| {
            let j = &self.jetons[k];
            j.montants.is_empty() && j.date.is_none() && contient(&self.normes[k])
        };
        propre || self.gauche[i].is_some_and(libelle) || (dessus && self.dessus[i].is_some_and(libelle))
    }
}
