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

use crate::entree::{Champ, Entree, Grille, Jeton};
use crate::lignes::rangees_selon;
use crate::reperes::normaliser;
use crate::textuel::{iso_valide, jusqua};
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
    /// Le sens vient de la déclaration de la personne, que les indices de la pièce ne
    /// contredisent pas.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub declare: bool,
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
    /// Le champ des groupes qui suivent la lettre de contrôle du matricule de l'émetteur
    /// (`groupes_emetteur` : le code TVA, la catégorie, l'établissement — « A/M/000 »),
    /// imprimés DANS ce matricule.
    groupes_emetteur: Option<usize>,
    /// Les adresses des parties (`adresse_emetteur`, `adresse_client`) : la ligne imprimée
    /// sous leur nom, dans leur bloc.
    adresse_emetteur: Option<usize>,
    adresse_client: Option<usize>,
    /// Le contact de l'émetteur (`telephone_email_emetteur`) : les lignes de son bloc qui
    /// s'ouvrent sur un repère de ce champ (« Tél : », « Fax : », « E-mail : »).
    contact_emetteur: Option<usize>,
}

fn cle_op(e: &Value, k: &str) -> Option<String> {
    e.get(k)
        .and_then(|v| v.as_str())
        .map(|s| s.trim_end_matches('?').trim().to_string())
}

/// Lit et contrôle l'op : les champs nommés existent ; les matricules ont un format.
pub fn lire_op(grille: &Grille, e: &Value) -> Result<OpParties, String> {
    let champ = |k: &str| -> Result<usize, String> {
        let nom = cle_op(e, k).ok_or_else(|| format!("clé « {k} » manquante"))?;
        grille
            .champs
            .iter()
            .position(|c| c.code == nom)
            .ok_or_else(|| format!("champ « {nom} » absent de la grille"))
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
    let groupes_emetteur = match cle_op(e, "groupes_emetteur") {
        Some(_) => Some(champ("groupes_emetteur")?),
        None => None,
    };
    let facultatif = |k: &str| -> Result<Option<usize>, String> {
        match cle_op(e, k) {
            Some(_) => Ok(Some(champ(k)?)),
            None => Ok(None),
        }
    };
    Ok(OpParties {
        emetteur,
        client,
        nom_emetteur: champ("nom_emetteur")?,
        nom_client: champ("nom_client")?,
        numero,
        groupes_emetteur,
        adresse_emetteur: facultatif("adresse_emetteur")?,
        adresse_client: facultatif("adresse_client")?,
        contact_emetteur: facultatif("contact_emetteur")?,
    })
}

/// Le texte d'un libellé, sans la ponctuation qui l'entoure (« Client : » → « client »).
/// Le point reste : « M. » n'est pas la lettre « M » d'un texte vertical.
fn cle(s: &str) -> String {
    s.trim_matches(|c: char| ":,;-–—·/|()".contains(c))
        .to_string()
}

/// Un mot comparable : sans casse, sans accents, sans ponctuation.
fn mot(s: &str) -> String {
    normaliser(s)
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// La valeur d'un matricule : majuscules, sans espaces.
/// Deux écritures normalisées de même forme qui ne diffèrent que par un seul chiffre.
fn a_un_chiffre_pres(a: &str, b: &str) -> bool {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    a.len() == b.len()
        && a.iter().zip(&b).filter(|(x, y)| x != y).count() == 1
        && a.iter()
            .zip(&b)
            .all(|(x, y)| x == y || (x.is_ascii_digit() && y.is_ascii_digit()))
}

/// Les chiffres qu'un OCR rend à la place d'une lettre de même dessin. Ce n'est pas une
/// règle d'un pays (R4) : c'est la forme des glyphes, la même pour tout alphabet latin.
const GLYPHES_CONFONDUS: [(char, char); 6] = [
    ('0', 'O'),
    ('1', 'I'),
    ('2', 'Z'),
    ('5', 'S'),
    ('6', 'G'),
    ('8', 'B'),
];

/// Deux réparations d'une lecture d'identifiant, toutes deux sous la lettre de contrôle
/// du pack (`ref.identifiant_controles`) : une valeur réparée n'est retenue que si la
/// lettre calculée sur son noyau est celle qu'elle porte. Sans règle de contrôle, rien
/// ne se répare.
///
/// - **La lettre lue comme un chiffre.** Banc du 6 novembre 2026, algoria-015 :
///   « 3184001O/A/M/000 » relu « 31840010/A/M/000 ». Le noyau a la longueur des poids ;
///   le caractère suivant est un chiffre qui ressemble à la lettre calculée.
/// - **L'écriture sans séparateurs.** algoria-002 : « 1958330VAM000 », le matricule du
///   dossier imprimé collé. Le motif du pack, ses séparateurs rendus facultatifs, le
///   trouve ; il est rendu dans la forme du motif.
pub(crate) struct Reparations<'c> {
    controle: &'c crate::entree::Controle,
    /// Le motif du pack dont chaque séparateur est facultatif, un groupe par segment.
    souple: Option<Regex>,
    /// Les séparateurs du motif, dans l'ordre : de quoi rendre la forme imprimée.
    separateurs: Vec<char>,
}

impl<'c> Reparations<'c> {
    pub(crate) fn nouvelles(motif: &str, controle: &'c crate::entree::Controle) -> Self {
        let (souple, separateurs) =
            motif_souple(motif).map_or((None, Vec::new()), |(r, s)| (Some(r), s));
        Reparations {
            controle,
            souple,
            separateurs,
        }
    }

    /// La lettre que porte la valeur après son noyau est celle que la règle calcule.
    fn confirmee(&self, valeur: &str) -> bool {
        let n = self.controle.poids.len();
        let noyau: String = valeur.chars().take(n).collect();
        let lettre = valeur.chars().nth(n);
        matches!((self.controle.lettre(&noyau), lettre), (Some(a), Some(b)) if a == b)
    }

    /// Le texte où un chiffre qui suit un noyau complet, et qui ressemble à la lettre que
    /// ce noyau appelle, est remplacé par elle. `None` s'il n'y a rien à réparer.
    fn lettre_lue_en_chiffre(&self, texte: &str) -> Option<String> {
        let n = self.controle.poids.len();
        let c: Vec<char> = texte.chars().collect();
        let mut sortie = c.clone();
        let mut repare = false;
        for i in n..c.len() {
            let debut = i - n;
            let noyau_isole = debut == 0 || !c[debut - 1].is_ascii_digit();
            if !noyau_isole || !c[debut..i].iter().all(char::is_ascii_digit) {
                continue;
            }
            let noyau: String = c[debut..i].iter().collect();
            let Some(attendue) = self.controle.lettre(&noyau) else {
                continue;
            };
            if GLYPHES_CONFONDUS
                .iter()
                .any(|&(chiffre, lettre)| c[i] == chiffre && lettre == attendue)
            {
                sortie[i] = attendue;
                repare = true;
            }
        }
        repare.then(|| sortie.into_iter().collect())
    }

    /// La valeur trouvée par le motif souple, rendue avec les séparateurs du motif.
    fn recompose(&self, c: &regex::Captures) -> String {
        let mut v = String::new();
        for (i, g) in c.iter().skip(1).enumerate() {
            if let Some(g) = g {
                v.push_str(g.as_str());
            }
            if let Some(s) = self.separateurs.get(i) {
                v.push(*s);
            }
        }
        v
    }
}

/// Le motif du pack, chaque séparateur littéral de premier niveau rendu facultatif, et ses
/// segments capturés. `None` si le motif n'a pas de séparateur, ou porte une alternative ou
/// un groupe de premier niveau (il ne se découpe pas sans risque).
fn motif_souple(motif: &str) -> Option<(Regex, Vec<char>)> {
    let mut segments: Vec<String> = vec![String::new()];
    let mut separateurs: Vec<char> = Vec::new();
    let (mut crochets, mut accolades, mut echappe) = (0i32, 0i32, false);
    for ch in motif.chars() {
        if echappe {
            segments.last_mut()?.push(ch);
            echappe = false;
            continue;
        }
        match ch {
            '\\' => {
                echappe = true;
                segments.last_mut()?.push(ch);
            }
            '[' => {
                crochets += 1;
                segments.last_mut()?.push(ch);
            }
            ']' => {
                crochets -= 1;
                segments.last_mut()?.push(ch);
            }
            '{' => {
                accolades += 1;
                segments.last_mut()?.push(ch);
            }
            '}' => {
                accolades -= 1;
                segments.last_mut()?.push(ch);
            }
            '|' | '(' | ')' if crochets == 0 => return None,
            _ if crochets == 0
                && accolades == 0
                && !ch.is_alphanumeric()
                && !"?*+.^$".contains(ch) =>
            {
                separateurs.push(ch);
                segments.push(String::new());
            }
            _ => segments.last_mut()?.push(ch),
        }
    }
    if separateurs.is_empty() || segments.iter().any(String::is_empty) {
        return None;
    }
    let mut r = String::new();
    for (i, s) in segments.iter().enumerate() {
        r.push('(');
        r.push_str(s);
        r.push(')');
        if let Some(sep) = separateurs.get(i) {
            r.push_str(&format!("{}?", regex::escape(&sep.to_string())));
        }
    }
    Regex::new(&r).ok().map(|re| (re, separateurs))
}

fn norme_matricule(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(|c| c.to_uppercase())
        .collect()
}

/// Un champ d'identifiant d'une PARTIE (le champ a un rôle) lu égal au matricule du
/// DOSSIER alors que la page imprime un autre identifiant de même noyau : la pièce a deux
/// parties, et l'étiquette (« MF ») ne dit pas laquelle est le dossier. Le rendre, ce
/// serait affirmer le sens de la pièce sans l'avoir lu (banc du 5 novembre 2026, dirigeant
/// 100/C-01 : un devis reçu, le matricule du client sous « MF » lu comme celui du
/// fournisseur, celui du fournisseur imprimé « 1105673/K/M/000 », hors du motif). L'autre
/// identifiant se reconnaît à son noyau — les chiffres de la règle de contrôle, puis la
/// lettre facultative et un séparateur —, même quand le motif le refuse : une lettre mal
/// lue ne doit pas faire du dossier la seule partie de la page. Il se signale.
pub(crate) fn le_dossier_parmi_d_autres(champ: &Champ, entree: &Entree, valeur: &str) -> bool {
    let Some(code) = champ.format_code.as_deref() else {
        return false;
    };
    let (Some(controle), Some(dossier), Some(_)) = (
        entree.pack.controles.get(code),
        entree.connus.as_ref().and_then(|c| c.dossier.as_ref()),
        champ.role.as_ref(),
    ) else {
        return false;
    };
    let complete = |v: &str| controle.complete(&norme_matricule(v));
    let d = complete(&dossier.matricule);
    if complete(valeur) != d {
        return false;
    }
    let noyau_du_dossier: String = d.chars().take(controle.poids.len()).collect();
    let Ok(re) = Regex::new(&format!(r"[0-9]{{{}}}[A-Za-z]?/", controle.poids.len())) else {
        return false;
    };
    // Les jetons d'une page recollés : un identifiant coupé en deux jetons (« 1105673 »
    // « /K/M/000 ») se voit aussi. Un recollement fortuit ne fait que taire le champ.
    let mut pages: BTreeMap<u32, String> = BTreeMap::new();
    for j in &entree.jetons {
        pages
            .entry(j.page)
            .or_default()
            .push_str(&norme_matricule(&j.texte));
    }
    pages.values().any(|t| {
        re.find_iter(t).any(|m| {
            let avant = t[..m.start()].chars().next_back();
            !avant.is_some_and(|c| c.is_ascii_digit())
                && !m.as_str().starts_with(noyau_du_dossier.as_str())
        })
    })
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
    /// Le jeton est-il écrit de droite à gauche ?
    rtl: Vec<bool>,
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
            .flat_map(|(c, ch)| {
                ch.reperes_fr
                    .iter()
                    .chain(ch.reperes_ar.iter())
                    .map(move |r| (cle(&normaliser(r)), c))
            })
            .filter(|(r, _): &(String, usize)| !r.is_empty())
            .collect::<Vec<_>>();
        let repere_max = reperes
            .iter()
            .map(|(r, _)| r.len())
            .max()
            .unwrap_or_default();
        let rtl = jetons
            .iter()
            .map(|j| crate::reperes::droite_a_gauche(&j.texte))
            .collect();
        Page {
            j: jetons,
            normes,
            rtl,
            cles,
            rangs,
            ou,
            reperes,
            repere_max,
        }
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

    /// Le jeton `i` a-t-il, juste sous lui et dans sa colonne, un jeton de même FORME (un
    /// nombre sous un nombre, un mot sous un mot : mêmes suites de chiffres, de lettres et
    /// de signes) qui n'est pas un libellé ? Alors il est une cellule d'une colonne de
    /// valeurs. Une date au-dessus d'une référence d'article n'en est pas une.
    fn en_colonne(&self, i: usize) -> bool {
        let j = &self.j[i];
        let forme = |t: &Jeton| {
            let mut f: Vec<char> = Vec::new();
            for c in t.texte.trim().chars() {
                let k = if c.is_ascii_digit() {
                    '9'
                } else if c.is_alphabetic() {
                    'a'
                } else {
                    c
                };
                if f.last() != Some(&k) || !matches!(k, '9' | 'a') {
                    f.push(k);
                }
            }
            f
        };
        let chiffre = |t: &Jeton| forme(t);
        let (r, _) = self.ou[i];
        self.rangs.iter().skip(r + 1).take(2).flatten().any(|&b| {
            let t = &self.j[b];
            t.page == j.page
                && t.y0 - j.y1 <= DESSUS * self.h(i)
                && t.x0 <= j.x1 + MARGE
                && t.x1 >= j.x0 - MARGE
                && !self.ponct(b)
                && chiffre(t) == chiffre(j)
                && self.champs_de(&self.normes[b]).is_none()
        })
    }

    /// La rangée `r` se poursuit-elle à la ligne d'après, comme un paragraphe ? Oui quand la
    /// rangée suivante, serrée sous elle (à moins d'une hauteur de corps), commence à la même
    /// marge, ne commence pas par un libellé, et n'est pas plus longue qu'elle : une ligne
    /// renvoyée à la ligne est pleine. Une liste « Client : … / Adresse : … » n'en est pas un.
    fn se_poursuit(&self, r: usize) -> bool {
        let (Some(rang), Some(suivante)) = (self.rangs.get(r), self.rangs.get(r + 1)) else {
            return false;
        };
        let (Some(&a), Some(&b)) = (rang.first(), suivante.first()) else {
            return false;
        };
        let fin = |g: &[usize]| g.iter().map(|&i| self.j[i].x1).fold(f64::MIN, f64::max);
        let bas = rang.iter().map(|&i| self.j[i].y1).fold(f64::MIN, f64::max);
        self.j[a].page == self.j[b].page
            && self.j[b].y0 - bas < self.h(a)
            && (self.j[b].x0 - self.j[a].x0).abs() <= MARGE
            && self.champs_de(&self.normes[b]).is_none()
            && fin(rang) >= fin(suivante) - MARGE
    }

    fn cite(&self, jetons: &[usize]) -> Vec<RefJeton> {
        jetons
            .iter()
            .map(|&i| RefJeton {
                page: self.j[i].page,
                ordinal: self.j[i].ordinal,
            })
            .collect()
    }

    fn texte(&self, jetons: &[usize]) -> String {
        jetons
            .iter()
            .map(|&i| self.j[i].texte.trim())
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Les champs dont un repère égale exactement ce libellé.
    /// Un jeton qui égale un repère du champ `n`, hors de `pris`, est-il suivi sur sa rangée
    /// d'une valeur à chiffres autre que `v` ?
    fn autre_valeur_du_libelle(&self, n: usize, pris: &[usize], v: &str) -> bool {
        let compact = |t: &str| {
            t.chars()
                .filter(|c| c.is_alphanumeric())
                .collect::<String>()
        };
        let v = compact(v);
        (0..self.j.len()).filter(|i| !pris.contains(i)).any(|i| {
            if !self
                .champs_de(&self.normes[i])
                .is_some_and(|e| e.champs.contains(&n))
            {
                return false;
            }
            let (r, k) = self.ou[i];
            self.rangs[r].get(k + 1).is_some_and(|&b| {
                let t = compact(&self.j[b].texte);
                !pris.contains(&b)
                    && t.chars().any(|c| c.is_ascii_digit())
                    && !v.contains(&t)
                    && !t.contains(&v)
            })
        })
    }

    fn champs_de(&self, texte: &str) -> Option<Etiquette> {
        let k = cle(texte);
        let champs: BTreeSet<usize> = self
            .reperes
            .iter()
            .filter(|(r, _)| *r == k)
            .map(|(_, c)| *c)
            .collect();
        (!champs.is_empty()).then_some(Etiquette { cle: k, champs })
    }

    /// Le libellé que portent les jetons `rang[s..e]` : la suite ENTIÈRE des mots
    /// adjacents qui finit en `e` (sans chiffre : une valeur n'est pas un libellé), dont
    /// le texte doit égaler un repère. « Payable avant le » n'est pas « Le », et
    /// « Contrat Entreprise n° » n'est pas « N° ».
    fn libelle_entier(
        &self,
        rang: &[usize],
        e: usize,
        debut_min: usize,
        h: f64,
    ) -> Option<Etiquette> {
        self.libelle_entier_ou(rang, e, debut_min, h)
            .map(|(et, _)| et)
    }

    /// Comme `libelle_entier`, avec le premier mot du libellé.
    fn libelle_entier_ou(
        &self,
        rang: &[usize],
        e: usize,
        debut_min: usize,
        h: f64,
    ) -> Option<(Etiquette, usize)> {
        let mut s = e - 1;
        while s > debut_min {
            let p = rang[s - 1];
            if self.ecart(p, rang[s]) > ECART_MOT * h
                || self.j[p].texte.chars().any(|c| c.is_ascii_digit())
            {
                break;
            }
            s -= 1;
        }
        self.libelle_de(&rang[s..e]).map(|et| (et, s))
    }

    /// De quel côté un libellé désigne-t-il sa valeur ? Vrai : à sa GAUCHE.
    ///
    /// Ni l'écriture du libellé ni la place d'un deux-points ne suffisent seules : « Client
    /// / الحريف : Société Nervane » (pièce bilingue, de gauche à droite) porte le libellé
    /// arabe à GAUCHE de sa valeur, « ALGORIA FACTORY SARL : الحريف » (pièce arabe) à sa
    /// DROITE, et l'OCR perd ou déplace les séparateurs. Chaque indice VOTE, pondéré :
    ///
    ///   3  le deux-points du libellé lui-même, collé à son bord (« MF: », « :المعرف ») ;
    ///   2  un séparateur entre le libellé et une VALEUR (un jeton qui n'est ni ponctuation
    ///      ni libellé de la grille) : seul (« RC : B37… ») ou collé à la valeur
    ///      (« :Laboratoire ») — un séparateur suivi d'un autre libellé (« Client : الحريف »,
    ///      la paire bilingue) ne vote pas ;
    ///   1  la valeur la plus proche, de part et d'autre ;
    ///   et, à égalité, l'écriture du libellé.
    fn vers_la_gauche(&self, mots: &[usize]) -> bool {
        let (Some(&premier), Some(&dernier)) = (mots.first(), mots.last()) else {
            return false;
        };
        let h = self.h(premier);
        let libelle = |t: usize| self.ponct(t) || self.champs_de(&self.normes[t]).is_some();
        let deux_points_seul = |t: usize| self.ponct(t) && self.j[t].texte.contains(':');
        // Le côté gauche (rangée du premier mot, vers la gauche) et le côté droit.
        let (r, k) = self.ou[premier];
        let cote_g: Vec<usize> = self.rangs[r][..k].iter().rev().copied().collect();
        let (r2, k2) = self.ou[dernier];
        let cote_d: Vec<usize> = self.rangs[r2][k2 + 1..].to_vec();
        // Le vote d'un côté : séparateur vers une valeur, et la distance de cette valeur.
        let vote = |cote: &[usize], bord0: usize, vers_gauche: bool| -> (i32, Option<f64>) {
            let ecart = |a: usize, b: usize| {
                if vers_gauche {
                    self.ecart(b, a)
                } else {
                    self.ecart(a, b)
                }
            };
            let mut bord = bord0;
            let mut separe = false;
            for (n, &t) in cote.iter().enumerate() {
                if ecart(bord, t) > ECART_VALEUR * h {
                    break;
                }
                let texte = self.j[t].texte.trim();
                let colle = if vers_gauche {
                    texte.ends_with(':')
                } else {
                    texte.starts_with(':')
                };
                if n == 0 && ecart(bord, t) <= ECART_MOT * h && deux_points_seul(t) {
                    separe = true;
                } else if !libelle(t) {
                    let poids = if separe || (n == 0 && colle) { 2 } else { 0 };
                    return (poids, Some(ecart(bord0, t)));
                } else if n == 0 || !separe {
                    // un autre libellé (la paire bilingue) : le séparateur ne lui était pas destiné
                    separe = false;
                }
                bord = t;
            }
            (0, None)
        };
        let (sep_g, dist_g) = vote(&cote_g, premier, true);
        let (sep_d, dist_d) = vote(&cote_d, dernier, false);
        let fin = self.j[dernier]
            .texte
            .trim_end_matches(|c: char| c == '/' || c.is_whitespace());
        let debut = self.j[premier].texte.trim_start();
        let propre_g = if debut.starts_with(':') { 3 } else { 0 };
        let propre_d = if fin.ends_with(':') { 3 } else { 0 };
        let proche = match (dist_g, dist_d) {
            (Some(_), None) => (1, 0),
            (None, Some(_)) => (0, 1),
            (Some(g), Some(d)) if (g - d).abs() > 0.25 * h => {
                if g < d {
                    (1, 0)
                } else {
                    (0, 1)
                }
            }
            _ => (0, 0),
        };
        let (g, d) = (propre_g + sep_g + proche.0, propre_d + sep_d + proche.1);
        if g != d {
            return g > d;
        }
        mots.iter().any(|&t| self.rtl[t])
    }

    /// Le libellé que portent ces mots, dans l'ordre visuel : de gauche à droite pour
    /// une écriture latine, de droite à gauche pour l'arabe (« الجبائي | المعرف »
    /// se lit « المعرف الجبائي »).
    fn libelle_de(&self, mots: &[usize]) -> Option<Etiquette> {
        let texte: String = if mots.iter().any(|&x| self.rtl[x]) {
            mots.iter()
                .rev()
                .map(|&x| self.normes[x].as_str())
                .collect()
        } else {
            mots.iter().map(|&x| self.normes[x].as_str()).collect()
        };
        if cle(&texte).len() > self.repere_max {
            return None;
        }
        self.champs_de(&texte)
    }

    /// Le libellé arabe à DROITE d'une valeur sur sa rangée : la suite entière des mots
    /// adjacents qui commence juste après elle (ponctuation sautée), sans chiffre.
    fn droite(&self, i: usize) -> Option<Etiquette> {
        let (r, k) = self.ou[i];
        let rang = &self.rangs[r];
        let h = self.h(i);
        let mut s = k + 1;
        while s < rang.len() && self.ponct(rang[s]) {
            s += 1;
        }
        if s >= rang.len() || self.ecart(i, rang[s]) > ECART_VALEUR * h {
            return None;
        }
        let mut e = s + 1;
        while e < rang.len()
            && self.ecart(rang[e - 1], rang[e]) <= ECART_MOT * h
            && !self.j[rang[e]].texte.chars().any(|c| c.is_ascii_digit())
            && !self.ponct(rang[e])
        {
            e += 1;
        }
        let et = self.libelle_de(&rang[s..e])?;
        self.vers_la_gauche(&rang[s..e]).then_some(et)
    }

    /// Le libellé à gauche d'une valeur sur sa rangée (ou dans le jeton lui-même,
    /// avant la valeur), sinon juste au-dessus.
    fn etiquette(&self, i: usize, prefixe: &str) -> Option<Etiquette> {
        if !cle(prefixe).is_empty() {
            return self.champs_de(prefixe);
        }
        self.droite(i)
            .or_else(|| self.gauche(i))
            .or_else(|| self.dessus(i))
    }

    /// Le libellé collé en tête d'un jeton (« N°IE-2026-0701 ») : le plus long début du
    /// texte qui égale un repère de la grille, et l'octet où la valeur commence.
    fn libelle_colle(&self, i: usize) -> Option<(Etiquette, usize)> {
        let t = self.j[i].texte.trim();
        t.char_indices()
            .map(|(b, _)| b)
            .skip(1)
            .filter(|&b| cle(&normaliser(&t[..b])).len() <= self.repere_max)
            .filter(|&b| t[b..].chars().any(|c| c.is_alphanumeric()))
            .filter_map(|b| self.champs_de(&normaliser(&t[..b])).map(|et| (et, b)))
            .max_by_key(|(et, _)| et.cle.len())
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
        // Un libellé qui désigne vers sa gauche est celui d'une AUTRE valeur, plus à gauche.
        let (et, s) = self.libelle_entier_ou(rang, e, 0, h)?;
        (!self.vers_la_gauche(&rang[s..e])).then_some(et)
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
                t.x1 >= j.x0 - MARGE
                    && t.x0 <= j.x1 + MARGE
                    && j.y0 - t.y1 <= DESSUS * h
                    && j.y0 - t.y1 >= -0.25 * h
            })
            .collect();
        let (&premier, &dernier) = (sur.first()?, sur.last()?);
        // Un en-tête au-dessus d'une COLONNE de valeurs (« Qté » sur 2, 5, …) nomme une
        // cellule de tableau, pas un champ de la pièce : la quantité d'une ligne n'est pas
        // « la quantité » de l'avoir (banc du 4 novembre 2026, avoir, bon de livraison,
        // note de frais).
        if self.en_colonne(i) {
            return None;
        }
        // Un libellé qui commence une phrase n'est pas l'en-tête de ce qui est dessous : la
        // ligne du dessous est la suite du paragraphe (« Réserve de propriété : le transfert
        // … Toute / réclamation doit être formulée … », conditions générales, banc du
        // 4 novembre 2026). Un en-tête finit son segment de rangée.
        let mut apres = dernier + 1;
        while apres < rang.len() && self.ponct(rang[apres]) {
            apres += 1;
        }
        if apres < rang.len() && self.ecart(rang[apres - 1], rang[apres]) <= ECART_MOT * h {
            return None;
        }
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
                if self.ponct(rang[s])
                    || (s > 0
                        && self.ecart(rang[s - 1], rang[s]) <= ECART_SEGMENT * h
                        && !self.ponct(rang[s - 1]))
                {
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
                    if let Some(et) = self.libelle_de(&rang[s..e]) {
                        if meilleur
                            .as_ref()
                            .is_none_or(|(_, m)| et.cle.len() > m.cle.len())
                        {
                            meilleur = Some((e, et));
                        }
                    }
                }
                let Some((e, et)) = meilleur else { continue };
                let camp =
                    if et.champs.contains(&op.nom_client) && camps.decide(Camp::Client, &et.cle) {
                        Camp::Client
                    } else if et.champs.contains(&op.nom_emetteur)
                        && camps.decide(Camp::Emetteur, &et.cle)
                    {
                        Camp::Emetteur
                    } else {
                        continue;
                    };
                out.push(Libelle {
                    camp,
                    jetons: rang[s..e].to_vec(),
                });
            }
            // Un libellé arabe ferme son segment, à droite : on le lit depuis la fin.
            for f in 0..rang.len() {
                let h = self.h(rang[f]);
                let fin = f + 1 == rang.len()
                    || self.ecart(rang[f], rang[f + 1]) > ECART_SEGMENT * h
                    || self.ponct(rang[f + 1]);
                if !self.rtl[rang[f]] || !fin || out.iter().any(|l| l.jetons.contains(&rang[f])) {
                    continue;
                }
                let mut meilleur: Option<(usize, Etiquette)> = None;
                let mut d = f + 1;
                while d > 0 {
                    if d <= f && self.ecart(rang[d - 1], rang[d]) > ECART_MOT * h {
                        break;
                    }
                    d -= 1;
                    if !self.rtl[rang[d]] {
                        break;
                    }
                    match self.libelle_de(&rang[d..=f]) {
                        Some(et)
                            if meilleur
                                .as_ref()
                                .is_none_or(|(_, m)| et.cle.len() > m.cle.len()) =>
                        {
                            meilleur = Some((d, et))
                        }
                        _ => {}
                    }
                }
                let Some((d, et)) = meilleur else { continue };
                if !self.vers_la_gauche(&rang[d..=f]) {
                    continue;
                }
                let camp =
                    if et.champs.contains(&op.nom_client) && camps.decide(Camp::Client, &et.cle) {
                        Camp::Client
                    } else if et.champs.contains(&op.nom_emetteur)
                        && camps.decide(Camp::Emetteur, &et.cle)
                    {
                        Camp::Emetteur
                    } else {
                        continue;
                    };
                out.push(Libelle {
                    camp,
                    jetons: rang[d..=f].to_vec(),
                });
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
            t.page == fin.page
                && (t.x0 - marge).abs() <= MARGE
                && t.y0 >= fin.y1
                && t.y0 - fin.y1 <= ECART_MOT * h
        })?;
        Some((r + 1, kk))
    }

    /// Les occurrences des valeurs au format : jetons contigus d'une rangée (et de sa
    /// suite quand le segment est coupé en fin de ligne), recollés sans espaces ; la
    /// valeur touche le premier et le dernier jeton, et n'est bordée d'aucun caractère
    /// alphanumérique.
    fn matricules(&self, re: &Regex, rep: Option<&Reparations>) -> Vec<Occ> {
        let mut out: Vec<Occ> = Vec::new();
        for (r, rang) in self.rangs.iter().enumerate() {
            for s in 0..rang.len() {
                let h = self.h(rang[s]);
                let mut seq = vec![rang[s]];
                let mut k = s;
                while k + 1 < rang.len()
                    && seq.len() < SPAN_MAX
                    && self.ecart(rang[k], rang[k + 1]) <= ECART_MOT * h
                {
                    k += 1;
                    seq.push(rang[k]);
                }
                let fin_de_segment =
                    k + 1 == rang.len() || self.ecart(rang[k], rang[k + 1]) > ECART_SEGMENT * h;
                if seq.len() < SPAN_MAX && fin_de_segment {
                    if let Some((rr, kk)) = self.suite(r, k) {
                        let rg = &self.rangs[rr];
                        let mut q = kk;
                        while q < rg.len()
                            && seq.len() < SPAN_MAX
                            && (q == kk || self.ecart(rg[q - 1], rg[q]) <= ECART_MOT * h)
                        {
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
                    // Une valeur touche le premier et le dernier jeton, sans être bordée
                    // d'un caractère alphanumérique.
                    let borne = |texte: &str, debut: usize, fin: usize| {
                        let avant = texte[..debut].chars().next_back();
                        let apres = texte[fin..].chars().next();
                        debut < premier
                            && fin > dernier
                            && !avant.is_some_and(|c| c.is_alphanumeric())
                            && !apres.is_some_and(|c| c.is_alphanumeric())
                    };
                    let mut pousser = |valeur: String, debut: usize| {
                        let jetons = seq[..=e].to_vec();
                        if !out.iter().any(|o| o.valeur == valeur && o.jetons == jetons) {
                            out.push(Occ {
                                valeur,
                                jetons,
                                prefixe: tout[..debut].to_string(),
                            });
                        }
                    };
                    for m in re.find_iter(&tout) {
                        if borne(&tout, m.start(), m.end()) {
                            pousser(m.as_str().to_string(), m.start());
                        }
                    }
                    let Some(rep) = rep else { continue };
                    // Les réparations : la lettre de contrôle lue comme un chiffre, et
                    // l'écriture sans séparateurs. Chacune n'est retenue que si la lettre
                    // calculée par la règle du pack la confirme.
                    let lettre_reparee = rep.lettre_lue_en_chiffre(&tout);
                    let textes: Vec<&str> = match lettre_reparee.as_deref() {
                        Some(t) => vec![tout.as_str(), t],
                        None => vec![tout.as_str()],
                    };
                    for (k, texte) in textes.iter().enumerate() {
                        if k > 0 {
                            for m in re.find_iter(texte) {
                                if borne(texte, m.start(), m.end()) && rep.confirmee(m.as_str()) {
                                    pousser(m.as_str().to_string(), m.start());
                                }
                            }
                        }
                        if let Some(souple) = &rep.souple {
                            for c in souple.captures_iter(texte) {
                                let m = c.get(0).expect("le motif entier");
                                if !borne(texte, m.start(), m.end()) {
                                    continue;
                                }
                                let valeur = rep.recompose(&c);
                                if valeur != m.as_str()
                                    && re.is_match(&valeur)
                                    && rep.confirmee(&valeur)
                                {
                                    pousser(valeur, m.start());
                                }
                            }
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
                let vertical = a.page == o.page
                    && a.y0 <= o.y0 + 0.5 * self.h(i)
                    && o.y0 - a.y0 <= BLOC_HAUTEUR;
                // Un bloc ouvert par un libellé arabe s'étend vers la gauche, depuis son bord droit.
                if self.vers_la_gauche(&l.jetons) {
                    let x1 = l
                        .jetons
                        .iter()
                        .map(|&t| self.j[t].x1)
                        .fold(f64::MIN, f64::max);
                    vertical && o.x1 <= x1 + MARGE && o.x1 >= x1 - BLOC_LARGEUR
                } else {
                    vertical && o.x0 >= a.x0 - MARGE && o.x0 <= a.x0 + BLOC_LARGEUR
                }
            })
            .max_by(|a, b| {
                let (ja, jb) = (&self.j[a.jetons[0]], &self.j[b.jetons[0]]);
                ja.y0
                    .partial_cmp(&jb.y0)
                    .unwrap_or(std::cmp::Ordering::Equal)
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

    /// Les grappes légales de deux matricules : chaque étiquette d'un champ que la grille
    /// donne au seul rôle de l'émetteur (registre de commerce, RIB, téléphone, capital…) ou au
    /// seul rôle du client, imprimée près d'eux, va au matricule le PLUS PROCHE (l'écart entre
    /// colonnes pèse double : un bloc est une colonne). Rend, pour chacun, (émetteur, client).
    /// Une étiquette que les deux rôles portent (« Adresse ») ne compte pas ; les matricules
    /// non plus.
    fn grappes(
        &self,
        a: &[&Occ],
        b: &[&Occ],
        grille: &Grille,
        op: &OpParties,
        formes: &BTreeSet<String>,
    ) -> ((usize, usize), (usize, usize)) {
        let role = |c: usize| grille.champs[c].role.clone();
        let (re, rc) = (role(op.emetteur), role(op.client));
        if re.is_none() || rc.is_none() || re == rc {
            return ((0, 0), (0, 0));
        }
        let cles_de = |r: &Option<String>| -> BTreeSet<String> {
            grille
                .champs
                .iter()
                .filter(|c| c.role == *r && c.format_code.is_none())
                .flat_map(|c| c.reperes_fr.iter().chain(c.reperes_ar.iter()))
                .map(|x| mot(x))
                // une forme juridique (« SUARL ») est une valeur du nom, pas une étiquette
                .filter(|x| x.chars().count() >= 2 && !formes.contains(x))
                .collect()
        };
        let (e, c) = (cles_de(&re), cles_de(&rc));
        let seuls_e: BTreeSet<&String> = e.iter().filter(|k| !c.contains(*k)).collect();
        let seuls_c: BTreeSet<&String> = c.iter().filter(|k| !e.contains(*k)).collect();
        let pris: BTreeSet<usize> = a
            .iter()
            .chain(b.iter())
            .flat_map(|o| o.jetons.iter().copied())
            .collect();
        // L'écart d'un jeton à une occurrence : entre colonnes (doublé) et entre rangées.
        let ecart = |t: usize, o: &Occ| -> f64 {
            let j = &self.j[t];
            let (x0, x1) = (
                self.j[o.jetons[0]].x0,
                self.j[*o.jetons.last().unwrap_or(&o.jetons[0])].x1,
            );
            let (y0, y1) = (self.j[o.jetons[0]].y0, self.j[o.jetons[0]].y1);
            if j.page != self.j[o.jetons[0]].page {
                return f64::MAX;
            }
            let dx = (x0 - j.x1).max(j.x0 - x1).max(0.0);
            let dy = (y0 - j.y1).max(j.y0 - y1).max(0.0);
            2.0 * dx + dy
        };
        let plus_pres =
            |t: usize, occs: &[&Occ]| occs.iter().map(|o| ecart(t, o)).fold(f64::MAX, f64::min);
        let (mut ea, mut ca, mut eb, mut cb) = (
            BTreeSet::new(),
            BTreeSet::new(),
            BTreeSet::new(),
            BTreeSet::new(),
        );
        for rang in &self.rangs {
            for (k, &t) in rang.iter().enumerate() {
                if pris.contains(&t) {
                    continue;
                }
                let (da, db) = (plus_pres(t, a), plus_pres(t, b));
                if da.min(db) > 2.0 * BLOC_HAUTEUR {
                    continue;
                }
                // un libellé d'un à trois mots qui commence ici
                let mut texte = String::new();
                for &u in rang.iter().skip(k).take(3) {
                    texte.push_str(&mot(&self.j[u].texte));
                    let (vers_e, vers_c) = if da < db {
                        (&mut ea, &mut ca)
                    } else {
                        (&mut eb, &mut cb)
                    };
                    if da == db {
                        break;
                    }
                    if seuls_e.contains(&texte) {
                        vers_e.insert(t);
                    }
                    if seuls_c.contains(&texte) {
                        vers_c.insert(t);
                    }
                }
            }
        }
        ((ea.len(), ca.len()), (eb.len(), cb.len()))
    }

    /// Les mots d'un nom écrit à gauche du jeton `k` de la rangée `r` (ponctuation sautée),
    /// jusqu'à la ponctuation ou un blanc : dans l'ordre de la rangée.
    fn mots_avant(&self, r: usize, mut k: usize) -> Vec<usize> {
        let rang = &self.rangs[r];
        while k > 0 && self.ponct(rang[k - 1]) {
            k -= 1;
        }
        let mut out: Vec<usize> = Vec::new();
        while k > 0 && !self.ponct(rang[k - 1]) {
            if let Some(&p) = out.last() {
                if self.ecart(rang[k - 1], p) > ECART_MOT * self.h(p) {
                    break;
                }
            }
            out.push(rang[k - 1]);
            k -= 1;
        }
        out.reverse();
        out
    }

    /// La raison sociale connue, cherchée dans les jetons : la première suite de mots
    /// égale (formes juridiques ignorées), formes qui la suivent comprises.
    /// Le nom connu (`raison_sociale`), trouvé sur la page et imprimé FIDÈLEMENT : chaque mot
    /// est celui de la fiche, à la casse près, ou ce mot sans ses accents (une pièce les
    /// omet). Un accent que la fiche n'a pas est une lecture fausse (algoria-065 :
    /// « ALGORIA FAÇTORY SARL ») : le nom ne se rend pas.
    fn nom_connu(&self, raison_sociale: &str, formes: &BTreeSet<String>) -> Option<Vec<usize>> {
        let jetons = self.chercher_nom(raison_sociale, formes)?;
        let minuscules = |t: &str| -> String {
            t.chars()
                .filter(|c| c.is_alphanumeric())
                .flat_map(char::to_lowercase)
                .collect()
        };
        let fiche: Vec<&str> = raison_sociale
            .split_whitespace()
            .filter(|m| !formes.contains(&mot(m)))
            .collect();
        let imprime: Vec<&str> = jetons
            .iter()
            .map(|&t| self.j[t].texte.as_str())
            .filter(|m| !formes.contains(&mot(m)))
            .collect();
        let fidele = fiche.len() == imprime.len()
            && fiche
                .iter()
                .zip(&imprime)
                .all(|(f, i)| minuscules(i) == minuscules(f) || minuscules(i) == mot(f));
        fidele.then_some(jetons)
    }

    fn chercher_nom(&self, raison_sociale: &str, formes: &BTreeSet<String>) -> Option<Vec<usize>> {
        let cherches: Vec<String> = raison_sociale
            .split_whitespace()
            .map(mot)
            .filter(|m| !m.is_empty() && !formes.contains(m))
            .collect();
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
                    if !mots[p].is_empty()
                        && !formes.contains(&mots[p])
                        && !self.j[p].texte.trim_end().ends_with(':')
                        && adjacent(p, rang[s])
                    {
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
                while k < rang.len()
                    && formes.contains(&mots[rang[k]])
                    && adjacent(rang[k - 1], rang[k])
                {
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
    fn nom_inconnu(
        &self,
        occs: &[&Occ],
        libelle: Option<&Libelle>,
        formes: &BTreeSet<String>,
    ) -> Option<Vec<usize>> {
        if let Some(l) = libelle.filter(|l| self.vers_la_gauche(&l.jetons)) {
            // Le nom se lit à GAUCHE d'un libellé arabe, sur sa rangée ; sinon juste dessous,
            // aligné sur son bord droit.
            let debut = *l.jetons.first()?;
            let (r, k) = self.ou[debut];
            let h = self.h(debut);
            // `mots_avant` rend les mots de gauche à droite ; un nom écrit de droite à gauche
            // se lit dans l'autre sens (« للتدقيق غرفان مكتب » pour « مكتب غرفان للتدقيق »,
            // OCR PP-OCRv6 du 8 novembre 2026, algoria-107).
            let lecture = |mut m: Vec<usize>| {
                if m.iter().any(|&t| self.rtl[t]) {
                    m.reverse();
                }
                m
            };
            let avant = self.mots_avant(r, k);
            if avant
                .last()
                .is_some_and(|&a| self.ecart(a, debut) <= ECART_VALEUR * h)
            {
                return Some(lecture(avant));
            }
            let x1 = l
                .jetons
                .iter()
                .map(|&t| self.j[t].x1)
                .fold(f64::MIN, f64::max);
            let a = &self.j[debut];
            let dessous = self.rangs.iter().enumerate().skip(r + 1).find(|(_, rg)| {
                let b = &self.j[rg[0]];
                b.page == a.page && b.y0 > a.y0
            });
            if let Some((rr, rg)) = dessous {
                if self.j[rg[0]].y0 - a.y1 <= DESSUS * h {
                    if let Some(k0) = rg.iter().rposition(|&t| {
                        self.j[t].x1 <= x1 + MARGE && self.j[t].x1 >= x1 - BLOC_LARGEUR
                    }) {
                        let m = self.mots_avant(rr, k0 + 1);
                        if !m.is_empty() {
                            return Some(lecture(m));
                        }
                    }
                }
            }
            return None;
        }
        if let Some(l) = libelle {
            let fin = *l.jetons.last()?;
            let (r, k) = self.ou[fin];
            let h = self.h(fin);
            let apres = self.mots_depuis(r, k + 1);
            if apres
                .first()
                .is_some_and(|&a| self.ecart(fin, a) <= ECART_VALEUR * h)
            {
                return Some(apres);
            }
            let a = &self.j[l.jetons[0]];
            let dessous = self.rangs.iter().enumerate().skip(r + 1).find(|(_, rg)| {
                let b = &self.j[rg[0]];
                b.page == a.page && b.y0 > a.y0
            });
            if let Some((rr, rg)) = dessous {
                if self.j[rg[0]].y0 - a.y1 <= DESSUS * h {
                    if let Some(k0) = rg.iter().position(|&t| {
                        self.j[t].x0 >= a.x0 - MARGE && self.j[t].x0 <= a.x0 + BLOC_LARGEUR
                    }) {
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
                    let Some(pris) = self.nom_a_forme(rang, k, formes) else {
                        continue;
                    };
                    let (x0, x1) = (self.j[pris[0]].x0, self.j[rang[k]].x1);
                    if x1 < jo.x0 - BLOC_LARGEUR || x0 > self.j[*o.jetons.last()?].x1 + BLOC_LARGEUR
                    {
                        continue;
                    }
                    return Some(pris);
                }
            }
        }
        None
    }

    /// Le segment de la rangée `r` qui s'ouvre au bord gauche `x0` (à `MARGE` près) : ses
    /// mots contigus, sans mot collé à sa gauche.
    fn segment_a(&self, r: usize, x0: f64) -> Option<Vec<usize>> {
        let rg = &self.rangs[r];
        let k0 = rg
            .iter()
            .position(|&t| (self.j[t].x0 - x0).abs() <= MARGE)?;
        if k0 > 0 && self.ecart(rg[k0 - 1], rg[k0]) <= ECART_SEGMENT * self.h(rg[k0]) {
            return None;
        }
        let mut pris = vec![rg[k0]];
        for w in rg[k0..].windows(2) {
            if self.ecart(w[0], w[1]) > ECART_SEGMENT * self.h(w[0]) {
                break;
            }
            pris.push(w[1]);
        }
        Some(pris)
    }

    /// Le nom d'une partie sans libellé ni forme juridique : la TÊTE du bloc aligné sur son
    /// matricule. Banc du 7 novembre 2026 : « Imprimerie Darvane », « Centre Felmane de
    /// Formation » — un en-tête d'émetteur classique, nom, adresse, « MF : », « Tél : » —
    /// se taisaient, faute de « SARL » à lire. Rendu seulement quand la structure le
    /// prouve, sinon rien :
    /// - le bloc est la suite des rangées, au-dessus du matricule, dont un segment s'ouvre
    ///   au même bord gauche que celui de la rangée du matricule, sans trou entre elles ;
    /// - le nom est la PREMIÈRE de ces rangées : rien d'aligné au-dessus (une enseigne, un
    ///   slogan rendraient le choix ambigu) ;
    /// - il est fait de mots, sans chiffre, sans libellé, sans deux-points, pas en
    ///   écriture de droite à gauche ;
    /// - dessous, dans l'ordre et sans rien d'autre : son écriture arabe s'il y en a une,
    ///   une adresse d'une ou deux lignes de mots qui porte un numéro, puis des lignes à
    ///   libellé (« MF : », « Tél : », « RC : ») jusqu'au matricule.
    fn tete_de_bloc(&self, occs: &[&Occ]) -> Option<Vec<usize>> {
        for o in occs {
            let i = o.jetons[0];
            let (r0, k0) = self.ou[i];
            let rang = &self.rangs[r0];
            // le bord gauche du segment qui porte le matricule (« MF : 1234567A/… »)
            let mut d = k0;
            while d > 0 && self.ecart(rang[d - 1], rang[d]) <= ECART_SEGMENT * self.h(rang[d]) {
                d -= 1;
            }
            let x0 = self.j[rang[d]].x0;
            let jo = &self.j[i];
            let h = self.h(i);
            // remonter le bloc, rangée par rangée, tant qu'un segment s'ouvre à `x0`
            let mut bloc: Vec<Vec<usize>> = Vec::new();
            let mut bas = jo.y0;
            for r in (0..r0).rev() {
                let a = &self.j[self.rangs[r][0]];
                if a.page != jo.page || jo.y0 - a.y0 > BLOC_HAUTEUR {
                    break;
                }
                let Some(seg) = self.segment_a(r, x0) else {
                    continue;
                };
                let y1 = seg.iter().map(|&t| self.j[t].y1).fold(f64::MIN, f64::max);
                if bas - y1 > DESSUS * h {
                    break;
                }
                bas = self.j[seg[0]].y0;
                bloc.push(seg);
            }
            // de haut en bas : le nom, puis son écriture arabe s'il y en a une, puis
            // l'adresse (une ou deux lignes), puis des lignes à libellé jusqu'au matricule
            bloc.reverse();
            let Some(nom) = bloc.first() else {
                continue;
            };
            let arabe = |l: &[usize]| {
                l.iter().all(|&t| {
                    self.j[t]
                        .texte
                        .chars()
                        .any(|c| ('\u{0600}'..='\u{06FF}').contains(&c))
                })
            };
            let libelle = |l: &[usize]| {
                l.iter()
                    .any(|&t| self.etiquette(t, "").is_some() || self.j[t].texte.contains(':'))
            };
            let chiffre = |l: &[usize]| {
                l.iter()
                    .any(|&t| self.j[t].texte.chars().any(|c| c.is_ascii_digit()))
            };
            let mots = |l: &[usize]| {
                l.iter()
                    .any(|&t| self.j[t].texte.chars().any(char::is_alphabetic))
            };
            if arabe(nom) || libelle(nom) || chiffre(nom) || !mots(nom) {
                continue;
            }
            let mut k = 1;
            while k < bloc.len() && arabe(&bloc[k]) && !libelle(&bloc[k]) {
                k += 1;
            }
            let debut_adresse = k;
            while k < bloc.len() && k - debut_adresse < 2 && !libelle(&bloc[k]) && !arabe(&bloc[k])
            {
                k += 1;
            }
            let adresse = &bloc[debut_adresse..k];
            if adresse.is_empty()
                || !adresse.iter().any(|l| chiffre(l))
                || !adresse.iter().all(|l| mots(l))
                || !bloc[k..].iter().all(|l| libelle(l))
            {
                continue;
            }
            return Some(nom.clone());
        }
        None
    }

    /// Le contact d'une partie : les lignes de SON bloc qui s'ouvrent sur un repère du champ
    /// `champ` (« Tél : 00 38 356 183 », « E-mail : vente@… », « Tél:71 … » collé). Leur
    /// reste, mis bout à bout. Une valeur sans chiffre ni « @ » n'en est pas une.
    ///
    /// Le bloc : en partant de la rangée du matricule, vers le haut puis vers le bas, les
    /// segments alignés sur le bord gauche de celui du matricule, sans trou vertical, à moins
    /// d'une hauteur de bloc. Il s'arrête au premier segment qui porte une `frontiere` — le
    /// libellé d'une partie (« Client », « Livré à ») ou le matricule d'une autre — : deux
    /// blocs empilés à la même marge ne se mêlent pas (revue Codex de #268 : le téléphone
    /// du client, sous l'émetteur, était pris pour le sien).
    fn contact_du_bloc(
        &self,
        matricule: &[usize],
        champ: usize,
        frontieres: &BTreeSet<usize>,
    ) -> Option<Vec<usize>> {
        let i = *matricule.first()?;
        let (r0, k0) = self.ou[i];
        let rang = &self.rangs[r0];
        let mut d = k0;
        while d > 0 && self.ecart(rang[d - 1], rang[d]) <= ECART_SEGMENT * self.h(rang[d]) {
            d -= 1;
        }
        let x0 = self.j[rang[d]].x0;
        let jo = &self.j[i];
        let h = self.h(i);
        // les segments du bloc, rangée par rangée, du matricule vers le haut puis vers le bas
        let mut bloc: Vec<Vec<usize>> = Vec::new();
        let haut: Vec<usize> = (0..r0).rev().collect();
        let bas: Vec<usize> = (r0 + 1..self.rangs.len()).collect();
        for sens in [haut, bas] {
            let (mut y_haut, mut y_bas) = (jo.y0, jo.y1);
            for r in sens {
                let a = &self.j[self.rangs[r][0]];
                if a.page != jo.page || (a.y0 - jo.y0).abs() > BLOC_HAUTEUR {
                    break;
                }
                let Some(seg) = self.segment_a(r, x0) else {
                    continue;
                };
                if seg.iter().any(|t| frontieres.contains(t)) {
                    break;
                }
                let y0 = seg.iter().map(|&t| self.j[t].y0).fold(f64::MAX, f64::min);
                let y1 = seg.iter().map(|&t| self.j[t].y1).fold(f64::MIN, f64::max);
                if y0 - y_bas > DESSUS * h || y_haut - y1 > DESSUS * h {
                    break;
                }
                y_haut = y_haut.min(y0);
                y_bas = y_bas.max(y1);
                bloc.push(seg);
            }
        }
        let mut pris: Vec<usize> = Vec::new();
        for seg in bloc {
            let t0 = seg[0];
            // « Tél. » : le point d'abréviation ne fait pas partie du repère (« Tél »). Il
            // reste partout ailleurs, où « M. » n'est pas la lettre « M ».
            let entier = [
                self.normes[t0].as_str(),
                self.normes[t0].trim_end_matches(['.', ':']),
            ]
            .iter()
            .any(|n| self.champs_de(n).is_some_and(|e| e.champs.contains(&champ)));
            let colle = !entier
                && self
                    .libelle_colle(t0)
                    .is_some_and(|(e, _)| e.champs.contains(&champ));
            if !entier && !colle {
                continue;
            }
            let reste: Vec<usize> = if colle {
                seg.clone()
            } else {
                seg[1..]
                    .iter()
                    .copied()
                    .skip_while(|&t| self.ponct(t))
                    .collect()
            };
            let utile = reste.iter().any(|&t| {
                self.j[t]
                    .texte
                    .chars()
                    .any(|c| c.is_ascii_digit() || c == '@')
            });
            if utile {
                pris.extend(reste);
            }
        }
        (!pris.is_empty()).then_some(pris)
    }

    /// L'adresse imprimée sous un nom, dans son bloc : la ligne qui suit, alignée sur le
    /// bord gauche du nom, faite de mots (pas d'un libellé). Rendue seulement ENTIÈRE : la
    /// ligne d'après, dans le bloc, s'ouvre sur un libellé (« Tél : », « MF : ») ou le bloc
    /// s'arrête — une adresse sur deux lignes ne se rend pas coupée —, et elle porte un
    /// numéro. Jamais en écriture de droite à gauche. Banc sans IA du 5 novembre 2026 : 240
    /// adresses muettes ; 18 faux au premier essai (débuts de ligne, « Tel: » collé,
    /// adresses arabes, slogans), écartés par ces règles.
    fn adresse_sous(&self, nom: &[usize]) -> Option<Vec<usize>> {
        let premier = *nom.first()?;
        if self.vers_la_gauche(nom) {
            return None;
        }
        let a = &self.j[premier];
        let x0 = nom.iter().map(|&t| self.j[t].x0).fold(f64::MAX, f64::min);
        let y1 = nom.iter().map(|&t| self.j[t].y1).fold(f64::MIN, f64::max);
        let h = self.h(premier);
        // Le bord du bloc peut être celui du libellé qui ouvre la rangée du nom (« Client :
        // ALGORIA FACTORY SARL », l'adresse alignée sous « Client », algoria-036) : le
        // début du segment du nom.
        let bord = {
            let (r, k) = self.ou[premier];
            let rg = &self.rangs[r];
            let mut d = k;
            while d > 0 && self.ecart(rg[d - 1], rg[d]) <= ECART_SEGMENT * self.h(rg[d]) {
                d -= 1;
            }
            self.j[rg[d]].x0
        };
        // la ligne du bloc sous `y`, alignée sur `x0` : ses mots contigus
        let ligne_sous = |y: f64| -> Option<Vec<usize>> {
            let rg = self.rangs.iter().find(|rg| {
                let b = &self.j[rg[0]];
                b.page == a.page && b.y0 >= y - 0.25 * h
            })?;
            if self.j[rg[0]].y0 - y > DESSUS * h {
                return None;
            }
            // le début d'un segment (aucun mot collé à sa gauche), aligné sur le nom ou sur
            // le bord de sa rangée : un mot qui tombe par hasard sous le nom, au milieu d'une
            // ligne (« Cyprès, »), n'en est pas un
            let debut =
                |k: usize| k == 0 || self.ecart(rg[k - 1], rg[k]) > ECART_SEGMENT * self.h(rg[k]);
            let k0 = (0..rg.len())
                .find(|&k| (self.j[rg[k]].x0 - x0).abs() <= MARGE && debut(k))
                .or_else(|| {
                    (0..rg.len()).find(|&k| (self.j[rg[k]].x0 - bord).abs() <= MARGE && debut(k))
                })?;
            let mut pris = vec![rg[k0]];
            for w in rg[k0..].windows(2) {
                if self.ecart(w[0], w[1]) > ECART_SEGMENT * self.h(w[0]) {
                    break;
                }
                pris.push(w[1]);
            }
            // une seule ligne imprimée : les mots à la même hauteur
            let y = self.j[pris[0]].y0;
            if pris.iter().any(|&t| (self.j[t].y0 - y).abs() > 0.3 * h) {
                return None;
            }
            Some(pris)
        };
        // un libellé n'importe où dans la ligne (« … Tunis Tel: 00 71 … »)
        let libelle = |l: &[usize]| {
            l.iter()
                .any(|&t| self.etiquette(t, "").is_some() || self.j[t].texte.contains(':'))
        };
        let adresse = ligne_sous(y1)?;
        // une écriture de droite à gauche se lit dans l'ordre de son bloc, pas ici
        if adresse.iter().any(|&t| self.j[t].texte.chars().any(|c| ('\u{0600}'..='\u{06FF}').contains(&c)))
            || libelle(&adresse)
            || !adresse
                .iter()
                .any(|&t| self.j[t].texte.chars().any(char::is_alphabetic))
            // une adresse porte un numéro (de rue, le code postal) : « Sahloul », seul, est la
            // fin d'une adresse coupée ; « I A S O U V E R A I N E », un slogan
            || !adresse
                .iter()
                .any(|&t| self.j[t].texte.chars().any(|c| c.is_ascii_digit()))
        {
            return None;
        }
        let fin = adresse
            .iter()
            .map(|&t| self.j[t].y1)
            .fold(f64::MIN, f64::max);
        match ligne_sous(fin) {
            Some(suite) if !libelle(&suite) => None,
            _ => Some(adresse),
        }
    }

    /// Le nom qui finit par la forme juridique `rang[k]` : les mots à sa gauche, une
    /// ponctuation sautée au plus, jusqu'à un blanc, une ponctuation ou une autre forme.
    fn nom_a_forme(
        &self,
        rang: &[usize],
        k: usize,
        formes: &BTreeSet<String>,
    ) -> Option<Vec<usize>> {
        if !formes.contains(&mot(&self.j[rang[k]].texte)) {
            return None;
        }
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
            if self.ponct(t)
                || formes.contains(&mot(&self.j[t].texte))
                || self.ecart(t, droite) > ECART_MOT * hn
            {
                break;
            }
            debut -= 1;
            droite = t;
        }
        if debut == g {
            return None;
        }
        let mut pris: Vec<usize> = rang[debut..g].to_vec();
        pris.push(rang[k]);
        Some(pris)
    }

    /// Le SEUL nom à forme juridique de la page qui n'est pas celui du dossier : quand le
    /// matricule du tiers est imprimé loin de son nom (en pied de page), la page qui ne
    /// nomme que deux sociétés — le dossier et une autre — nomme le tiers. Deux autres noms
    /// à forme juridique (un transporteur, une banque) : rien. Banc sans IA du 5 novembre
    /// 2026 : 263 raisons sociales d'émetteur muettes, sens déclaré.
    fn seul_autre_nom(&self, formes: &BTreeSet<String>, dossier: &str) -> Option<Vec<usize>> {
        let siens: BTreeSet<String> = dossier
            .split_whitespace()
            .map(mot)
            .filter(|m| !m.is_empty() && !formes.contains(m))
            .collect();
        let joint: String = dossier
            .split_whitespace()
            .map(mot)
            .filter(|m| !formes.contains(m))
            .collect();
        let mut vus: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for rang in &self.rangs {
            for k in 0..rang.len() {
                let Some(pris) = self.nom_a_forme(rang, k, formes) else {
                    continue;
                };
                let mots: Vec<String> = pris
                    .iter()
                    .map(|&t| mot(&self.j[t].texte))
                    .filter(|m| !m.is_empty() && !formes.contains(m))
                    .collect();
                // ni un identifiant (« 1612398F/A/M/00 SARL », 50/11), ni le nom du dossier,
                // même lu sans ses blancs (« ALGORITHMACONSULTING SARL »)
                if pris
                    .iter()
                    .any(|&t| self.j[t].texte.chars().any(|c| c.is_ascii_digit()))
                    || mots.is_empty()
                    || mots.iter().all(|m| siens.contains(m))
                    || joint.contains(&mots.concat())
                {
                    continue;
                }
                vus.entry(mots.join(" ")).or_insert(pris);
            }
        }
        (vus.len() == 1).then(|| vus.into_values().next()).flatten()
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
                .flat_map(|&c| {
                    grille.champs[c]
                        .reperes_fr
                        .iter()
                        .chain(grille.champs[c].reperes_ar.iter())
                })
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
        self.decide(camp, cle)
            && noms
                .iter()
                .any(|n| cle.contains(n.as_str()) && self.decide(camp, n))
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
    Valeur {
        valeur: v,
        refs: page.cite(jetons),
        statut: statut.into(),
    }
}

fn champ_de(v: &Valeur) -> ChampSortie {
    ChampSortie {
        valeur: Some(v.valeur.clone()),
        refs: v.refs.clone(),
        statut: v.statut.clone(),
        instances: None,
    }
}

/// L'anneau 2, sur la pièce entière. Les champs d'en-tête de `champs` sont remplacés
/// par ce qu'il établit ; aucun autre n'est touché.
pub fn prouver(
    op: &OpParties,
    entree: &Entree,
    champs: &mut BTreeMap<String, ChampSortie>,
) -> Resultat {
    let grille = &entree.grille;
    let page = Page::new(&entree.jetons, grille);
    let mut lus = Vec::new();

    dates(&page, grille, champs, &mut lus);
    if let Some(n) = op.numero {
        numero(&page, n, grille, champs, &mut lus);
    }

    let Some(connus) = entree.connus.as_ref() else {
        return Resultat {
            parties: None,
            statut: "non_evaluable",
            lus,
        };
    };
    let Some(dossier) = connus.dossier.as_ref() else {
        return Resultat {
            parties: None,
            statut: "non_evaluable",
            lus,
        };
    };
    let code_format = grille.champs[op.emetteur]
        .format_code
        .clone()
        .unwrap_or_default();
    let Some(motif) = entree.pack.formats.get(&code_format) else {
        return Resultat {
            parties: None,
            statut: "non_evaluable",
            lus,
        };
    };
    let Ok(re) = Regex::new(&format!("(?:{motif})")) else {
        return Resultat {
            parties: None,
            statut: "non_evaluable",
            lus,
        };
    };
    let formes: BTreeSet<String> = connus
        .formes_juridiques
        .iter()
        .map(|f| mot(f))
        .filter(|f| !f.is_empty())
        .collect();
    let camps = Camps::new(grille, op);
    let libelles = page.libelles(op, &camps);

    let reparations = entree
        .pack
        .controles
        .get(&code_format)
        .map(|c| Reparations::nouvelles(motif, c));
    let occs = page.matricules(&re, reparations.as_ref());
    let mut par_valeur: BTreeMap<String, Vec<&Occ>> = BTreeMap::new();
    for o in &occs {
        par_valeur.entry(o.valeur.clone()).or_default().push(o);
    }
    // Un matricule imprimé sans sa lettre de contrôle se compare par la lettre que la
    // règle du pack calcule (`ref.identifiant_controles`) ; la valeur rendue reste celle
    // qui est imprimée. Ses écritures avec et sans lettre sont un seul matricule, rendu
    // dans sa forme la plus pleine.
    let controle = entree.pack.controles.get(&code_format);
    let complete = |v: &str| controle.map_or_else(|| v.to_string(), |c| c.complete(v));
    // La même écriture sans sa lettre, quelle qu'elle soit : « 1856324G/A/M/000 » et
    // « 1856324/A/M/000 » ont le même noyau.
    let sans_lettre = |v: &str| -> String {
        let Some(c) = controle else {
            return v.to_string();
        };
        let n = c.poids.len();
        v.chars()
            .enumerate()
            .filter(|&(i, ch)| !(i == n && ch.is_alphabetic()))
            .map(|(_, ch)| ch)
            .collect()
    };
    let mut groupes: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for k in par_valeur.keys() {
        groupes.entry(complete(k)).or_default().push(k.clone());
    }
    for ks in groupes.values().filter(|ks| ks.len() > 1) {
        let rep = ks
            .iter()
            .max_by_key(|k| k.len())
            .expect("groupe non vide")
            .clone();
        for k in ks.iter().filter(|k| **k != rep) {
            let v = par_valeur.remove(k).expect("valeur lue");
            par_valeur.get_mut(&rep).expect("valeur lue").extend(v);
        }
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
    let ancre = |v: &str, camp: Camp| {
        par_valeur[v]
            .iter()
            .any(|o| camp_de(o).is_some_and(|(c, _)| c == camp))
    };
    let haut = |v: &str| {
        par_valeur[v]
            .iter()
            .map(|o| page.haut(&o.jetons))
            .min_by(|a, b| {
                a.0.cmp(&b.0)
                    .then(a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            })
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
        declare: false,
        raison: Some(raison.into()),
    };
    // Le matricule du dossier tel que la pièce l'imprime : sa fiche, ou l'écriture lue
    // qui lui est égale une fois sa lettre calculée.
    let fiche = norme_matricule(&dossier.matricule);
    let d = par_valeur
        .keys()
        .find(|k| complete(k) == complete(&fiche))
        .cloned()
        .unwrap_or(fiche);
    // Le sens déclaré par la personne, s'il y en a un.
    let declare_par: Option<Sens> = match connus.sens.as_deref() {
        Some("achat") => Some(Sens::Achat),
        Some("vente") => Some(Sens::Vente),
        _ => None,
    };

    // Deux matricules lus qui ne diffèrent que d'un chiffre sont une écriture lue deux fois,
    // dont l'une est fausse (dirigeant 50/31 : « 0745612B » en tête, « 0765612B » en pied) ;
    // un matricule lu à un chiffre de celui du dossier est le sien, mal lu : rien n'est
    // rendu — ni le sens, ni les parties.
    let mut valeurs: Vec<&str> = par_valeur.keys().map(String::as_str).collect();
    valeurs.push(d.as_str());
    valeurs.sort_unstable();
    valeurs.dedup();
    if valeurs.iter().enumerate().any(|(i, a)| {
        valeurs[i + 1..].iter().any(|b| {
            let (sa, sb) = (sans_lettre(a), sans_lettre(b));
            // à un chiffre près, ou le même noyau dont la lettre calculée diffère
            a_un_chiffre_pres(a, b)
                || a_un_chiffre_pres(&sa, &sb)
                || (sa == sb && complete(a) != complete(b))
        })
    }) {
        return Resultat {
            parties: Some(vide(
                "signale",
                "deux lectures d'un matricule se contredisent",
            )),
            statut: "indeterminee",
            lus,
        };
    }
    let d_lu = par_valeur.contains_key(&d);
    let autres: Vec<&str> = par_valeur
        .keys()
        .map(|k| k.as_str())
        .filter(|k| *k != d)
        .collect();
    // Sans déclaration, le sens se lit sur la pièce : il faut le matricule du dossier et
    // un autre. Un sens déclaré rend ce qui est lu, même partiel : le nom du dossier ne
    // dépend d'aucun matricule.
    if declare_par.is_none() {
        if par_valeur.is_empty() {
            return Resultat {
                parties: Some(vide("absent", "aucun matricule au format")),
                statut: "non_evaluable",
                lus,
            };
        }
        if !d_lu {
            return Resultat {
                parties: Some(vide("signale", "le matricule du dossier n'est pas lu")),
                statut: "indeterminee",
                lus,
            };
        }
        if autres.is_empty() {
            return Resultat {
                parties: Some(vide("signale", "seul le matricule du dossier est lu")),
                statut: "indeterminee",
                lus,
            };
        }
    }

    // Les indices, tous concordants ou rien.
    let mut votes: Vec<Sens> = Vec::new();
    let (cd, ed) = (
        d_lu && ancre(&d, Camp::Client),
        d_lu && ancre(&d, Camp::Emetteur),
    );
    if cd {
        votes.push(Sens::Achat);
    }
    if ed {
        votes.push(Sens::Vente);
    }
    let contrepartie: Option<&str> = if autres.len() == 1 && !d_lu {
        // le dossier n'est pas lu : le seul matricule lu est le tiers (sens déclaré)
        Some(autres[0])
    } else if autres.len() == 1 {
        let o = autres[0];
        if ancre(o, Camp::Emetteur) {
            votes.push(Sens::Achat);
        }
        if ancre(o, Camp::Client) {
            votes.push(Sens::Vente);
        }
        // La GRAPPE LÉGALE : autour d'un matricule, les étiquettes des champs que la grille
        // donne à UN rôle seul (registre de commerce, RIB, capital, téléphone de l'émetteur…).
        // La partie dont le bloc porte la grappe de l'émetteur, quand l'autre n'en porte
        // aucune, est l'émetteur — sans « Client : » ni « Fournisseur : » imprimés.
        let ((eo, co), (edo, cdo)) =
            page.grappes(&par_valeur[o], &par_valeur[d.as_str()], grille, op, &formes);
        if eo > 0 && co == 0 && edo == 0 {
            votes.push(Sens::Achat);
        }
        if edo > 0 && cdo == 0 && eo == 0 {
            votes.push(Sens::Vente);
        }
        // Les indices FORTS : un matricule ancré à son camp, ou la grappe légale d'un rôle.
        let forts = !votes.is_empty();
        // Les étiquettes du CLIENT (« Client », « Facturé à », « Livré à ») ne s'impriment
        // que dans le bloc du destinataire ; celles de l'émetteur (RC, téléphone) se lisent
        // aussi dans le bloc d'un client qui les imprime (algoria-001 : « RC : B0128… » à
        // côté du matricule du dossier, client, sous « Livré à : »). Le bloc qui porte une
        // étiquette du client, quand l'autre n'en porte aucune, est le client. Ce n'est
        // qu'un REPLI : une étiquette qui coiffe un bloc (« Doit : » au-dessus du dossier) le
        // dit déjà, et sa proximité au bloc voisin ne la lui rattache pas (dirigeant 50/02).
        if votes.is_empty() && cdo > 0 && co == 0 {
            votes.push(Sens::Achat);
        }
        if votes.is_empty() && co > 0 && cdo == 0 {
            votes.push(Sens::Vente);
        }
        // La géométrie corrobore, elle ne décide jamais seule : un émetteur peut imprimer
        // son matricule plus bas que le bloc du client (colonne latérale, pied de page).
        // Elle ne s'oppose donc qu'à un REPLI (l'étiquette du client), jamais à un indice
        // fort : algoria-001 imprime le matricule du dossier sous « Livré à », en tête, et
        // celui du fournisseur en pied ; la hauteur votait contre l'ancre, et tout le bloc
        // des parties (matricules, noms, adresses) se taisait.
        // Le matricule du dossier imprimé plus d'une fois (dans l'en-tête ET sous « Client »)
        // laisse la hauteur voter : c'est elle qui dit qu'il est aussi en tête.
        let dossier_une_fois = par_valeur.get(d.as_str()).is_some_and(|v| v.len() == 1);
        // Et la contrepartie doit porter sa lettre de contrôle : un « matricule » sans lettre
        // (« 0334991/T/S/000 », dirigeant 100/C-10, admis par un pack d'essai) peut être un
        // autre identifiant ; la hauteur garde alors sa voix.
        let o_a_sa_lettre = controle.is_some() && sans_lettre(o) != o;
        if !votes.is_empty() && !(forts && dossier_une_fois && o_a_sa_lettre) {
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
        // Un sens déclaré dit le camp du dossier, et donc celui de la contrepartie.
        let oppose = match (cd, ed, declare_par) {
            (true, false, _) => Some(Camp::Emetteur),
            (false, true, _) => Some(Camp::Client),
            (_, _, Some(Sens::Achat)) => Some(Camp::Emetteur),
            (_, _, Some(Sens::Vente)) => Some(Camp::Client),
            _ => None,
        };
        oppose.and_then(|camp| {
            let c: Vec<&str> = autres.iter().copied().filter(|o| ancre(o, camp)).collect();
            if c.len() == 1
                && !ancre(
                    c[0],
                    if camp == Camp::Client {
                        Camp::Emetteur
                    } else {
                        Camp::Client
                    },
                )
            {
                votes.push(if camp == Camp::Emetteur {
                    Sens::Achat
                } else {
                    Sens::Vente
                });
                Some(c[0])
            } else {
                None
            }
        })
    };
    let unanimes = votes
        .first()
        .copied()
        .filter(|&s| votes.iter().all(|v| *v == s));
    // Le sens déclaré par la personne décide, sauf contre des indices UNANIMES : une
    // déclaration que la pièce dément se signale, elle ne se recopie pas. Sans
    // déclaration, les indices tous concordants, ou rien.
    let (sens, declare) = match (declare_par, unanimes, votes.is_empty(), contrepartie) {
        (Some(d), Some(u), _, _) if d != u => {
            return Resultat {
                parties: Some(vide("signale", "le sens déclaré contredit la pièce")),
                statut: "echec",
                lus,
            };
        }
        (Some(d), _, _, _) => (d, true),
        (None, _, _, None) => {
            let raison = if votes.is_empty() {
                "aucun indice de sens"
            } else {
                "indices de sens contradictoires"
            };
            return Resultat {
                parties: Some(vide("signale", raison)),
                statut: "indeterminee",
                lus,
            };
        }
        (None, Some(u), _, Some(_)) => (u, false),
        (None, None, true, Some(_)) => {
            return Resultat {
                parties: Some(vide("signale", "aucun indice de sens")),
                statut: "indeterminee",
                lus,
            };
        }
        (None, None, false, Some(_)) => {
            return Resultat {
                parties: Some(vide("signale", "indices de sens contradictoires")),
                statut: "echec",
                lus,
            };
        }
    };
    let autre: Option<&str> = contrepartie;
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
                    pa.cmp(&pb)
                        .then(ya.partial_cmp(&yb).unwrap_or(std::cmp::Ordering::Equal))
                })
            })
            .expect("valeur lue")
    };
    let od = d_lu.then(|| occ_de(&d, camp_dossier));
    let oa = autre.map(|a| occ_de(a, camp_autre));
    // Le matricule du dossier est corroboré par sa fiche. Celui du tiers l'est par la
    // couche de texte exacte, deux occurrences qui concordent, un tiers connu du dossier,
    // ou chaque caractère lu avec assurance ; sinon il est rendu à VÉRIFIER (dirigeant
    // 50/02 : « 0567321M » lu « 0557321M », une seule fois, sans confiance).
    let connu = autre.is_some_and(|a| {
        connus
            .tiers
            .iter()
            .any(|t| norme_matricule(&t.matricule) == a)
    });
    let assure = |o: &Occ| {
        let seuil = entree.pack.confiance_du_caractere;
        o.jetons.iter().all(|&t| {
            let j = &page.j[t];
            !j.incertain(&entree.pack) && seuil.is_some_and(|s| j.faible.is_some_and(|f| f >= s))
        })
    };
    let mut cote_dossier = Cote {
        matricule: od.map(|o| valeur(&page, &o.jetons, d.clone(), "prouve")),
        nom: None,
    };
    let mut cote_autre = Cote {
        matricule: autre.zip(oa).map(|(a, o)| {
            let corrobore = entree.texte_exact || connu || par_valeur[a].len() >= 2 || assure(o);
            valeur(
                &page,
                &o.jetons,
                a.to_string(),
                if corrobore { "prouve" } else { "signale" },
            )
        }),
        nom: None,
    };

    if let Some(rs) = dossier.raison_sociale.as_deref() {
        cote_dossier.nom = page
            .nom_connu(rs, &formes)
            .map(|j| valeur(&page, &j, page.texte(&j), "prouve"));
    }
    let tiers = autre.and_then(|a| {
        connus
            .tiers
            .iter()
            .find(|t| norme_matricule(&t.matricule) == a)
    });
    if let Some(rs) = tiers.and_then(|t| t.raison_sociale.as_deref()) {
        cote_autre.nom = page
            .nom_connu(rs, &formes)
            .map(|j| valeur(&page, &j, page.texte(&j), "prouve"));
    }
    if let (None, Some(autre)) = (&cote_autre.nom, autre) {
        let occs_autre: Vec<&Occ> = {
            let mut v = par_valeur[autre].clone();
            v.sort_by(|a, b| {
                let (pa, ya, _) = page.haut(&a.jetons);
                let (pb, yb, _) = page.haut(&b.jetons);
                pa.cmp(&pb)
                    .then(ya.partial_cmp(&yb).unwrap_or(std::cmp::Ordering::Equal))
            });
            v
        };
        let libelle = par_valeur[autre].iter().find_map(|o| {
            camp_de(o)
                .filter(|(c, _)| *c == camp_autre)
                .and_then(|(_, l)| l)
        });
        cote_autre.nom = page
            .nom_inconnu(&occs_autre, libelle, &formes)
            .map(|j| valeur(&page, &j, page.texte(&j), "conforme"));
    }

    // Le nom de l'autre partie n'est JAMAIS celui du dossier : ni ses jetons, ni ses mots
    // (formes juridiques ôtées). Banc sans IA du 4 novembre 2026 : sur 17 achats, la
    // raison sociale d'ALGORIA sortait comme celle du fournisseur — la rangée à forme
    // juridique la plus proche du matricule du fournisseur était celle du client.
    // Un nom qui ne départage pas les parties ne se rend pas.
    let rejete = |n: &Valeur| -> bool {
        let sien = cote_dossier
            .nom
            .as_ref()
            .is_some_and(|d| d.refs.iter().any(|r| n.refs.contains(r)));
        let mots_de = |t: &str| -> Vec<String> {
            t.split_whitespace()
                .map(mot)
                .filter(|m| !m.is_empty() && !formes.contains(m))
                .collect()
        };
        // Ni un texte qui CONTIENT le nom du dossier, collé à son libellé par l'OCR :
        // « Client :/JI:ALGORIA FACTORY SARL » (OCR PP-OCRv6 du 8 novembre 2026,
        // algoria-066, 069, 071) n'est pas le fournisseur ; son adresse était celle du client.
        let meme = dossier.raison_sociale.as_deref().is_some_and(|rs| {
            let (a, b) = (mots_de(rs), mots_de(&n.valeur));
            let colle: String = b.concat();
            !a.is_empty()
                && (a == b
                    || a.iter()
                        .all(|m| m.chars().count() >= 3 && colle.contains(m.as_str())))
        });
        // Ni un identifiant : un nom qui cite les jetons d'un matricule lu n'est pas un nom.
        let identifiant = occs.iter().any(|o| {
            o.jetons.iter().any(|&t| {
                n.refs
                    .iter()
                    .any(|r| r.page == page.j[t].page && r.ordinal == page.j[t].ordinal)
            })
        });
        // Ni une étiquette : un « nom » fait du seul repère d'un champ de la grille (« M. »,
        // la civilité qui ANNONCE le client) n'est pas un nom (algoria-115, manuscrit).
        let etiquette = page
            .reperes
            .iter()
            .any(|(r, _)| !r.is_empty() && *r == cle(&normaliser(&n.valeur)));
        sien || meme || identifiant || etiquette
    };
    if cote_autre.nom.as_ref().is_some_and(&rejete) {
        cote_autre.nom = None;
    }
    // La tête du bloc de l'autre partie, prouvée par sa structure : la règle de la forme
    // juridique a pu prendre le nom du dossier, imprimé près du matricule du tiers, et il
    // vient d'être écarté (algoria-036 : « Client : ALGORIA FACTORY SARL » à droite de
    // l'en-tête de « Centre Felmane de Formation »).
    if let (None, Some(autre)) = (&cote_autre.nom, autre) {
        let mut occs_autre: Vec<&Occ> = par_valeur[autre].clone();
        occs_autre.sort_by(|a, b| {
            let (pa, ya, _) = page.haut(&a.jetons);
            let (pb, yb, _) = page.haut(&b.jetons);
            pa.cmp(&pb)
                .then(ya.partial_cmp(&yb).unwrap_or(std::cmp::Ordering::Equal))
        });
        // Affirmé comme le matricule d'un tiers : par la couche de texte exacte, ou chaque
        // caractère lu avec assurance ; sinon une piste, SIGNALÉE (dirigeant 50/08 : « Mme
        // Leïla BEN SALEM » relu « Leila », sans confiance mesurée).
        let seuil = entree.pack.confiance_du_caractere;
        let assure = |jetons: &[usize]| {
            entree.texte_exact
                || jetons.iter().all(|&t| {
                    let j = &page.j[t];
                    !j.incertain(&entree.pack)
                        && seuil.is_some_and(|s| j.faible.is_some_and(|f| f >= s))
                })
        };
        cote_autre.nom = page
            .tete_de_bloc(&occs_autre)
            .map(|j| {
                let statut = if assure(&j) { "conforme" } else { "signale" };
                valeur(&page, &j, page.texte(&j), statut)
            })
            .filter(|v| !rejete(v));
    }
    // Le matricule du tiers imprimé loin de son nom, ou près du nom du dossier : le seul
    // autre nom à forme juridique de la page (`Page::seul_autre_nom`).
    if cote_autre.nom.is_none() && autre.is_some() {
        cote_autre.nom = page
            .seul_autre_nom(
                &formes,
                dossier.raison_sociale.as_deref().unwrap_or_default(),
            )
            .map(|j| valeur(&page, &j, page.texte(&j), "conforme"));
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
    // Les groupes du matricule de l'émetteur (« 2815004Q/A/M/000 » → « A/M/000 ») : le
    // noyau (la longueur de la règle de la lettre), la lettre s'il y en a une, un séparateur.
    if let (Some(c), Some(m), Some(ctl)) =
        (op.groupes_emetteur, emetteur.matricule.as_ref(), controle)
    {
        let mut reste = m.valeur.chars().skip(ctl.poids.len()).peekable();
        reste.next_if(|c| c.is_alphabetic());
        if reste.next().is_some_and(|c| !c.is_alphanumeric()) {
            let groupes: String = reste.collect();
            if !groupes.is_empty() {
                champs.insert(
                    grille.champs[c].code.clone(),
                    ChampSortie {
                        valeur: Some(groupes.clone()),
                        refs: m.refs.clone(),
                        statut: m.statut.clone(),
                        instances: None,
                    },
                );
                lus.push((c, groupes));
            }
        }
    }
    // Les adresses, sous les noms placés.
    for (c, nom) in [
        (op.adresse_emetteur, &emetteur.nom),
        (op.adresse_client, &client.nom),
    ] {
        let (Some(c), Some(nom)) = (c, nom) else {
            continue;
        };
        let jetons: Vec<usize> = nom
            .refs
            .iter()
            .filter_map(|r| {
                page.j
                    .iter()
                    .position(|j| j.page == r.page && j.ordinal == r.ordinal)
            })
            .collect();
        if let Some(a) = page.adresse_sous(&jetons) {
            let v = valeur(&page, &a, page.texte(&a), "conforme");
            champs.insert(grille.champs[c].code.clone(), champ_de(&v));
            lus.push((c, v.valeur.clone()));
        }
    }
    // Le contact de l'émetteur, dans son bloc : affirmé par la couche de texte exacte ou
    // chaque caractère lu avec assurance, sinon une piste.
    if let (Some(c), Some(m)) = (op.contact_emetteur, emetteur.matricule.as_ref()) {
        let jetons: Vec<usize> = m
            .refs
            .iter()
            .filter_map(|r| {
                page.j
                    .iter()
                    .position(|j| j.page == r.page && j.ordinal == r.ordinal)
            })
            .collect();
        // les frontières du bloc : les libellés des parties, et les matricules des autres
        let frontieres: BTreeSet<usize> = libelles
            .iter()
            .flat_map(|l| l.jetons.iter().copied())
            .chain(
                occs.iter()
                    .filter(|o| o.valeur != m.valeur)
                    .flat_map(|o| o.jetons.iter().copied()),
            )
            .collect();
        if let Some(a) = page.contact_du_bloc(&jetons, c, &frontieres) {
            let seuil = entree.pack.confiance_du_caractere;
            let assure = entree.texte_exact
                || a.iter().all(|&t| {
                    let j = &page.j[t];
                    !j.incertain(&entree.pack)
                        && seuil.is_some_and(|s| j.faible.is_some_and(|f| f >= s))
                });
            let v = valeur(
                &page,
                &a,
                page.texte(&a),
                if assure { "conforme" } else { "signale" },
            );
            champs.insert(grille.champs[c].code.clone(), champ_de(&v));
            lus.push((c, v.valeur.clone()));
        }
    }
    let parties = PartiesSortie {
        sens: Some(
            match sens {
                Sens::Achat => "achat",
                Sens::Vente => "vente",
            }
            .into(),
        ),
        statut: "prouve".into(),
        emetteur,
        client,
        tiers: tiers.map(|t| TiersSortie {
            code: t.code.clone(),
            statut: "prouve".into(),
        }),
        declare,
        raison: None,
    };
    Resultat {
        parties: Some(parties),
        statut: "verifiee",
        lus,
    }
}

/// Les dates de chaque preuve `ordre` : candidates ancrées par leurs repères ; une
/// seule valeur ancrée → `conforme`. L'échéance ≥ émission départage plusieurs
/// candidates, et, quand la pièce ne porte que deux dates dont l'échéance ancrée,
/// désigne l'autre comme émission si elle la précède.
fn dates(
    page: &Page,
    grille: &Grille,
    champs: &mut BTreeMap<String, ChampSortie>,
    lus: &mut Vec<(usize, String)>,
) {
    let index = |nom: &str| {
        grille
            .champs
            .iter()
            .position(|c| c.code == nom.trim_end_matches('?'))
    };
    let paires: Vec<(usize, usize)> = grille
        .preuves
        .iter()
        .filter(|p| p.statut.as_deref() != Some("a_traduire"))
        .filter_map(|p| p.expression.as_ref())
        .filter(|e| e.get("op").and_then(|o| o.as_str()) == Some("ordre"))
        .filter_map(|e| {
            Some((
                index(e.get("avant")?.as_str()?)?,
                index(e.get("apres")?.as_str()?)?,
            ))
        })
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
            let prefixe: String = j
                .texte
                .chars()
                .take_while(|c| !c.is_ascii_digit())
                .collect();
            let champs = page
                .etiquette(i, &normaliser(&prefixe))
                .map(|e| e.champs)
                .unwrap_or_default();
            Some((i, d, champs))
        })
        .collect();
    let toutes: BTreeSet<&str> = lues.iter().map(|(_, d, _)| *d).collect();
    for (a, b) in paires {
        let ancrees = |c: usize| -> BTreeSet<&str> {
            lues.iter()
                .filter(|(_, _, ch)| ch.contains(&c))
                .map(|(_, d, _)| *d)
                .collect()
        };
        let (ma, eb) = (ancrees(a), ancrees(b));
        let unique = |s: BTreeSet<&str>| -> Option<String> {
            (s.len() == 1).then(|| s.into_iter().next().unwrap_or_default().to_string())
        };
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
                let autre = toutes
                    .iter()
                    .copied()
                    .find(|d| *d != e.as_str())
                    .unwrap_or_default();
                let libres = lues
                    .iter()
                    .filter(|(_, d, _)| *d == autre)
                    .all(|(_, _, ch)| {
                        !ch.contains(&b) && ch.iter().all(|c| grille.champs[*c].genre == "date")
                    });
                if libres && autre <= e.as_str() {
                    va = Some(autre.to_string());
                }
            }
        }
        let (pa, pb) = (va.clone(), vb.clone());
        for (c, v, candidates) in [(a, va, ma), (b, vb, eb)] {
            // Rien vu ici, quand l'ancrage textuel (`textuel`) a lu la date sous son libellé :
            // cet expert ne la défait pas (banc sans IA du 4 novembre 2026, s087 : « التاريخ |
            // :11-09-2026 », lue conforme, effacée en « absent ») — sauf si c'est la date que
            // la paire donne à l'AUTRE champ.
            let code = &grille.champs[c].code;
            let autre = if c == a { &pb } else { &pa };
            if v.is_none() && candidates.is_empty() {
                if let Some(deja) = champs
                    .get(code)
                    .filter(|x| x.statut == "conforme" && x.valeur.is_some() && x.valeur != *autre)
                {
                    if let Some(d) = &deja.valeur {
                        lus.push((c, d.clone()));
                    }
                    continue;
                }
            }
            let sortie = match v {
                Some(v) => {
                    let i = lues
                        .iter()
                        .find(|(_, d, ch)| *d == v && ch.contains(&c))
                        .or_else(|| lues.iter().find(|(_, d, _)| *d == v))
                        .map(|(i, _, _)| *i)
                        .unwrap_or_default();
                    lus.push((c, v.clone()));
                    let plage: Vec<usize> = (i..=jusqua(page.j, i, page.j[i].date_fin)).collect();
                    ChampSortie {
                        valeur: Some(v),
                        refs: page.cite(&plage),
                        statut: "conforme".into(),
                        instances: None,
                    }
                }
                None => ChampSortie {
                    valeur: None,
                    refs: Vec::new(),
                    statut: if candidates.is_empty() {
                        "absent"
                    } else {
                        "signale"
                    }
                    .into(),
                    instances: None,
                },
            };
            champs.insert(code.clone(), sortie);
        }
    }
}

/// Le numéro : le jeton juste après son repère (à droite, ou dessous), qui porte au
/// moins un chiffre, avec les morceaux qui lui sont collés. Une seule valeur → `conforme`.
fn numero(
    page: &Page,
    n: usize,
    grille: &Grille,
    champs: &mut BTreeMap<String, ChampSortie>,
    lus: &mut Vec<(usize, String)>,
) {
    let sortie = apres_repere(
        page,
        n,
        &Lecture {
            chiffre: true,
            colle_au_libelle: false,
            exclusif: false,
            motif: None,
            phrase: false,
            partie: false,
        },
    );
    if let Some(v) = &sortie.valeur {
        lus.push((n, v.clone()));
    }
    champs.insert(grille.champs[n].code.clone(), sortie);
}

/// Comment l'anneau 3 lit la valeur d'un champ après son repère.
struct Lecture<'r> {
    /// La valeur porte au moins un chiffre, et ne prend que les morceaux qui lui sont
    /// collés (un numéro) ; sinon elle prend les mots qui la suivent (un libellé).
    chiffre: bool,
    /// Le libellé peut être collé à la valeur dans le même jeton (« N°IE-2026-0701 »).
    colle_au_libelle: bool,
    /// Un libellé que plusieurs champs portent ne désigne aucun d'eux : le champ est signalé.
    exclusif: bool,
    /// Le format du pack que la valeur doit respecter, quand le champ en nomme un.
    motif: Option<&'r Regex>,
    /// La valeur est un texte libre (`texte`) : elle ne suit son libellé, sur la même
    /// rangée, que derrière un séparateur ou un blanc ; collée, c'est la suite de la même
    /// phrase (« Article 11 — Droit applicable et litiges » : « et litiges » n'est pas le
    /// droit applicable).
    phrase: bool,
    /// Le champ est celui d'UNE partie (il a un rôle : le registre de commerce de
    /// l'émetteur) : un libellé imprimé deux fois devant deux valeurs ne dit pas de qui.
    partie: bool,
}

/// Au plus tant de mots dans la valeur d'un libellé : une ligne, pas un paragraphe.
const MOTS_MAX: usize = 12;

/// La valeur qui suit un libellé du champ `n` : sur sa rangée (ou collée au libellé dans
/// le même jeton), sinon juste dessous. Une seule valeur → `conforme` ; deux → `signale`.
fn apres_repere(page: &Page, n: usize, l: &Lecture) -> ChampSortie {
    // Chaque valeur lue, ses jetons, et si un libellé détaché (à gauche ou au-dessus) l'a
    // nommée au moins une fois.
    let mut lus_n: BTreeMap<String, (Vec<usize>, bool, bool)> = BTreeMap::new();
    let mut partage = false;
    let libelle_court_colle = regex::Regex::new(r"^\p{L}{1,3}[°º]\s*\d").expect("motif");
    for (i, j) in page.j.iter().enumerate() {
        if l.chiffre && !j.texte.chars().any(|c| c.is_ascii_digit()) {
            continue;
        }
        let colle = l.colle_au_libelle.then(|| page.libelle_colle(i)).flatten();
        // Un libellé collé ne commence pas au milieu d'une phrase : « Contrat Entreprise
        // n°ENT-55821 » n'est pas « N° » (OCR de 50/07).
        let (r0, k0) = page.ou[i];
        let colle = colle.filter(|_| {
            k0 == 0 || {
                let p = page.rangs[r0][k0 - 1];
                page.ponct(p)
                    || page.j[p].texte.chars().any(|c| c.is_ascii_digit())
                    || page.ecart(p, i) > ECART_MOT * page.h(p)
            }
        });
        let (et, debut) = match colle {
            Some((et, octet)) => (Some(et), octet),
            None => (page.etiquette(i, ""), 0),
        };
        let Some(et) = et else { continue };
        if !et.champs.contains(&n) {
            continue;
        }
        if l.exclusif && et.champs.len() > 1 {
            partage = true;
            continue;
        }
        let (r, k) = page.ou[i];
        let rang = &page.rangs[r];
        let colle = |a: usize, b: usize| page.ecart(a, b) <= COLLE * page.h(a);
        if debut == 0 {
            // déjà pris comme morceau collé d'une valeur à sa gauche
            if k > 0 && colle(rang[k - 1], i) && !page.ponct(rang[k - 1]) {
                continue;
            }
            // la suite de la phrase du libellé, pas sa valeur
            if l.phrase
                && k > 0
                && !page.ponct(rang[k - 1])
                && page.ecart(rang[k - 1], i) <= ECART_MOT * page.h(i)
                && page.dessus(i).is_none_or(|d| d.champs != et.champs)
            {
                continue;
            }
            // un libellé n'est pas une valeur
            if !l.chiffre && (page.ponct(i) || page.champs_de(&page.normes[i]).is_some()) {
                continue;
            }
        }
        let mut pris = vec![i];
        let mut q = k + 1;
        let max = if l.chiffre { SPAN_MAX } else { MOTS_MAX };
        // Un texte n'est rendu qu'ENTIER : arrêté par la fin de sa rangée, par un blanc ou
        // par un autre libellé — pas par la borne de mots —, et sans suite à la ligne
        // d'après. Banc sans IA du 4 novembre 2026 : « réclamation », un mot d'un paragraphe
        // de conditions générales, était rendu comme les conditions entières.
        let mut entier = true;
        while q < rang.len() {
            if pris.len() == max {
                entier = false;
                break;
            }
            let (a, b) = (rang[q - 1], rang[q]);
            let suit = if l.chiffre {
                colle(a, b)
            } else {
                page.ecart(a, b) <= ECART_MOT * page.h(a)
            };
            let libelle = !l.chiffre && page.champs_de(&page.normes[b]).is_some();
            // un autre libellé commence : la valeur s'arrête
            if !suit || libelle {
                // Arrêtée sur un mot qui la touche — un identifiant à blancs (« 239 TU
                // 4170 »), un libellé sans séparateur au milieu d'une phrase (« Cadre —
                // échelon 4 ») : la valeur est peut-être coupée, elle n'est pas entière.
                let touche = page.ecart(a, b) <= ECART_MOT * page.h(a) && !page.ponct(b);
                let separe = q + 1 < rang.len() && page.ponct(rang[q + 1]);
                // un identifiant se poursuit par un code (chiffres, capitales), pas par un mot
                let code = {
                    let t = page.j[b].texte.trim();
                    t.chars().any(|c| c.is_ascii_digit())
                        || (t.chars().all(|c| c.is_alphabetic())
                            && t.chars().all(|c| c.is_uppercase()))
                };
                if touche && if l.chiffre { code } else { libelle && !separe } {
                    entier = false;
                }
                break;
            }
            pris.push(b);
            q += 1;
        }
        if !l.chiffre && q == rang.len() && page.se_poursuit(r) {
            entier = false;
        }
        // Nommée par un libellé détaché, une valeur dont le jeton s'ouvre sur un court
        // libellé collé (« n°354642/6 » sous « Quittance », OCR PP-OCRv6 du 8 novembre 2026,
        // algoria-148) porte autre chose que la valeur : elle n'est pas rendue entière.
        if debut == 0 && libelle_court_colle.is_match(page.j[i].texte.trim()) {
            entier = false;
        }
        let premier = page.j[i].texte.trim();
        let premier = if debut > 0 {
            premier
                .get(debut.min(premier.len())..)
                .unwrap_or_default()
                .trim_start_matches(|c: char| ":;,-–—·|".contains(c) || c.is_whitespace())
        } else {
            premier
        };
        let suite = pris[1..].iter().map(|&t| page.j[t].texte.trim());
        let v: String = if l.chiffre {
            std::iter::once(premier).chain(suite).collect()
        } else {
            std::iter::once(premier)
                .chain(suite)
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        };
        if v.is_empty() || (l.chiffre && !v.chars().any(|c| c.is_ascii_digit())) {
            continue;
        }
        if l.motif.is_some_and(|re| !re.is_match(&v)) {
            continue;
        }
        let e = lus_n.entry(v).or_insert((pris, false, true));
        e.1 |= debut == 0;
        e.2 &= entier;
    }
    let rien = |statut: &str| ChampSortie {
        valeur: None,
        refs: Vec::new(),
        statut: statut.into(),
        instances: None,
    };
    match lus_n.len() {
        0 if partage => rien("signale"),
        0 => rien("absent"),
        1 if !partage => {
            let (v, (pris, detache, entier)) = lus_n.into_iter().next().unwrap_or_default();
            // Le champ d'une partie, quand son libellé précède ailleurs une AUTRE valeur à
            // chiffres, que la lecture n'a pas retenue (le libellé y entame une phrase) : la
            // page porte deux valeurs du même libellé, et rien ne dit laquelle est celle de
            // la partie. Banc sans IA du 4 novembre 2026, algoria-034 : « RC: » du client,
            // près du matricule du dossier, rendu comme le registre de l'émetteur, dont le
            // « RC: » imprimé en pied de page suivait « Garantie selon les ».
            if l.partie && page.autre_valeur_du_libelle(n, &pris, &v) {
                return rien("signale");
            }
            // Lue seulement derrière un libellé collé dans son jeton : l'OCR a pu coller autre
            // chose à la valeur (« N°DV-PX-2026-091111 », 50/48). Elle se dit, citée, et se
            // vérifie : signalée, jamais conforme. Un texte coupé aussi.
            // Collée à son libellé, une valeur à chiffres qui a la FORME d'une référence —
            // des groupes de capitales et de chiffres séparés par « - », « / » ou « . », rien
            // d'autre — n'a rien reçu de l'OCR (« N°293/2026 ») : elle est conforme. Ce qui y
            // est collé de plus (« MFS-FAC-2026-06129juin2026 », « Jc:H/2026/045 ») la garde
            // signalée. Banc sans IA du 5 novembre 2026 : 109 numéros justes signalés.
            // Le libellé collé se ferme par un signe (« N° », « Réf: ») : collé par un
            // séparateur de référence (« BAIL-VZ-2026-013 »), il est peut-être la tête de la
            // valeur (algoria-133).
            let ferme = pris.first().is_some_and(|&t| {
                let texte = page.j[t].texte.trim();
                let fin = texte.len().saturating_sub(v.len());
                texte
                    .get(..fin)
                    .and_then(|l| l.trim_end().chars().next_back())
                    .is_some_and(|c| !c.is_alphanumeric() && !"-/.".contains(c))
            });
            let reference = l.chiffre
                && ferme
                && regex::Regex::new(r"^[A-Z0-9]+(?:[-/.][A-Z0-9]+)*$")
                    .is_ok_and(|re| re.is_match(&v));
            let statut = if entier && (detache || reference) {
                "conforme"
            } else {
                "signale"
            };
            ChampSortie {
                valeur: Some(v),
                refs: page.cite(&pris),
                statut: statut.into(),
                instances: None,
            }
        }
        _ => rien("signale"),
    }
}

/// Les suites de mots qui égalent EXACTEMENT un repère du champ `n` : une suite commence et
/// finit là où les mots cessent d'être adjacents (ou à un nombre). `partage` : un repère que
/// d'autres champs portent aussi.
fn repere_imprime(page: &Page, n: usize) -> (Vec<Vec<usize>>, bool) {
    let mut out = Vec::new();
    let mut partage = false;
    for rang in &page.rangs {
        let mot = |k: usize| {
            !page.ponct(rang[k]) && !page.j[rang[k]].texte.chars().any(|c| c.is_ascii_digit())
        };
        let lie = |a: usize, b: usize| page.ecart(rang[a], rang[b]) <= ECART_MOT * page.h(rang[a]);
        for s in 0..rang.len() {
            if !mot(s) {
                continue;
            }
            if s > 0 && mot(s - 1) && lie(s - 1, s) {
                // Au milieu d'une phrase, un jeton qui égale à lui seul un repère compte aussi
                // (« Montant (USD) ») : sinon une devise imprimée entre parenthèses se perd.
                if let Some(et) = page
                    .champs_de(&page.normes[rang[s]])
                    .filter(|et| et.champs.contains(&n))
                {
                    if et.champs.len() > 1 {
                        partage = true;
                    } else {
                        out.push(vec![rang[s]]);
                    }
                }
                continue;
            }
            let mut texte = String::new();
            let mut e = s;
            while e < rang.len() && mot(e) && (e == s || lie(e - 1, e)) {
                texte.push_str(&page.normes[rang[e]]);
                e += 1;
                if cle(&texte).len() > page.repere_max {
                    break;
                }
                let fin = e == rang.len() || !mot(e) || !lie(e - 1, e);
                if let (true, Some(et)) = (fin, page.champs_de(&texte)) {
                    if et.champs.contains(&n) {
                        if et.champs.len() > 1 {
                            partage = true;
                        } else {
                            out.push(rang[s..e].to_vec());
                        }
                    }
                }
            }
        }
    }
    (out, partage)
}

/// Un champ « liste » qui a un domaine : il ne rend qu'un CODE du domaine, lu sous l'une de
/// ses formes imprimables (le libellé du code dans une des trois langues, une marque :
/// « DT », « Espèces », « نقدًا »), jamais le texte d'une étiquette. Les formes ancrées par
/// un libellé du champ l'emportent ; un seul code → `conforme`, deux → `signale`.
///
/// Banc sans IA du 4 novembre 2026 : « règlement: » rendu pour le mode de règlement, « (DT) »
/// pour la devise.
fn liste_du_domaine(page: &Page, n: usize, ch: &crate::entree::Champ) -> ChampSortie {
    const MOTS_D_UNE_FORME: usize = 4;
    let formes: Vec<(&str, String)> = ch
        .valeurs
        .iter()
        .flat_map(|v| {
            v.formes
                .iter()
                .map(move |f| (v.code.as_str(), f.as_str(), mot(f)))
        })
        // Une forme qui perd son SYMBOLE (« US$ » → « US ») et devient un fragment de deux
        // lettres n'est plus elle-même : deux jetons « U | S » d'une adresse la lisaient, et
        // la devise de 22 pièces en dinars se taisait (banc sans IA du 4 novembre 2026).
        .filter(|(_, brute, f)| {
            !f.is_empty()
                && (f.chars().count() >= 3
                    || brute
                        .chars()
                        .all(|c| c.is_alphanumeric() || c == '.' || c.is_whitespace()))
        })
        .map(|(code, _, f)| (code, f))
        .collect();
    // (code, jetons, ancré)
    let mut vus: Vec<(&str, Vec<usize>, bool)> = Vec::new();
    for rang in &page.rangs {
        let mut s = 0;
        while s < rang.len() {
            let mut texte = String::new();
            let mut meilleur: Option<(&str, usize)> = None;
            for e in s..rang.len().min(s + MOTS_D_UNE_FORME) {
                if e > s && page.ecart(rang[e - 1], rang[e]) > ECART_MOT * page.h(rang[e - 1]) {
                    break;
                }
                texte.push_str(&mot(&page.j[rang[e]].texte));
                if let Some((code, _)) = formes.iter().find(|(_, f)| *f == texte) {
                    meilleur = Some((code, e));
                }
            }
            // Une forme prise dans l'étiquette d'un AUTRE champ n'est pas une valeur : « Reçu
            // le » (le visa du client) ne dit pas que la pièce est un reçu.
            let dans_une_etiquette = |s: usize, e: usize| {
                let autour = [
                    (s.saturating_sub(2), e),
                    (s.saturating_sub(1), e),
                    (s, (e + 1).min(rang.len() - 1)),
                    (s, (e + 2).min(rang.len() - 1)),
                ];
                autour.iter().any(|&(a, b)| {
                    (a, b) != (s, e)
                        && page
                            .libelle_de(&rang[a..=b])
                            .is_some_and(|et| !et.champs.contains(&n))
                })
            };
            // … sauf si la forme est elle-même un repère du champ (« FACTURE » dans « FACTURE N° »).
            let repere_du_champ = |s: usize, e: usize| {
                page.libelle_de(&rang[s..=e])
                    .is_some_and(|et| et.champs.contains(&n))
            };
            let meilleur =
                meilleur.filter(|&(_, e)| repere_du_champ(s, e) || !dans_une_etiquette(s, e));
            match meilleur {
                Some((code, e)) => {
                    let jetons = rang[s..=e].to_vec();
                    let ancre = page
                        .etiquette(jetons[0], "")
                        .is_some_and(|et| et.champs.contains(&n))
                        || page
                            .etiquette(jetons[jetons.len() - 1], "")
                            .is_some_and(|et| et.champs.contains(&n));
                    vus.push((code, jetons, ancre));
                    s = e + 1;
                }
                None => s += 1,
            }
        }
        // Une barre sépare deux valeurs dans un même jeton (« Livraison/Facture ») : chacune
        // de ses parties se lit aussi comme une forme.
        for &t in rang.iter() {
            let texte = &page.j[t].texte;
            if !texte.contains('/') || vus.iter().any(|v| v.1.contains(&t)) {
                continue;
            }
            for partie in texte.split('/') {
                if let Some((code, _)) = formes.iter().find(|(_, f)| *f == mot(partie)) {
                    vus.push((code, vec![t], false));
                }
            }
        }
    }
    let ancres: Vec<&(&str, Vec<usize>, bool)> = vus.iter().filter(|v| v.2).collect();
    let retenus: Vec<&(&str, Vec<usize>, bool)> = if ancres.is_empty() {
        vus.iter().collect()
    } else {
        ancres
    };
    let mut codes: Vec<&str> = retenus.iter().map(|v| v.0).collect();
    codes.sort();
    codes.dedup();
    match codes.as_slice() {
        [] => ChampSortie {
            valeur: None,
            refs: Vec::new(),
            statut: "absent".into(),
            instances: None,
        },
        [code] => {
            let v = retenus[0];
            ChampSortie {
                valeur: Some((*code).to_string()),
                refs: page.cite(&v.1),
                statut: "conforme".into(),
                instances: None,
            }
        }
        _ => ChampSortie {
            valeur: None,
            refs: Vec::new(),
            statut: "signale".into(),
            instances: None,
        },
    }
}

/// Les familles d'experts que l'anneau 3 lit (`ref.experts`) : celles dont la valeur suit
/// son repère. Le montant est au centre, la date et les parties à l'anneau 2.
const FAMILLES_NOMMEES: [&str; 6] = [
    "reference",
    "identifiant",
    "libelle",
    "nombre",
    "taux",
    "presence",
];

/// L'anneau 3 : les champs que nulle preuve ne lit, chacun par l'expert de sa famille,
/// piloté par ses seuls repères (et son format, s'il en nomme un). Il ne remplace rien : un
/// champ déjà lu (prouvé, conforme ou signalé) reste tel quel. Au mieux `conforme` — aucune
/// arithmétique ne le prouve — ; `signale` quand deux valeurs se disputent le champ.
///
/// Ne lit pas : les cellules d'un tableau (la parcelle des champs de la preuve `lignes`),
/// le champ d'une preuve `lettres` (l'adaptateur les lit), un identifiant dont le format est
/// au pack (le centre le lit). Une présence (signature, cachet) ne se constate pas dans un
/// texte : son repère imprimé la SIGNALE, à vérifier sur la pièce.
pub fn nommes(entree: &Entree, champs: &mut BTreeMap<String, ChampSortie>) {
    let grille = &entree.grille;
    let index = |nom: &str| {
        grille
            .champs
            .iter()
            .position(|c| c.code == nom.trim_end_matches('?').trim())
    };
    let mut cellules: BTreeSet<&str> = BTreeSet::new();
    let mut lettres: BTreeSet<usize> = BTreeSet::new();
    for p in grille
        .preuves
        .iter()
        .filter(|p| p.statut.as_deref() != Some("a_traduire"))
    {
        let Some(e) = p.expression.as_ref().and_then(|e| e.as_object()) else {
            continue;
        };
        match e.get("op").and_then(|o| o.as_str()) {
            Some(crate::lignes::OP) => {
                // Les cellules d'une ligne d'article (pas les totaux qui ferment le tableau).
                let Ok(op) = crate::lignes::lire_op(grille, &Value::Object(e.clone())) else {
                    continue;
                };
                for c in op.champs_lignes.iter().filter_map(|n| index(n)) {
                    if let Some(parcelle) = grille.champs[c].parcelle.as_deref() {
                        cellules.insert(parcelle);
                    }
                }
            }
            Some(crate::lettres::OP) => {
                if let Some(c) = e.get("champ").and_then(|v| v.as_str()).and_then(index) {
                    lettres.insert(c);
                }
            }
            _ => {}
        }
    }
    let page = Page::new(&entree.jetons, grille);
    for (n, ch) in grille.champs.iter().enumerate() {
        if champs.get(&ch.code).is_some_and(|c| c.statut != "absent")
            || !ch.expert.as_deref().is_some_and(|f| FAMILLES_NOMMEES.contains(&f))
            || ch.parcelle.as_deref().is_some_and(|p| cellules.contains(p))
            // une cellule d'une parcelle répétée n'est pas un champ de la pièce
            || ch.repetee
            || lettres.contains(&n)
            || (ch.reperes_fr.is_empty() && ch.reperes_ar.is_empty())
        {
            continue;
        }
        let motif = ch
            .format_code
            .as_ref()
            .and_then(|f| entree.pack.formats.get(f));
        if ch.expert.as_deref() == Some("identifiant") && motif.is_some() {
            continue;
        }
        let Ok(motif) = motif.map(|m| Regex::new(&format!("^(?:{m})$"))).transpose() else {
            continue;
        };
        let sortie = match ch.genre.as_str() {
            // Le champ qui attend une MARQUE (un cachet) la lit, vue sans modèle, quand il est
            // le seul de la grille à l'attendre : un cachet ne dit pas de qui il est quand deux
            // champs l'attendent. La marque n'est pas un jeton : rien n'est cité.
            "booleen"
                if ch.marque.as_ref().is_some_and(|m| {
                    entree.marques.iter().any(|x| &x.genre == m)
                        && grille
                            .champs
                            .iter()
                            .filter(|c| c.marque.as_ref() == Some(m))
                            .count()
                            == 1
                }) =>
            {
                ChampSortie {
                    valeur: Some("true".into()),
                    refs: Vec::new(),
                    statut: "conforme".into(),
                    instances: None,
                }
            }
            "booleen" => {
                let (vus, partage) = repere_imprime(&page, n);
                let statut = if vus.is_empty() && !partage {
                    "absent"
                } else {
                    "signale"
                };
                ChampSortie {
                    valeur: None,
                    refs: Vec::new(),
                    statut: statut.into(),
                    instances: None,
                }
            }
            "liste" if !ch.valeurs.is_empty() => liste_du_domaine(&page, n, ch),
            // Une liste sans domaine ne se lit pas : ses repères mêlent étiquettes (« Statut »,
            // « Régime », « Motif ») et valeurs, et rien ne dit lesquels sont des valeurs. Banc
            // sans IA du 4 novembre 2026 : 14 étiquettes rendues comme valeurs. Le champ attend
            // son domaine (`ref.concepts.domaine`) ; il ne dit, d'ici là, que l'étiquette vue.
            "liste" => {
                let (vus, partage) = repere_imprime(&page, n);
                let statut = if vus.is_empty() && !partage {
                    "absent"
                } else {
                    "signale"
                };
                ChampSortie {
                    valeur: None,
                    refs: Vec::new(),
                    statut: statut.into(),
                    instances: None,
                }
            }
            genre => {
                let chiffre = matches!(genre, "identifiant" | "nombre" | "taux");
                apres_repere(
                    &page,
                    n,
                    &Lecture {
                        chiffre,
                        colle_au_libelle: true,
                        exclusif: true,
                        motif: motif.as_ref(),
                        phrase: genre == "texte",
                        partie: ch.role.is_some(),
                    },
                )
            }
        };
        champs.insert(ch.code.clone(), sortie);
    }
}
