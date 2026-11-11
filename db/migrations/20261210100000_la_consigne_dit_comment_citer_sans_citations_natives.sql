-- DeepSeek répond dans la même boucle d'outils que Claude : la consigne dit comment citer.
--
-- Claude reçoit les résultats d'outils en blocs « search_result » et cite
-- nativement. DeepSeek ne connaît ni ces blocs ni les citations : le serveur
-- (`apps/api/src/malica/assistant/deepseek-flux.ts`) lui remet les mêmes
-- sources en passages numérotés [S1], [S2]…, et retire de la réponse les
-- marqueurs qu'il écrit pour en faire les mêmes citations que Claude.
--
-- Ce que le modèle doit écrire est une CONSIGNE : elle vit ici, versionnée,
-- réglable depuis la tour — pas dans le code. Une seule consigne pour les deux
-- moteurs : la parité commence par le même texte. La version en vigueur n'est
-- pas réécrite (le déclencheur l'interdit) : on publie une version nouvelle,
-- qui reprend la dernière publiée et lui ajoute la section ; une version
-- publiée entre-temps depuis la tour est donc reprise, pas écrasée.
--
-- R11 : aucune horloge. La version est datée en littéral, toujours après la
-- dernière publiée ; l'identifiant est laissé à son défaut. Rejouée, la
-- migration n'ajoute rien (motif déjà présent).

begin;

insert into plateforme.assistant_consignes (texte, motif, decide_le)
select k.texte || E'\n\n' || $section$CITER LES PASSAGES NUMÉROTÉS
Quand le résultat d'un outil t'arrive en passages numérotés — [S1], [S2]… —, tu les cites ainsi : à la fin de chaque phrase qui s'appuie sur un passage, tu écris son marqueur, collé au dernier mot et avant la ponctuation, exactement comme dans « Le crédit de TVA est de 342.000 TND[S1]. ». Plusieurs passages pour une même phrase : [S1][S3]. Tu n'écris un marqueur que pour un passage que tu as reçu : jamais [S4] si tu n'as reçu que trois passages. Une phrase qui porte un chiffre sans passage qui le porte est retirée : n'écris pas de chiffre que tu ne trouves pas dans un passage.
Quand les résultats t'arrivent sous une autre forme, avec leurs citations natives, tu n'écris aucun marqueur.$section$,
       'Ajout de la section « CITER LES PASSAGES NUMÉROTÉS » : DeepSeek répond dans la même boucle d''outils que Claude, '
       || 'avec la même consigne (lot B, parité des deux moteurs).',
       greatest(timestamptz '2026-11-10 10:00:00+00', k.decide_le + interval '1 second')
  from (select c.texte, c.decide_le
          from plateforme.assistant_consignes c
         order by c.decide_le desc, c.id desc
         limit 1) k
 where not exists (
   select 1 from plateforme.assistant_consignes c
    where c.motif like 'Ajout de la section « CITER LES PASSAGES NUMÉROTÉS »%');

commit;
