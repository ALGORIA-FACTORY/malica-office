//! Les colonnes de texte d'un tableau, déduites de son en-tête et des rangées prouvées.
//!
//! Une rangée prouvée (q × p = m, la somme qui ferme le total) fixe ses colonnes de
//! CHIFFRES ; ses colonnes de TEXTE — référence, code-barres, désignation, unité — ne
//! se séparent par aucun trait, et la désignation avalait tout ce qui précède la
//! quantité (« ECR-24IPS 6198052301238 Écran 24 pouces IPS », 300 désignations fausses
//! au banc sans IA du 4 novembre 2026).
//!
//! L'en-tête du tableau dit les colonnes. C'est la rangée, juste au-dessus de la
//! première rangée prouvée, qui porte au moins deux repères des champs de la parcelle
//! des lignes (`ref.grille_champs`, rien n'est écrit ici). Ses intitulés sont
//! coupés en cellules à leurs blancs, dans l'ordre de la page ; une cellule qu'aucun
//! repère ne nomme (« Code à Barre ») reste une colonne — elle borne ses voisines.
//! L'en-tête NOMME les colonnes ; les rangées les PLACENT : la frontière entre deux
//! cellules est le plus large couloir blanc que toutes les rangées prouvées laissent
//! entre elles (un intitulé centré ou débordant ne déplace pas la colonne), à défaut le
//! milieu de l'écart entre les deux intitulés. Une désignation n'est rendue que faite des jetons
//! de sa rangée qui tombent dans SA colonne, d'un côté ou de l'autre des chiffres (un
//! tableau arabe la porte à droite). Sans en-tête lisible, rien ne change ; une colonne
//! vide rend une désignation absente — jamais celle d'une autre colonne.

use std::collections::BTreeMap;

use super::{en_lignes, Cite, LigneSortie};
use crate::entree::{Grille, Jeton};
use crate::reperes::normaliser;
use crate::RefJeton;

/// L'écart, en hauteurs de jeton, au-delà duquel deux intitulés sont deux cellules.
const ECART_CELLULE: f64 = 1.2;
/// Un blanc et un mot de deux signes : la place qu'un mot coupé à l'impression aurait prise.
const SIGNES_D_UN_MOT_COUPE: f64 = 3.0;
/// La rangée d'en-tête est au plus à tant de hauteurs au-dessus de la première ligne.
const EN_TETE_MAX: f64 = 6.0;

fn cle(s: &str) -> String {
    normaliser(s).chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Une cellule de l'en-tête : son étendue, et le champ dont un repère l'égale.
struct Cellule {
    x0: f64,
    x1: f64,
    champ: Option<usize>,
}

pub fn affiner(
    instances: &mut [LigneSortie],
    jetons: &[Jeton],
    rangs: &[Vec<usize>],
    grille: &Grille,
    designation: &str,
) {
    let Some(d) = grille.champs.iter().position(|c| c.code == designation) else { return };
    let Some(parcelle) = grille.champs[d].parcelle.as_deref() else { return };
    let autres = super::autres_champs(designation, grille);
    // Les repères de la parcelle des lignes, par champ.
    let reperes: Vec<(usize, String)> = grille
        .champs
        .iter()
        .enumerate()
        .filter(|(_, c)| c.parcelle.as_deref() == Some(parcelle))
        .flat_map(|(k, c)| c.reperes_fr.iter().chain(c.reperes_ar.iter()).map(move |r| (k, cle(r))))
        .filter(|(_, r)| !r.is_empty())
        .collect();
    let par_ref: BTreeMap<(u32, u32), usize> =
        jetons.iter().enumerate().map(|(i, j)| ((j.page, j.ordinal), i)).collect();
    let jeton_de = |r: &RefJeton| par_ref.get(&(r.page, r.ordinal)).copied();
    // Le jeton qui situe une ligne : une cellule lue (une cellule déduite n'en a pas).
    let ancre = |l: &LigneSortie| [Some(&l.montant), l.prix.as_ref(), l.quantite.as_ref()].into_iter().flatten().find_map(|c| c.refs.first().and_then(jeton_de));
    let rang_de: BTreeMap<usize, usize> = rangs.iter().enumerate().flat_map(|(n, r)| r.iter().map(move |&i| (i, n))).collect();

    // La première rangée prouvée, et l'en-tête au-dessus d'elle.
    let Some(premiere) = instances.iter().filter_map(&ancre).filter_map(|i| rang_de.get(&i).copied()).min()
    else {
        return;
    };
    let h = {
        let j = &jetons[rangs[premiere][0]];
        (j.y1 - j.y0).max(f64::EPSILON)
    };
    let Some(cellules) = (0..premiere).rev().take_while(|&n| {
        let (a, b) = (&jetons[rangs[n][0]], &jetons[rangs[premiere][0]]);
        a.page == b.page && b.y0 - a.y0 <= EN_TETE_MAX * h
    })
    .find_map(|n| en_tete(&rangs[n], jetons, &reperes, h))
    else {
        taire_les_coupees(instances, jetons, rangs, grille, h, &jeton_de, &rang_de);
        return;
    };
    let Some(k) = cellules.iter().position(|c| c.champ == Some(d)) else {
        taire_les_coupees(instances, jetons, rangs, grille, h, &jeton_de, &rang_de);
        return;
    };
    // Les jetons des rangées prouvées : ce sont eux qui placent les frontières.
    let lignes: Vec<usize> = instances
        .iter()
        .filter_map(&ancre)
        .filter_map(|i| rang_de.get(&i).copied())
        .flat_map(|n| rangs[n].iter().copied())
        .collect();
    let frontiere = |a: &Cellule, b: &Cellule| couloir(&lignes, jetons, a.x0, b.x1).unwrap_or((a.x1 + b.x0) / 2.0);
    // La première (dernière) colonne n'a pas de voisine : sa frontière extérieure est le plus
    // large couloir blanc entre le bord de la page et son intitulé — la marge, ou le blanc qui
    // sépare le tableau d'un bloc posé à côté (« MATRICULE FISCAL » d'une colonne latérale).
    let gauche = if k == 0 {
        couloir(&lignes, jetons, 0.0, cellules[k].x1).unwrap_or(f64::MIN)
    } else {
        frontiere(&cellules[k - 1], &cellules[k])
    };
    let droite = if k + 1 == cellules.len() {
        couloir(&lignes, jetons, cellules[k].x0, 1.0).unwrap_or(f64::MAX)
    } else {
        frontiere(&cellules[k], &cellules[k + 1])
    };

    let rangs_des_lignes: Vec<usize> = instances
        .iter()
        .filter_map(|l| ancre(l).and_then(|i| rang_de.get(&i).copied()))
        .collect();
    let dedans = |i: usize| {
        let j = &jetons[i];
        let centre = (j.x0 + j.x1) / 2.0;
        centre >= gauche && centre < droite
    };
    // Le bord droit effectif de la colonne : le plus loin qu'un texte y va, sur les lignes.
    let bord = lignes.iter().filter(|&&i| dedans(i)).map(|&i| jetons[i].x1).fold(f64::MIN, f64::max);
    let debut = lignes.iter().filter(|&&i| dedans(i)).map(|&i| jetons[i].x0).fold(f64::MAX, f64::min);
    let chiffres_de = |l: &LigneSortie| -> Vec<usize> {
        [l.quantite.as_ref(), l.prix.as_ref(), Some(&l.montant), l.remise.as_ref()]
            .into_iter()
            .flatten()
            .flat_map(|c| c.refs.iter().filter_map(jeton_de))
            .collect()
    };
    // une rangée qui porte une étiquette (« SN: ») ou un numéro est une autre information ;
    // un numéro est fait de chiffres (« 322911304202613 », « SN12345678 ») — une
    // référence d'article qui en mêle (« 65ML L3110 ») reste de la désignation
    // — un MONTANT, lui, a ses séparateurs (« 28 000,000 ») : cité dans la désignation
    // (« selon devis … de 28 000,000 DT HT »), il en est la suite, pas un numéro
    let autre_information = |r: &[usize]| {
        r.iter().any(|&i| {
            let t = jetons[i].texte.trim();
            let chiffres = t.chars().filter(|c| c.is_ascii_digit()).count();
            let signes = t.chars().filter(|c| c.is_alphanumeric()).count();
            let montant = t.contains([',', '.']) && !jetons[i].montants.is_empty();
            t.ends_with(':') || chiffres >= 6 && 5 * chiffres >= 4 * signes && !montant
        })
    };
    let etendue = |ids: &mut dyn Iterator<Item = usize>| {
        ids.fold((f64::MAX, f64::MIN), |(a, b), i| (a.min(jetons[i].y0), b.max(jetons[i].y1)))
    };
    // Le tableau s'étend de la marge de sa première colonne à celle de sa dernière.
    let (tableau_g, tableau_d) = (
        couloir(&lignes, jetons, 0.0, cellules[0].x1).unwrap_or(f64::MIN),
        cellules.last().and_then(|c| couloir(&lignes, jetons, c.x0, 1.0)).unwrap_or(f64::MAX),
    );
    let dans_le_tableau = |i: usize| {
        let centre = (jetons[i].x0 + jetons[i].x1) / 2.0;
        centre >= tableau_g && centre < tableau_d
    };
    // La part d'une rangée qui tombe dans la colonne, quand tout ce qu'elle porte DANS le
    // tableau y tombe : un bloc posé à côté du tableau (« MATRICULE FISCAL », colonne
    // latérale) que la rangée recouvre n'en est pas ; une autre cellule du tableau (« Montant
    // TVA TOTAL ») fait de la rangée autre chose qu'une suite.
    let dans_la_colonne = |r: &[usize]| -> Vec<usize> {
        if r.iter().any(|&i| dans_le_tableau(i) && !dedans(i)) {
            return Vec::new();
        }
        r.iter().copied().filter(|&i| dedans(i)).collect()
    };
    // La suite d'une désignation COUPÉE en fin de ligne : seulement si la ligne touche le
    // bord de sa colonne (le texte a manqué de place), les rangées suivantes, serrées,
    // dont des jetons tombent dans la colonne — et qui ne sont pas des lignes. Une ligne
    // courte suivie d'un numéro de série (« S N : 7645… ») n'est pas coupée.
    let coupee = |r: &[usize]| {
        let fin = r.iter().map(|&i| jetons[i].x1).fold(f64::MIN, f64::max);
        let ici = r.iter().map(|&i| jetons[i].x0).fold(f64::MAX, f64::min);
        !r.is_empty() && (fin >= bord - 0.15 * (bord - debut) || ici <= debut + 0.15 * (bord - debut) && r.iter().any(|&i| crate::reperes::droite_a_gauche(&jetons[i].texte)))
    };
    // Les rangées de la suite d'une ligne dont `derniere` est la dernière ligne de texte,
    // à partir de la rangée `m`, hors des rangées `exclues`.
    let suite = |mut m: usize, mut derniere: Vec<usize>, exclues: &[usize]| -> Vec<usize> {
        let mut prises = Vec::new();
        while m < rangs.len() && coupee(&derniere) && !rangs_des_lignes.contains(&m) && !exclues.contains(&m) {
            let dans = dans_la_colonne(&rangs[m]);
            // serrée : l'écart se mesure entre les textes de la colonne, pas entre les blocs
            // voisins que les rangées recouvrent
            let serree = || {
                let (_, fin) = etendue(&mut derniere.iter().copied());
                let (haut, _) = etendue(&mut dans.iter().copied());
                jetons[derniere[0]].page == jetons[dans[0]].page && haut - fin <= 0.8 * h
            };
            if dans.is_empty() || autre_information(&dans) || !serree() {
                break;
            }
            derniere = en_lignes(jetons, &dans).pop().unwrap_or_default();
            prises.push(m);
            m += 1;
        }
        prises
    };

    // La tête d'une désignation sur plusieurs lignes : un tableau CENTRE ses chiffres sur la
    // cellule, et la première ligne du texte monte au-dessus de la rangée des chiffres. Une
    // rangée de texte juste au-dessus, toute dans la colonne, en est la tête quand elle
    // rapproche le milieu du texte du milieu des chiffres — un tableau qui aligne ses
    // chiffres sur la première ligne ne la prend pas (son milieu s'en éloignerait).
    let tetes: BTreeMap<usize, Vec<usize>> = instances
        .iter()
        .filter_map(|l| {
            let n = ancre(l).and_then(|i| rang_de.get(&i).copied())?;
            let chiffres = chiffres_de(l);
            let (c0, c1) = etendue(&mut chiffres.iter().copied());
            let milieu_chiffres = (c0 + c1) / 2.0;
            let texte: Vec<usize> = rangs[n].iter().copied().filter(|i| !chiffres.contains(i) && dedans(*i)).collect();
            let (mut t0, mut t1) = if texte.is_empty() { (c0, c1) } else { etendue(&mut texte.iter().copied()) };
            // le milieu du texte compte sa suite sous la rangée (une cellule de trois lignes,
            // les chiffres sur celle du milieu)
            let derniere = en_lignes(jetons, &texte).pop().unwrap_or_default();
            for m in suite(n + 1, derniere, &[]) {
                t1 = t1.max(etendue(&mut dans_la_colonne(&rangs[m]).into_iter()).1);
            }
            let mut prises = Vec::new();
            let mut m = n;
            while m > 0 {
                m -= 1;
                let r = &rangs[m];
                let (r0, r1) = etendue(&mut r.iter().copied());
                let proche = jetons[r[0]].page == jetons[rangs[n][0]].page && t0 - r1 <= 0.8 * h;
                let mieux = ((r0 + t1) / 2.0 - milieu_chiffres).abs() < ((t0 + t1) / 2.0 - milieu_chiffres).abs();
                if !proche || !mieux || rangs_des_lignes.contains(&m) || autre_information(r) || !r.iter().all(|&i| dedans(i)) {
                    break;
                }
                prises.push(m);
                t0 = r0;
            }
            (!prises.is_empty()).then_some((n, prises))
        })
        .collect();
    let prises_en_tete: Vec<usize> = tetes.values().flatten().copied().collect();

    for l in instances.iter_mut() {
        let Some(n) = ancre(l).and_then(|i| rang_de.get(&i).copied()) else { continue };
        let chiffres = chiffres_de(l);
        let mut lignes_de_texte: Vec<Vec<usize>> = tetes
            .get(&n)
            .map(|t| t.iter().rev().flat_map(|&m| en_lignes(jetons, &rangs[m])).collect())
            .unwrap_or_default();
        let texte: Vec<usize> = rangs[n].iter().copied().filter(|i| !chiffres.contains(i)).filter(|&i| dedans(i)).collect();
        if texte.is_empty() {
            lignes_de_texte.push(texte);
        } else {
            lignes_de_texte.extend(en_lignes(jetons, &texte));
        }
        let derniere = lignes_de_texte.last().cloned().unwrap_or_default();
        for m in suite(n + 1, derniere, &prises_en_tete) {
            lignes_de_texte.extend(en_lignes(jetons, &dans_la_colonne(&rangs[m])));
        }
        // Un texte qui bute sur la colonne suivante a pu être COUPÉ à l'impression (la cellule
        // trop étroite) : « Contrat d'entretien climatisation - se », sous l'intitulé QTÉ.
        // Ce qui est imprimé n'est pas la désignation entière : elle se tait.
        // Sur la DERNIÈRE ligne de la cellule, la marge se compte aussi en caractères : un mot
        // entier coupé (« A4 », 50/45, ticket à chasse fixe) laisse moins de place qu'un blanc et
        // deux signes avant la colonne. Une ligne qui en suit une autre est un retour à la
        // ligne, pas une coupe.
        let derniere = lignes_de_texte.iter().rev().find(|l| !l.is_empty());
        let coupe_par_la_colonne = cellules.get(k + 1).is_some_and(|suivante| {
            lignes_de_texte.iter().flatten().any(|&i| jetons[i].x1 >= suivante.x0 - h)
                || derniere.is_some_and(|l| {
                    l.iter().any(|&i| {
                        let j = &jetons[i];
                        let signe = (j.x1 - j.x0) / j.texte.chars().count().max(1) as f64;
                        j.x1 >= suivante.x0 - SIGNES_D_UN_MOT_COUPE * signe
                    })
                })
        });
        if coupe_par_la_colonne {
            l.designation = None;
            continue;
        }
        // chaque ligne est déjà dans son ordre de lecture (`en_lignes`) ; une ligne qui ouvre
        // un autre champ de la parcelle (le numéro de série) n'est pas la désignation
        let pris: Vec<usize> =
            lignes_de_texte.into_iter().filter(|l| !super::ouvre_un_autre_champ(jetons, l, &autres)).flatten().collect();
        let remise = l.remise.as_ref().and_then(|c| c.refs.first()).and_then(jeton_de);
        let pris = super::sans_la_remise(&pris, remise, jetons);
        l.designation = (!pris.is_empty()).then(|| {
            Cite::lue(
                pris.iter().map(|&i| jetons[i].texte.trim()).collect::<Vec<_>>().join(" "),
                pris.iter().map(|&i| RefJeton { page: jetons[i].page, ordinal: jetons[i].ordinal }).collect(),
            )
        });
    }
}

/// Sans en-tête, la colonne de la désignation n'est pas connue : sa suite à la ligne d'après
/// ne se distingue pas d'un autre texte. Une rangée serrée sous la ligne, qui n'est pas une
/// ligne, dont des jetons tombent sous la désignation et qui ne commence pas par un libellé
/// de la grille (« Total HT »), peut en être la suite : la désignation n'est pas prouvée
/// entière, elle se tait. Banc sans IA du 4 novembre 2026, 50/32 : « Acompte 30 % —
/// Développement application mobile Malica » rendue sans « (Android) selon devis
/// DV-2026-007 de 28 000,000 DT HT », sa seconde ligne.
fn taire_les_coupees(
    instances: &mut [LigneSortie],
    jetons: &[Jeton],
    rangs: &[Vec<usize>],
    grille: &Grille,
    h: f64,
    jeton_de: &dyn Fn(&RefJeton) -> Option<usize>,
    rang_de: &BTreeMap<usize, usize>,
) {
    let libelles: Vec<String> = grille
        .champs
        .iter()
        .flat_map(|c| c.reperes_fr.iter().chain(c.reperes_ar.iter()))
        .map(|r| cle(r))
        .filter(|r| r.chars().count() >= 2)
        .collect();
    let rang_d = |l: &LigneSortie| {
        [Some(&l.montant), l.prix.as_ref(), l.quantite.as_ref()].into_iter().flatten().find_map(|c| c.refs.first().and_then(jeton_de)).and_then(|i| rang_de.get(&i).copied())
    };
    let lignes: Vec<usize> = instances.iter().filter_map(rang_d).collect();
    for l in instances.iter_mut() {
        let (Some(n), Some(d)) = (rang_d(l), l.designation.as_ref()) else { continue };
        let ids: Vec<usize> = d.refs.iter().filter_map(jeton_de).collect();
        let (Some(&premier), Some(r)) = (ids.first(), rangs.get(n + 1)) else { continue };
        if lignes.contains(&(n + 1)) {
            continue;
        }
        let x0 = ids.iter().map(|&i| jetons[i].x0).fold(f64::MAX, f64::min);
        let x1 = ids.iter().map(|&i| jetons[i].x1).fold(f64::MIN, f64::max);
        let bas = ids.iter().map(|&i| jetons[i].y1).fold(f64::MIN, f64::max);
        let dessous: Vec<usize> = r.iter().copied().filter(|&i| jetons[i].x1 > x0 && jetons[i].x0 < x1).collect();
        let Some(haut) = dessous.iter().map(|&i| jetons[i].y0).reduce(f64::min) else { continue };
        let texte = cle(&dessous.iter().map(|&i| jetons[i].texte.as_str()).collect::<Vec<_>>().join(" "));
        let libelle = libelles.iter().any(|x| texte.starts_with(x.as_str()));
        if jetons[r[0]].page == jetons[premier].page && haut - bas <= 0.8 * h && !libelle {
            l.designation = None;
        }
    }
}

/// Le milieu du plus large couloir que les jetons laissent libre entre `debut` et `fin`,
/// sur toutes les rangées à la fois.
fn couloir(lignes: &[usize], jetons: &[Jeton], debut: f64, fin: f64) -> Option<f64> {
    let mut pleins: Vec<(f64, f64)> = lignes
        .iter()
        .map(|&i| (jetons[i].x0, jetons[i].x1))
        .filter(|(a, b)| *b > debut && *a < fin)
        .collect();
    pleins.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut meilleur: Option<(f64, f64)> = None;
    let mut bord = debut;
    for (a, b) in pleins {
        if a > bord && meilleur.is_none_or(|(x, y)| a - bord > y - x) {
            meilleur = Some((bord, a));
        }
        bord = bord.max(b);
    }
    if fin > bord && meilleur.is_none_or(|(x, y)| fin - bord > y - x) {
        meilleur = Some((bord, fin));
    }
    meilleur.filter(|(x, y)| y > x).map(|(x, y)| (x + y) / 2.0)
}

/// Les cellules d'une rangée d'en-tête, si au moins deux d'entre elles sont nommées par
/// les repères des lignes.
fn en_tete(rang: &[usize], jetons: &[Jeton], reperes: &[(usize, String)], h: f64) -> Option<Vec<Cellule>> {
    let mut groupes: Vec<Vec<usize>> = Vec::new();
    for &i in rang {
        match groupes.last_mut() {
            Some(g) if jetons[i].x0 - jetons[*g.last()?].x1 <= ECART_CELLULE * h => g.push(i),
            _ => groupes.push(vec![i]),
        }
    }
    let cellules: Vec<Cellule> = groupes
        .iter()
        .map(|g| {
            let texte: String = g.iter().map(|&i| cle(&jetons[i].texte)).collect();
            // le plus long repère égal à la cellule, ou à son début (« Désignation article »)
            let champ = reperes
                .iter()
                .filter(|(_, r)| texte == *r || (r.chars().count() >= 3 && texte.starts_with(r.as_str())))
                .max_by_key(|(_, r)| r.len())
                .map(|(k, _)| *k);
            Cellule {
                x0: g.iter().map(|&i| jetons[i].x0).fold(f64::MAX, f64::min),
                x1: g.iter().map(|&i| jetons[i].x1).fold(f64::MIN, f64::max),
                champ,
            }
        })
        .collect();
    (cellules.iter().filter(|c| c.champ.is_some()).count() >= 2).then_some(cellules)
}
