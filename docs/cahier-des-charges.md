# Cahier des charges fonctionnel — Journal de Trading

Version 1.0 — 26/08/2026
Statut : périmètre fonctionnel uniquement. L'identité visuelle (charte graphique, composants UI définitifs) fait l'objet d'un document séparé, à produire dans une phase ultérieure. Les pistes de design déjà évoquées sont conservées en annexe (section 8) pour ne rien perdre.

---

## 1. Présentation du projet

### 1.1 Objectif
Construire un journal de trading numérique qui ne se contente pas d'enregistrer des trades, mais qui aide le trader à :
1. **Mesurer objectivement sa performance** (PnL, ratios, statistiques).
2. **Comprendre le processus** derrière chaque trade (thèse, émotions, respect du plan), indépendamment du résultat.
3. **Détecter ses dérives comportementales** avant qu'elles ne coûtent cher (overtrading, revenge trading, non-respect des règles).
4. **S'améliorer dans la durée** grâce à des statistiques croisées, des alertes préventives et des insights personnalisés.

### 1.2 Principe directeur
Le fil conducteur de l'outil est : **le process compte autant que le résultat**. Un trade bien exécuté peut perdre de l'argent ; un mauvais trade peut en gagner. L'application doit donc systématiquement permettre de distinguer :
- la **qualité d'exécution** (le trader a-t-il suivi son plan, sa checklist, ses règles ?),
- le **résultat** (le trade a-t-il été gagnant ou perdant ?).

Ce principe structure une grande partie des fonctionnalités (checklist pré-trade, note de qualité d'exécution, score de discipline, comparaison PnL réel vs PnL "si le plan avait été respecté").

### 1.3 Public cible
- Trader indépendant, discrétionnaire et/ou systématique (particulier ou en compte prop firm).
- Trade sur un ou plusieurs marchés (forex, indices, crypto, actions...).
- Peut gérer plusieurs comptes en parallèle (compte personnel, compte de prop firm, compte démo).

### 1.4 Portée du présent document
Ce cahier des charges couvre exclusivement le **fonctionnel** : ce que l'application doit faire, quelles données elle manipule, comment les fonctionnalités s'articulent entre elles. Il ne traite pas :
- de l'identité visuelle définitive (charte graphique, maquettes) — cf. section 8 pour les pistes déjà collectées,
- de l'architecture technique (choix de stack, base de données, hébergement),
- du modèle économique (gratuit/payant, freemium).

---

## 2. Modèle de données conceptuel (le socle transversal)

Avant de détailler chaque fonctionnalité, il est nécessaire de définir les **objets métier** partagés par tous les modules. C'est ce socle commun qui garantit la cohérence de l'ensemble : une même donnée (une émotion, une règle, un tag) est saisie une seule fois et réutilisée par la saisie, les statistiques, l'analyse comportementale et les alertes.

### 2.1 Compte de trading (`Compte`)
| Champ | Description |
|---|---|
| Nom | Libellé libre (ex : "Compte principal", "Prop firm FTMO") |
| Type | Personnel / Prop firm / Démo |
| Broker | Nom du courtier/plateforme |
| Devise | Devise de référence du compte |
| Capital initial | Montant de départ |
| Capital courant | Calculé = capital initial + dépôts − retraits + PnL cumulé |
| Historique dépôts/retraits | Liste horodatée, **exclue du calcul de performance pure** (cf. 3.7.10) |

Un utilisateur peut posséder plusieurs comptes (cf. 3.7.5). Chaque trade est rattaché à un compte unique.

### 2.2 Trade (`Trade`)
Objet central de l'application. Regroupe l'ensemble des champs listés en section 3.1, plus les valeurs calculées (PnL, R-multiple, statut gagnant/perdant/breakeven). Un trade est toujours rattaché à :
- un **Compte**,
- un ou plusieurs **Tags** (setup, timeframe, session, condition de marché),
- une **Stratégie** (optionnel, cf. 2.7),
- une **Checklist pré-trade** remplie (optionnel selon paramétrage),
- un ensemble de **Règles personnelles** cochées respectées/non respectées.

### 2.3 Trade non pris (`TradeManqué`)
Setup identifié mais non exécuté. Ne génère ni PnL ni R-multiple, mais alimente l'analyse de la confiance (cf. 3.2.5) et est mis en regard des trades réellement pris pour objectiver un manque de confiance récurrent.

### 2.4 Règle personnelle (`Règle`)
Énoncé court, éditable par l'utilisateur (ex : "Jamais trader après 15h", "Max 3 trades/jour"). Chaque règle peut être :
- **cochée a posteriori sur chaque trade** (respectée / non respectée) → alimente le "rule adherence" (3.4.6) et la comparaison hors-plan vs dans le plan (3.4.4),
- **reliée à un seuil d'alerte** correspondant (3.6.7) pour un contrôle en temps réel plutôt qu'a posteriori.

C'est l'objet qui fait le pont entre le **journal qualitatif** (section 3.2), l'**analyse comportementale** (section 3.4) et les **alertes temps réel** (section 3.6).

### 2.5 Checklist pré-trade (`ChecklistTemplate`)
Modèle de checklist défini une fois par l'utilisateur (ex : "Setup validé", "Stop défini", "Pas dans une série de pertes récente"). À chaque trade, une copie de la checklist est cochée point par point. Le taux de complétion nourrit la note de qualité d'exécution (3.2.9).

### 2.6 Journal quotidien (`EntréeJournal`)
Une entrée par jour de trading, indépendante des trades individuels : réponses aux questions de réflexion guidée, humeur générale du jour, facteurs externes déclarés (sommeil, fatigue, heure tardive...). Sert de base à la corrélation facteurs externes / qualité des trades (3.4.9).

### 2.7 Stratégie (`Stratégie`)
Regroupement logique de trades partageant un même système de règles testé (ex : "Breakout NY session", "Mean reversion range asiatique"). Permet la comparaison de plusieurs stratégies en parallèle (3.3.16) et la distinction système vs discrétionnaire (3.3.17).

### 2.8 Objectif (`Objectif`)
Cible mensuelle définie par l'utilisateur sur une métrique donnée (PnL, win rate, score de discipline...), comparée au réalisé (3.7.2).

### 2.9 Schéma relationnel simplifié
```
Compte 1───N Trade N───N Tag (setup / timeframe / session / condition de marché)
Compte 1───N Dépôt/Retrait
Trade  N───1 Stratégie (optionnel)
Trade  1───1 ChecklistTemplate (copie remplie)
Trade  N───N Règle (respectée / non respectée)
Trade  1───N Émotion (avant / pendant / après)
Compte 1───N TradeManqué
Compte 1───N EntréeJournal (par jour)
Compte 1───N Objectif (par mois)
Règle  1───N SeuilAlerte (0 ou 1 le plus souvent)
```

Toutes les fonctionnalités décrites ci-après **lisent ou écrivent** dans ce socle commun. Chaque section 3.x précise explicitement ses dépendances vers les autres modules.

---

## 3. Modules fonctionnels détaillés

Convention de lecture pour chaque fonctionnalité :
- **Description** : ce que fait la fonctionnalité.
- **Données** : champs concernés (cf. section 2).
- **Règles de gestion** : comportement attendu, cas particuliers.
- **Dépendances** : quels autres modules consomment ou alimentent cette donnée.

### 3.1 Module — Saisie de trade

#### 3.1.1 Données de base du trade
- **Description** : formulaire de saisie couvrant actif, sens (long/short), taille de position, prix d'entrée et de sortie, date/heure d'entrée et de sortie.
- **Données** : `Trade.actif`, `Trade.sens`, `Trade.taille`, `Trade.prixEntrée`, `Trade.prixSortie`, `Trade.dateHeureEntrée`, `Trade.dateHeureSortie`.
- **Règles de gestion** :
  - Le PnL brut est calculé automatiquement à partir de ces champs (cf. 3.3.1) — jamais saisi manuellement pour éviter les incohérences.
  - La session (Londres/NY/Asie, cf. 3.1.6) peut être déduite automatiquement de l'heure d'entrée, avec possibilité de correction manuelle.
  - Un trade encore ouvert n'a pas de prix/date de sortie ; il apparaît comme "en cours" dans le calendrier et les stats l'excluent du PnL réalisé tant qu'il n'est pas clôturé.
- **Dépendances** : base de tous les calculs de la section 3.3, du calendrier (3.7.1), de la heatmap (3.3.11).

#### 3.1.2 Stop loss et take profit : prévus vs réels
- **Description** : deux couples de valeurs sont saisis — SL/TP **prévus** (au moment de la décision) et SL/TP **réels** (là où le trade a effectivement été clôturé).
- **Données** : `Trade.slPrevu`, `Trade.tpPrevu`, `Trade.slReel`, `Trade.tpReel`.
- **Règles de gestion** :
  - Un trade sans SL prévu renseigné déclenche l'alerte de garde-fou 3.6.6 avant validation de la saisie.
  - L'écart entre TP prévu et prix réellement atteint après la sortie alimente la vue "coût d'opportunité" (3.3.19).
  - L'écart entre SL/TP prévus et réels objective le respect du plan (lié à 3.2.3).
- **Dépendances** : 3.2.3 (respect du plan), 3.3.19 (coût d'opportunité), 3.6.6 (alerte SL manquant).

#### 3.1.3 Frais et commissions
- **Description** : saisie des frais associés au trade (commission broker, spread si applicable).
- **Données** : `Trade.frais`.
- **Règles de gestion** : le PnL net = PnL brut − frais. Le PnL net est la valeur de référence pour tous les indicateurs de performance (win rate, expectancy, etc.), sauf mention contraire explicite "brut".
- **Dépendances** : 3.3.1 (PnL net), 3.3.13 (coût cumulé des frais).

#### 3.1.4 Screenshot du graphique
- **Description** : pièce jointe image associée au trade, capturant le graphique au moment de la prise de décision.
- **Données** : `Trade.screenshot`.
- **Règles de gestion** : facultatif à la saisie mais fortement recommandé ; utilisé lors de la revue (mode replay, 3.7.4) et pour l'export "carte de trade" (3.7.7).
- **Dépendances** : 3.7.4, 3.7.7.

#### 3.1.5 Tags libres (setup, timeframe, session)
- **Description** : système de tags réutilisables pour qualifier chaque trade.
- **Données** : `Trade.setup`, `Trade.timeframe`, `Trade.session` (Londres/NY/Asie).
- **Règles de gestion** : les tags sont créés une fois puis réutilisés (liste suggérée à la saisie) pour garantir des regroupements statistiques fiables — un setup mal orthographié deux fois de façon différente fausserait les stats par setup (3.3.9).
- **Dépendances** : socle de toute la performance par segment (3.3.9), de la mise en avant du meilleur setup/session (3.5.2).

#### 3.1.6 Condition de marché
- **Description** : tag qualifiant le contexte de marché au moment du trade (range, tendance, forte volatilité, news économique).
- **Données** : `Trade.conditionMarché`.
- **Règles de gestion** : si "news économique" est sélectionné, le trade est automatiquement croisé avec le calendrier économique pour l'alerte 3.6.8.
- **Dépendances** : 3.6.8 (alerte trading pendant news), 3.3.9 (performance par segment).

#### 3.1.7 Bouton "Quick Add"
- **Description** : saisie rapide ne demandant que les champs strictement indispensables (actif, sens, taille, prix entrée/sortie), les autres champs restant modifiables plus tard.
- **Règles de gestion** : un trade en "Quick Add" est marqué comme incomplet tant que les champs qualitatifs (thèse, émotions, checklist) ne sont pas renseignés ; un compteur "trades à compléter" peut être affiché pour inciter à la complétude, car les statistiques comportementales (section 3.4) perdent en fiabilité si une part significative des trades reste incomplète.
- **Dépendances** : 3.2 (le "pourquoi" est saisi a posteriori), 3.4 (fiabilité de l'analyse comportementale).

#### 3.1.8 Notation manuelle du trade (1 à 5 étoiles)
- **Description** : note subjective libre attribuée par le trader pour marquer les trades à revoir.
- **Données** : `Trade.note`.
- **Règles de gestion** : sert de filtre dans le mode replay/historique (3.7.4), indépendant de la note de qualité d'exécution (3.2.9) qui elle est structurée.
- **Dépendances** : 3.7.4.

#### 3.1.9 Mode confiance (conviction pré-trade)
- **Description** : avant de connaître le résultat, le trader note sa conviction dans le setup sur une échelle de 1 à 10.
- **Données** : `Trade.convictionPreTrade`.
- **Règles de gestion** : une fois le trade clôturé, l'application peut comparer la conviction déclarée au résultat réel (corrélation conviction/performance) — un indicateur si le trader "sait" quand un trade est bon, ou si sa conviction n'est pas prédictive.
- **Dépendances** : 3.3 (croisement conviction × performance, extension de 3.4.2), 3.4.5 (comparaison avec les trades manqués : est-ce que la faible conviction pousse à ne pas trader, à raison ou à tort ?).

---

### 3.2 Module — Le "pourquoi" du trade (journal qualitatif)

Ce module capture le **process**, en complément du résultat chiffré du module 3.1/3.3. C'est la matière première de l'analyse comportementale (section 3.4).

#### 3.2.1 Thèse d'entrée
- **Description** : champ texte libre décrivant la raison d'entrée en position.
- **Données** : `Trade.thèse`.
- **Dépendances** : consultée lors du post-mortem (3.2.4) et du mode replay (3.7.4).

#### 3.2.2 Émotions avant / pendant / après
- **Description** : sélection de tags émotionnels à trois moments du trade (ex : discipline, FOMO, revenge trading, sérénité, stress).
- **Données** : `Trade.émotionAvant`, `Trade.émotionPendant`, `Trade.émotionAprès`.
- **Règles de gestion** : liste de tags prédéfinie mais extensible.
- **Dépendances** : 3.4.2 (corrélation émotion/résultat), 3.4.5 (détection revenge trading), 3.6.4 (alerte revenge trading en temps réel s'appuie sur les mêmes tags historiques pour calibrer le seuil).

#### 3.2.3 Respect du plan de trading initial
- **Description** : indicateur (oui/non, ou partiel) déclaré par le trader sur le respect de son plan pour ce trade précis.
- **Données** : `Trade.planRespecté`.
- **Règles de gestion** : distinct de la note de qualité d'exécution (3.2.9), qui est plus granulaire (checklist) ; celui-ci est une déclaration globale rapide.
- **Dépendances** : 3.4.4 (comparaison perf trades hors-plan vs dans le plan), 3.3.20 (PnL réel vs PnL simulé si plan toujours respecté).

#### 3.2.4 Note post-mortem
- **Description** : champ texte libre rempli après clôture : qu'est-ce qui a marché, qu'est-ce qui n'a pas marché.
- **Données** : `Trade.postMortem`.
- **Dépendances** : mode replay (3.7.4), export carte de trade (3.7.7).

#### 3.2.5 Journal des trades manqués
- **Description** : consignation des setups vus mais non tradés, avec la raison (peur, doute...).
- **Données** : objet `TradeManqué` (cf. 2.3) : `actif`, `dateHeure`, `raisonNonPrise`, `notes`.
- **Règles de gestion** : ne génère pas de PnL réel ; peut optionnellement estimer un "PnL fictif" si le setup avait été pris, pour objectiver le coût de l'inaction — à considérer en V2 (cf. section 5).
- **Dépendances** : 3.4.5 (repérage d'un manque de confiance récurrent par setup/session).

#### 3.2.6 Journal quotidien avec question de réflexion guidée
- **Description** : une entrée par jour de trading, avec des questions fixes ("qu'est-ce qui a bien marché aujourd'hui", "qu'est-ce qui est à améliorer") et déclaration de facteurs externes (sommeil, fatigue, heure tardive).
- **Données** : objet `EntréeJournal` (cf. 2.6).
- **Dépendances** : 3.4.9 (corrélation facteurs externes / qualité des trades), 3.6 (rappel de remplissage, cf. 3.2.8).

#### 3.2.7 Checklist pré-trade
- **Description** : liste de vérifications personnalisable, cochée avant d'entrer en position (setup validé, stop défini, pas dans une série de pertes récente...).
- **Données** : `ChecklistTemplate` (modèle, cf. 2.5) + copie de réponses par `Trade`.
- **Règles de gestion** : l'utilisateur définit sa propre checklist (items ajoutables/supprimables) ; le taux de complétion par trade est stocké.
- **Dépendances** : 3.2.9 (note de qualité d'exécution), 3.6.6 (le contrôle "pas de SL" peut être un item de checklist en plus d'une alerte dédiée).

#### 3.2.8 Rappel/notification pour remplir le journal du jour
- **Description** : notification programmée incitant à compléter le journal quotidien (3.2.6) et les trades du jour restés en "Quick Add" (3.1.7) incomplet.
- **Règles de gestion** : heure de rappel paramétrable ; ne se déclenche que s'il y a eu au moins un trade ou une session de marché dans la journée.
- **Dépendances** : 3.2.6, 3.1.7.

#### 3.2.9 Note de qualité d'exécution (séparée du résultat)
- **Description** : note structurée évaluant si le trade a été **bien exécuté** (respect checklist, respect du plan, gestion du risque conforme), indépendamment de son résultat financier.
- **Données** : calculée à partir de `Trade.checklistComplétée`, `Trade.planRespecté`, `Trade.règlesRespectées` — ou saisie manuellement en complément.
- **Règles de gestion** : c'est l'indicateur pivot du principe directeur (section 1.2). Un trade peut être "gagnant / mal exécuté" ou "perdant / bien exécuté" ; ces deux catégories doivent être visibles distinctement dans les statistiques (3.3) pour éviter que le trader ne juge sa performance uniquement au résultat.
- **Dépendances** : 3.4.1 (score de discipline global, qui agrège ces notes dans le temps), 3.3.20 (PnL simulé si discipline parfaite).

---

### 3.3 Module — Statistiques et PnL

Ce module transforme les données brutes des modules 3.1/3.2 en indicateurs de performance. Toutes les métriques ci-dessous sont calculées, jamais saisies manuellement, afin de garantir leur cohérence entre elles (cf. glossaire, section 7, pour les formules exactes).

#### 3.3.1 PnL brut/net, en valeur et en pourcentage
- **Description** : gain/perte par trade et cumulé, avant et après frais, en valeur absolue et en % du capital engagé.
- **Données** : dérivées de 3.1.1, 3.1.3.
- **Dépendances** : base de tous les indicateurs suivants et du calendrier (3.7.1).

#### 3.3.2 Win rate et ratio gain moyen / perte moyenne (R:R réel)
- **Description** : proportion de trades gagnants ; rapport entre le gain moyen des trades gagnants et la perte moyenne des trades perdants.
- **Dépendances** : entre dans le calcul de l'expectancy (3.3.3).

#### 3.3.3 Expectancy (espérance mathématique par trade, en R)
- **Description** : gain moyen attendu par trade, exprimé en multiple du risque initial (R).
- **Formule** : voir glossaire (section 7).
- **Dépendances** : nécessite que chaque trade ait un risque initial défini (via le SL prévu, 3.1.2) pour calculer le R-multiple (3.3.7).

#### 3.3.4 Profit factor
- **Description** : rapport entre la somme des gains et la somme des pertes sur une période.

#### 3.3.5 Sharpe ratio
- **Description** : mesure du rendement ajusté du risque (volatilité des résultats).

#### 3.3.6 Max drawdown et drawdown en cours
- **Description** : perte maximale enregistrée depuis un point haut du capital, et perte en cours depuis le dernier point haut.
- **Dépendances** : alimente la courbe d'équité (3.3.7) et peut déclencher une alerte de seuil (3.6.3).

#### 3.3.7 Courbe d'équité dans le temps
- **Description** : évolution du capital dans le temps, **hors impact des dépôts/retraits** (cf. 3.7.10) pour ne représenter que la performance de trading pure.
- **Dépendances** : 3.7.10 (suivi séparé des mouvements de capital), 3.3.6 (drawdown).

#### 3.3.8 Distribution des R-multiples (histogramme)
- **Description** : histogramme du nombre de trades par tranche de R-multiple réalisé.
- **Dépendances** : nécessite le R-multiple par trade (calculé à partir du SL prévu, 3.1.2, et du PnL net, 3.3.1).

#### 3.3.9 Performance par segment (actif, setup, jour de semaine, heure)
- **Description** : les indicateurs de 3.3.1 à 3.3.5 déclinés par segment.
- **Dépendances** : nécessite les tags de 3.1.5/3.1.6 correctement renseignés — voir la règle de cohérence des tags (3.1.5).

#### 3.3.10 Long vs Short
- **Description** : répartition du nombre de trades et de la performance selon le sens (long/short).

#### 3.3.11 Heatmap P&L par jour (vue mensuelle en grille colorée)
- **Description** : grille calendaire colorée par jour selon le PnL du jour (vert/rouge, intensité proportionnelle).
- **Dépendances** : 3.7.1 (calendrier de trading, dont c'est une variante visuelle de synthèse).

#### 3.3.12 Risque exprimé en % du capital
- **Description** : tous les indicateurs de risque (taille de position, perte max autorisée) sont affichables en % du capital courant plutôt qu'en valeur brute.
- **Règles de gestion** : plus pertinent que la valeur brute lorsque le capital évolue dans le temps (dépôts, retraits, gains cumulés) — s'appuie sur `Compte.capitalCourant` (2.1).
- **Dépendances** : 3.6.3, 3.6.4, 3.7.13 (vue scaling du capital).

#### 3.3.13 Vue "par actif" dédiée
- **Description** : page de synthèse par instrument tradé, agrégeant l'ensemble des indicateurs pour cet actif seul.
- **Dépendances** : extension de 3.3.9.

#### 3.3.14 PnL réel vs PnL simulé "si le plan avait toujours été respecté"
- **Description** : recalcule le PnL en supposant que chaque trade non conforme (SL/TP non respecté, règle non respectée) avait été géré selon le plan initial — chiffre le **coût de l'indiscipline**.
- **Données** : s'appuie sur `Trade.planRespecté` (3.2.3), `Trade.slPrevu`/`slReel`, `tpPrevu`/`tpReel` (3.1.2).
- **Dépendances** : c'est l'indicateur qui matérialise concrètement le principe directeur (section 1.2) en euros/dollars.

#### 3.3.15 Coût cumulé des frais/commissions dans le temps
- **Description** : somme des frais (3.1.3) affichée en courbe cumulative.

#### 3.3.16 Comparaison de plusieurs stratégies en parallèle
- **Description** : les indicateurs de performance déclinés par `Stratégie` (2.7) plutôt qu'un mélange global de tous les trades.
- **Dépendances** : nécessite le rattachement des trades à une stratégie (2.7).

#### 3.3.17 Comparaison système vs discrétionnaire
- **Description** : segmentation des trades selon qu'ils suivent des règles mécaniques strictes ou un jugement libre.
- **Données** : peut être un attribut de `Stratégie` (2.7) ou du `Trade` directement.

#### 3.3.18 Vue "coût d'opportunité"
- **Description** : gains laissés sur la table en sortant trop tôt — compare le TP prévu (3.1.2) au prix réellement atteint après la sortie du trade (nécessite un suivi du prix post-clôture, ex. via une source de données de marché).
- **Dépendances** : 3.1.2.

#### 3.3.19 Comparaison période actuelle vs même période l'année précédente
- **Description** : tous les indicateurs peuvent être comparés en glissement annuel.
- **Dépendances** : 3.7.6 (filtre par période), dont c'est une extension.

#### 3.3.20 Ratio temps passé en position
- **Description** : durée moyenne des trades gagnants vs perdants (temps entre entrée et sortie).
- **Dépendances** : 3.1.1 (dates/heures d'entrée et de sortie).

#### 3.3.21 Vue "scaling" du capital
- **Description** : vérifie si la taille de position suit la croissance (ou décroissance) du compte — détecte un sous- ou sur-dimensionnement.
- **Dépendances** : 3.3.12 (risque en % du capital), `Compte.capitalCourant`.

---

### 3.4 Module — Analyse comportementale

Ce module croise les données qualitatives (3.2) et quantitatives (3.3) pour produire une lecture du **comportement** du trader dans la durée.

#### 3.4.1 Score de discipline (jauge circulaire /100)
- **Description** : indicateur agrégé combinant le respect des règles personnelles (2.4), le taux de complétion des checklists (3.2.7), le respect du plan (3.2.3) et la note de qualité d'exécution (3.2.9), sur une période donnée.
- **Règles de gestion** : la formule de pondération exacte doit être définie avant développement (arbitrage produit), mais la donnée d'entrée est toujours la même liste de champs — garantissant que ce score reste explicable trade par trade.
- **Dépendances** : agrège 2.4, 3.2.3, 3.2.7, 3.2.9 ; alimente les objectifs (3.7.2) et peut être une métrique cible.

#### 3.4.2 Corrélation entre émotion déclarée et résultat
- **Description** : croise `Trade.émotionAvant/Pendant/Après` (3.2.2) avec le résultat (gagnant/perdant, R-multiple).
- **Dépendances** : 3.2.2.

#### 3.4.3 Streak de trades gagnants/perdants
- **Description** : suivi des séries consécutives, pour repérer un état de "tilt" (dérive émotionnelle après une série de pertes).
- **Dépendances** : alimente l'alerte temps réel 3.6.1.

#### 3.4.4 Trades hors plan vs dans le plan
- **Description** : comparaison de la performance (3.3) entre les trades où `planRespecté = non` et ceux où `planRespecté = oui`.
- **Dépendances** : 3.2.3.

#### 3.4.5 Détection automatique de patterns dangereux
- **Description** : détection algorithmique de séquences à risque, ex. augmentation de la taille de position juste après une perte (revenge trading), sur la base de l'historique des trades.
- **Dépendances** : 3.1.1 (taille), 3.4.3 (streak) ; sert de base de calibration à l'alerte temps réel équivalente (3.6.4), la détection a posteriori affinant les seuils utilisés en temps réel.

#### 3.4.6 Suivi du "rule adherence"
- **Description** : pour chaque `Règle` personnelle (2.4), taux de respect dans le temps, avec tendance (amélioration/dégradation).
- **Dépendances** : 2.4.

#### 3.4.7 Fréquence des erreurs typées
- **Description** : classification des erreurs (sortie prématurée, overtrading, mauvaise gestion du risque, absence de plan...) et comptage de leur fréquence.
- **Données** : peut s'appuyer sur des tags d'erreur dédiés saisis au post-mortem (3.2.4) ou déduits des règles non respectées (2.4).
- **Dépendances** : 3.2.4, 2.4.

#### 3.4.8 Vue "erreurs récurrentes" avec compteur cliquable
- **Description** : liste des erreurs de 3.4.7 avec un compteur ; cliquer sur une erreur affiche la liste des trades concernés.
- **Dépendances** : 3.4.7.

#### 3.4.9 Corrélation avec facteurs externes déclarés
- **Description** : croise les facteurs déclarés dans le journal quotidien (sommeil, fatigue, heure tardive — 3.2.6) avec la qualité des trades du jour (note d'exécution 3.2.9, résultat 3.3).
- **Dépendances** : 3.2.6.

#### 3.4.10 Vue "premier trade du jour" vs "trades suivants"
- **Description** : compare la performance et la discipline du premier trade de la journée à celles des trades suivants, la discipline ayant tendance à se dégrader après plusieurs trades.
- **Dépendances** : 3.1.1 (ordre chronologique des trades du jour), 3.4.1.

#### 3.4.11 Benchmark contre un objectif de risque max par trade
- **Description** : compare, trade par trade, le risque effectivement pris (3.3.12) à l'objectif de risque max défini par l'utilisateur, en mettant en évidence les dépassements.
- **Dépendances** : 3.3.12, 2.4 (peut être formalisé comme une règle personnelle).

---

### 3.5 Module — Insights / IA

Ce module ne crée pas de nouvelles données : il **synthétise et met en avant** des informations déjà calculées dans les modules 3.3 et 3.4, sous une forme actionnable.

#### 3.5.1 Alertes automatiques de tendance
- **Description** : détection de dérives progressives (ex. "taille de position augmentée de 23 % sur les 10 derniers trades") et notification proactive.
- **Dépendances** : 3.3.21 (scaling du capital), 3.4.5 (patterns dangereux).

#### 3.5.2 Mise en avant du meilleur setup / meilleure session
- **Description** : synthèse automatique pointant les segments (3.3.9) les plus performants.
- **Dépendances** : 3.3.9.

#### 3.5.3 Suggestions d'amélioration personnalisées
- **Description** : recommandations textuelles générées à partir des erreurs récurrentes (3.4.7/3.4.8) et des corrélations identifiées (3.4.2, 3.4.9).
- **Dépendances** : 3.4.7, 3.4.8, 3.4.2, 3.4.9.

---

### 3.6 Module — Alertes à seuils (garde-fous en temps réel)

Contrairement au module 3.4 (analyse a posteriori), ce module intervient **au moment de la saisie ou en continu dans la journée**, pour prévenir une dérive avant qu'elle ne s'aggrave. Tous les seuils sont **paramétrables par l'utilisateur** (3.6.7) — aucune valeur n'est figée en dur dans l'application.

#### 3.6.1 Alerte "risque d'overtrading" (pertes consécutives)
- **Description** : déclenchée après X trades perdants d'affilée dans la journée (X paramétrable).
- **Dépendances** : 3.4.3 (streak).

#### 3.6.2 Alerte fréquence
- **Description** : déclenchée si X trades sont pris dans un laps de temps trop court (X et durée paramétrables).
- **Dépendances** : 3.1.1 (horodatage des trades).

#### 3.6.3 Alerte "stop pour aujourd'hui" (perte journalière/hebdo)
- **Description** : déclenchée quand la perte cumulée du jour ou de la semaine dépasse un seuil en % du capital.
- **Dépendances** : 3.3.12 (risque en % du capital), 3.3.6 (drawdown en cours).

#### 3.6.4 Alerte "revenge trading" (taille de position anormale après perte)
- **Description** : déclenchée si la taille de position est anormalement plus élevée que la moyenne juste après un trade perdant.
- **Dépendances** : 3.4.5 (calibration du seuil "anormal" à partir de l'historique détecté).

#### 3.6.5 Alerte trade hors horaires/sessions habituels
- **Description** : déclenchée si un trade est pris en dehors des sessions habituelles du trader (3.1.6).
- **Dépendances** : 3.1.6.

#### 3.6.6 Alerte "trade sans stop loss"
- **Description** : blocage/avertissement avant validation de la saisie si aucun SL prévu n'est renseigné (3.1.2).
- **Dépendances** : 3.1.2.

#### 3.6.7 Seuils personnalisables
- **Description** : chaque seuil des alertes 3.6.1 à 3.6.6 est configurable par l'utilisateur dans un écran de paramètres dédié — aucune règle n'est imposée par défaut de façon rigide (des valeurs par défaut raisonnables sont proposées à l'installation, mais toutes modifiables).
- **Dépendances** : transversal à tout le module 3.6.

#### 3.6.8 Alerte trading pendant news économiques majeures
- **Description** : déclenchée si un trade est pris pendant une plage de news économique majeure (CPI/NFP/FOMC), si les statistiques de l'utilisateur (3.3.9, segmentées par condition de marché "news économique", 3.1.6) montrent que ces trades sont statistiquement moins bons pour lui.
- **Règles de gestion** : nécessite une source de calendrier économique externe pour dater les événements majeurs.
- **Dépendances** : 3.1.6, 3.3.9.

#### 3.6.9 Système de "règles personnelles" éditables et cochées par trade
- **Description** : plutôt que des seuils génériques uniquement, l'utilisateur définit ses propres règles en texte libre (ex. "jamais trader après 15h", "max 3 trades/jour"), cochées comme respectées ou non à chaque trade.
- **Données** : objet `Règle` (cf. 2.4).
- **Règles de gestion** : une règle peut exister uniquement à titre déclaratif (analyse a posteriori, 3.4.6) ou être reliée à un seuil actif (alerte temps réel équivalente parmi 3.6.1 à 3.6.6) quand elle est quantifiable.
- **Dépendances** : c'est l'objet pivot qui relie le journal qualitatif (3.2), l'analyse comportementale (3.4.6) et les alertes temps réel (3.6.1 à 3.6.6) — cf. section 4 pour la vue d'ensemble de cette articulation.

---

### 3.7 Module — Autres fonctionnalités

#### 3.7.1 Calendrier de trading (vue mensuelle avec PnL par jour)
- **Description** : vue mensuelle affichant le PnL de chaque jour tradé.
- **Dépendances** : 3.3.1, base commune avec la heatmap (3.3.11).

#### 3.7.2 Objectifs mensuels et suivi
- **Description** : définition d'un `Objectif` (2.8) par mois sur une métrique choisie (PnL, win rate, score de discipline...) et suivi de sa progression.
- **Dépendances** : peut cibler n'importe quelle métrique du module 3.3 ou 3.4.1.

#### 3.7.3 Export CSV/PDF pour bilan fiscal
- **Description** : export de l'historique des trades et des PnL sur une période donnée, dans un format exploitable pour la déclaration fiscale.
- **Dépendances** : 3.1 (données brutes des trades), 3.7.6 (filtre par période).

#### 3.7.4 Mode "replay" / historique consultable rapidement
- **Description** : parcours rapide de l'historique des trades, filtrable notamment par la notation manuelle (3.1.8), avec accès au screenshot (3.1.4), à la thèse (3.2.1) et au post-mortem (3.2.4).
- **Dépendances** : 3.1.4, 3.1.8, 3.2.1, 3.2.4.

#### 3.7.5 Multi-comptes
- **Description** : gestion de plusieurs `Compte` (2.1) en parallèle (ex. compte principal / compte prop firm / démo), avec bascule entre comptes ou vue consolidée.
- **Dépendances** : socle transversal (2.1) ; tous les modules de stats (3.3) doivent être filtrables par compte.

#### 3.7.6 Comparaison de performance entre comptes/brokers
- **Description** : met en regard les indicateurs de performance (3.3) de plusieurs comptes, pouvant révéler un problème d'exécution ou de spread côté broker plutôt qu'un problème de stratégie.
- **Dépendances** : 3.7.5.

#### 3.7.7 Export/partage d'un trade individuel en "carte de trade"
- **Description** : génération d'une image de synthèse d'un trade (setup, résultat, graphique) destinée au partage.
- **Dépendances** : 3.1.4 (screenshot), 3.1.5 (setup), 3.3.1 (résultat).

#### 3.7.8 Filtre par période et comparaison à la période précédente
- **Description** : filtre global (1J/1S/1M/3M/1A/Tout) applicable à l'ensemble des vues statistiques, avec comparaison automatique à la période précédente équivalente.
- **Dépendances** : transversal à tout le module 3.3 ; base de la comparaison an-1 (3.3.19).

#### 3.7.9 Exposition au risque par catégorie d'actif
- **Description** : répartition du risque pris (3.3.12) par catégorie d'actif (indices, forex, crypto...).
- **Dépendances** : 3.1.1 (catégorie d'actif), 3.3.12.

#### 3.7.10 Suivi des dépôts/retraits séparé de la performance
- **Description** : les mouvements de capital (dépôts, retraits) sont enregistrés séparément des trades, afin de ne pas fausser la courbe d'équité (3.3.7) ni les indicateurs de performance.
- **Données** : `Compte.historiqueDépôtsRetraits` (2.1).
- **Dépendances** : 3.3.7, 2.1 — règle de gestion fondamentale à respecter dans tous les calculs de performance du module 3.3.

---

## 4. Cohérence transversale — comment les modules s'articulent

Cette section explicite les grands **fils de données** qui traversent plusieurs modules, afin qu'aucune fonctionnalité ne soit développée comme un silo isolé.

1. **Le fil "risque"** : `SL prévu` (3.1.2) → `R-multiple` (3.3.8) → `Expectancy` (3.3.3) → `Risque en % du capital` (3.3.12) → `Alerte de dépassement de risque` (3.6.3, 3.4.11) → `Vue scaling du capital` (3.3.21).
2. **Le fil "discipline"** : `Règles personnelles` (2.4) + `Checklist pré-trade` (3.2.7) + `Respect du plan` (3.2.3) → `Note de qualité d'exécution` (3.2.9) → `Score de discipline` (3.4.1) → `PnL simulé si plan respecté` (3.3.14) → `Objectifs` (3.7.2) sur la discipline elle-même.
3. **Le fil "émotion/comportement"** : `Émotions déclarées` (3.2.2) → `Corrélation émotion/résultat` (3.4.2) → `Détection de patterns dangereux` (3.4.5) → `Alertes temps réel équivalentes` (3.6.1, 3.6.4).
4. **Le fil "confiance"** : `Conviction pré-trade` (3.1.9) + `Trades manqués` (3.2.5) → `Repérage d'un manque de confiance récurrent` (3.4.5, extension) → `Suggestions personnalisées` (3.5.3).
5. **Le fil "segmentation"** : `Tags` (setup, timeframe, session, condition de marché — 3.1.5, 3.1.6) → `Performance par segment` (3.3.9) → `Mise en avant du meilleur setup/session` (3.5.2) → `Comparaison de stratégies` (3.3.16).
6. **Le fil "capital"** : `Dépôts/retraits` (3.7.10) séparés → `Courbe d'équité pure` (3.3.7) ; `Capital courant` (2.1) → `Risque en %` (3.3.12) → `Taille de position vs croissance du compte` (3.3.21).
7. **Le fil "règles personnelles"** (objet pivot, cf. 3.6.9) : une règle définie une fois (2.4) est simultanément : cochée sur chaque trade (saisie), source du "rule adherence" (analyse comportementale), et source d'un seuil d'alerte en temps réel quand elle est quantifiable — évitant de dupliquer la définition d'une même contrainte à trois endroits différents de l'application.

**Conséquence pour le développement** : les modules 3.1 (saisie) et 2 (modèle de données) doivent être conçus en premier et de façon extensible, car toutes les statistiques, l'analyse comportementale et les alertes n'existent que par lecture de ces données. Un champ mal conçu à la saisie (ex. un tag "setup" en texte libre non normalisé) dégrade la fiabilité de plusieurs modules en aval simultanément.

---

## 5. Priorisation fonctionnelle (V1 / V2 / V3)

Le document source indiquait explicitement qu'un tri serait fait pour la V1. Proposition de phasage, à valider :

### V1 — Socle indispensable
- Saisie de trade complète (3.1.1 à 3.1.7, hors mode confiance)
- Le "pourquoi" du trade : thèse, émotions, respect du plan, post-mortem (3.2.1 à 3.2.4)
- Checklist pré-trade (3.2.7)
- Statistiques de base : PnL, win rate, R:R réel, expectancy, profit factor, max drawdown, courbe d'équité (3.3.1 à 3.3.7)
- Performance par segment simple (3.3.9)
- Calendrier de trading (3.7.1)
- Règles personnelles éditables + cochage par trade, sans alerte temps réel (3.6.9, volet déclaratif)
- Multi-comptes basique (3.7.5)
- Export CSV (3.7.3)
- Filtre par période (3.7.8)
- Suivi dépôts/retraits séparé (3.7.10)

### V2 — Analyse comportementale et garde-fous
- Mode confiance (3.1.9), trades manqués (3.2.5), journal quotidien (3.2.6) + rappel (3.2.8)
- Note de qualité d'exécution (3.2.9) et score de discipline (3.4.1)
- Distribution des R-multiples, heatmap, long vs short, risque en % (3.3.8, 3.3.10 à 3.3.12)
- Analyse comportementale complète (streaks, hors-plan vs plan, erreurs récurrentes, corrélations — 3.4.2 à 3.4.10)
- Toutes les alertes à seuils temps réel (3.6.1 à 3.6.8)
- Objectifs mensuels (3.7.2)
- Mode replay (3.7.4)

### V3 — Approfondissement et intelligence
- Insights/IA (alertes de tendance, suggestions personnalisées — 3.5.1 à 3.5.3)
- Comparaison de stratégies et système vs discrétionnaire (3.3.16, 3.3.17)
- Coût d'opportunité, comparaison an-1, scaling du capital (3.3.18 à 3.3.21)
- Comparaison entre comptes/brokers (3.7.6)
- Carte de trade partageable (3.7.7)
- Benchmark risque max par trade (3.4.11)

---

## 6. Exigences non-fonctionnelles

- **Confidentialité des données** : les données de trading sont sensibles (PnL, capital) ; chiffrement au repos et en transit recommandé, accès protégé par authentification.
- **Sauvegarde et export** : possibilité d'exporter l'intégralité des données à tout moment (au-delà du seul export fiscal 3.7.3), pour éviter tout verrouillage des données de l'utilisateur.
- **Performance** : les écrans de statistiques (section 3.3) doivent rester réactifs même avec un historique de plusieurs milliers de trades.
- **Mode sombre/clair** : les deux thèmes doivent être supportés (détail visuel traité en annexe, section 8).
- **Accessibilité multi-support** : usage envisagé sur ordinateur en priorité, avec consultation mobile a minima pour la saisie rapide (3.1.7) et les alertes (3.6).
- **Fiabilité des calculs** : toute métrique affichée (cf. glossaire, section 7) doit être recalculée depuis les données sources, jamais mise en cache de façon incohérente entre deux vues.

---

## 7. Glossaire des métriques (référence de calcul)

Ce glossaire garantit que chaque métrique est implémentée de façon identique partout où elle apparaît dans l'application.

- **R-multiple** : résultat d'un trade exprimé en multiple du risque initial. `R = (Prix de sortie − Prix d'entrée) × sens / (Prix d'entrée − SL prévu)`. Nécessite un SL prévu renseigné (3.1.2).
- **Expectancy (espérance en R)** : `(Win rate × R moyen des gains) − (Taux de perte × R moyen des pertes)`. Indique le gain moyen attendu par trade, en unités de risque.
- **Profit factor** : `Somme des gains / Somme des pertes (en valeur absolue)` sur la période considérée.
- **Win rate** : `Nombre de trades gagnants / Nombre total de trades clôturés`.
- **Ratio gain moyen / perte moyenne (R:R réel)** : `Gain moyen des trades gagnants / Perte moyenne des trades perdants`, à ne pas confondre avec le R:R théorique prévu à l'entrée.
- **Max drawdown** : plus grande baisse observée entre un point haut et le point bas suivant de la courbe d'équité (3.3.7), en % du capital.
- **Drawdown en cours** : baisse actuelle depuis le dernier point haut du capital.
- **Sharpe ratio** : `(Rendement moyen − taux sans risque) / Écart-type des rendements`, sur la période considérée.
- **PnL brut** : résultat du trade avant frais. **PnL net** : après déduction des frais/commissions (3.1.3).
- **Courbe d'équité pure** : évolution du capital liée uniquement à la performance de trading, en excluant les dépôts/retraits (3.7.10).

---

## 8. Annexe — Identité visuelle (à traiter ultérieurement)

Cette section conserve les pistes déjà évoquées, pour mémoire, dans l'attente du document de charte graphique dédié :

- Palette sombre (fond quasi-noir), accents colorés : vert/rouge pour gains/pertes, violet/bleu pour la donnée.
- Cards bien hiérarchisées avec mini-graphiques de type sparkline.
- Jauges circulaires pour les scores (ex. score de discipline, 3.4.1).
- Mode sombre/clair au choix (cf. exigence non-fonctionnelle, section 6).
- Références visuelles à consulter : captures d'inspiration du 25/08 (Trade OS, TradeJournal, Tradelog).

---

## 9. Points ouverts / décisions produit à trancher avant développement

- Formule exacte de pondération du score de discipline (3.4.1) — quelles composantes pèsent le plus.
- Faut-il estimer un "PnL fictif" sur les trades manqués (3.2.5), et selon quelle méthode ?
- Source de données pour le calendrier économique (3.6.8) et pour le suivi du prix post-clôture (3.3.18, coût d'opportunité) — nécessite potentiellement une API de marché tierce.
- Granularité du multi-comptes : vue consolidée automatique ou uniquement par bascule manuelle (3.7.5) ?
- Valeurs par défaut proposées pour les seuils d'alerte (3.6.7) à l'installation.
