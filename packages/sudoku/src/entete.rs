//! L'anneau 2 : l'en-tête d'une pièce, prouvé par ses relations avec la base du
//! client (le dossier et ses tiers), sans IA.
//!
//! Preuve `{"op":"parties","emetteur":"…","client":"…","nom_emetteur":"…","nom_client":"…","numero":"…?"}`
//! (contrat §2). Déterministe :
//! 1. les matricules candidats sont les jetons (ou jetons contigus d'une même rangée,
//!    une rangée coupée en fin de ligne comprise) qui respectent le format du pack
//!    (`pack.formats[format_code]`), normalisés en majuscules sans espaces ; aucune
//!    lecture de montant n'y entre ;
//! 2. le sens se décide par des indices, tous concordants ou rien : le matricule du
//!    dossier dans le bloc du client (ou derrière un repère propre au client) vote
//!    « achat », dans celui de l'émetteur « vente » ; quand deux matricules distincts
//!    seulement sont lus, l'autre vote symétriquement, et celui des deux qui est
//!    imprimé le plus haut vote émetteur — en corroboration seulement : la géométrie
//!    ne décide jamais seule. Un indice contraire, ou aucun repère : `signale` ;
//! 3. la contrepartie est rapprochée des tiers connus par son matricule ; son nom est
//!    alors la raison sociale du tiers, cherchée dans les jetons (sans casse, sans
//!    accents, sans ponctuation ni forme juridique — les formes viennent de l'entrée).
//!    Tiers inconnu : le nom est le texte ancré par le repère de son bloc, ou la
//!    rangée la plus proche au-dessus de son matricule qui porte une forme juridique,
//!    au statut `conforme` ;
//! 4. les dates d'une preuve `ordre` et le numéro (clé `numero`) se lisent par leurs
//!    repères ; l'échéance ≥ émission départage deux dates.
//!
//! Non bloquant : l'issue de la pièce reste celle du centre. Les repères attribuent
//! un libellé au plus long repère de la grille qui l'égale exactement (« BC N° » est
//! au bon de commande, pas au numéro de facture). Aucune constante réglementaire :
//! formats, repères et formes juridiques arrivent en entrée (R4).

use crate::entree::{Entree, Grille, Jeton};
use crate::lignes::rangees_selon;
use crate::reperes::normaliser;
use crate::textuel::iso_valide;
use crate::{ChampSortie, RefJeton};
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// Le nom de l'op dans le langage des preuves.
pub const OP: &str = "parties";

// Géométrie de la page, en hauteurs de jeton ou en fraction de page : des mesures
// de mise en page, pas des valeurs réglementaires.
/// Jetons au plus par valeur recollée ; un libellé, lui, s'étend tant que son texte
/// ne dépasse pas le plus long repère de la grille (« C L I E N T »).
const SPAN_MAX: usize = 4;
/// Écart (en hauteurs) entre deux mots d'un même libellé ou d'un même nom.
const ECART_MOT: f64 = 1.5;
/// Écart (en hauteurs) au-delà duquel un libellé commence un nouveau segment de rangée.
const ECART_SEGMENT: f64 = 2.5;
/// Écart (en hauteurs) au plus entre un libellé et la valeur à sa droite.
const ECART_VALEUR: f64 = 4.0;
/// Écart (en hauteurs) au plus entre deux morceaux collés d'une même valeur.
const COLLE: f64 = 0.2;
/// Écart vertical (en hauteurs) au plus entre une valeur et son libellé au-dessus.
const DESSUS: f64 = 2.5;
/// Hauteur (fraction de page) d'un bloc de partie sous son libellé.
const BLOC_HAUTEUR: f64 = 0.15;
/// Largeur (fraction de page) d'un bloc de partie à droite de son libellé.
const BLOC_LARGEUR: f64 = 0.35;
/// Tolérance horizontale (fraction de page) d'un alignement.
const MARGE: f64 = 0.02;

/// Une valeur citée, avec son statut.
#[derive(Serialize, Clone)]
pub struct Valeur {
    pub valeur: String,
    pub refs: Vec<RefJeton>,
    pub statut: String,
}

#[derive(Serialize, Default)]
pub struct Cote {
    pub matricule: Option<Valeur>,
    pub nom: Option<Valeur>,
}

#[derive(Serialize)]
pub struct TiersSortie {
    pub code: String,
    pub statut: String,
}

#[derive(Serialize)]
pub struct PartiesSortie {
    pub sens: Option<String>,
    pub statut: String,
    pub emetteur: Cote,
    pub client: Cote,
    pub tiers: Option<TiersSortie>,
    /// Pourquoi le sens n'est pas prouvé.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raison: Option<String>,
}

/// L'op lue dans la grille : des indices de champs.
pub struct OpParties {
    emetteur: usize,
    client: usize,
    nom_emetteur: usize,
    nom_client: usize,
    numero: Option<usize>,
}

fn cle_op(e: &Value, k: &str) -> Option<String> {
    e.get(k).and_then(|v| v.as_str()).map(|s| s.trim_end_matches('?').trim().to_string())
}

/// Lit et contrôle l'op : les champs nommés existent ; les matricules ont un format.
pub fn lire_op(grille: &Grille, e: &Value) -> Result<OpParties, String> {
    let champ = |k: &str| -> Result<usize, String> {
        let nom = cle_op(e, k).ok_or_else(|| format!("clé « {k} » manquante"))?;
        grille.champs.iter().position(|c| c.code == nom).ok_or_else(|| format!("champ « {nom} » absent de la grille"))
    };
    let emetteur = champ("emetteur")?;
    let client = champ("client")?;
    for c in [emetteur, client] {
        if grille.champs[c].format_code.is_none() {
            return Err(format!("champ « {} » sans format", grille.champs[c].code));
        }
    }
    let numero = match cle_op(e, "numero") {
        Some(_) => Some(champ("numero")?),
        None => None,
    };
    Ok(OpParties { emetteur, client, nom_emetteur: champ("nom_emetteur")?, nom_client: champ("nom_client")?, numero })
}

/// Le texte d'un libellé, sans la ponctuation qui l'entoure (« Client : » → « client »).
/// Le point reste : « M. » n'est pas la lettre « M » d'un texte vertical.
fn cle(s: &str) -> String {
    s.trim_matches(|c: char| ":,;-–—·/|()".contains(c)).to_string()
}

/// Un mot comparable : sans casse, sans accents, sans ponctuation.
fn mot(s: &str) -> String {
    normaliser(s).chars().filter(|c| c.is_alphanumeric()).collect()
}

/// La valeur d'un matricule : majuscules, sans espaces.
fn norme_matricule(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).flat_map(|c| c.to_uppercase()).collect()
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Sens {
    Achat,
    Vente,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Camp {
    Client,
    Emetteur,
}

/// Un libellé lu : sa clé et les champs dont un repère l'égale.
struct Etiquette {
    cle: String,
    champs: BTreeSet<usize>,
}

/// Un libellé de bloc de partie (« Client : », « Facturé à »).
struct Libelle {
    camp: Camp,
    jetons: Vec<usize>,
}

/// Une occurrence d'un matricule.
struct Occ {
    valeur: String,
    jetons: Vec<usize>,
    prefixe: String,
}

struct Page<'a> {
    j: &'a [Jeton],
    normes: Vec<String>,
    cles: Vec<String>,
    rangs: Vec<Vec<usize>>,
    /// (rangée, position) de chaque jeton.
    ou: Vec<(usize, usize)>,
    /// (clé du repère, champ), pour tous les champs de la grille.
    reperes: Vec<(String, usize)>,
    /// La longueur du plus long repère : la borne d'un libellé.
    repere_max: usize,
}

impl<'a> Page<'a> {
    fn new(jetons: &'a [Jeton], grille: &Grille) -> Self {
        let normes: Vec<String> = jetons.iter().map(|j| normaliser(&j.texte)).collect();
        let cles = normes.iter().map(|n| cle(n)).collect();
        let rangs = rangees_selon(jetons, f64::max);
        let mut ou = vec![(0, 0); jetons.len()];
        for (r, rang) in rangs.iter().enumerate() {
            for (k, &i) in rang.iter().enumerate() {
                ou[i] = (r, k);
            }
        }
        let reperes = grille
            .champs
            .iter()
            .enumerate()
            .flat_map(|(c, ch)| ch.reperes_fr.iter().chain(ch.reperes_ar.iter()).map(move |r| (cle(&normaliser(r)), c)))
            .filter(|(r, _): &(String, usize)| !r.is_empty())
            .collect::<Vec<_>>();
        let repere_max = reperes.iter().map(|(r, _)| r.len()).max().unwrap_or_default();
        Page { j: jetons, normes, cles, rangs, ou, reperes, repere_max }
    }

    fn h(&self, i: usize) -> f64 {
        (self.j[i].y1 - self.j[i].y0).max(f64::EPSILON)
    }

    fn ecart(&self, a: usize, b: usize) -> f64 {
        self.j[b].x0 - self.j[a].x1
    }

    fn ponct(&self, i: usize) -> bool {
        self.cles[i].is_empty()
    }

    fn cite(&self, jetons: &[usize]) -> Vec<RefJeton> {
        jetons.iter().map(|&i| RefJeton { page: self.j[i].page, ordinal: self.j[i].ordinal }).collect()
    }

    fn texte(&self, jetons: &[usize]) -> String {
        jetons.iter().map(|&i| self.j[i].texte.trim()).collect::<Vec<_>>().join(" ")
    }

    /// Les champs dont un repère égale exactement ce libellé.
    fn champs_de(&self, texte: &str) -> Option<Etiquette> {
        let k = cle(texte);
        let champs: BTreeSet<usize> = self.reperes.iter().filter(|(r, _)| *r == k).map(|(_, c)| *c).collect();
        (!champs.is_empty()).then_some(Etiquette { cle: k, champs })
    }

    /// Le libellé que portent les jetons `rang[s..e]` : la suite ENTIÈRE des mots
    /// adjacents qui finit en `e` (sans chiffre : une valeur n'est pas un libellé), dont
    /// le texte doit égaler un repère. « Payable avant le » n'est pas « Le », et
    /// « Contrat Entreprise n° » n'est pas « N° ».
    fn libelle_entier(&self, rang: &[usize], e: usize, debut_min: usize, h: f64) -> Option<Etiquette> {
        let mut s = e - 1;
        while s > debut_min {
            let p = rang[s - 1];
            if self.ecart(p, rang[s]) > ECART_MOT * h || self.j[p].texte.chars().any(|c| c.is_ascii_digit()) {
                break;
            }
            s -= 1;
        }
        let texte: String = rang[s..e].iter().map(|&x| self.normes[x].as_str()).collect();
        if cle(&texte).len() > self.repere_max {
            return None;
        }
        self.champs_de(&texte)
    }

    /// Le libellé à gauche d'une valeur sur sa rangée (ou dans le jeton lui-même,
    /// avant la valeur), sinon juste au-dessus.
    fn etiquette(&self, i: usize, prefixe: &str) -> Option<Etiquette> {
        if !cle(prefixe).is_empty() {
            return self.champs_de(prefixe);
        }
        self.gauche(i).or_else(|| self.dessus(i))
    }

    fn gauche(&self, i: usize) -> Option<Etiquette> {
        let (r, k) = self.ou[i];
        let rang = &self.rangs[r];
        let h = self.h(i);
        let mut e = k;
        while e > 0 && self.ponct(rang[e - 1]) {
            e -= 1;
        }
        if e == 0 || self.ecart(rang[e - 1], i) > ECART_VALEUR * h {
            return None;
        }
        self.libelle_entier(rang, e, 0, h)
    }

    fn dessus(&self, i: usize) -> Option<Etiquette> {
        let (r, _) = self.ou[i];
        let j = &self.j[i];
        let h = self.h(i);
        let rr = (0..r).rev().find(|&rr| {
            let a = &self.j[self.rangs[rr][0]];
            a.page == j.page && a.y0 < j.y0
        })?;
        let rang = &self.rangs[rr];
        let sur: Vec<usize> = (0..rang.len())
            .filter(|&k| {
                let t = &self.j[rang[k]];
                t.x1 >= j.x0 - MARGE && t.x0 <= j.x1 + MARGE && j.y0 - t.y1 <= DESSUS * h && j.y0 - t.y1 >= -0.25 * h
            })
            .collect();
        let (&premier, &dernier) = (sur.first()?, sur.last()?);
        let mut e = dernier + 1;
        while e > premier && self.ponct(rang[e - 1]) {
            e -= 1;
        }
        if e == premier {
            return None;
        }
        self.libelle_entier(rang, e, premier, h)
    }

    /// Les libellés de bloc de partie : en tête d'un segment de rangée, le plus long
    /// repère de la grille, s'il est un repère de nom propre à un camp.
    fn libelles(&self, op: &OpParties, camps: &Camps) -> Vec<Libelle> {
        let mut out = Vec::new();
        for rang in &self.rangs {
            for s in 0..rang.len() {
                let h = self.h(rang[s]);
                if self.ponct(rang[s]) || (s > 0 && self.ecart(rang[s - 1], rang[s]) <= ECART_SEGMENT * h && !self.ponct(rang[s - 1])) {
                    continue;
                }
                let mut meilleur: Option<(usize, Etiquette)> = None;
                let mut e = s;
                let mut texte = String::new();
                while e < rang.len() {
                    if e > s && self.ecart(rang[e - 1], rang[e]) > ECART_MOT * h {
                        break;
                    }
                    texte.push_str(&self.normes[rang[e]]);
                    e += 1;
                    if texte.len() > self.repere_max {
                        break;
                    }
                    if let Some(et) = self.champs_de(&texte) {
                        if meilleur.as_ref().is_none_or(|(_, m)| et.cle.len() > m.cle.len()) {
                            meilleur = Some((e, et));
                        }
                    }
                }
                let Some((e, et)) = meilleur else { continue };
                let camp = if et.champs.contains(&op.nom_client) && camps.decide(Camp::Client, &et.cle) {
                    Camp::Client
                } else if et.champs.contains(&op.nom_emetteur) && camps.decide(Camp::Emetteur, &et.cle) {
                    Camp::Emetteur
                } else {
                    continue;
                };
                out.push(Libelle { camp, jetons: rang[s..e].to_vec() });
            }
        }
        out
    }

    /// La suite d'un segment coupé en fin de ligne : sur la rangée suivante, le jeton qui
    /// part de la marge du segment, juste dessous. `k` est le dernier jeton du segment.
    fn suite(&self, r: usize, k: usize) -> Option<(usize, usize)> {
        let rang = &self.rangs[r];
        let h = self.h(rang[k]);
        let mut debut = k;
        while debut > 0 && self.ecart(rang[debut - 1], rang[debut]) <= ECART_SEGMENT * h {
            debut -= 1;
        }
        let marge = self.j[rang[debut]].x0;
        let fin = &self.j[rang[k]];
        let suivante = self.rangs.get(r + 1)?;
        let kk = suivante.iter().position(|&t| {
            let t = &self.j[t];
            t.page == fin.page && (t.x0 - marge).abs() <= MARGE && t.y0 >= fin.y1 && t.y0 - fin.y1 <= ECART_MOT * h
        })?;
        Some((r + 1, kk))
    }

    /// Les occurrences des valeurs au format : jetons contigus d'une rangée (et de sa
    /// suite quand le segment est coupé en fin de ligne), recollés sans espaces ; la
    /// valeur touche le premier et le dernier jeton, et n'est bordée d'aucun caractère
    /// alphanumérique.
    fn matricules(&self, re: &Regex) -> Vec<Occ> {
        let mut out = Vec::new();
        for (r, rang) in self.rangs.iter().enumerate() {
            for s in 0..rang.len() {
                let h = self.h(rang[s]);
                let mut seq = vec![rang[s]];
                let mut k = s;
                while k + 1 < rang.len() && seq.len() < SPAN_MAX && self.ecart(rang[k], rang[k + 1]) <= ECART_MOT * h {
                    k += 1;
                    seq.push(rang[k]);
                }
                let fin_de_segment = k + 1 == rang.len() || self.ecart(rang[k], rang[k + 1]) > ECART_SEGMENT * h;
                if seq.len() < SPAN_MAX && fin_de_segment {
                    if let Some((rr, kk)) = self.suite(r, k) {
                        let rg = &self.rangs[rr];
                        let mut q = kk;
                        while q < rg.len() && seq.len() < SPAN_MAX && (q == kk || self.ecart(rg[q - 1], rg[q]) <= ECART_MOT * h) {
                            seq.push(rg[q]);
                            q += 1;
                        }
                    }
                }
                let mut morceaux: Vec<String> = Vec::new();
                for e in 0..seq.len() {
                    morceaux.push(norme_matricule(&self.j[seq[e]].texte));
                    let tout: String = morceaux.concat();
                    let premier = morceaux[0].len();
                    let dernier = tout.len() - morceaux.last().map_or(0, |m| m.len());
                    for m in re.find_iter(&tout) {
                        let avant = tout[..m.start()].chars().next_back();
                        let apres = tout[m.end()..].chars().next();
                        if m.start() < premier
                            && m.end() > dernier
                            && !avant.is_some_and(|c| c.is_alphanumeric())
                            && !apres.is_some_and(|c| c.is_alphanumeric())
                        {
                            out.push(Occ {
                                valeur: m.as_str().to_string(),
                                jetons: seq[..=e].to_vec(),
                                prefixe: tout[..m.start()].to_string(),
                            });
                        }
                    }
                }
            }
        }
        out
    }

    /// Le haut d'une occurrence : (page, y0) de son premier jeton.
    fn haut(&self, jetons: &[usize]) -> (u32, f64, f64) {
        let i = jetons[0];
        (self.j[i].page, self.j[i].y0, self.h(i))
    }

    /// Le libellé de bloc le plus proche au-dessus d'une valeur, dans sa colonne.
    fn bloc<'b>(&self, i: usize, libelles: &'b [Libelle]) -> Option<&'b Libelle> {
        let o = &self.j[i];
        libelles
            .iter()
            .filter(|l| {
                let a = &self.j[l.jetons[0]];
                a.page == o.page
                    && a.y0 <= o.y0 + 0.5 * self.h(i)
                    && o.y0 - a.y0 <= BLOC_HAUTEUR
                    && o.x0 >= a.x0 - MARGE
                    && o.x0 <= a.x0 + BLOC_LARGEUR
            })
            .max_by(|a, b| {
                let (ja, jb) = (&self.j[a.jetons[0]], &self.j[b.jetons[0]]);
                ja.y0.partial_cmp(&jb.y0).unwrap_or(std::cmp::Ordering::Equal)
            })
    }

    /// Les jetons d'un nom : une suite de mots adjacents (à l'échelle de leurs propres
    /// caractères), qui commence au jeton `k` de la rangée `r` (en sautant la
    /// ponctuation) et s'arrête à la ponctuation.
    fn mots_depuis(&self, r: usize, mut k: usize) -> Vec<usize> {
        let rang = &self.rangs[r];
        while k < rang.len() && self.ponct(rang[k]) {
            k += 1;
        }
        let mut out = Vec::new();
        while k < rang.len() && !self.ponct(rang[k]) {
            if let Some(&p) = out.last() {
                if self.ecart(p, rang[k]) > ECART_MOT * self.h(p) {
                    break;
                }
            }
            out.push(rang[k]);
            k += 1;
        }
        out
    }

    /// La raison sociale connue, cherchée dans les jetons : la première suite de mots
    /// égale (formes juridiques ignorées), formes qui la suivent comprises.
    fn chercher_nom(&self, raison_sociale: &str, formes: &BTreeSet<String>) -> Option<Vec<usize>> {
        let cherches: Vec<String> =
            raison_sociale.split_whitespace().map(mot).filter(|m| !m.is_empty() && !formes.contains(m)).collect();
        if cherches.is_empty() {
            return None;
        }
        let mots: Vec<String> = self.j.iter().map(|j| mot(&j.texte)).collect();
        let adjacent = |a: usize, b: usize| self.ecart(a, b) <= ECART_MOT * self.h(a);
        for rang in &self.rangs {
            'debut: for s in 0..rang.len() {
                if mots[rang[s]] != cherches[0] {
                    continue;
                }
                // bordé à gauche d'un mot (hors libellé suivi de « : ») : ce n'est pas ce nom
                if s > 0 {
                    let p = rang[s - 1];
                    if !mots[p].is_empty() && !formes.contains(&mots[p]) && !self.j[p].texte.trim_end().ends_with(':') && adjacent(p, rang[s]) {
                        continue;
                    }
                }
                let mut pris = vec![rang[s]];
                let mut k = s + 1;
                for m in &cherches[1..] {
                    if k >= rang.len() || mots[rang[k]] != *m || !adjacent(rang[k - 1], rang[k]) {
                        continue 'debut;
                    }
                    pris.push(rang[k]);
                    k += 1;
                }
                while k < rang.len() && formes.contains(&mots[rang[k]]) && adjacent(rang[k - 1], rang[k]) {
                    pris.push(rang[k]);
                    k += 1;
                }
                if k < rang.len() && !mots[rang[k]].is_empty() && adjacent(rang[k - 1], rang[k]) {
                    continue;
                }
                return Some(pris);
            }
        }
        None
    }

    /// Le nom d'une partie inconnue : le texte ancré par le libellé de son bloc, sinon
    /// la rangée la plus proche au-dessus de son matricule qui porte une forme juridique.
    fn nom_inconnu(&self, occs: &[&Occ], libelle: Option<&Libelle>, formes: &BTreeSet<String>) -> Option<Vec<usize>> {
        if let Some(l) = libelle {
            let fin = *l.jetons.last()?;
            let (r, k) = self.ou[fin];
            let h = self.h(fin);
            let apres = self.mots_depuis(r, k + 1);
            if apres.first().is_some_and(|&a| self.ecart(fin, a) <= ECART_VALEUR * h) {
                return Some(apres);
            }
            let a = &self.j[l.jetons[0]];
            let dessous = self.rangs.iter().enumerate().skip(r + 1).find(|(_, rg)| {
                let b = &self.j[rg[0]];
                b.page == a.page && b.y0 > a.y0
            });
            if let Some((rr, rg)) = dessous {
                if self.j[rg[0]].y0 - a.y1 <= DESSUS * h {
                    if let Some(k0) = rg.iter().position(|&t| self.j[t].x0 >= a.x0 - MARGE && self.j[t].x0 <= a.x0 + BLOC_LARGEUR) {
                        let m = self.mots_depuis(rr, k0);
                        if !m.is_empty() {
                            return Some(m);
                        }
                    }
                }
            }
            return None;
        }
        if formes.is_empty() {
            return None;
        }
        for o in occs {
            let i = o.jetons[0];
            let jo = &self.j[i];
            let (r0, k0) = self.ou[i];
            for r in (0..=r0).rev() {
                let rang = &self.rangs[r];
                let a = &self.j[rang[0]];
                if a.page != jo.page || jo.y0 - a.y0 > BLOC_HAUTEUR {
                    break;
                }
                let fin = if r == r0 { k0 } else { rang.len() };
                for k in (0..fin).rev() {
                    if !formes.contains(&mot(&self.j[rang[k]].texte)) {
                        continue;
                    }
                    // les mots à gauche de la forme, une ponctuation sautée au plus
                    let mut g = k;
                    if g > 0 && self.ponct(rang[g - 1]) {
                        g -= 1;
                    }
                    let mut debut = g;
                    let mut droite = rang[g.min(k)];
                    // la hauteur du nom lui-même : une raison sociale est souvent en grands caractères
                    let hn = self.h(rang[k]);
                    while debut > 0 {
                        let t = rang[debut - 1];
                        if self.ponct(t) || formes.contains(&mot(&self.j[t].texte)) || self.ecart(t, droite) > ECART_MOT * hn {
                            break;
                        }
                        debut -= 1;
                        droite = t;
                    }
                    if debut == g {
                        continue;
                    }
                    let (x0, x1) = (self.j[rang[debut]].x0, self.j[rang[k]].x1);
                    if x1 < jo.x0 - BLOC_LARGEUR || x0 > self.j[*o.jetons.last()?].x1 + BLOC_LARGEUR {
                        continue;
                    }
                    let mut pris: Vec<usize> = rang[debut..g].to_vec();
                    pris.push(rang[k]);
                    return Some(pris);
                }
            }
        }
        None
    }
}

/// Les repères qui départagent les camps : ceux d'un camp qu'aucun repère de l'autre
/// camp ne contient (« MF » est contenu dans « MF client » : il ne départage pas).
/// Le libellé d'un matricule ne départage que s'il NOMME la partie (« MF client »
/// contient « client », repère du nom du client) : « Identifiant fiscal » se lit
/// devant les deux matricules, quel que soit le champ où la grille le range.
struct Camps {
    client: BTreeSet<String>,
    emetteur: BTreeSet<String>,
    nom_client: BTreeSet<String>,
    nom_emetteur: BTreeSet<String>,
}

impl Camps {
    fn new(grille: &Grille, op: &OpParties) -> Self {
        let de = |champs: &[usize]| -> BTreeSet<String> {
            champs
                .iter()
                .flat_map(|&c| grille.champs[c].reperes_fr.iter().chain(grille.champs[c].reperes_ar.iter()))
                .map(|r| cle(&normaliser(r)))
                .filter(|r| !r.is_empty())
                .collect()
        };
        Camps {
            client: de(&[op.client, op.nom_client]),
            emetteur: de(&[op.emetteur, op.nom_emetteur]),
            nom_client: de(&[op.nom_client]),
            nom_emetteur: de(&[op.nom_emetteur]),
        }
    }

    /// Le libellé d'un matricule départage-t-il, et nomme-t-il la partie de ce camp ?
    fn nomme(&self, camp: Camp, cle: &str) -> bool {
        let noms = match camp {
            Camp::Client => &self.nom_client,
            Camp::Emetteur => &self.nom_emetteur,
        };
        self.decide(camp, cle) && noms.iter().any(|n| cle.contains(n.as_str()) && self.decide(camp, n))
    }

    fn decide(&self, camp: Camp, cle: &str) -> bool {
        let (le_sien, l_autre) = match camp {
            Camp::Client => (&self.client, &self.emetteur),
            Camp::Emetteur => (&self.emetteur, &self.client),
        };
        le_sien.contains(cle) && !l_autre.iter().any(|r| r.contains(cle))
    }
}

/// Ce que l'anneau 2 rend à `lib.rs` : la sortie des parties, le statut de la preuve,
/// et les champs lus (pour les preuves `format` et `ordre`).
pub struct Resultat {
    pub parties: Option<PartiesSortie>,
    pub statut: &'static str,
    pub lus: Vec<(usize, String)>,
}

fn valeur(page: &Page, jetons: &[usize], v: String, statut: &str) -> Valeur {
    Valeur { valeur: v, refs: page.cite(jetons), statut: statut.into() }
}

fn champ_de(v: &Valeur) -> ChampSortie {
    ChampSortie { valeur: Some(v.valeur.clone()), refs: v.refs.clone(), statut: v.statut.clone(), instances: None }
}

/// L'anneau 2, sur la pièce entière. Les champs d'en-tête de `champs` sont remplacés
/// par ce qu'il établit ; aucun autre n'est touché.
pub fn prouver(op: &OpParties, entree: &Entree, champs: &mut BTreeMap<String, ChampSortie>) -> Resultat {
    let grille = &entree.grille;
    let page = Page::new(&entree.jetons, grille);
    let mut lus = Vec::new();

    dates(&page, grille, champs, &mut lus);
    if let Some(n) = op.numero {
        numero(&page, n, grille, champs, &mut lus);
    }

    let Some(connus) = entree.connus.as_ref() else {
        return Resultat { parties: None, statut: "non_evaluable", lus };
    };
    let Some(dossier) = connus.dossier.as_ref() else {
        return Resultat { parties: None, statut: "non_evaluable", lus };
    };
    let code_format = grille.champs[op.emetteur].format_code.clone().unwrap_or_default();
    let Some(motif) = entree.pack.formats.get(&code_format) else {
        return Resultat { parties: None, statut: "non_evaluable", lus };
    };
    let Ok(re) = Regex::new(&format!("(?:{motif})")) else {
        return Resultat { parties: None, statut: "non_evaluable", lus };
    };
    let formes: BTreeSet<String> = connus.formes_juridiques.iter().map(|f| mot(f)).filter(|f| !f.is_empty()).collect();
    let camps = Camps::new(grille, op);
    let libelles = page.libelles(op, &camps);

    let occs = page.matricules(&re);
    let mut par_valeur: BTreeMap<String, Vec<&Occ>> = BTreeMap::new();
    for o in &occs {
        par_valeur.entry(o.valeur.clone()).or_default().push(o);
    }
    // Les camps d'une occurrence : repère propre à gauche, puis bloc de partie.
    let camp_de = |o: &Occ| -> Option<(Camp, Option<&Libelle>)> {
        if let Some(et) = page.etiquette(o.jetons[0], &o.prefixe) {
            if et.champs.contains(&op.client) && camps.nomme(Camp::Client, &et.cle) {
                return Some((Camp::Client, None));
            }
            if et.champs.contains(&op.emetteur) && camps.nomme(Camp::Emetteur, &et.cle) {
                return Some((Camp::Emetteur, None));
            }
        }
        page.bloc(o.jetons[0], &libelles).map(|l| (l.camp, Some(l)))
    };
    let ancre = |v: &str, camp: Camp| par_valeur[v].iter().any(|o| camp_de(o).is_some_and(|(c, _)| c == camp));
    let haut = |v: &str| {
        par_valeur[v]
            .iter()
            .map(|o| page.haut(&o.jetons))
            .min_by(|a, b| a.0.cmp(&b.0).then(a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)))
            .expect("valeur lue")
    };
    let au_dessus = |a: &str, b: &str| {
        let (pa, ya, ha) = haut(a);
        let (pb, yb, hb) = haut(b);
        pa < pb || (pa == pb && ya + ha.max(hb) < yb)
    };

    let vide = |statut: &str, raison: &str| PartiesSortie {
        sens: None,
        statut: statut.into(),
        emetteur: Cote::default(),
        client: Cote::default(),
        tiers: None,
        raison: Some(raison.into()),
    };
    let d = norme_matricule(&dossier.matricule);
    if par_valeur.is_empty() {
        return Resultat { parties: Some(vide("absent", "aucun matricule au format")), statut: "non_evaluable", lus };
    }
    if !par_valeur.contains_key(&d) {
        return Resultat {
            parties: Some(vide("signale", "le matricule du dossier n'est pas lu")),
            statut: "indeterminee",
            lus,
        };
    }
    let autres: Vec<&str> = par_valeur.keys().map(|k| k.as_str()).filter(|k| *k != d).collect();
    if autres.is_empty() {
        return Resultat {
            parties: Some(vide("signale", "seul le matricule du dossier est lu")),
            statut: "indeterminee",
            lus,
        };
    }

    // Les indices, tous concordants ou rien.
    let mut votes: Vec<Sens> = Vec::new();
    let (cd, ed) = (ancre(&d, Camp::Client), ancre(&d, Camp::Emetteur));
    if cd {
        votes.push(Sens::Achat);
    }
    if ed {
        votes.push(Sens::Vente);
    }
    let contrepartie: Option<&str> = if autres.len() == 1 {
        let o = autres[0];
        if ancre(o, Camp::Emetteur) {
            votes.push(Sens::Achat);
        }
        if ancre(o, Camp::Client) {
            votes.push(Sens::Vente);
        }
        // La géométrie corrobore, elle ne décide jamais seule : un émetteur peut imprimer
        // son matricule plus bas que le bloc du client (colonne latérale).
        if !votes.is_empty() {
            if au_dessus(o, &d) {
                votes.push(Sens::Achat);
            } else if au_dessus(&d, o) {
                votes.push(Sens::Vente);
            }
        }
        Some(o)
    } else {
        // Plus de deux matricules : le dossier se place par ses seuls repères, et la
        // contrepartie est l'unique autre ancré au camp opposé.
        let oppose = match (cd, ed) {
            (true, false) => Some(Camp::Emetteur),
            (false, true) => Some(Camp::Client),
            _ => None,
        };
        oppose.and_then(|camp| {
            let c: Vec<&str> = autres.iter().copied().filter(|o| ancre(o, camp)).collect();
            if c.len() == 1 && !ancre(c[0], if camp == Camp::Client { Camp::Emetteur } else { Camp::Client }) {
                votes.push(if camp == Camp::Emetteur { Sens::Achat } else { Sens::Vente });
                Some(c[0])
            } else {
                None
            }
        })
    };
    let sens = match (votes.first(), contrepartie) {
        (Some(&s), Some(_)) if votes.iter().all(|v| *v == s) => s,
        (None, _) | (_, None) => {
            return Resultat { parties: Some(vide("signale", "aucun indice de sens")), statut: "indeterminee", lus };
        }
        _ => {
            return Resultat { parties: Some(vide("signale", "indices de sens contradictoires")), statut: "echec", lus };
        }
    };
    let autre = contrepartie.expect("contrepartie décidée");
    let (camp_dossier, camp_autre) = match sens {
        Sens::Achat => (Camp::Client, Camp::Emetteur),
        Sens::Vente => (Camp::Emetteur, Camp::Client),
    };

    // La citation d'un matricule : l'occurrence ancrée à son camp, sinon la plus haute.
    let occ_de = |v: &str, camp: Camp| -> &Occ {
        par_valeur[v]
            .iter()
            .find(|o| camp_de(o).is_some_and(|(c, _)| c == camp))
            .or_else(|| {
                par_valeur[v].iter().min_by(|a, b| {
                    let (pa, ya, _) = page.haut(&a.jetons);
                    let (pb, yb, _) = page.haut(&b.jetons);
                    pa.cmp(&pb).then(ya.partial_cmp(&yb).unwrap_or(std::cmp::Ordering::Equal))
                })
            })
            .expect("valeur lue")
    };
    let od = occ_de(&d, camp_dossier);
    let oa = occ_de(autre, camp_autre);
    let mut cote_dossier = Cote { matricule: Some(valeur(&page, &od.jetons, d.clone(), "prouve")), nom: None };
    let mut cote_autre = Cote { matricule: Some(valeur(&page, &oa.jetons, autre.to_string(), "prouve")), nom: None };

    if let Some(rs) = dossier.raison_sociale.as_deref() {
        cote_dossier.nom = page.chercher_nom(rs, &formes).map(|j| valeur(&page, &j, page.texte(&j), "prouve"));
    }
    let tiers = connus.tiers.iter().find(|t| norme_matricule(&t.matricule) == autre);
    if let Some(rs) = tiers.and_then(|t| t.raison_sociale.as_deref()) {
        cote_autre.nom = page.chercher_nom(rs, &formes).map(|j| valeur(&page, &j, page.texte(&j), "prouve"));
    }
    if cote_autre.nom.is_none() {
        let occs_autre: Vec<&Occ> = {
            let mut v = par_valeur[autre].clone();
            v.sort_by(|a, b| {
                let (pa, ya, _) = page.haut(&a.jetons);
                let (pb, yb, _) = page.haut(&b.jetons);
                pa.cmp(&pb).then(ya.partial_cmp(&yb).unwrap_or(std::cmp::Ordering::Equal))
            });
            v
        };
        let libelle = par_valeur[autre].iter().find_map(|o| camp_de(o).filter(|(c, _)| *c == camp_autre).and_then(|(_, l)| l));
        cote_autre.nom = page.nom_inconnu(&occs_autre, libelle, &formes).map(|j| valeur(&page, &j, page.texte(&j), "conforme"));
    }

    let (emetteur, client) = match sens {
        Sens::Achat => (cote_autre, cote_dossier),
        Sens::Vente => (cote_dossier, cote_autre),
    };
    for (c, v) in [
        (op.emetteur, &emetteur.matricule),
        (op.client, &client.matricule),
        (op.nom_emetteur, &emetteur.nom),
        (op.nom_client, &client.nom),
    ] {
        if let Some(v) = v {
            champs.insert(grille.champs[c].code.clone(), champ_de(v));
            lus.push((c, v.valeur.clone()));
        }
    }
    let parties = PartiesSortie {
        sens: Some(match sens {
            Sens::Achat => "achat",
            Sens::Vente => "vente",
        }
        .into()),
        statut: "prouve".into(),
        emetteur,
        client,
        tiers: tiers.map(|t| TiersSortie { code: t.code.clone(), statut: "prouve".into() }),
        raison: None,
    };
    Resultat { parties: Some(parties), statut: "verifiee", lus }
}

/// Les dates de chaque preuve `ordre` : candidates ancrées par leurs repères ; une
/// seule valeur ancrée → `conforme`. L'échéance ≥ émission départage plusieurs
/// candidates, et, quand la pièce ne porte que deux dates dont l'échéance ancrée,
/// désigne l'autre comme émission si elle la précède.
fn dates(page: &Page, grille: &Grille, champs: &mut BTreeMap<String, ChampSortie>, lus: &mut Vec<(usize, String)>) {
    let index = |nom: &str| grille.champs.iter().position(|c| c.code == nom.trim_end_matches('?'));
    let paires: Vec<(usize, usize)> = grille
        .preuves
        .iter()
        .filter(|p| p.statut.as_deref() != Some("a_traduire"))
        .filter_map(|p| p.expression.as_ref())
        .filter(|e| e.get("op").and_then(|o| o.as_str()) == Some("ordre"))
        .filter_map(|e| Some((index(e.get("avant")?.as_str()?)?, index(e.get("apres")?.as_str()?)?)))
        .filter(|(a, b)| grille.champs[*a].genre == "date" && grille.champs[*b].genre == "date")
        .collect();
    if paires.is_empty() {
        return;
    }
    // Chaque date lue, et les champs de son libellé.
    let lues: Vec<(usize, &str, BTreeSet<usize>)> = page
        .j
        .iter()
        .enumerate()
        .filter_map(|(i, j)| {
            let d = j.date.as_deref().filter(|d| iso_valide(d))?;
            let prefixe: String = j.texte.chars().take_while(|c| !c.is_ascii_digit()).collect();
            let champs = page.etiquette(i, &normaliser(&prefixe)).map(|e| e.champs).unwrap_or_default();
            Some((i, d, champs))
        })
        .collect();
    let toutes: BTreeSet<&str> = lues.iter().map(|(_, d, _)| *d).collect();
    for (a, b) in paires {
        let ancrees = |c: usize| -> BTreeSet<&str> { lues.iter().filter(|(_, _, ch)| ch.contains(&c)).map(|(_, d, _)| *d).collect() };
        let (ma, eb) = (ancrees(a), ancrees(b));
        let unique = |s: BTreeSet<&str>| -> Option<String> { (s.len() == 1).then(|| s.into_iter().next().unwrap_or_default().to_string()) };
        let mut va = unique(ma.clone());
        let mut vb = unique(eb.clone());
        if va.is_none() && ma.len() > 1 {
            if let Some(e) = &vb {
                va = unique(ma.iter().copied().filter(|d| *d <= e.as_str()).collect());
            }
        }
        if vb.is_none() && eb.len() > 1 {
            if let Some(m) = &va {
                vb = unique(eb.iter().copied().filter(|d| *d >= m.as_str()).collect());
            }
        }
        if va.is_none() && ma.is_empty() && toutes.len() == 2 {
            if let Some(e) = &vb {
                let autre = toutes.iter().copied().find(|d| *d != e.as_str()).unwrap_or_default();
                let libres = lues
                    .iter()
                    .filter(|(_, d, _)| *d == autre)
                    .all(|(_, _, ch)| !ch.contains(&b) && ch.iter().all(|c| grille.champs[*c].genre == "date"));
                if libres && autre <= e.as_str() {
                    va = Some(autre.to_string());
                }
            }
        }
        for (c, v, candidates) in [(a, va, ma), (b, vb, eb)] {
            let sortie = match v {
                Some(v) => {
                    let i = lues
                        .iter()
                        .find(|(_, d, ch)| *d == v && ch.contains(&c))
                        .or_else(|| lues.iter().find(|(_, d, _)| *d == v))
                        .map(|(i, _, _)| *i)
                        .unwrap_or_default();
                    lus.push((c, v.clone()));
                    ChampSortie { valeur: Some(v), refs: page.cite(&[i]), statut: "conforme".into(), instances: None }
                }
                None => ChampSortie {
                    valeur: None,
                    refs: Vec::new(),
                    statut: if candidates.is_empty() { "absent" } else { "signale" }.into(),
                    instances: None,
                },
            };
            champs.insert(grille.champs[c].code.clone(), sortie);
        }
    }
}

/// Le numéro : le jeton juste après son repère (à droite, ou dessous), qui porte au
/// moins un chiffre, avec les morceaux qui lui sont collés. Une seule valeur → `conforme`.
fn numero(page: &Page, n: usize, grille: &Grille, champs: &mut BTreeMap<String, ChampSortie>, lus: &mut Vec<(usize, String)>) {
    let mut lus_n: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, j) in page.j.iter().enumerate() {
        if !j.texte.chars().any(|c| c.is_ascii_digit()) || page.etiquette(i, "").is_none_or(|e| !e.champs.contains(&n)) {
            continue;
        }
        // déjà pris comme morceau collé d'une valeur à sa gauche
        let (r, k) = page.ou[i];
        let rang = &page.rangs[r];
        let colle = |a: usize, b: usize| page.ecart(a, b) <= COLLE * page.h(a);
        if k > 0 && colle(rang[k - 1], i) && !page.ponct(rang[k - 1]) {
            continue;
        }
        let mut pris = vec![i];
        let mut q = k + 1;
        while q < rang.len() && colle(rang[q - 1], rang[q]) && pris.len() < SPAN_MAX {
            pris.push(rang[q]);
            q += 1;
        }
        let v: String = pris.iter().map(|&t| page.j[t].texte.trim()).collect();
        lus_n.entry(v).or_insert(pris);
    }
    let sortie = match lus_n.len() {
        0 => ChampSortie { valeur: None, refs: Vec::new(), statut: "absent".into(), instances: None },
        1 => {
            let (v, pris) = lus_n.into_iter().next().unwrap_or_default();
            lus.push((n, v.clone()));
            ChampSortie { valeur: Some(v), refs: page.cite(&pris), statut: "conforme".into(), instances: None }
        }
        _ => ChampSortie { valeur: None, refs: Vec::new(), statut: "signale".into(), instances: None },
    };
    champs.insert(grille.champs[n].code.clone(), sortie);
}
