//! Le sudoku : attribuer les valeurs lues d'une pièce aux champs de sa grille
//! par les seules relations de la grille et les paramètres du pack.
//!
//! Contrat : `docs/sudoku/contrat-du-moteur.md` (§2 langage des preuves, §3 entrée,
//! §4 sortie). Le moteur ne lit aucun montant lui-même (il reçoit `montants`
//! déjà lus par jeton) et ne porte aucune constante réglementaire (R4) : taux,
//! charges, formats et libellés arrivent en entrée. Toute valeur rendue cite le
//! jeton qui la porte (R2).

mod entete;
mod entree;
mod identite;
mod lettres;
mod lignes;
mod modele;
mod numerique;
mod reperes;
mod textuel;
mod valeurs;

use entree::Entree;
use modele::{Contrainte, Modele, NonNumerique};
use numerique::{cle, Etat, Eval, Solution, Solveur};
use reperes::{reperes_de, Plan};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use textuel::Issue;
use valeurs::Domaine;

/// Plafond de combinaisons par défaut, quand l'entrée n'en fixe pas.
const PLAFOND_DEFAUT: u64 = 200_000;

#[derive(Serialize, Clone, PartialEq, Eq)]
pub struct RefJeton {
    pub page: u32,
    pub ordinal: u32,
}

#[derive(Serialize)]
pub struct InstanceSortie {
    /// Code du taux dans le barème du pack.
    pub taux: String,
    pub valeur: Option<String>,
    pub refs: Vec<RefJeton>,
}

#[derive(Serialize)]
pub struct ChampSortie {
    pub valeur: Option<String>,
    pub refs: Vec<RefJeton>,
    pub statut: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instances: Option<Vec<InstanceSortie>>,
}

#[derive(Serialize)]
pub struct Sortie {
    pub issue: String,
    pub solutions: usize,
    pub champs: BTreeMap<String, ChampSortie>,
    pub preuves: BTreeMap<String, String>,
    pub combinaisons: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raison: Option<String>,
    /// Les lignes d'articles (anneau 1), quand la grille porte une preuve `lignes`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lignes: Option<lignes::LignesSortie>,
    /// Les parties de l'en-tête (anneau 2), quand la grille porte une preuve `parties`
    /// et que l'entrée porte le dossier (`connus`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parties: Option<entete::PartiesSortie>,
    /// Le champ dont la valeur vient du montant en lettres, quand c'est lui qui a fermé la
    /// pièce (`par_les_lettres`) : un total que les chiffres ne donnaient pas.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub par_lettres: Option<String>,
}

fn erreur(m: String) -> String {
    let s = Sortie {
        issue: "aucune".into(),
        solutions: 0,
        champs: BTreeMap::new(),
        preuves: BTreeMap::new(),
        combinaisons: 0,
        raison: Some(m),
        lignes: None,
        parties: None,
        par_lettres: None,
    };
    serde_json::to_string(&s).unwrap_or_default()
}

/// Point d'entrée : JSON du contrat §3 en entrée, JSON du contrat §4 en sortie.
pub fn solve(input_json: &str) -> String {
    let entree: Entree = match serde_json::from_str(input_json) {
        Ok(e) => e,
        Err(e) => return erreur(format!("entrée invalide : {e}")),
    };
    let sortie = resoudre(&entree).map(|s| {
        if s.issue == "aucune" && s.solutions == 0 {
            par_les_lettres(input_json, &entree).unwrap_or(s)
        } else {
            s
        }
    });
    match sortie {
        Ok(s) => serde_json::to_string(&s).unwrap_or_else(|e| erreur(format!("sortie : {e}"))),
        Err(m) => erreur(m),
    }
}

/// Le total que les chiffres ne donnent pas, les lettres le donnent (2 novembre 2026).
///
/// Une photo de facture MyTek : « 510,000 » relevé « 810,000 », et « Cinq Cent Dix Dinars »
/// écrit en toutes lettres. Aucune affectation ne fermait, et la preuve `lettres` restait
/// « non évaluable » : elle ne se jugeait que sur une pièce déjà prouvée. Ici, quand rien ne
/// ferme, le montant en lettres devient UN candidat de plus, porté par le premier mot de sa
/// phrase — et seulement pour les champs que la preuve `lettres` nomme (`egal_a`).
///
/// La pièce n'est retenue que si elle se prouve alors entièrement, par les mêmes règles
/// (le HT porte son libellé, les lignes confirment une exonération partielle…), et si les
/// lettres ne servent qu'à ces champs. Sinon rien ne change. Le moteur ne lit toujours
/// aucun mot : la valeur vient de l'adaptateur, avec le lexique du pack (règle ①).
fn par_les_lettres(input_json: &str, entree: &Entree) -> Option<Sortie> {
    // Les champs que les lettres peuvent porter, et le champ des lettres lui-même.
    let mut egal_a: BTreeSet<String> = BTreeSet::new();
    let mut champs_lettres: BTreeSet<String> = BTreeSet::new();
    for p in &entree.grille.preuves {
        let Some(e) = p.expression.as_ref().filter(|e| e.get("op").and_then(|o| o.as_str()) == Some(lettres::OP)) else {
            continue;
        };
        if p.statut.as_deref() == Some("a_traduire") {
            continue;
        }
        let Ok(op) = lettres::lire_op(&entree.grille, e) else { continue };
        champs_lettres.insert(entree.grille.champs[op.champ].code.clone());
        egal_a.extend(op.egal_a.iter().map(|&c| entree.grille.champs[c].code.clone()));
    }
    if egal_a.is_empty() {
        return None;
    }
    // Un seul montant en lettres sur la pièce, strictement positif.
    let lus = lettres::lus(entree);
    let (v, phrase) = lus.first()?;
    if *v <= 0 || lus.iter().any(|(w, _)| w != v) {
        return None;
    }
    let (v, phrase) = (*v, phrase.clone());
    let porteurs: BTreeSet<(u32, u32)> =
        entree.jetons.iter().filter(|j| j.lettres.is_some()).map(|j| (j.page, j.ordinal)).collect();

    let mut avec: Entree = serde_json::from_str(input_json).ok()?;
    for j in avec.jetons.iter_mut().filter(|j| j.lettres.is_some()) {
        j.montants.push(entree::Lecture { v, forte: true });
    }
    let mut s = resoudre(&avec).ok()?;
    if s.issue != "prouvee" {
        return None;
    }
    let cite_les_lettres =
        |c: &ChampSortie| c.refs.iter().any(|r| porteurs.contains(&(r.page, r.ordinal)));
    let mut porte = None;
    for (code, c) in &s.champs {
        let cite = cite_les_lettres(c) || c.instances.iter().flatten().any(|i| i.refs.iter().any(|r| porteurs.contains(&(r.page, r.ordinal))));
        if !cite || champs_lettres.contains(code) {
            continue;
        }
        // Les lettres ne portent qu'un total qu'elles doivent égaler, et cette valeur-là.
        if !egal_a.contains(code) || c.statut != "prouve" || c.valeur.as_deref() != Some(&v.to_string()) {
            return None;
        }
        porte = Some(code.clone());
    }
    let porte = porte?;
    // Le total cite toute sa phrase, comme le champ des lettres : un seul mot ne porte pas
    // le montant (« Cinq » pour « Cinq Cent Dix Dinars »).
    if let Some(c) = s.champs.get_mut(&porte) {
        c.refs = phrase;
    }
    s.raison = Some(format!("le total en chiffres ne ferme pas : le montant en lettres donne {porte}, et la pièce se prouve par lui"));
    s.par_lettres = Some(porte);
    Some(s)
}

fn resoudre(entree: &Entree) -> Result<Sortie, String> {
    let grille = &entree.grille;
    let plan = Plan::new(&entree.jetons);
    let dom = Domaine::new(&entree.jetons);
    let mut modele: Modele = modele::construire(entree);
    let reperes: Vec<Vec<String>> = grille.champs.iter().map(reperes_de).collect();
    // Les champs de la preuve arithmétique : ceux que son retrait fait passer à signalés.
    let numeriques: BTreeSet<String> = modele
        .vars
        .iter()
        .map(|v| v.champ)
        .chain(modele.groupes.iter().flat_map(|g| [g.champ_base, g.champ_montant]))
        .map(|c| grille.champs[c].code.clone())
        .collect();

    // Présence des champs facultatifs, décidée avant la recherche.
    let fixes: BTreeMap<usize, i64> = modele
        .contraintes
        .iter()
        .filter_map(|cp| match cp.c {
            Contrainte::Charge { m, fixe: Some(f), .. } => Some((m, f)),
            _ => None,
        })
        .collect();
    // Une CHARGE du pack (timbre, FODEC) est exigée dès que son libellé est lu, même
    // sans montant à côté : c'est ce qui empêche un TTC de « fermer » sans le timbre
    // imprimé que l'OCR a manqué. Les autres champs facultatifs (retenue, acompte…)
    // ne le sont que sur une rangée chiffrée.
    // Une charge PROPORTIONNELLE l'est aussi par son taux, imprimé sur une rangée chiffrée
    // (« 31,675 1 % ») : son libellé perdu ne l'efface pas.
    let charges: BTreeMap<usize, Option<i64>> = modele
        .contraintes
        .iter()
        .filter_map(|cp| match cp.c {
            Contrainte::Charge { m, taux_ppm, .. } => Some((m, taux_ppm)),
            _ => None,
        })
        .collect();
    for (i, v) in modele.vars.iter_mut().enumerate() {
        if v.facultatif {
            let annonce = if let Some(taux) = charges.get(&i) {
                plan.annonce(&reperes[v.champ]) || taux.is_some_and(|t| t > 0 && plan.taux_chiffre(t))
            } else {
                plan.annonce_chiffree(&reperes[v.champ])
            };
            let fixe_imprime = fixes.get(&i).is_some_and(|f| dom.forte(*f));
            v.present = annonce || fixe_imprime;
        }
    }
    let exo: Vec<bool> = modele
        .groupes
        .iter()
        .map(|g| g.exoneration.is_some_and(|c| plan.annonce(&reperes[c])))
        .collect();

    // Un champ que seules des sommes exactes contraignent peut prendre n'importe quel
    // jeton : quand son libellé ancre des jetons porteurs de montants (sur le jeton
    // lui-même ou juste à gauche), il ne prend que ceux-là.
    let restreints: Vec<Option<BTreeSet<i64>>> = (0..modele.vars.len())
        .map(|i| {
            let somme_seule = modele.contraintes.iter().all(|cp| match &cp.c {
                Contrainte::Lin { .. } => true,
                c => !numerique::unites(c, &modele).contains(&modele::Unite::S(i)),
            });
            if !somme_seule {
                return None;
            }
            let champ = modele.vars[i].champ;
            let ancrees: BTreeSet<i64> = dom
                .valeurs
                .iter()
                // Le montant en lettres, porté par le premier mot de sa phrase quand il devient
                // candidat (`par_les_lettres`), est ancré par sa propre phrase : il compte.
                .filter(|(_, val)| {
                    val.occurrences.iter().any(|o| {
                        plan.ancre(o.jeton, &reperes[champ], None, false)
                            || plan.apparie(o.jeton, &reperes[champ])
                            || entree.jetons[o.jeton].lettres.is_some()
                    })
                })
                .map(|(v, _)| *v)
                .collect();
            if ancrees.is_empty() {
                None
            } else {
                Some(ancrees)
            }
        })
        .collect();

    let plafond = entree.plafond.unwrap_or(PLAFOND_DEFAUT);
    let mut s = Solveur::new(&modele, &dom, &entree.pack, exo, restreints, plafond);
    let a_chercher = !modele.contraintes.is_empty();
    if a_chercher {
        s.chercher();
    }

    // Déduplication : une même solution par deux chemins n'en fait qu'une, la plus forte —
    // et, à force égale, celle qui n'invoque pas d'exonération partielle (qui exige les lignes).
    let partielle = |sol: &Solution| sol.etat.g.iter().any(|g| g.as_ref().is_some_and(|g| g.partielle));
    let mut uniques: BTreeMap<_, Solution> = BTreeMap::new();
    for sol in s.solutions.drain(..) {
        let k = cle(&sol.etat);
        let remplace = match uniques.get(&k) {
            None => true,
            Some(x) => (x.faible && !sol.faible) || (x.faible == sol.faible && partielle(x) && !partielle(&sol)),
        };
        if remplace {
            uniques.insert(k, sol);
        }
    }
    let toutes: Vec<Solution> = uniques.into_values().collect();
    // Une solution qui ne s'appuie que sur des lectures fortes l'emporte.
    let fortes: Vec<Solution> = toutes.iter().filter(|x| !x.faible).cloned().collect();
    let retenues = if fortes.is_empty() { toutes } else { fortes };

    // Une valeur imprimée une fois n'est lue que pour UN champ. Banc sans IA du 4 novembre
    // 2026, algoria-135 : « Total 304,000 », seul ; net à rembourser = total − avance
    // (absente) fermait sur ce même jeton, et le net, jamais imprimé, était rendu prouvé —
    // une preuve qui ne compare un jeton qu'à lui-même. Les champs en surnombre (d'abord les
    // facultatifs, puis ceux dont le libellé n'ancre aucune occurrence) sont absents — un net
    // à payer sans timbre n'est pas imprimé à part du TTC —, puis les contraintes se
    // réévaluent : une preuve qui ne tenait que par ce partage tombe. Un champ OBLIGATOIRE
    // en surnombre invalide la solution : elle lisait un champ requis là où il n'est pas.
    // Ce partage se juge sur CHAQUE solution retenue, avant l'unicité : une solution qui lit
    // un champ requis sur le jeton d'un autre (le HT à 0 sur « 0 % », le TTC sur le seul
    // « 1,000 » du timbre, algoria-055) n'est pas une seconde lecture de la pièce.
    let sans_partage = |etat: &Etat| -> (Etat, bool) {
        let mut e = etat.clone();
        let mut requis = false;
        let mut par_valeur: BTreeMap<i64, Vec<(bool, bool, usize)>> = BTreeMap::new();
        let mut faibles: BTreeSet<i64> = BTreeSet::new();
        for (i, x) in e.s.iter().enumerate() {
            if let Some(x) = x.filter(|x| !x.absent) {
                if x.faible {
                    faibles.insert(x.v);
                }
                let champ = modele.vars[i].champ;
                let ancree = dom.valeurs.get(&x.v).is_some_and(|val| {
                    val.occurrences.iter().any(|o| plan.ancre(o.jeton, &reperes[champ], None, false))
                });
                par_valeur.entry(x.v).or_default().push((modele.vars[i].facultatif, !ancree, i));
            }
        }
        for (v, mut vars) in par_valeur {
            // lue forte, une valeur ne compte que ses occurrences fortes : le « 1 » d'une
            // adresse n'est pas un second « 1,000 »
            let jetons: BTreeSet<usize> = dom
                .valeurs
                .get(&v)
                .map(|val| val.occurrences.iter().filter(|o| o.forte || faibles.contains(&v)).map(|o| o.jeton).collect())
                .unwrap_or_default();
            if vars.len() <= jetons.len() {
                continue;
            }
            vars.sort();
            for &(_, _, i) in &vars[jetons.len()..] {
                requis |= !modele.vars[i].facultatif;
                e.s[i] = Some(numerique::Val { v: 0, absent: true, faible: false });
            }
        }
        (e, requis)
    };
    // Nettoyée, la solution doit encore tenir : une contrainte qui échoue sans le champ
    // retiré (le TTC qui ne tenait que par le « 1,000 » du timbre) la disqualifie.
    let lues: Vec<Etat> = retenues
        .iter()
        .map(|r| sans_partage(&r.etat))
        .filter(|(e, requis)| !requis && modele.contraintes.iter().all(|cp| s.evaluer(e, &cp.c) != Eval::Echec))
        .map(|(e, _)| e)
        .collect();
    let partage_requis = !retenues.is_empty() && lues.is_empty();
    let unique: Option<&Etat> = if lues.len() == 1 { lues.first() } else { None };
    let mut issue = match lues.len() {
        0 => "aucune",
        1 => "prouvee",
        _ => "ambigue",
    }
    .to_string();
    let mut raison = None;
    if partage_requis {
        issue = "aucune".into();
        raison = Some("une valeur imprimée une fois est lue pour deux champs".into());
    }
    if s.depasse {
        issue = "aucune".into();
        raison = Some(format!("plafond de {plafond} combinaisons atteint"));
    } else if !a_chercher {
        raison = Some("aucune preuve arithmétique exécutable".into());
    }

    // Statut de chaque contrainte dans la solution unique.
    let evals: Vec<Eval> = match unique {
        Some(e) if !s.depasse => modele.contraintes.iter().map(|cp| s.evaluer(e, &cp.c)).collect(),
        _ => vec![Eval::Inconnu; modele.contraintes.len()],
    };
    // toutes les contraintes numériques sont arithmétiques : il en faut au moins une vérifiée
    if issue == "prouvee" && !evals.contains(&Eval::Ok) {
        issue = "aucune".into();
        raison = Some("aucune preuve arithmétique vérifiée".into());
    }
    let mut prouvee = issue == "prouvee";

    // ---------- Les champs ----------
    let mut champs: BTreeMap<String, ChampSortie> = BTreeMap::new();
    let cite = |v: i64, champ: usize| -> Vec<RefJeton> {
        let occ = match dom.valeurs.get(&v) {
            Some(x) => &x.occurrences,
            None => return Vec::new(),
        };
        // l'occurrence ancrée au libellé du champ, puis forte, puis la plus basse de la dernière page
        let best = occ.iter().max_by(|a, b| {
            let ja = &entree.jetons[a.jeton];
            let jb = &entree.jetons[b.jeton];
            let ka = (plan.ancre(a.jeton, &reperes[champ], None, false), a.forte, ja.page);
            let kb = (plan.ancre(b.jeton, &reperes[champ], None, false), b.forte, jb.page);
            ka.cmp(&kb)
                .then(ja.y0.partial_cmp(&jb.y0).unwrap_or(std::cmp::Ordering::Equal))
                .then(ja.ordinal.cmp(&jb.ordinal))
        });
        best.map(|o| {
            let j = &entree.jetons[o.jeton];
            vec![RefJeton { page: j.page, ordinal: j.ordinal }]
        })
        .unwrap_or_default()
    };
    let signale = || ChampSortie { valeur: None, refs: Vec::new(), statut: "signale".into(), instances: None };
    let absent = || ChampSortie { valeur: None, refs: Vec::new(), statut: "absent".into(), instances: None };

    for (i, v) in modele.vars.iter().enumerate() {
        if !s.utile(i) {
            continue;
        }
        let code = grille.champs[v.champ].code.clone();
        let sortie = match unique {
            Some(e) if prouvee => match e.s[i] {
                Some(x) if !x.absent => {
                    let dans_preuve = modele.contraintes.iter().zip(&evals).any(|(cp, ev)| {
                        *ev == Eval::Ok && numerique::unites(&cp.c, &modele).contains(&modele::Unite::S(i))
                    });
                    ChampSortie {
                        valeur: Some(x.v.to_string()),
                        refs: cite(x.v, v.champ),
                        statut: if dans_preuve { "prouve" } else { "signale" }.into(),
                        instances: None,
                    }
                }
                _ => absent(),
            },
            _ => {
                if v.present {
                    signale()
                } else {
                    absent()
                }
            }
        };
        champs.insert(code, sortie);
    }
    for (g, gr) in modele.groupes.iter().enumerate() {
        let coefs = s.coefs_groupe(g);
        for (champ, est_base) in [(gr.champ_base, true), (gr.champ_montant, false)] {
            let code = grille.champs[champ].code.clone();
            let sortie = match unique {
                Some(e) if prouvee => {
                    let sol = e.g[g].as_ref().expect("groupe résolu");
                    if sol.exoneration {
                        // Exonération totale : la part exonérée est tout le total des bases,
                        // nommée par le taux nul de la grille quand elle en désigne un.
                        let total = gr.total_base.and_then(|t| e.s[t].filter(|v| !v.absent)).map(|v| v.v);
                        match (&gr.taux_exonere, total) {
                            (Some(code), Some(t)) => {
                                let v = if est_base { t } else { 0 };
                                ChampSortie {
                                    valeur: None,
                                    refs: Vec::new(),
                                    statut: "prouve".into(),
                                    instances: Some(vec![InstanceSortie { taux: code.clone(), valeur: Some(v.to_string()), refs: cite(v, champ) }]),
                                }
                            }
                            _ if est_base => absent(),
                            _ => ChampSortie {
                                valeur: Some("0".into()),
                                refs: cite(0, champ),
                                statut: "prouve".into(),
                                instances: Some(Vec::new()),
                            },
                        }
                    } else {
                        // L'assiette PROUVÉE : la base d'un taux est la somme de tout ce que le
                        // pack met dans l'assiette de son barème — la base des lignes et les
                        // charges d'assiette présentes (le FODEC) —, jamais un jeton choisi. Banc
                        // sans IA du 4 novembre 2026 : la base rendue était le HT sur 10 pièces
                        // « prouvées » à FODEC. À plusieurs taux, la charge ne se répartit pas
                        // sans les lignes : la base n'est pas rendue.
                        let charges: Vec<i64> = modele
                            .contraintes
                            .iter()
                            .filter_map(|cp| match &cp.c {
                                modele::Contrainte::Charge { m, assiette: Some(b), .. } if *b == gr.bareme => {
                                    e.s[*m].filter(|x| !x.absent).map(|x| x.v)
                                }
                                _ => None,
                            })
                            .collect();
                        let majoration: i64 = charges.iter().sum();
                        let mut inst: Vec<InstanceSortie> = sol
                            .instances
                            .iter()
                            .map(|it| {
                                let v = if est_base { it.b } else { it.m };
                                let v = match v {
                                    Some(b) if est_base && majoration != 0 => {
                                        (sol.instances.len() == 1).then_some(b + majoration)
                                    }
                                    autre => autre,
                                };
                                InstanceSortie {
                                    taux: coefs[it.taux].0.clone(),
                                    valeur: v.map(|x| x.to_string()),
                                    refs: v.map(|x| cite(x, champ)).unwrap_or_default(),
                                }
                            })
                            .collect();
                        // Exonération partielle : la part exonérée est une instance de la
                        // ventilation — base = total des bases − Σ bases imprimées, montant nul —,
                        // nommée par le taux nul que la grille désigne. Sans ce taux, la
                        // ventilation est incomplète et n'est pas affirmée. Banc sans IA du
                        // 4 novembre 2026 : « 0 % 4 032,000 0,000 » imprimé, la ventilation
                        // rendue ne portait que le 19 %. Les lignes confirment le reste
                        // (contrôle plus bas), sinon la preuve est retirée.
                        let exoneree = match (sol.partielle, &gr.taux_exonere) {
                            (false, _) => Some(None),
                            (true, None) => None,
                            (true, Some(code)) => gr
                                .total_base
                                .and_then(|t| e.s[t].filter(|v| !v.absent))
                                .map(|total| {
                                    let v = if est_base { total.v - sol.somme_b } else { 0 };
                                    Some(InstanceSortie { taux: code.clone(), valeur: Some(v.to_string()), refs: cite(v, champ) })
                                }),
                        };
                        match exoneree {
                            Some(reste) => {
                                inst.extend(reste);
                                ChampSortie { valeur: None, refs: Vec::new(), statut: "prouve".into(), instances: Some(inst) }
                            }
                            None => signale(),
                        }
                    }
                }
                _ => signale(),
            };
            champs.insert(code, sortie);
        }
    }

    // Les champs non numériques.
    let mut lus: BTreeMap<usize, String> = BTreeMap::new();
    for (c, champ) in grille.champs.iter().enumerate() {
        if !textuel::traite(champ, &entree.pack) {
            continue;
        }
        // Deux champs de la grille portent le même format (le matricule de l'émetteur et celui
        // du client) : une valeur au format ne dit pas à quelle partie elle appartient — les
        // repères (« Matricule fiscal ») sont les mêmes. Seul l'anneau 2 (E01) l'établit ;
        // ici, elle est signalée, jamais attribuée (banc des 150 factures, 1er novembre 2026 :
        // le matricule du client lu « conforme » comme celui d'un émetteur étranger).
        let partage = champ.genre == "identifiant"
            && champ.format_code.is_some()
            && grille.champs.iter().enumerate().any(|(k, x)| k != c && x.format_code == champ.format_code);
        let sortie = match textuel::lire(champ, &entree.pack, &plan)? {
            Issue::Conforme(_) if partage => signale(),
            Issue::Conforme(l) => {
                lus.insert(c, l.valeur.clone());
                ChampSortie {
                    valeur: Some(l.valeur),
                    refs: (l.jeton..=l.fin)
                        .map(|k| RefJeton { page: entree.jetons[k].page, ordinal: entree.jetons[k].ordinal })
                        .collect(),
                    statut: "conforme".into(),
                    instances: None,
                }
            }
            Issue::Signale => signale(),
            Issue::Absent => absent(),
        };
        champs.insert(champ.code.clone(), sortie);
    }

    // ---------- L'anneau 2 : l'en-tête, par ses relations avec la base du client ----------
    // Avant les preuves `format` et `ordre`, qui lisent les champs qu'il établit.
    let mut sortie_parties = None;
    let mut statuts_parties: Vec<(String, &str)> = Vec::new();
    let mut une_preuve_parties = false;
    for p in &grille.preuves {
        let Some(e) = p.expression.as_ref().filter(|e| e.get("op").and_then(|o| o.as_str()) == Some(entete::OP)) else {
            continue;
        };
        if p.statut.as_deref() == Some("a_traduire") {
            continue;
        }
        let st = if une_preuve_parties {
            // une seule preuve de parties par grille
            "non_evaluable"
        } else {
            une_preuve_parties = true;
            match entete::lire_op(grille, e) {
                Ok(op) => {
                    let r = entete::prouver(&op, entree, &mut champs);
                    for (c, v) in r.lus {
                        lus.insert(c, v);
                    }
                    sortie_parties = r.parties;
                    r.statut
                }
                Err(_) => "non_evaluable",
            }
        };
        statuts_parties.push((p.code.clone(), st));
    }

    // ---------- Les preuves ----------
    let mut preuves: BTreeMap<String, String> = BTreeMap::new();
    for i in modele.non_traduites.keys() {
        preuves.insert(grille.preuves[*i].code.clone(), "non_evaluable".into());
    }
    for (cp, ev) in modele.contraintes.iter().zip(&evals) {
        let st = if s.depasse {
            "non_fermee"
        } else if prouvee {
            match ev {
                Eval::Ok => "verifiee",
                Eval::NonEvaluable => "non_evaluable",
                Eval::Echec => "echec",
                Eval::Inconnu => "non_evaluable",
            }
        } else if issue == "ambigue" {
            "indeterminee"
        } else {
            "non_fermee"
        };
        preuves.insert(grille.preuves[cp.preuve].code.clone(), st.into());
    }
    for (p, nn) in &modele.non_numeriques {
        let st = match nn {
            NonNumerique::Format { champ, format } => match (lus.get(champ), entree.pack.formats.get(format)) {
                (Some(v), Some(motif)) => {
                    if textuel::respecte(v, motif)? {
                        "verifiee"
                    } else {
                        "echec"
                    }
                }
                _ => "non_evaluable",
            },
            NonNumerique::Ordre { avant, apres } => match (lus.get(avant), lus.get(apres)) {
                (Some(a), Some(b)) => {
                    if a <= b {
                        "verifiee"
                    } else {
                        "echec"
                    }
                }
                _ => "non_evaluable",
            },
        };
        preuves.insert(grille.preuves[*p].code.clone(), st.into());
    }
    for (code, st) in statuts_parties {
        preuves.insert(code, st.into());
    }

    // ---------- L'anneau 1 : les lignes, sur la sortie du centre, sans la modifier ----------
    let mut sortie_lignes = None;
    for p in &grille.preuves {
        let Some(e) = p.expression.as_ref().filter(|e| e.get("op").and_then(|o| o.as_str()) == Some(lignes::OP)) else {
            continue;
        };
        if p.statut.as_deref() == Some("a_traduire") {
            continue;
        }
        let st = if sortie_lignes.is_some() {
            // une seule preuve de lignes par grille
            "non_evaluable"
        } else {
            match lignes::lire_op(grille, e) {
                Ok(op) => {
                    let (l, st) = lignes::prouver(&op, entree, &champs);
                    sortie_lignes = Some(l);
                    st
                }
                Err(_) => "non_evaluable",
            }
        };
        preuves.insert(p.code.clone(), st.into());
    }

    // ---------- Le total HT porte son libellé, ou les lignes le ferment ----------
    // Une preuve n'est retenue que si la valeur prise pour le total des bases (le HT) porte
    // son libellé — repères du champ, en base, sur le jeton ou dans la suite de purs mots juste
    // à sa gauche — ou si les lignes la ferment exactement. Décision du dirigeant (2 novembre
    // 2026) : zéro fausse preuve l'emporte sur les pièces gagnées. Sans elle :
    // - exonération totale (zéro instance) : le groupe ne contraint plus le HT, et HT + droits
    //   = TTC fermait sur le « Total TTC » pris pour le HT (100/B-15, tranches 0 % et 19 %,
    //   « 0,000 » et « exonérée » imprimés) ;
    // - deux taux sur un ticket, un chiffre du TTC mal lu : la base à 7 % passait pour le HT,
    //   et un montant d'article pour le TTC (50/05, OCR).
    // Exonération partielle, en plus : le reste, exonéré, n'est pas une base qu'un calcul de
    // taux prouve (le montant nul ferme n'importe quel zéro) ; les lignes seules l'établissent, chaque taux y valant sa base imprimée (`taux_par_base`).
    // Sinon la pièce n'est pas prouvée : rendue à la chaîne, valeurs gardées au statut signalé.
    // Un HT accepté par le seul libellé de la base, en attente des lettres (voir plus bas).
    let mut ht_par_la_base = false;
    if let (true, Some(e)) = (prouvee, unique) {
        // Les lignes lues sans cellule déduite ni remise globale, et dont la somme vaut `total`.
        let lignes_ferment = |total: i64, par_taux: bool| {
            sortie_lignes.as_ref().is_some_and(|l| {
                l.statut == "prouve"
                    && (!par_taux || l.taux_par_base == "verifiee")
                    && l.deduites.is_none()
                    && l.remise_globale.is_none()
                    && l.instances.iter().map(|x| x.montant.valeur.parse::<i64>().ok()).sum::<Option<i64>>() == Some(total)
            })
        };
        let mut refus: Option<&str> = None;
        for (g, gr) in modele.groupes.iter().enumerate() {
            let Some(sol) = e.g[g].as_ref() else { continue };
            let Some(t) = gr.total_base else { continue };
            let Some(ht) = e.s[t].filter(|v| !v.absent).map(|v| v.v) else { continue };
            let champ = modele.vars[t].champ;
            let ancre_par = |reperes: &[String]| {
                dom.valeurs.get(&ht).is_some_and(|x| {
                    x.occurrences.iter().any(|o| {
                        plan.libelle_avant(o.jeton, reperes)
                            || plan.ancre(o.jeton, reperes, None, true)
                            || plan.apparie(o.jeton, reperes)
                    })
                })
            };
            // À un seul taux, la base imprimée EST le total HT : une valeur imprimée sous le
            // libellé de la base (« Base TVA ») que base × taux = TVA vérifie peut tenir lieu
            // du libellé du HT (2 novembre 2026 : MyTek imprime « Total HT » timbre compris,
            // la base juste sous « Base TVA »). Jamais à zéro instance ni à plusieurs taux,
            // et jamais seule : il faut encore que le montant en lettres vérifie le total —
            // une seconde écriture de la pièce, indépendante des chiffres (plus bas).
            let base_seule = sol.instances.len() == 1 && sol.instances[0].b == Some(ht) && !sol.partielle;
            let ancre = ancre_par(&reperes[champ]);
            if sol.partielle && !lignes_ferment(ht, true) {
                refus = Some("exonération partielle non confirmée par les lignes");
            } else if !ancre && !lignes_ferment(ht, false) {
                if base_seule && ancre_par(&reperes[gr.champ_base]) {
                    ht_par_la_base = true;
                } else {
                    refus = Some("le total HT ne porte pas son libellé");
                }
            }
        }
        if let Some(r) = refus {
            ht_par_la_base = false;
            retirer_la_preuve(&mut prouvee, &mut issue, &mut raison, &mut champs, &numeriques, r);
            for (cp, ev) in modele.contraintes.iter().zip(&evals) {
                if *ev == Eval::Ok {
                    preuves.insert(grille.preuves[cp.preuve].code.clone(), "non_fermee".into());
                }
            }
        }
    }

    // ---------- L'anneau 3 : les champs nommés, que nulle preuve ne lit ----------
    entete::nommes(entree, &mut champs);

    // ---------- Les lettres : la seconde écriture du total ----------
    let mut contredite = false;
    for p in &grille.preuves {
        let Some(e) = p.expression.as_ref().filter(|e| e.get("op").and_then(|o| o.as_str()) == Some(lettres::OP)) else {
            continue;
        };
        if p.statut.as_deref() == Some("a_traduire") {
            continue;
        }
        let st = match lettres::lire_op(grille, e) {
            Ok(op) => {
                let valeur_prouvee = |c: usize| -> Option<i64> {
                    champs
                        .get(&grille.champs[c].code)
                        .filter(|x| x.statut == "prouve")
                        .and_then(|x| x.valeur.as_deref())
                        .and_then(|v| v.parse().ok())
                };
                let r = lettres::prouver(&op, entree, prouvee.then_some(&valeur_prouvee as &dyn Fn(usize) -> Option<i64>));
                if let Some(c) = r.champ {
                    champs.insert(grille.champs[op.champ].code.clone(), c);
                }
                r.statut
            }
            Err(_) => "non_evaluable",
        };
        contredite |= st == "echec";
        preuves.insert(p.code.clone(), st.into());
    }
    // Le HT pris sous le libellé de la base ne tient que si les lettres vérifient le total.
    let lettres_verifient = preuves.iter().any(|(code, st)| {
        st == "verifiee"
            && grille.preuves.iter().any(|p| {
                &p.code == code && p.expression.as_ref().and_then(|e| e.get("op")).and_then(|o| o.as_str()) == Some(lettres::OP)
            })
    });
    if ht_par_la_base && prouvee && !lettres_verifient {
        retirer_la_preuve(&mut prouvee, &mut issue, &mut raison, &mut champs, &numeriques, "le total HT ne porte pas son libellé");
        for (cp, ev) in modele.contraintes.iter().zip(&evals) {
            if *ev == Eval::Ok {
                preuves.insert(grille.preuves[cp.preuve].code.clone(), "non_fermee".into());
            }
        }
    }
    // Les chiffres ferment, les lettres les contredisent : la pièce n'est pas prouvée, elle
    // est signalée. Ses valeurs restent citées, au statut `signale`.
    if contredite && issue == "prouvee" {
        issue = "signalee".into();
        raison = Some("le montant en lettres contredit les chiffres".into());
        for c in champs.values_mut() {
            if c.statut == "prouve" {
                c.statut = "signale".into();
            }
        }
    }

    // ---------- L'identité du dossier : un seul rôle par pièce ----------
    identite::exclusive(entree, &mut champs);

    // ---------- Ce qu'aucun calcul ne prouve se lit avec assurance ----------
    // Hors de son ressort : ce que l'arithmétique prouve (les montants du centre), ce que les
    // chiffres confirment (le montant en lettres), et ce qu'un domaine fermé valide (une
    // valeur de liste n'est rendue qu'égale, forme pour forme, à un code de son domaine).
    let mut garantis: BTreeSet<&str> = modele.vars.iter().map(|v| grille.champs[v.champ].code.as_str()).collect();
    for p in grille.preuves.iter().filter(|p| p.statut.as_deref() != Some("a_traduire")) {
        if let Some(op) = p
            .expression
            .as_ref()
            .filter(|e| e.get("op").and_then(|o| o.as_str()) == Some(lettres::OP))
            .and_then(|e| lettres::lire_op(grille, e).ok())
        {
            garantis.insert(grille.champs[op.champ].code.as_str());
        }
    }
    garantis.extend(grille.champs.iter().filter(|c| !c.valeurs.is_empty()).map(|c| c.code.as_str()));
    identite::assurance(entree, &mut champs, &garantis);

    Ok(Sortie {
        issue,
        solutions: retenues.len(),
        champs,
        preuves,
        combinaisons: s.combinaisons,
        raison,
        lignes: sortie_lignes,
        parties: sortie_parties,
        par_lettres: None,
    })
}

/// Une preuve retirée : la pièce rendue à la chaîne, ses valeurs gardées au statut signalé.
/// La preuve arithmétique retirée : ses champs (`numeriques`) passent de prouvés à signalés.
/// Ceux que l'anneau 2 a établis par l'identité (les matricules des parties) ne dépendent
/// pas d'elle et restent : sinon l'en-tête changerait avec la variante de la grille.
fn retirer_la_preuve(
    prouvee: &mut bool,
    issue: &mut String,
    raison: &mut Option<String>,
    champs: &mut BTreeMap<String, ChampSortie>,
    numeriques: &BTreeSet<String>,
    r: &str,
) {
    *prouvee = false;
    *issue = "aucune".into();
    *raison = Some(r.into());
    for (code, c) in champs.iter_mut() {
        if c.statut == "prouve" && numeriques.contains(code) {
            c.statut = "signale".into();
        }
    }
}

/// Exports WebAssembly, sans wasm-bindgen : l'hôte alloue, écrit l'entrée,
/// appelle `solve_json`, lit la sortie (pointeur << 32 | longueur), puis libère.
#[cfg(target_arch = "wasm32")]
mod wasm {
    use std::alloc::{alloc as sys_alloc, dealloc as sys_dealloc, Layout};

    #[no_mangle]
    pub extern "C" fn alloc(len: usize) -> *mut u8 {
        if len == 0 {
            return core::ptr::NonNull::<u8>::dangling().as_ptr();
        }
        match Layout::from_size_align(len, 1) {
            Ok(l) => unsafe { sys_alloc(l) },
            Err(_) => core::ptr::null_mut(),
        }
    }

    /// # Safety
    /// `ptr` doit venir de `alloc(len)` ou de `solve_json`, avec la même longueur.
    #[no_mangle]
    pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
        if len == 0 || ptr.is_null() {
            return;
        }
        if let Ok(l) = Layout::from_size_align(len, 1) {
            sys_dealloc(ptr, l);
        }
    }

    /// # Safety
    /// `ptr` doit désigner `len` octets lisibles (l'entrée JSON en UTF-8).
    #[no_mangle]
    pub unsafe extern "C" fn solve_json(ptr: *const u8, len: usize) -> u64 {
        let octets = if len == 0 { &[][..] } else { core::slice::from_raw_parts(ptr, len) };
        let sortie = match core::str::from_utf8(octets) {
            Ok(s) => crate::solve(s),
            Err(_) => crate::erreur("entrée non UTF-8".into()),
        };
        let b = sortie.as_bytes();
        let p = alloc(b.len());
        if p.is_null() {
            return 0;
        }
        if !b.is_empty() {
            core::ptr::copy_nonoverlapping(b.as_ptr(), p, b.len());
        }
        ((p as u32 as u64) << 32) | (b.len() as u32 as u64)
    }
}
