//! Traduction des preuves de la grille (contrat §2) en contraintes sur des
//! variables. Une preuve sans expression, ou dont l'expression ne se traduit
//! pas, n'est pas exécutée : elle reste `non_evaluable`, avec sa raison.

use crate::entree::{Entree, Grille};
use serde_json::Value;
use std::collections::HashMap;

/// Nombre d'instances de taux distincts d'un groupe : « une à trois » (contrat §2),
/// surchargeable par la clé `instances_max` de l'expression.
const INSTANCES_MAX_CONTRAT: usize = 3;

const TYPES_NUMERIQUES: [&str; 3] = ["montant", "nombre", "taux"];

/// Une unité d'une somme : un champ scalaire, ou l'agrégat (Σ montants, Σ bases) d'un groupe.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Unite {
    S(usize),
    M(usize),
    B(usize),
}

pub enum Contrainte {
    /// Σ coef × unité = 0, exactement.
    Lin { termes: Vec<(Unite, i64)> },
    Produit { total: usize, facteurs: Vec<usize> },
    Taux { m: usize, b: usize, bareme: String },
    /// `fixe` : le montant standard du pack ; `admis` : tout montant que le pack admet au
    /// jour de la pièce (le standard et les tranches de son barème). `assiette` : le barème
    /// dont la base est majorée de cette charge — nommé par la preuve (clé `assiette`),
    /// et seulement si le pack dit la charge `assiette_tva`.
    Charge {
        m: usize,
        fixe: Option<i64>,
        admis: Vec<i64>,
        taux_ppm: Option<i64>,
        base: Option<usize>,
        assiette: Option<String>,
    },
    Groupe { g: usize },
}

pub struct ContraintePreuve {
    pub c: Contrainte,
    pub preuve: usize,
}

pub struct Var {
    pub champ: usize,
    pub facultatif: bool,
    /// Décidé avant la recherche : un champ facultatif n'est présent que si son
    /// repère est lu, ou si c'est une charge à montant fixe imprimé en lecture forte.
    pub present: bool,
}

pub struct Groupe {
    pub champ_base: usize,
    pub champ_montant: usize,
    pub total_base: Option<usize>,
    pub total_montant: Option<usize>,
    pub bareme: String,
    /// Champ dont la mention autorise l'exonération (zéro instance), s'il est déclaré.
    pub exoneration: Option<usize>,
    pub instances_max: usize,
}

pub enum NonNumerique {
    Format { champ: usize, format: String },
    Ordre { avant: usize, apres: usize },
}

pub struct Modele {
    pub vars: Vec<Var>,
    pub groupes: Vec<Groupe>,
    pub contraintes: Vec<ContraintePreuve>,
    pub non_numeriques: Vec<(usize, NonNumerique)>,
    /// Pour chaque preuve : la raison pour laquelle elle n'est pas exécutée.
    pub non_traduites: HashMap<usize, String>,
}

struct Ref {
    nom: String,
    signe: i64,
    facultatif: bool,
}

fn lire_ref(s: &str) -> Ref {
    let (signe, reste) = match s.strip_prefix('-') {
        Some(r) => (-1, r),
        None => (1, s.strip_prefix('+').unwrap_or(s)),
    };
    let (nom, facultatif) = match reste.strip_suffix('?') {
        Some(n) => (n, true),
        None => (reste, false),
    };
    Ref { nom: nom.trim().to_string(), signe, facultatif }
}

fn texte(e: &Value, cle: &str) -> Result<String, String> {
    e.get(cle).and_then(|v| v.as_str()).map(|s| s.to_string()).ok_or_else(|| format!("clé « {cle} » manquante"))
}

fn liste(e: &Value, cle: &str) -> Result<Vec<String>, String> {
    e.get(cle)
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .ok_or_else(|| format!("clé « {cle} » manquante"))
}

struct Bati<'a> {
    grille: &'a Grille,
    index: HashMap<&'a str, usize>,
    vars: Vec<Var>,
    var_de: HashMap<usize, usize>,
    groupes: Vec<Groupe>,
}

impl<'a> Bati<'a> {
    fn champ(&self, nom: &str) -> Result<usize, String> {
        self.index.get(nom).copied().ok_or_else(|| format!("champ « {nom} » absent de la grille"))
    }

    fn numerique(&self, c: usize) -> Result<(), String> {
        let g = &self.grille.champs[c].genre;
        if TYPES_NUMERIQUES.contains(&g.as_str()) {
            Ok(())
        } else {
            Err(format!("champ « {} » de type {g}, non numérique", self.grille.champs[c].code))
        }
    }

    fn var(&mut self, r: &Ref) -> Result<usize, String> {
        let c = self.champ(&r.nom)?;
        self.numerique(c)?;
        if self.groupes.iter().any(|g| g.champ_base == c || g.champ_montant == c) {
            return Err(format!("champ « {} » de groupe employé comme scalaire", r.nom));
        }
        let i = match self.var_de.get(&c) {
            Some(&i) => i,
            None => {
                self.vars.push(Var { champ: c, facultatif: false, present: true });
                self.var_de.insert(c, self.vars.len() - 1);
                self.vars.len() - 1
            }
        };
        self.vars[i].facultatif |= r.facultatif;
        Ok(i)
    }

    fn unite(&mut self, r: &Ref) -> Result<Unite, String> {
        let c = self.champ(&r.nom)?;
        for (g, gr) in self.groupes.iter().enumerate() {
            if gr.champ_montant == c {
                return Ok(Unite::M(g));
            }
            if gr.champ_base == c {
                return Ok(Unite::B(g));
            }
        }
        Ok(Unite::S(self.var(r)?))
    }
}

pub fn construire(entree: &Entree) -> Modele {
    let grille = &entree.grille;
    let mut b = Bati {
        grille,
        index: grille.champs.iter().enumerate().map(|(i, c)| (c.code.as_str(), i)).collect(),
        vars: Vec::new(),
        var_de: HashMap::new(),
        groupes: Vec::new(),
    };
    let mut contraintes = Vec::new();
    let mut non_numeriques = Vec::new();
    let mut non_traduites = HashMap::new();

    // Les preuves exécutables : une expression, et un statut qui n'est pas « à traduire ».
    let executables: Vec<(usize, &Value)> = grille
        .preuves
        .iter()
        .enumerate()
        .filter_map(|(i, p)| {
            if p.statut.as_deref() == Some("a_traduire") {
                non_traduites.insert(i, "statut a_traduire".to_string());
                return None;
            }
            match &p.expression {
                Some(e) if !e.is_null() => Some((i, e)),
                _ => {
                    non_traduites.insert(i, "aucune expression".to_string());
                    None
                }
            }
        })
        .collect();

    // 1. Les groupes d'abord : leurs champs ne sont pas des scalaires.
    for &(i, e) in &executables {
        if e.get("op").and_then(|o| o.as_str()) != Some("groupe_taux") {
            continue;
        }
        let r: Result<(), String> = (|| {
            let cb = b.champ(&lire_ref(&texte(e, "base")?).nom)?;
            let cm = b.champ(&lire_ref(&texte(e, "montant")?).nom)?;
            b.numerique(cb)?;
            b.numerique(cm)?;
            let bareme = texte(e, "bareme")?;
            if !entree.pack.baremes.contains_key(&bareme) {
                return Err(format!("barème « {bareme} » absent du pack"));
            }
            let exoneration = match e.get("exoneration").and_then(|v| v.as_str()) {
                Some(n) => Some(b.champ(n)?),
                None => None,
            };
            let instances_max = e
                .get("instances_max")
                .and_then(|v| v.as_u64())
                .map(|n| n as usize)
                .unwrap_or(INSTANCES_MAX_CONTRAT);
            b.groupes.push(Groupe {
                champ_base: cb,
                champ_montant: cm,
                total_base: None,
                total_montant: None,
                bareme,
                exoneration,
                instances_max,
            });
            let g = b.groupes.len() - 1;
            if let Ok(t) = texte(e, "total_base") {
                b.groupes[g].total_base = Some(b.var(&lire_ref(&t))?);
            }
            if let Ok(t) = texte(e, "total_montant") {
                b.groupes[g].total_montant = Some(b.var(&lire_ref(&t))?);
            }
            contraintes.push(ContraintePreuve { c: Contrainte::Groupe { g }, preuve: i });
            Ok(())
        })();
        if let Err(m) = r {
            non_traduites.insert(i, m);
        }
    }

    // 2. Les autres preuves.
    for &(i, e) in &executables {
        let op = e.get("op").and_then(|o| o.as_str()).unwrap_or("");
        let r: Result<(), String> = (|| {
            match op {
                // Les lignes (lignes.rs), l'en-tête (entete.rs) et les lettres (lettres.rs) se
                // prouvent après le centre, sur sa sortie : ils n'entrent pas dans sa recherche.
                "groupe_taux" | crate::lignes::OP | crate::entete::OP | crate::lettres::OP => {}
                "somme" => {
                    let total = b.unite(&lire_ref(&texte(e, "total")?))?;
                    let mut termes = vec![(total, 1)];
                    for p in liste(e, "parties")? {
                        let r = lire_ref(&p);
                        termes.push((b.unite(&r)?, -r.signe));
                    }
                    contraintes.push(ContraintePreuve { c: Contrainte::Lin { termes }, preuve: i });
                }
                "egal" => {
                    let a = b.unite(&lire_ref(&texte(e, "a")?))?;
                    let c = b.unite(&lire_ref(&texte(e, "b")?))?;
                    contraintes.push(ContraintePreuve { c: Contrainte::Lin { termes: vec![(a, 1), (c, -1)] }, preuve: i });
                }
                "produit" => {
                    let total = b.var(&lire_ref(&texte(e, "total")?))?;
                    let mut facteurs = Vec::new();
                    for f in liste(e, "facteurs")? {
                        facteurs.push(b.var(&lire_ref(&f))?);
                    }
                    if facteurs.is_empty() {
                        return Err("produit sans facteur".into());
                    }
                    contraintes.push(ContraintePreuve { c: Contrainte::Produit { total, facteurs }, preuve: i });
                }
                "taux" => {
                    let m = b.var(&lire_ref(&texte(e, "montant")?))?;
                    let base = b.var(&lire_ref(&texte(e, "base")?))?;
                    let bareme = texte(e, "bareme")?;
                    if !entree.pack.baremes.contains_key(&bareme) {
                        return Err(format!("barème « {bareme} » absent du pack"));
                    }
                    contraintes.push(ContraintePreuve { c: Contrainte::Taux { m, b: base, bareme }, preuve: i });
                }
                "charge" => {
                    let m = b.var(&lire_ref(&texte(e, "montant")?))?;
                    let code = texte(e, "code")?;
                    let ch = entree
                        .pack
                        .charges
                        .iter()
                        .find(|c| c.code == code)
                        .ok_or_else(|| format!("charge « {code} » absente du pack"))?;
                    let base = match e.get("base").and_then(|v| v.as_str()) {
                        Some(n) => Some(b.var(&lire_ref(n))?),
                        None => None,
                    };
                    // Les montants admis : le standard, et ceux que le pack admet au jour dit
                    // (les tranches d'un barème). Triés, sans doublon.
                    let mut admis: Vec<i64> =
                        ch.montant_fixe.into_iter().chain(ch.montants_admis.iter().copied()).collect();
                    admis.sort_unstable();
                    admis.dedup();
                    if admis.is_empty() && ch.taux_ppm.is_none() {
                        return Err(format!("charge « {code} » sans montant ni taux dans le pack"));
                    }
                    // Une charge d'assiette majore la base d'un barème : la preuve le nomme.
                    let assiette = if ch.assiette_tva {
                        let b = texte(e, "assiette").map_err(|_| {
                            format!("charge « {code} » d'assiette : la preuve ne nomme pas son barème (clé « assiette »)")
                        })?;
                        if !entree.pack.baremes.contains_key(&b) {
                            return Err(format!("barème « {b} » absent du pack"));
                        }
                        Some(b)
                    } else {
                        None
                    };
                    contraintes.push(ContraintePreuve {
                        c: Contrainte::Charge { m, fixe: ch.montant_fixe, admis, taux_ppm: ch.taux_ppm, base, assiette },
                        preuve: i,
                    });
                }
                "format" => {
                    let champ = b.champ(&lire_ref(&texte(e, "champ")?).nom)?;
                    non_numeriques.push((i, NonNumerique::Format { champ, format: texte(e, "format")? }));
                }
                "ordre" => {
                    let avant = b.champ(&lire_ref(&texte(e, "avant")?).nom)?;
                    let apres = b.champ(&lire_ref(&texte(e, "apres")?).nom)?;
                    non_numeriques.push((i, NonNumerique::Ordre { avant, apres }));
                }
                autre => return Err(format!("op « {autre} » inconnue")),
            }
            Ok(())
        })();
        if let Err(m) = r {
            non_traduites.insert(i, m);
        }
    }

    Modele { vars: b.vars, groupes: b.groupes, contraintes, non_numeriques, non_traduites }
}
