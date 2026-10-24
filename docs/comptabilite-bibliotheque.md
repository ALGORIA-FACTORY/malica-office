# Bibliothèque et dossier d’opération — comptabilité

La comptabilité retrouve les documents transmis par client et mois de réception,
les filtre par nature et ouvre leur dossier existant. Le téléchargement d’une
sélection ferme les liens documentaires autorisés et fournit les originaux,
un index avec empreintes, les écritures et leurs statuts, les paiements et les
résultats réels des contrôles. Une pièce manquante fait échouer la préparation :
aucune archive partielle n’est présentée comme complète.

Le dossier garde la visionneuse et les actions existantes. Les comptes affichent
leur intitulé dans les factures et les règlements. L’onglet Contrôles restitue
la dernière analyse et signale l’absence ou l’ancienneté de celle-ci. Une retenue
inférée du montant payé est explicitement signalée comme à vérifier.

Cette livraison ne modifie ni les écrans PME, ni le moteur fiscal, ni les taux
des packs. Elle ne résout pas les anomalies fiscales de la revue du 24 octobre
(qualification des retenues, effets à recevoir, annulation d’un règlement inscrit).
Les contrôles existants ne deviennent pas une attestation de conformité fiscale
exhaustive par l’ajout de cet écran.

## Restitution

- Mandat actif, dates applicables et affectation vérifiés ; vues RLS conservées.
- Seules les pièces `partage` du client demandé participent au parcours.
- Les documents privés ne sont ni sélectionnables ni des ponts de rattachement.
- La garde de licence des exports existants s’applique à la préparation du dossier.
- Types de fichiers conservés, noms uniques, formules CSV neutralisées.
- Borne explicite : 2 000 documents dans la bibliothèque, 100 Mio d’originaux par archive.
  Le produit demande de réduire la période ou la sélection au-delà, sans tronquer.
- Préparation et annulation locales ; pas de tâche serveur persistante pour gros volumes.
- `Ecritures.csv` conserve les propositions et corrections avec leur statut ; ce fichier
  ne remplace pas les exports réglementaires existants.

## Vérification

`archive-comptable.test.ts` vérifie les octets, extensions, dédoublonnage,
collisions de références, fichiers manquants, limite de taille, annulation,
traversées de chemins et formules CSV.

`bibliotheque.test.ts` utilise PostgreSQL et les identités réelles : double
appartenance PME/comptabilité, exclusion des pièces privées, liens, utilisateur
non mandaté, période, contrôles et révocation. Cette suite requiert les mêmes
variables de base que les autres tests API ; sans elles, elle est ignorée.
