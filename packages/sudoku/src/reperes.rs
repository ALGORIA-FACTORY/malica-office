//! Les libellés repères : comparés sans accents, sans casse et sans espaces
//! (l'OCR colle souvent les mots : « Matriculefiscal: »), et l'ancrage d'un
//! jeton à un repère — sur le jeton lui-même avant la valeur, sur le jeton
//! juste à gauche sur la même ligne, ou sur le jeton juste au-dessus (ces
//! voisins n'ancrent que s'ils sont de purs libellés, sans montant ni date).

use crate::entree::{Champ, Jeton};
use crate::valeurs::{CENT, PPM};
use std::collections::{BTreeMap, BTreeSet};

/// Un texte d'une écriture de droite à gauche : l'hébreu, l'arabe, le syriaque, le
/// thâna, le n'ko… — les blocs Unicode dont les lettres ont la classe bidirectionnelle
/// R ou AL. Son libellé se lit à DROITE de sa valeur, et le bloc qu'il ouvre s'étend
/// vers la gauche : toute relation « avant / après » du moteur se calcule dans l'ordre
/// de lecture du jeton, jamais en « gauche / droite » écrit en dur.
///
/// Banc sans IA du 4 novembre 2026 : les pièces arabes se lisaient comme des pièces
/// françaises — l'étiquette « الحريف » (client) ouvrait son bloc vers la droite, sur la
/// colonne du fournisseur, et le sens de six achats sortait « vente ».
pub fn droite_a_gauche(s: &str) -> bool {
    s.chars().any(|c| {
        matches!(c,
            '\u{0590}'..='\u{08FF}' | '\u{FB1D}'..='\u{FDFF}' | '\u{FE70}'..='\u{FEFF}'
            | '\u{10800}'..='\u{10FFF}' | '\u{1E800}'..='\u{1EFFF}')
            && c.is_alphabetic()
    })
}

/// Les proclitiques arabes collés à un mot défini se ramènent à l'article : « للحريف » (pour
/// le client) se compare à « الحريف », comme « وال… », « بال… », « فال… », « كال… ». Une
/// étiquette arabe porte souvent le nom de la partie avec sa préposition (« المعرف الجبائي
/// للحريف ») : sans ce retour, « الحريف » n'y était jamais reconnu.
fn sans_proclitique(mot: &str) -> String {
    for p in ["لل", "وال", "بال", "فال", "كال"] {
        if let Some(reste) = mot.strip_prefix(p) {
            if reste.chars().count() >= 2 {
                return format!("ال{reste}");
            }
        }
    }
    mot.to_string()
}

/// Les mots au plus d'un libellé de date ou d'identifiant lu sur ses voisins
/// (« Date de la livraison », « المعرّف البنكي »).
pub const MOTS_D_UN_LIBELLE: usize = 4;

/// En deçà de tant de lettres, un repère n'est reconnu que comme un mot entier.
const REPERE_COURT: usize = 4;

pub fn normaliser(s: &str) -> String {
    let s: String = s
        .split_whitespace()
        .map(sans_proclitique)
        .collect::<Vec<_>>()
        .join(" ");
    s.chars()
        .flat_map(|c| c.to_lowercase())
        // Les signes qui ne changent pas le mot arabe : voyelles brèves, chadda, soukoun,
        // alif suscrit, tatwil. « المعرّف » et « المعرف » sont un même libellé.
        .filter(|c| {
            !c.is_whitespace() && !matches!(c, '\u{064B}'..='\u{065F}' | '\u{0670}' | '\u{0640}')
        })
        .map(|c| match c {
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'à' | 'â' | 'ä' => 'a',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'û' | 'ù' | 'ü' => 'u',
            'ç' => 'c',
            // les formes de l'alif, et le ya final sans points
            'أ' | 'إ' | 'آ' | 'ٱ' => 'ا',
            'ى' => 'ي',
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
    /// Le voisin de droite, sur la même ligne : le libellé d'une valeur écrite de droite à gauche.
    droite: Vec<Option<usize>>,
    dessus: Vec<Option<usize>>,
    rtl: Vec<bool>,
    /// Les libellés (normalisés) que l'ordre d'une colonne de libellés donne à une valeur
    /// (`colonnes_de_libelles`).
    paires: BTreeMap<usize, Vec<String>>,
    /// Les taux (en ppm) imprimés sur une rangée sans mot qui porte un montant imprimé.
    taux_chiffres: BTreeSet<i64>,
}

impl<'a> Plan<'a> {
    pub fn new(jetons: &'a [Jeton]) -> Self {
        let normes = jetons.iter().map(|j| normaliser(&j.texte)).collect();
        let n = jetons.len();
        let mut gauche = vec![None; n];
        let mut droite = vec![None; n];
        let mut dessus = vec![None; n];
        for (i, a) in jetons.iter().enumerate() {
            let ha = (a.y1 - a.y0).max(f64::EPSILON);
            let la = (a.x1 - a.x0).max(f64::EPSILON);
            let mut meilleur_g: Option<(usize, f64)> = None;
            let mut meilleur_dr: Option<(usize, f64)> = None;
            let mut meilleur_d: Option<(usize, f64)> = None;
            for (k, b) in jetons.iter().enumerate() {
                if k == i || b.page != a.page {
                    continue;
                }
                let hb = (b.y1 - b.y0).max(f64::EPSILON);
                let recouvre_v = (a.y1.min(b.y1) - a.y0.max(b.y0)) / ha.min(hb);
                // juste à gauche : même ligne (recouvrement vertical majoritaire), le plus proche
                if recouvre_v > 0.5
                    && b.x1 <= a.x0 + 0.25 * ha
                    && b.x0 < a.x0
                    && meilleur_g.is_none_or(|(_, x)| b.x1 > x)
                {
                    meilleur_g = Some((k, b.x1));
                }
                // juste à droite : même ligne, le plus proche
                if recouvre_v > 0.5
                    && b.x0 >= a.x1 - 0.25 * ha
                    && b.x1 > a.x1
                    && meilleur_dr.is_none_or(|(_, x)| b.x0 < x)
                {
                    meilleur_dr = Some((k, b.x0));
                }
                // juste au-dessus : recouvrement horizontal, le plus proche verticalement
                let lb = (b.x1 - b.x0).max(f64::EPSILON);
                let recouvre_h = (a.x1.min(b.x1) - a.x0.max(b.x0)) / la.min(lb);
                if recouvre_h > 0.0
                    && b.y1 <= a.y0 + 0.25 * ha
                    && b.y0 < a.y0
                    && meilleur_d.is_none_or(|(_, y)| b.y1 > y)
                {
                    meilleur_d = Some((k, b.y1));
                }
            }
            gauche[i] = meilleur_g.map(|(k, _)| k);
            droite[i] = meilleur_dr.map(|(k, _)| k);
            dessus[i] = meilleur_d.map(|(k, _)| k);
        }
        let rtl = jetons.iter().map(|j| droite_a_gauche(&j.texte)).collect();
        let paires = colonnes_de_libelles(jetons);
        let taux_chiffres = taux_sur_rangees_chiffrees(jetons);
        Plan {
            jetons,
            normes,
            gauche,
            droite,
            dessus,
            rtl,
            paires,
            taux_chiffres,
        }
    }

    /// Le taux `ppm` est-il imprimé, sans mot, sur une rangée qui porte un montant
    /// (« 31,675 1 % ») ?
    pub fn taux_chiffre(&self, ppm: i64) -> bool {
        self.taux_chiffres.contains(&ppm)
    }

    /// Un taux NUL (« 0 % ») est-il imprimé sur une rangée qui porte un montant non nul : la
    /// ventilation qui imprime sa part exonérée (« TVA 0 % — Base 1.988,009 0,000 »), ou une
    /// ligne d'article à 0 % ? C'est la preuve qu'une part du total est sous un taux nul,
    /// même sans mention d'exonération (banc sans IA du 5 novembre 2026 : 31 factures
    /// muettes). L'arithmétique décide ensuite : HT, TVA nulle et TTC doivent fermer.
    pub fn taux_nul_imprime(&self) -> bool {
        let zero = regex::Regex::new(r"(?:^|[^\d.,])0(?:[.,]0{1,3})?\s*%").expect("motif");
        crate::lignes::rangees_selon(self.jetons, f64::min)
            .iter()
            .any(|r| {
                let texte: String = r
                    .iter()
                    .map(|&i| self.jetons[i].texte.as_str())
                    .collect::<Vec<_>>()
                    .join(" ");
                zero.is_match(&texte)
                    && r.iter()
                        .any(|&i| self.jetons[i].montants.iter().any(|m| m.forte && m.v != 0))
            })
    }

    /// La valeur `i` est-elle, dans l'ordre d'une colonne de libellés, celle d'un repère ?
    pub fn apparie(&self, i: usize, reperes: &[String]) -> bool {
        self.paires.get(&i).is_some_and(|ts| {
            ts.iter()
                .any(|t| reperes.iter().any(|r| t.contains(r.as_str())))
        })
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
                // le libellé précède le montant dans son ordre de lecture
                let avant = if self.rtl[k] { b.x0 > a.x0 } else { b.x0 < a.x0 };
                if k == i || b.page != a.page || !avant {
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
        self.libelle_avant_selon(i, reperes, false)
    }

    /// `libelle_avant`, un libellé ARABE d'au moins huit lettres se lisant aussi à une lettre
    /// près (une lettre perdue, ajoutée ou changée) : l'OCR rend « اعتار » pour « اعتبار »
    /// (diagnostic des pièces non prouvées, 8 novembre 2026). Un libellé latin, ou court, se
    /// lit toujours exactement.
    pub fn libelle_avant_a_une_lettre(&self, i: usize, reperes: &[String]) -> bool {
        self.libelle_avant_selon(i, reperes, true)
    }

    fn libelle_avant_selon(&self, i: usize, reperes: &[String], approche: bool) -> bool {
        if reperes.is_empty() {
            return false;
        }
        let contient = |t: &str| {
            reperes.iter().any(|r| {
                t.contains(r.as_str())
                    || (approche
                        && r.chars().count() >= 8
                        && r.chars().any(|c| ('\u{0600}'..='\u{06FF}').contains(&c))
                        && a_une_lettre_pres(t, r))
            })
        };
        if contient(&self.normes[i]) {
            return true;
        }
        let a = &self.jetons[i];
        let ha = (a.y1 - a.y0).max(f64::EPSILON);
        let meme_rangee = |b: &Jeton| {
            let hb = (b.y1 - b.y0).max(f64::EPSILON);
            b.page == a.page && (a.y1.min(b.y1) - a.y0.max(b.y0)) / ha.min(hb) > 0.5
        };
        let libelle = |b: &Jeton| {
            b.montants.is_empty()
                && b.date.is_none()
                && !b.texte.chars().any(|c| c.is_ascii_digit())
        };
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
        let ordre = |x: &usize, y: &usize| {
            self.jetons[*x]
                .x0
                .partial_cmp(&self.jetons[*y].x0)
                .unwrap_or(std::cmp::Ordering::Equal)
        };
        let mut gauche: Vec<usize> = (0..self.jetons.len())
            .filter(|&k| {
                k != i && meme_rangee(&self.jetons[k]) && self.jetons[k].x1 <= a.x0 + 0.25 * ha
            })
            .collect();
        gauche.sort_by(|x, y| ordre(y, x));
        let mut droite: Vec<usize> = (0..self.jetons.len())
            .filter(|&k| {
                k != i && meme_rangee(&self.jetons[k]) && self.jetons[k].x0 >= a.x1 - 0.25 * ha
            })
            .collect();
        droite.sort_by(ordre);
        suite_lue(gauche) || suite_lue(droite)
    }

    /// Un repère est-il imprimé, MOT POUR MOT, comme libellé d'un montant ? Les mots entiers
    /// (purs mots : ni montant, ni date, ni chiffre) qui précèdent un montant sur sa rangée, de
    /// gauche à droite, contiennent une suite de mots consécutifs qui EST le repère
    /// (« Indemnité | de | transport | 89,000 »). Contrairement à `annonce_chiffree`, le
    /// libellé peut s'étendre sur plusieurs jetons ; contrairement à un simple « contient »,
    /// un repère court ne se lit pas à cheval sur deux mots (« Prêt » n'est pas dans
    /// « … présent »). Une pièce de droite à gauche n'est pas lue ainsi.
    pub fn annonce_en_mots(&self, reperes: &[String]) -> bool {
        if reperes.is_empty() {
            return false;
        }
        (0..self.jetons.len()).any(|i| {
            let a = &self.jetons[i];
            if a.montants.is_empty() || self.rtl[i] {
                return false;
            }
            let ha = (a.y1 - a.y0).max(f64::EPSILON);
            let mut gauche: Vec<usize> = (0..self.jetons.len())
                .filter(|&k| {
                    let b = &self.jetons[k];
                    let hb = (b.y1 - b.y0).max(f64::EPSILON);
                    k != i
                        && b.page == a.page
                        && (a.y1.min(b.y1) - a.y0.max(b.y0)) / ha.min(hb) > 0.5
                        && b.x1 <= a.x0 + 0.25 * ha
                })
                .collect();
            gauche.sort_by(|x, y| {
                self.jetons[*x]
                    .x0
                    .partial_cmp(&self.jetons[*y].x0)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            // les mots qui précèdent le montant sans interruption, dans l'ordre de lecture
            let mut mots: Vec<&str> = Vec::new();
            for &k in gauche.iter().rev() {
                let b = &self.jetons[k];
                if !b.montants.is_empty()
                    || b.date.is_some()
                    || b.texte.chars().any(|c| c.is_ascii_digit())
                {
                    break;
                }
                mots.insert(0, self.normes[k].as_str());
            }
            (0..mots.len()).any(|d| {
                let mut suite = String::new();
                mots[d..].iter().any(|m| {
                    suite.push_str(m);
                    reperes.iter().any(|r| !r.is_empty() && suite == *r)
                })
            })
        })
    }

    /// Le jeton `i` est-il la DERNIÈRE valeur d'une rangée que son libellé ouvre ? Le libellé
    /// est la suite de purs mots (ni montant, ni date, ni chiffre) qui commence la rangée, de
    /// gauche à droite ; il doit contenir l'un des repères. Une rubrique de bulletin de paie
    /// imprime sa base et son taux entre son libellé et son montant (« Cotisation CNSS |
    /// 4 200,000 | 9,18 % | 385,560 ») : `ancre` ne voit que la base, voisine du libellé.
    /// Une pièce de droite à gauche n'est pas lue ainsi.
    pub fn fin_de_rangee_libellee(&self, i: usize, reperes: &[String]) -> bool {
        if reperes.is_empty() || self.rtl[i] || self.jetons[i].montants.is_empty() {
            return false;
        }
        let a = &self.jetons[i];
        let ha = (a.y1 - a.y0).max(f64::EPSILON);
        let mut rangee: Vec<usize> = (0..self.jetons.len())
            .filter(|&k| {
                let b = &self.jetons[k];
                let hb = (b.y1 - b.y0).max(f64::EPSILON);
                b.page == a.page && (a.y1.min(b.y1) - a.y0.max(b.y0)) / ha.min(hb) > 0.5
            })
            .collect();
        rangee.sort_by(|x, y| {
            self.jetons[*x]
                .x0
                .partial_cmp(&self.jetons[*y].x0)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        // la dernière valeur de la rangée
        if rangee
            .iter()
            .rev()
            .find(|&&k| !self.jetons[k].montants.is_empty())
            != Some(&i)
        {
            return false;
        }
        // Une rangée de relevé s'ouvre sur sa date (« 01/10/2026 | SOLDE AU 30/09/2026 | (C) |
        // 138.862,485 ») : les dates de tête ne coupent pas le libellé qui les suit.
        let mut libelle = String::new();
        // Le numéro de rubrique d'un formulaire (« 350 | Reste à payer | 7.739,058 ») non plus :
        // un nombre entier d'au plus trois chiffres en tête de rangée.
        let numero = |t: &str| t.len() <= 3 && t.chars().all(|c| c.is_ascii_digit());
        let tete = rangee
            .iter()
            .take_while(|&&k| self.jetons[k].date.is_some() || numero(&self.jetons[k].texte))
            .count();
        for &k in &rangee[tete..] {
            let b = &self.jetons[k];
            if !b.montants.is_empty()
                || b.date.is_some()
                || b.texte.chars().any(|c| c.is_ascii_digit())
            {
                break;
            }
            libelle.push_str(&self.normes[k]);
        }
        reperes.iter().any(|r| libelle.contains(r.as_str()))
    }

    /// Un repère est-il lu quelque part sur la pièce ? Sur un jeton, ou sur une suite d'au
    /// plus `MOTS_D_UN_LIBELLE` jetons consécutifs de la même page : l'OCR rend un mot par
    /// jeton (« معفاة | من | الأداء », la mention d'exonération d'une facture arabe).
    pub fn annonce(&self, reperes: &[String]) -> bool {
        !reperes.is_empty()
            && (0..self.normes.len()).any(|i| {
                let mut suite = String::new();
                (i..self.normes.len().min(i + MOTS_D_UN_LIBELLE))
                    .take_while(|&k| self.jetons[k].page == self.jetons[i].page)
                    .any(|k| {
                        suite.push_str(&self.normes[k]);
                        reperes.iter().any(|r| suite.contains(r.as_str()))
                    })
            })
    }

    /// Le jeton `i` est-il ancré par l'un des repères ? `avant` : le texte brut du
    /// jeton qui précède la valeur, quand on connaît sa position ; sinon tout le jeton.
    /// `dessus` : le jeton juste au-dessus compte aussi (en-tête de colonne).
    pub fn ancre(&self, i: usize, reperes: &[String], avant: Option<&str>, dessus: bool) -> bool {
        self.ancre_valeur(i, i, reperes, avant, dessus, 1)
    }

    /// `ancre` pour une valeur portée par les jetons `i` à `fin` : le libellé qui la suit
    /// (écriture de droite à gauche) se cherche après son DERNIER jeton — un RIB imprimé en
    /// quatre groupes a son « المعرف البنكي » à droite du quatrième. `mots` : les mots au
    /// plus d'un libellé lu sur les voisins (1 : le voisin seul, comme pour un montant).
    pub fn ancre_valeur(
        &self,
        i: usize,
        fin: usize,
        reperes: &[String],
        avant: Option<&str>,
        dessus: bool,
        mots: usize,
    ) -> bool {
        if reperes.is_empty() {
            return false;
        }
        // Un repère court (« le », « n° ») ne se cherche pas DANS un mot : « AVANTLE », collé
        // par l'OCR, n'est pas le libellé « Le » (banc sans IA du 4 novembre 2026, 50/06 :
        // l'échéance rendue comme date d'émission). Il égale le jeton entier.
        let contient = |t: &str| {
            let net = t.trim_matches(|c: char| !c.is_alphanumeric());
            reperes.iter().any(|r| {
                if r.chars().count() < REPERE_COURT {
                    net == r.as_str()
                } else {
                    t.contains(r.as_str())
                }
            })
        };
        // Sur le jeton de la valeur, un repère court se colle en TÊTE, devant ce qui n'est pas
        // une lettre (« MF0458213A/A/C/000 »).
        let en_tete = |t: &str| {
            reperes.iter().any(|r| {
                if r.chars().count() < REPERE_COURT {
                    t.strip_prefix(r.as_str())
                        .is_some_and(|reste| !reste.starts_with(char::is_alphabetic))
                } else {
                    t.contains(r.as_str())
                }
            })
        };
        let propre = match avant {
            Some(a) => contient(&normaliser(a)),
            None => en_tete(&self.normes[i]),
        };
        // un voisin n'ancre que s'il est un pur libellé : il ne porte lui-même ni montant ni date
        let libelle = |k: usize| {
            let j = &self.jetons[k];
            j.montants.is_empty() && j.date.is_none() && contient(&self.normes[k])
        };
        // Un séparateur imprimé seul (« Date : 07/08/2026 », « التاريخ / Date : ») n'est pas
        // un voisin : le libellé est au-delà. Banc sans IA du 4 novembre 2026 : sans ce pas,
        // 179 dates d'opération ne tenaient qu'au repli « seule date de la page ».
        let separateur = |k: usize| !self.jetons[k].texte.chars().any(char::is_alphanumeric);
        // Le premier voisin au-delà des séparateurs, et si un deux-points était parmi eux.
        let au_dela = |depart: Option<usize>, suivant: &dyn Fn(usize) -> Option<usize>| {
            let (mut k, mut deux_points) = (depart, false);
            while let Some(x) = k.filter(|&x| separateur(x)) {
                deux_points |= self.jetons[x].texte.contains(':');
                k = suivant(x);
            }
            (k, deux_points)
        };
        // Le libellé précède la valeur dans SON ordre de lecture : à gauche en écriture
        // latine, à droite en écriture de droite à gauche. Un deux-points entre eux dit le
        // sens à lui seul : « التاريخ : 26 mai 2026 », sur une pièce bilingue, met le libellé
        // arabe à gauche de sa valeur.
        //
        // Un libellé de plusieurs mots (« المعرّف البنكي », « Date de livraison ») se lit sur
        // les mots voisins, du plus proche au plus lointain : il contient toujours le plus
        // proche, et se lit dans l'ordre de la ligne (le plus lointain d'abord).
        let mot = |k: usize| {
            let j = &self.jetons[k];
            j.montants.is_empty() && j.date.is_none() && !separateur(k)
        };
        //
        // Lu sur plusieurs mots, un libellé est un repère ENTIER, mot pour mot (ponctuation
        // collée ôtée) : « Valable jusqu'au » n'est pas le repère « Le » qu'il contient.
        let net = |x: usize| self.normes[x].trim_matches(|c: char| !c.is_alphanumeric());
        let est_repere = |t: &str| reperes.iter().any(|r| r == t);
        let libelle_vers = |depart: Option<usize>, suivant: &dyn Fn(usize) -> Option<usize>| {
            if mots == 1 {
                return depart.is_some_and(libelle);
            }
            let mut lus: Vec<&str> = Vec::new();
            let mut k = depart;
            while let Some(x) = k.filter(|&x| mot(x)) {
                lus.insert(0, net(x));
                if est_repere(&lus.concat()) {
                    return true;
                }
                if lus.len() == mots {
                    break;
                }
                k = suivant(x);
            }
            false
        };
        let (g, g_dp) = au_dela(self.gauche[i], &|x| self.gauche[x]);
        let (d, d_dp) = au_dela(self.droite[fin], &|x| self.droite[x]);
        // Le deux-points collé à la valeur compte aussi : « التاريخ | :11-09-2026 », l'OCR
        // l'a lu avec la date (banc sans IA du 4 novembre 2026, s087).
        let g_dp = g_dp || self.jetons[i].texte.trim_start().starts_with(':');
        let d_dp = d_dp || self.jetons[fin].texte.trim_end().ends_with(':');
        propre
            || g.is_some_and(|k| {
                (!self.rtl[k] || g_dp) && libelle_vers(Some(k), &|x| self.gauche[x])
            })
            || d.is_some_and(|k| {
                (self.rtl[k] || d_dp) && libelle_vers(Some(k), &|x| self.droite[x])
            })
            || (dessus && self.dessus[i].is_some_and(libelle))
    }
}

/// L'appariement GLOBAL d'une colonne de libellés et des valeurs à sa droite.
///
/// Une pièce imprime ses totaux en deux colonnes : les libellés (« TOTAL HT: », « TVA: »,
/// « Timbre fiscal: », « TTC: ») à gauche, les montants à droite. Photographiée, la colonne
/// des montants glisse d'une demi-rangée : le voisin d'un libellé n'est plus sa valeur
/// (banc sans IA du 4 novembre 2026, algoria-013 : « TTC: » à côté du « Total avec
/// timbre »). L'ORDRE, lui, se conserve. Une colonne de libellés — des suites de mots,
/// alignées à gauche et serrées, en majorité terminées par « : » — et, à sa droite, dans sa
/// hauteur, au moins autant de montants imprimés : le i-ème libellé est celui de la i-ème
/// valeur de la suite la plus proche — ou de chacune des suites presque aussi proches
/// (moins d'une hauteur de rangée d'écart cumulé) : une colonne qui a glissé d'une
/// demi-rangée ne dit pas de quel côté. L'appariement ne PROUVE rien : il dit seulement
/// qu'une valeur que l'arithmétique a établie porte bien son libellé. Moins de valeurs que
/// de libellés : rien n'est apparié.
fn colonnes_de_libelles(jetons: &[Jeton]) -> BTreeMap<usize, Vec<String>> {
    let h = |j: &Jeton| (j.y1 - j.y0).max(f64::EPSILON);
    let mot = |j: &Jeton| {
        j.montants.is_empty() && j.date.is_none() && !j.texte.chars().any(|c| c.is_ascii_digit())
    };
    // Les rangées, ordonnées de gauche à droite (celles des lignes d'articles).
    let mut rangs = crate::lignes::rangees_selon(jetons, f64::min);
    // Les libellés : une suite de mots adjacents dont le dernier finit par « : ».
    struct Libelle {
        page: u32,
        x0: f64,
        x1: f64,
        y0: f64,
        y1: f64,
        h: f64,
        /// La suite finit par « : ».
        deux_points: bool,
        texte: String,
    }
    let mut libelles: Vec<Libelle> = Vec::new();
    let clore = |suite: &mut Vec<usize>, libelles: &mut Vec<Libelle>| {
        if let Some(&fin) = suite.last() {
            let js: Vec<&Jeton> = suite.iter().map(|&q| &jetons[q]).collect();
            libelles.push(Libelle {
                page: jetons[fin].page,
                x0: js.iter().map(|q| q.x0).fold(f64::MAX, f64::min),
                x1: js.iter().map(|q| q.x1).fold(f64::MIN, f64::max),
                y0: js.iter().map(|q| q.y0).fold(f64::MAX, f64::min),
                y1: js.iter().map(|q| q.y1).fold(f64::MIN, f64::max),
                h: js.iter().map(|q| h(q)).fold(0.0, f64::max),
                deux_points: jetons[fin].texte.trim_end().ends_with(':'),
                texte: normaliser(
                    &js.iter()
                        .map(|q| q.texte.as_str())
                        .collect::<Vec<_>>()
                        .join(" "),
                ),
            });
        }
        suite.clear();
    };
    for r in &mut rangs {
        let mut suite: Vec<usize> = Vec::new();
        for &k in r.iter() {
            let j = &jetons[k];
            // adjacents, et de la même taille : un libellé ne prolonge pas la phrase voisine
            // que la rangée recouvre (« … dinars | TTC: », algoria-013)
            let colle = suite.last().is_none_or(|&p| {
                let (hp, hj) = (h(&jetons[p]), h(j));
                j.x0 - jetons[p].x1 <= 1.5 * hj && hp.max(hj) <= 1.5 * hp.min(hj)
            });
            if !mot(j) || !colle {
                clore(&mut suite, &mut libelles);
            }
            if !mot(j) {
                continue;
            }
            suite.push(k);
            if j.texte.trim_end().ends_with(':') {
                clore(&mut suite, &mut libelles);
            }
        }
        clore(&mut suite, &mut libelles);
    }
    libelles.sort_by(|a, b| {
        a.page
            .cmp(&b.page)
            .then(a.y0.partial_cmp(&b.y0).unwrap_or(std::cmp::Ordering::Equal))
    });
    // Les colonnes : des libellés alignés à gauche, chacun juste sous le précédent.
    let mut colonnes: Vec<Vec<usize>> = Vec::new();
    for (k, l) in libelles.iter().enumerate() {
        let suit = colonnes.iter_mut().find(|c| {
            let p = &libelles[*c.last().expect("colonne non vide")];
            p.page == l.page
                && (p.x0 - l.x0).abs() <= 2.0 * l.h
                && l.y0 - p.y1 <= 1.5 * l.h
                && l.y0 >= p.y0
                && p.h.max(l.h) <= 1.5 * p.h.min(l.h)
        });
        match suit {
            Some(c) => c.push(k),
            None => colonnes.push(vec![k]),
        }
    }
    let mut paires = BTreeMap::new();
    // Une colonne de libellés : au moins deux, dont plus de la moitié finissent par « : »
    // (l'OCR en perd un : « Timbre fiscalt », algoria-029).
    // Ses bords sont des libellés à « : » : une ligne sans, en tête ou en queue, n'en est pas.
    for c in colonnes.iter_mut() {
        while c.last().is_some_and(|&k| !libelles[k].deux_points) {
            c.pop();
        }
        while c.first().is_some_and(|&k| !libelles[k].deux_points) {
            c.remove(0);
        }
    }
    let libellee = |c: &&Vec<usize>| {
        let n = c.iter().filter(|&&k| libelles[k].deux_points).count();
        n >= 2 && 2 * n > c.len()
    };
    for c in colonnes.iter().filter(libellee) {
        let ls: Vec<&Libelle> = c.iter().map(|&k| &libelles[k]).collect();
        let hc = ls.iter().map(|l| l.h).fold(0.0, f64::max);
        let (haut, bas) = (ls[0].y0 - hc, ls[ls.len() - 1].y1 + hc);
        let droite = ls.iter().map(|l| l.x1).fold(f64::MIN, f64::max);
        let mut valeurs: Vec<usize> = (0..jetons.len())
            .filter(|&i| {
                let j = &jetons[i];
                let centre = (j.y0 + j.y1) / 2.0;
                j.page == ls[0].page
                    && j.x0 > droite
                    && centre >= haut
                    && centre <= bas
                    && j.montants.iter().any(|m| m.forte)
            })
            .collect();
        if valeurs.len() < ls.len() {
            continue;
        }
        let centre = |i: usize| (jetons[i].y0 + jetons[i].y1) / 2.0;
        valeurs.sort_by(|&a, &b| {
            centre(a)
                .partial_cmp(&centre(b))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        // Une valeur de trop dans la hauteur (le montant de la dernière ligne d'articles,
        // juste au-dessus) : la suite de valeurs consécutives la plus proche, rangée par
        // rangée, des libellés ; deux suites aussi proches n'apparient rien.
        let ecart = |debut: usize| -> f64 {
            ls.iter()
                .enumerate()
                .map(|(k, l)| (centre(valeurs[debut + k]) - (l.y0 + l.y1) / 2.0).abs())
                .sum()
        };
        let mut fenetres: Vec<(f64, usize)> = (0..=valeurs.len() - ls.len())
            .map(|d| (ecart(d), d))
            .collect();
        fenetres.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        let meilleur = fenetres[0].0;
        for &(_, debut) in fenetres.iter().take_while(|(e, _)| *e - meilleur < hc) {
            for (k, l) in ls.iter().enumerate() {
                paires
                    .entry(valeurs[debut + k])
                    .or_insert_with(Vec::new)
                    .push(l.texte.clone());
            }
        }
    }
    paires
}

/// Les taux (en ppm) qu'une rangée sans mot imprime à côté d'un montant imprimé : « 1 % »
/// ou « 1% », « 19,5 % ». Une charge proportionnelle du pack (le FODEC) dont le libellé est
/// perdu s'annonce encore par son taux chiffré (banc sans IA du 4 novembre 2026,
/// algoria-054 : « 31,675 1 % », le libellé arabe du FODEC non lu ; la base à 19 %,
/// FODEC compris, était prise pour le HT).
fn taux_sur_rangees_chiffrees(jetons: &[Jeton]) -> BTreeSet<i64> {
    let motif = regex::Regex::new(r"(?:^|[^\d.,])(\d{1,2})(?:[.,](\d{1,3}))?\s*%").expect("motif");
    let mut taux = BTreeSet::new();
    for r in crate::lignes::rangees_selon(jetons, f64::min) {
        // une rangée SANS mot : un mot y nomme une autre chose au même taux (« Retenue à la
        // source 1 % », d100/B-01)
        if !r
            .iter()
            .any(|&i| jetons[i].montants.iter().any(|m| m.forte))
            || r.iter()
                .any(|&i| jetons[i].texte.chars().any(char::is_alphabetic))
        {
            continue;
        }
        let texte = r
            .iter()
            .map(|&i| jetons[i].texte.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        for c in motif.captures_iter(&texte) {
            // « 19,5 % » : 195 / 10 pour cent, en ppm (millionièmes)
            let chiffres = format!("{}{}", &c[1], c.get(2).map_or("", |d| d.as_str()));
            let echelle = 10i128.pow(c.get(2).map_or(0, |d| d.as_str().len()) as u32);
            if let Ok(n) = chiffres.parse::<i128>() {
                taux.insert((n * PPM / (CENT * echelle)) as i64);
            }
        }
    }
    taux
}

/// `motif` se lit-il dans `texte` à une lettre près (distance d'édition au plus 1, le motif
/// pris n'importe où dans le texte) ?
fn a_une_lettre_pres(texte: &str, motif: &str) -> bool {
    let t: Vec<char> = texte.chars().collect();
    let m: Vec<char> = motif.chars().collect();
    // d[j] : la distance du préfixe m[..j] à un suffixe du texte lu jusqu'ici
    let mut d: Vec<usize> = (0..=m.len()).collect();
    if d[m.len()] <= 1 {
        return true;
    }
    for &c in &t {
        let mut prec = d[0];
        d[0] = 0;
        for j in 1..=m.len() {
            let ancien = d[j];
            d[j] = (prec + usize::from(m[j - 1] != c))
                .min(d[j] + 1)
                .min(d[j - 1] + 1);
            prec = ancien;
        }
        if d[m.len()] <= 1 {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod essais {
    use super::a_une_lettre_pres;

    #[test]
    fn un_libelle_arabe_se_lit_a_une_lettre_pres() {
        // « اعتار » pour « اعتبار » : une lettre perdue
        assert!(a_une_lettre_pres(
            "المبلغدوناعتارالأداءات",
            "المبلغدوناعتبارالأداءات"
        ));
        // une lettre changée, au milieu d'un texte plus long
        assert!(a_une_lettre_pres(
            "xxالمبلغدوناعتبارالأدادات",
            "المبلغدوناعتبارالأداءات"
        ));
        // deux lettres perdues : non
        assert!(!a_une_lettre_pres(
            "المبلغدوناعتارالأداات",
            "المبلغدوناعتبارالأداءات"
        ));
    }
}
