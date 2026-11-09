-- « Parler à Malica » conclut sa réponse : une version nouvelle de la consigne.
--
-- La conversation DeepSeek (`askMalica`) fait relire par le cabinet mandaté
-- une réponse de conseil qui engage le dossier d'une PME : la PME lit « votre
-- comptable relit ma réponse », la réponse attend dans la file du cabinet.
-- L'assistant (#298) répondait en flux et ne retenait rien : la file du
-- cabinet ne recevait plus les questions posées par l'écran de la PME.
--
-- Il tient désormais la même règle (`doitEtreRelue`). Pour la juger, le modèle
-- dit ce qu'est sa réponse par un outil final, `conclure_reponse` : conseil ou
-- non, portée, certitude, doute, thème. Le serveur retient le texte tant que
-- la conclusion n'est pas connue, quand un cabinet engagé peut avoir à relire.
--
-- Ce que le modèle doit mettre dans cette conclusion est une CONSIGNE : elle
-- vit ici, versionnée, réglable depuis la tour — pas dans le code. La version
-- en vigueur n'est pas réécrite (le déclencheur l'interdit) : on publie une
-- version nouvelle, qui reprend la dernière publiée et lui ajoute la section.
-- Une version publiée entre-temps depuis la tour est donc reprise, pas écrasée.
--
-- R11 : aucune horloge. La version est datée en littéral, et toujours après la
-- dernière publiée (sans quoi elle ne vaudrait pas) ; l'identifiant est laissé
-- à son défaut. Rejouée, la migration n'ajoute rien (motif déjà présent).

begin;

insert into plateforme.assistant_consignes (texte, motif, decide_le)
select k.texte || E'\n\n' || $section$CONCLURE TA RÉPONSE
Quand ta réponse est entièrement écrite, tu appelles conclure_reponse — une seule fois, en dernier — et tu n'écris plus rien après. Cet outil ne s'annonce pas : la personne ne le voit pas. Tu y dis ce qu'est ta réponse :
- "conseil" : true si la question demande d'appliquer ou d'interpréter une règle fiscale, sociale ou réglementaire (un taux, une déduction, un régime, une obligation, un délai, une pénalité, une retenue) ; false si elle porte seulement sur les chiffres du dossier, une pièce, une écriture, une échéance déjà calculée, ou si c'est une question générale.
- "portee" : « generale » si tu énonces une règle valable pour tous, qu'on pourrait lire au Journal officiel — un taux, une définition, une échéance légale. « dossier » si ta réponse applique la règle à CETTE société : ses chiffres, son régime, sa situation, ce qu'elle doit faire dans son cas. « incertaine » si tu hésites entre les deux. N'hésite pas à répondre « incertaine » : une réponse relue arrive un peu plus tard, une réponse engageante lâchée trop vite engage quelqu'un.
- "certitude" : un nombre entre 0 et 1 — ta confiance que la réponse est juste ET complète pour cette société. Baisse-la dès qu'un fait manque, que deux textes se recoupent mal ou que le régime de la société n'est pas renseigné. Si aucun texte rendu par conseil_fiscal ne répond : 0.
- "doute" : en une ou deux phrases, ce qui te fait hésiter et ce que l'expert-comptable devrait vérifier avant d'envoyer ; null si rien.
- "theme" : le sujet en trois à cinq mots, sans verbe, comme « Retenue à la source sur loyer » ; null si ce n'est pas du conseil.
Si "conseil" vaut false : "portee" vaut « generale », "certitude" 1, "doute" et "theme" null.
Quand le cabinet doit relire ta réponse, c'est Malica qui le dit à la personne : tu n'annonces jamais toi-même qu'elle sera relue, ni qu'elle ne le sera pas.$section$,
       'Ajout de la section « CONCLURE TA RÉPONSE » (outil final conclure_reponse) : '
       || 'la file du cabinet reçoit de nouveau les réponses à faire relire (correctif de #298).',
       greatest(timestamptz '2026-11-09 09:00:00+00', k.decide_le + interval '1 second')
  from (select c.texte, c.decide_le
          from plateforme.assistant_consignes c
         order by c.decide_le desc, c.id desc
         limit 1) k
 where not exists (
   select 1 from plateforme.assistant_consignes c
    where c.motif like 'Ajout de la section « CONCLURE TA RÉPONSE »%');

commit;
