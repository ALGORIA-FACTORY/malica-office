/**
 * Les parties et les articles du jeu d'ALGORIA.
 *
 * ================================================================ LES PARTIES
 *
 * Une seule partie est réelle, à la demande du dirigeant : ALGORIA FACTORY
 * SARL, la société du staging, et son matricule fiscal. Elle est le CLIENT de
 * chaque achat et l'ÉMETTEUR de chaque vente. Tout le reste est inventé : ses
 * adresse, téléphone, RC et RIB sur ces pages, et chaque fournisseur, client,
 * banque, enseigne, adresse et numéro. Les noms sont faits de mots rares pour
 * ne ressembler à aucune enseigne ; les téléphones commencent par « 00 »,
 * préfixe qu'aucun abonné tunisien ne porte ; les banques ont le code « 99 »,
 * qu'aucune banque tunisienne ne porte (INCERTAIN : la liste des codes n'a pas
 * été relue — à vérifier dans la nomenclature de la BCT).
 *
 * ============================================================== LES ARTICLES
 *
 * `code` : le code de taux du référentiel (TVA19, TVA13, TVA07, EXO, EXPORT) ;
 * le taux lui-même se lit au référentiel, jamais ici (R4). `nature` : ce que
 * l'article EST quand ALGORIA le vend (705, 706, 707 du référentiel). Le taux
 * de chaque article est un CHOIX DU BANC, comme dans le jeu synthétique —
 * INCERTAIN pour la réalité (livres à 7 % notamment).
 */

/** ALGORIA FACTORY SARL : le nom et le matricule sont réels, le reste inventé. */
export const ALGORIA = {
  nom: "ALGORIA FACTORY SARL",
  nomAr: "شركة ألغوريا فاكتوري ش.ذ.م.م",
  matricule: "1958330V/A/M/000",
  forme: "SARL au capital de 50 000 DT",
  rue: ["14, rue des Cyprès", "14، نهج السرو"],
  ville: ["1053 Les Berges du Lac, Tunis", "1053 ضفاف البحيرة، تونس"],
  telephone: "00 71 940 517",
  email: "facturation@algoria-factory.example",
  rc: "B01283932024",
  banque: "Banque Ouzrane de Développement",
  rib: "99 017 0001834526710 54",
};

/*
 * Les enseignes de détail (gabarit A) : magasins d'informatique inventés, avec
 * un mot-symbole dessiné en lettres (aucun logo réel).
 */
export const ENSEIGNES = [
  {
    nom: "TIXORA INFORMATIQUE",
    raison: "Tixora Informatique SARL",
    slogan: "matériel & solutions",
    couleur: "#0b5aa6",
    rue: "Route de la Marsa, km 9, résidence Ennour",
    ville: "2046 Sidi Daoud",
    site: "www.tixora-info.example",
    email: "service.client@tixora-info.example",
    magasin: "01",
  },
  {
    nom: "VALMERA TECH",
    raison: "Valmera Tech SA",
    slogan: "high-tech pour tous",
    couleur: "#c0392b",
    rue: "Avenue de l'Environnement, immeuble Yasmine, 3e étage",
    ville: "4051 Sahloul",
    site: "www.valmera-tech.example",
    email: "commandes@valmera-tech.example",
    magasin: "07",
  },
  {
    nom: "KORDANE DIGITAL",
    raison: "Kordane Digital SUARL",
    slogan: "votre partenaire numérique",
    couleur: "#1e7f4f",
    rue: "Rue Ibn Khaldoun, centre Zitouna, local B12",
    ville: "3027 Sfax El Jadida",
    site: "www.kordane-digital.example",
    email: "contact@kordane-digital.example",
    magasin: "03",
  },
  {
    nom: "SIRVANE STORE",
    raison: "Sirvane Store SARL",
    slogan: "informatique · bureautique · réseau",
    couleur: "#6b2fa0",
    rue: "Zone commerciale Ezzahra, bloc C",
    ville: "2034 Ezzahra",
    site: "www.sirvane-store.example",
    email: "vente@sirvane-store.example",
    magasin: "12",
  },
];

/** Les fournisseurs des gabarits B à F : sociétés inventées, deux langues. */
export const FOURNISSEURS = [
  {
    fr: "Qalmira Fournitures SARL",
    ar: "شركة قلميرة للوازم",
    ville: "Mégrine",
    villeAr: "مقرين",
    industriel: false,
  },
  {
    fr: "Tazrane Climatisation SUARL",
    ar: "تازران للتكييف",
    ville: "Ben Arous",
    villeAr: "بن عروس",
    industriel: false,
  },
  {
    fr: "Ouzdira Câblerie SA",
    ar: "شركة وزديرة للكوابل",
    ville: "Menzel Bourguiba",
    villeAr: "منزل بورقيبة",
    industriel: true,
  },
  {
    fr: "Belmira Traiteur SARL",
    ar: "بلميرة للمرطبات",
    ville: "El Menzah",
    villeAr: "المنزه",
    industriel: false,
  },
  {
    fr: "Kessarine Transports SARL",
    ar: "قصارين للنقل",
    ville: "Radès",
    villeAr: "رادس",
    industriel: false,
  },
  {
    fr: "Sidmara Plasturgie SA",
    ar: "سيدمارة للبلاستيك",
    ville: "Sousse",
    villeAr: "سوسة",
    industriel: true,
  },
  {
    fr: "Imprimerie Darvane",
    ar: "مطبعة دارفان",
    ville: "Ariana",
    villeAr: "أريانة",
    industriel: true,
  },
  {
    fr: "Zennara Hôtels SA",
    ar: "شركة زنارة للنزل",
    ville: "Hammamet",
    villeAr: "الحمامات",
    industriel: false,
  },
  {
    fr: "Centre Felmane de Formation",
    ar: "مركز فلمان للتكوين",
    ville: "Tunis",
    villeAr: "تونس",
    industriel: false,
  },
  {
    fr: "Orvane Électricité SARL",
    ar: "أورفان للكهرباء",
    ville: "Nabeul",
    villeAr: "نابل",
    industriel: true,
  },
];

/** Les clients des ventes : sociétés inventées. */
export const CLIENTS = [
  {
    fr: "Groupe Medrane Distribution SA",
    ar: "مجمع مدران للتوزيع",
    ville: "Sfax",
    villeAr: "صفاقس",
  },
  { fr: "Clinique Tarvila SARL", ar: "مصحة تارفيلا", ville: "Monastir", villeAr: "المنستير" },
  { fr: "Assurances Kelmoun SA", ar: "تأمينات كلمون", ville: "Tunis", villeAr: "تونس" },
  { fr: "Banque Rezvane d'Essai", ar: "بنك رزفان التجريبي", ville: "La Marsa", villeAr: "المرسى" },
  { fr: "Cabinet Ghorvane Audit", ar: "مكتب غرفان للتدقيق", ville: "Ariana", villeAr: "أريانة" },
  { fr: "Société Ilmara Agro SARL", ar: "شركة إلمارا للفلاحة", ville: "Béja", villeAr: "باجة" },
  { fr: "Ravelune Systems Ltd", ar: "رافلون سيستمز", ville: "Valletta", villeAr: "فاليتا" },
];

export const RUES = [
  ["rue des Mimosas", "نهج الميموزا"],
  ["avenue de la Liberté", "شارع الحرية"],
  ["rue du Lac Ourmi", "نهج بحيرة أورمي"],
  ["zone industrielle, lot", "المنطقة الصناعية، مقسم"],
  ["rue de l'Artisanat", "نهج الصناعات التقليدية"],
];

/** Les banques des RIB : inventées, code « 99 ». */
export const BANQUES = ["Banque Talmira", "Banque Ouzrane de Développement", "Crédit Selvane"];

/** Les prénoms et noms des vendeurs (« Chargé(e) ») : des assemblages inventés. */
export const VENDEURS = [
  "Sirine Ouarda",
  "Hedi Belkhouja",
  "Mayssa Trabelsa",
  "Karim Dhouibi",
  "Ines Ghazouane",
  "Yassine Mrabta",
];

/** Le rayon d'un magasin d'informatique (gabarit A) : prix TTC, en dinars. */
export const RAYON = [
  { ref: "USB64-K32", fr: "Clé USB 3.2 64 Go", code: "TVA19", ttc: [18, 39], serie: false },
  { ref: "SOU-WL220", fr: "Souris optique sans fil", code: "TVA19", ttc: [25, 69], serie: false },
  { ref: "CLV-AZ105", fr: "Clavier AZERTY USB", code: "TVA19", ttc: [29, 79], serie: false },
  { ref: "HDMI-18M", fr: "Câble HDMI 2.0 1,8 m", code: "TVA19", ttc: [12, 32], serie: false },
  { ref: "SSD-NV1T", fr: "Disque SSD NVMe 1 To", code: "TVA19", ttc: [189, 349], serie: true },
  {
    ref: "RAM-D4-16",
    fr: "Barrette mémoire DDR4 16 Go",
    code: "TVA19",
    ttc: [99, 179],
    serie: true,
  },
  { ref: "ECR-24IPS", fr: "Écran 24 pouces IPS", code: "TVA19", ttc: [389, 629], serie: true },
  { ref: "CSQ-F300", fr: "Casque audio filaire", code: "TVA19", ttc: [35, 119], serie: false },
  { ref: "WCM-1080", fr: "Webcam HD 1080p", code: "TVA19", ttc: [79, 189], serie: true },
  { ref: "HUB-C7P", fr: "Hub USB-C 7 ports", code: "TVA19", ttc: [69, 149], serie: false },
  { ref: "CHG-C65W", fr: "Chargeur USB-C 65 W", code: "TVA19", ttc: [59, 139], serie: false },
  {
    ref: "MPR-5PF",
    fr: "Multiprise parafoudre 5 prises",
    code: "TVA19",
    ttc: [29, 65],
    serie: false,
  },
  { ref: "OND-850VA", fr: "Onduleur 850 VA", code: "TVA19", ttc: [249, 419], serie: true },
  { ref: "PAP-A4-80", fr: "Ramette papier A4 80 g", code: "TVA19", ttc: [11, 17], serie: false },
  { ref: "TNR-N26A", fr: "Cartouche toner noir", code: "TVA19", ttc: [129, 289], serie: false },
  { ref: "SAC-156", fr: "Sacoche 15,6 pouces", code: "TVA19", ttc: [39, 99], serie: false },
  { ref: "TPS-XL", fr: "Tapis de souris XL", code: "TVA19", ttc: [15, 45], serie: false },
  {
    ref: "ADP-C-RJ45",
    fr: "Adaptateur USB-C vers RJ45",
    code: "TVA19",
    ttc: [39, 85],
    serie: false,
  },
  { ref: "RTR-AX18", fr: "Routeur Wi-Fi 6 AX1800", code: "TVA19", ttc: [179, 329], serie: true },
  { ref: "SWT-8G", fr: "Switch 8 ports Gigabit", code: "TVA19", ttc: [89, 169], serie: true },
  { ref: "CBL-C6-3M", fr: "Câble réseau Cat6 3 m", code: "TVA19", ttc: [6, 15], serie: false },
  { ref: "PIL-AA4", fr: "Piles alcalines AA, lot de 4", code: "TVA19", ttc: [7, 16], serie: false },
  { ref: "SUP-ECR2", fr: "Support double écran", code: "TVA19", ttc: [119, 239], serie: false },
  {
    ref: "LIV-ALGO",
    fr: "Livre « Algorithmique en pratique »",
    code: "TVA07",
    ttc: [45, 89],
    serie: false,
  },
  {
    ref: "LIV-RES",
    fr: "Livre « Réseaux, la référence »",
    code: "TVA07",
    ttc: [55, 95],
    serie: false,
  },
  {
    ref: "REV-TEC",
    fr: "Revue technique, numéro mensuel",
    code: "TVA07",
    ttc: [9, 18],
    serie: false,
  },
];

/** Ce qu'ALGORIA achète ailleurs (gabarits B à F) : prix HT, en unités de la devise. */
export const ACHATS = [
  { fr: "Ramette papier A4 80 g", ar: "رزمة ورق A4 80 غ", code: "TVA19", pu: [11, 16] },
  { fr: "Cartouche d'encre couleur", ar: "خرطوشة حبر ملون", code: "TVA19", pu: [70, 160] },
  {
    fr: "Entretien climatisation, visite",
    ar: "صيانة المكيفات، زيارة",
    code: "TVA19",
    pu: [120, 450],
  },
  { fr: "Classeur à levier, dos 8 cm", ar: "ملف برافعة، ظهر 8 سم", code: "TVA19", pu: [4, 9] },
  {
    fr: "Câble électrique 3 × 2,5 mm², rouleau",
    ar: "كابل كهربائي 3 × 2,5 مم²، لفة",
    code: "TVA19",
    pu: [95, 240],
    fodec: true,
  },
  {
    fr: "Gaine ICTA 20 mm, couronne",
    ar: "غمد ICTA 20 مم، لفة",
    code: "TVA19",
    pu: [28, 60],
    fodec: true,
  },
  {
    fr: "Bac de rangement plastique 40 L",
    ar: "صندوق تخزين بلاستيكي 40 لتر",
    code: "TVA19",
    pu: [18, 42],
    fodec: true,
  },
  {
    fr: "Impression de cartes de visite, boîte de 500",
    ar: "طباعة بطاقات زيارة، علبة 500",
    code: "TVA19",
    pu: [45, 110],
    fodec: true,
  },
  { fr: "Plateau repas séminaire", ar: "وجبة ندوة", code: "TVA07", pu: [18, 38] },
  {
    fr: "Eau minérale, pack 6 × 1,5 L",
    ar: "مياه معدنية، حزمة 6 × 1,5 لتر",
    code: "TVA07",
    pu: [4, 7],
  },
  { fr: "Café en grains, sac 1 kg", ar: "قهوة حبوب، كيس 1 كغ", code: "TVA07", pu: [32, 58] },
  { fr: "Hébergement en hôtel, nuitée", ar: "إقامة بالنزل، ليلة", code: "TVA13", pu: [140, 390] },
  { fr: "Transport de matériel, course", ar: "نقل معدات، رحلة", code: "TVA13", pu: [80, 600] },
  {
    fr: "Formation professionnelle agréée, jour",
    ar: "تكوين مهني معتمد، يوم",
    code: "EXO",
    pu: [450, 1600],
  },
  {
    fr: "Formation certifiante en ligne, accès par stagiaire",
    ar: "تكوين إشهادي عن بعد، نفاذ لكل متكوّن",
    code: "EXO",
    pu: [180, 650],
  },
  {
    fr: "Prestation de déménagement de bureaux",
    ar: "خدمة نقل مكاتب",
    code: "TVA19",
    pu: [600, 2400],
  },
  {
    fr: "Location de salle de réunion, demi-journée",
    ar: "كراء قاعة اجتماعات، نصف يوم",
    code: "TVA19",
    pu: [250, 700],
  },
];

/** Ce qu'ALGORIA vend : ses produits et ses prestations, prix HT. */
export const VENTES = [
  {
    fr: "Abonnement Malica Office — palier Foundation, 12 mois",
    ar: "اشتراك Malica Office — مستوى Foundation، 12 شهرا",
    code: "TVA19",
    pu: [1800, 4200],
    nature: "prestations",
  },
  {
    fr: "Abonnement RegTrack — palier Compliance, 12 mois",
    ar: "اشتراك RegTrack — مستوى Compliance، 12 شهرا",
    code: "TVA19",
    pu: [6000, 14000],
    nature: "prestations",
  },
  {
    fr: "Paramétrage et intégration RegFlow, jour",
    ar: "إعداد وإدماج RegFlow، يوم",
    code: "TVA19",
    pu: [650, 1100],
    nature: "prestations",
  },
  {
    fr: "Assistance MEL Plus Suite, forfait mensuel",
    ar: "مساعدة MEL Plus Suite، جزاف شهري",
    code: "TVA19",
    pu: [900, 2500],
    nature: "prestations",
  },
  {
    fr: "Mise à disposition d'un consultant, jour",
    ar: "وضع مستشار على الذمة، يوم",
    code: "TVA19",
    pu: [700, 1300],
    nature: "annexes",
  },
  {
    fr: "Clé de sécurité matérielle FIDO2, boîte",
    ar: "مفتاح أمان مادي FIDO2، علبة",
    code: "TVA19",
    pu: [85, 160],
    nature: "marchandises",
  },
  {
    fr: "Formation professionnelle agréée RegFISC, jour",
    ar: "تكوين مهني معتمد RegFISC، يوم",
    code: "EXO",
    pu: [900, 1800],
    nature: "prestations",
  },
  {
    fr: "Formation professionnelle agréée MEL Plus, session",
    ar: "تكوين مهني معتمد MEL Plus، دورة",
    code: "EXO",
    pu: [1200, 2600],
    nature: "prestations",
  },
  {
    fr: "Étude de conformité réglementaire, mission",
    ar: "دراسة امتثال ترتيبي، مهمة",
    code: "TVA19",
    pu: [3500, 9000],
    nature: "prestations",
  },
];

/** La vente à l'export (en dollars, code EXPORT du référentiel). */
export const VENTES_EXPORT = [
  {
    fr: "Software development services — sprint",
    ar: "خدمات تطوير البرمجيات",
    code: "EXPORT",
    pu: [2500, 6000],
    nature: "prestations",
  },
  {
    fr: "Malica Office licence — Sovereign tier, 12 months",
    ar: "رخصة Malica Office",
    code: "EXPORT",
    pu: [9000, 15000],
    nature: "prestations",
  },
];

/** Les mentions légales du pied d'un ticket de détail (gabarit A), inventées. */
export const MENTIONS_DE_DETAIL = [
  "Les marchandises restent la propriété du vendeur jusqu'au paiement intégral. Garantie selon les conditions remises avec le produit ; elle ne couvre ni la casse ni l'oxydation. Aucun échange ni remboursement au-delà de sept jours, emballage d'origine exigé.",
  "Réserve de propriété : le transfert de propriété n'intervient qu'après encaissement du prix. Toute réclamation doit être formulée à la livraison. Les produits sous garantie sont repris sur présentation de la présente pièce.",
];

/* ======================================================== les autres pièces */

/*
 * Les personnes et organismes des pièces qui ne sont pas des factures (cas 121
 * à 161) : tous inventés. Les associés et le gérant d'ALGORIA sur ces pages ne
 * sont PAS ses associés réels — le nom et le matricule de la société sont les
 * seules données réelles. Aucun numéro de CIN n'est imprimé ; les matricules
 * CNSS commencent par « 99 », comme les RIB.
 */

/** Les associés inventés (5 000 parts de 10 DT : le capital de 50 000 DT). */
export const ASSOCIES = [
  {
    nom: "Nadhem Ourvani",
    ar: "ناظم أورفاني",
    parts: 2500,
    domicile: "7, rue des Glycines Selvanes, 2092 El Manar",
    gerant: true,
  },
  {
    nom: "Lyna Tazerouit",
    ar: "لينة تازروِيت",
    parts: 1500,
    domicile: "22, avenue Kerzane, 2045 L'Aouina",
    gerant: false,
  },
  {
    nom: "Faycel Morbane",
    ar: "فيصل موربان",
    parts: 1000,
    domicile: "3, impasse des Orvales, 4000 Sousse",
    gerant: false,
  },
];

/** Les salariés inventés d'ALGORIA : brut mensuel en dinars. */
export const SALARIES = [
  {
    nom: "Mehdi Varnasse",
    ar: "مهدي فارناس",
    interne: "ALG-0017",
    poste: "Ingénieur données",
    posteAr: "مهندس بيانات",
    categorie: "Cadre — échelon 4",
    entree: "2024-09-02",
    brut: 4200,
    adresse: "18, rue Zelmira, 2080 Ariana",
  },
  {
    nom: "Sana Belkorvi",
    ar: "سناء بلكورفي",
    interne: "ALG-0021",
    poste: "Développeuse full-stack",
    posteAr: "مطوّرة برمجيات",
    categorie: "Cadre — échelon 3",
    entree: "2025-01-06",
    brut: 3650,
    adresse: "5, rue des Ormelles, 2036 Soukra",
  },
  {
    nom: "Oussama Trezini",
    ar: "أسامة ترزيني",
    interne: "ALG-0024",
    poste: "Consultant conformité",
    posteAr: "مستشار امتثال",
    categorie: "Cadre — échelon 2",
    entree: "2025-03-17",
    brut: 3100,
    adresse: "41, avenue Ferzane, 1004 El Menzah",
  },
  {
    nom: "Rim Zaghvani",
    ar: "ريم زغفاني",
    interne: "ALG-0026",
    poste: "Assistante administrative",
    posteAr: "مساعدة إدارية",
    categorie: "Agent de maîtrise — échelon 5",
    entree: "2025-06-02",
    brut: 1850,
    adresse: "9, rue Talvane, 2015 Le Kram",
  },
  {
    nom: "Anis Quermadi",
    ar: "أنيس قرمادي",
    interne: "ALG-0029",
    poste: "Analyste financier",
    posteAr: "محلل مالي",
    categorie: "Cadre — échelon 1",
    entree: "2025-11-03",
    brut: 2800,
    adresse: "12, rue des Selvines, 2073 Borj Louzir",
  },
  {
    nom: "Yosra Kelvandi",
    ar: "يسرى كلفاندي",
    interne: "ALG-0031",
    poste: "Ingénieure sécurité des systèmes",
    posteAr: "مهندسة سلامة الأنظمة",
    categorie: "Cadre — échelon 2",
    entree: "2026-11-02",
    brut: 3300,
    adresse: "30, rue des Vernelles, 2091 El Menzah VI",
    diplome: "Diplôme national d'ingénieur en informatique",
  },
];

/** Les autres parties des pièces : inventées, mots rares, aucun logo. */
export const AUTRES = {
  bailleur: {
    fr: "Société Immobilière Varzane SARL",
    ar: "الشركة العقارية فارزان",
    adresse: "27, avenue Kelvira, 1002 Tunis Belvédère",
    representant: "Hamza Ouldrane",
  },
  bailleurSfax: {
    fr: "Société Belkhira Immobilière SA",
    ar: "شركة بلخيرة العقارية",
    adresse: "طريق قرمدة كلم 4، 3062 صفاقس",
    representant: "عادل بلخيرة",
  },
  local: "14, rue des Cyprès, 1053 Les Berges du Lac, Tunis",
  localSfax: "المنطقة الصناعية بوديان، مقسم 31، 3064 صفاقس",
  assureur: {
    fr: "Mutuelle Ervaline d'Assurances",
    adresse: "Immeuble Orvane, rue du Lac Morvane, 1053 Les Berges du Lac",
  },
  artisan: {
    ar: "ورشة قمران للترصيص",
    fr: "Atelier Qamrane Plomberie",
    adresse: "نهج الزرزور 11، 2034 الزهراء",
  },
  papeterie: {
    enseigne: "MARVELLE PAPETERIE",
    adresse: "Centre Orzane, local 4, 1053 Les Berges du Lac",
  },
  superette: {
    enseigne: "مغازة زيروان",
    enseigneFr: "Superette Zirwane",
    adresse: "شارع الأرز 56، 2045 العوينة",
  },
  restaurant: {
    nom: "Le Comptoir Olvane",
    adresse: "6, rue du Lac Ermane, 1053 Les Berges du Lac",
  },
  association: {
    nom: "Association Selvarine des Sciences des Données",
    adresse: "Pôle Kervane, 2088 Ariana",
  },
  syndic: {
    ar: "اتحاد مالكي إقامة ورزان",
  },
  agence: {
    nom: "Agence Lac Morvane",
    code: "017",
    adresse: "Rue du Lac Morvane, 1053 Les Berges du Lac",
    telephone: "00 71 962 330",
    bic: "OUZDTNT1XXX",
  },
  agenceSelvane: {
    nom: "Agence Ennasr Kelvane",
    code: "204",
    adresse: "Avenue Hedi Selvane, 2037 Ennasr",
    telephone: "00 70 118 452",
    bic: "CRSLTNT1XXX",
  },
};
