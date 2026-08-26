# Pulse — Plan de développement V1 (Claude Code)

Objectif : une V1 qui couvre quasiment tout le cahier des charges, construite phase par phase avec Claude Code. Chaque phase = une session de travail avec un prompt précis à copier-coller.

Avant de commencer, dans le terminal, à la racine du projet :
```
git status
gh auth status
```
- `git status` confirme que le dossier est bien un repo Git.
- `gh auth status` confirme si GitHub est connecté sur cet ordinateur (l'app mobile et l'ordinateur sont deux connexions séparées, l'une n'implique pas l'autre).
Si `gh auth status` dit "not logged in" : lancer `gh auth login` et suivre les étapes avant la Phase 0.

---

## Phase 0 — Fondations du projet
**Modèle : Sonnet | Effort : faible**
Poser l'ossature technique. Pas de logique complexe, juste de la structure — Sonnet suffit largement et c'est plus rapide/moins cher qu'Opus pour ce genre de tâche.

**Prompt Claude Code :**
```
Initialise un projet React + Vite + TypeScript + Tailwind CSS pour une app appelée "Pulse".
Configure Tailwind avec cette palette de couleurs custom dans tailwind.config :
- background: #0B0E27
- surface: #1E2347
- primary: #4A5FD9
- accent: #8B7FE8
- cream: #F0EDE4
- success: #6FA88A
- danger: #D96659

Utilise la police Inter (via Google Fonts) comme police par défaut.
Mets en place la structure de dossiers : /components, /pages, /lib, /types, /hooks.
Crée un fichier de types TypeScript pour un objet "Trade" avec tous les champs suivants :
asset, side (long/short), entryPrice, exitPrice, size, stopLoss, takeProfit, fees,
date, session, setup, timeframe, marketCondition, confidenceLevel (1-10),
emotionBefore, emotionAfter, followedPlan (boolean), thesis, postMortem,
executionQuality (1-5), starRating (1-5), screenshot (url optionnelle), closed (boolean).

Mets en place le stockage local des données (localStorage pour cette V1, structuré
pour pouvoir migrer vers une vraie base de données plus tard sans tout casser).

Initialise un repo Git si ce n'est pas déjà fait, fais un premier commit "Initial setup".
Ne code aucune UI pour l'instant, juste la structure.
```

---

## Phase 1 — Saisie de trade complète
**Modèle : Sonnet | Effort : moyen**
Formulaire avec beaucoup de champs mais une logique simple (CRUD classique). Sonnet gère très bien ça.

**Prompt Claude Code :**
```
Construis le formulaire de saisie/édition d'un trade (composant TradeForm) en utilisant
le type Trade déjà défini. Organise le formulaire en sections claires :
1. Infos de base (actif, sens long/short, date, session, timeframe)
2. Prix et taille (entrée, sortie, taille, stop loss, take profit, frais)
3. Contexte (setup, condition de marché : range/tendance/forte volatilité/news)
4. Le "pourquoi" (thèse d'entrée, niveau de confiance 1-10 avant résultat,
   émotion avant/après avec une liste déroulante, case à cocher "plan respecté")
5. Après coup (note d'exécution 1-5 séparée du résultat, notation étoiles 1-5,
   post-mortem en texte libre)

Calcule et affiche le PnL en temps réel dans le formulaire dès que prix d'entrée,
sortie et taille sont remplis.

Ajoute aussi un mode "trade non pris" : un formulaire allégé pour noter un setup vu
mais pas tradé (juste actif, date, raison du renoncement, ce qui s'est passé ensuite).

Respecte la charte graphique Pulse : boutons en forme de pilule, fond sombre #0B0E27,
accents bleu #4A5FD9 / violet #8B7FE8, coins très arrondis.

Sauvegarde chaque trade dans le storage local mis en place en Phase 0.
Fais un commit "Trade form + not-taken trades".
```

---

## Phase 2 — Liste des trades + vue détail
**Modèle : Sonnet | Effort : moyen**

**Prompt Claude Code :**
```
Construis la page "Trades" : un tableau listant tous les trades enregistrés
(triable par date, filtrable par setup/actif/session), avec code couleur
vert/rouge selon le PnL.

Au clic sur une ligne, ouvre une vue détail (modal ou panneau latéral) qui affiche
tous les champs du trade, y compris la thèse, les émotions, le post-mortem,
la notation étoiles, et le screenshot si présent (upload d'image simple,
stocké en base64 dans le storage local pour cette V1).

Ajoute un bouton "Nouveau trade" en haut à droite qui ouvre le TradeForm de la Phase 1,
et un bouton "Voir les trades non pris" séparé.

Ajoute la fonctionnalité d'export CSV de tous les trades (bouton "Exporter").
Fais un commit "Trades list + detail view + CSV export".
```

---

## Phase 3 — Dashboard et stats de base
**Modèle : Sonnet | Effort : moyen-élevé**
Les calculs (win rate, expectancy, profit factor, drawdown) sont mécaniques mais nombreux — toujours dans les cordes de Sonnet, juste prévoir plus de temps.

**Prompt Claude Code :**
```
Construis la page Dashboard avec les stats calculées à partir de tous les trades clôturés :
- PnL total (brut et net des frais), en € et en %
- Win rate, gain moyen, perte moyenne, ratio R:R réel
- Expectancy (espérance mathématique par trade)
- Profit factor
- Max drawdown et drawdown en cours
- Courbe d'équité dans le temps (graphique, utilise recharts)
- Distribution des trades gagnants/perdants (donut chart)

Affiche ces stats dans des cards avec mini sparkline, façon la maquette Pulse
(fond #1E2347 sur les cards, texte clair, accents bleu/violet).

Ajoute un sélecteur de période en haut (1D/1W/1M/3M/1Y/ALL) qui recalcule
toutes les stats sur la période choisie, avec comparaison au chiffre de la
période précédente équivalente (ex: "+13% vs mois dernier").

Fais un commit "Dashboard with core stats".
```

---

## Phase 4 — Analyses avancées (setup, session, temporel)
**Modèle : Sonnet | Effort : moyen-élevé**

**Prompt Claude Code :**
```
Ajoute une page "Analytics" avec ces vues :
- Performance par setup (tableau + graphique en barres, PnL et win rate par setup)
- Performance par actif individuel
- Performance par jour de la semaine et par heure de la journée (heatmap)
- Long vs Short (répartition et PnL comparé)
- Distribution des R-multiples (histogramme)
- Comparaison système (règle mécanique) vs discrétionnaire, si le trade a été tagué comme tel
  (ajoute ce champ "tradeType" dans le type Trade et dans le formulaire de la Phase 1)
- Ratio temps passé en position : durée moyenne trades gagnants vs perdants
  (ajoute les champs "entryTime" et "exitTime" si pas déjà présents pour calculer la durée)
- Vue "coût d'opportunité" : différence entre le take profit prévu et le prix
  réellement atteint après la sortie (nécessite un champ optionnel "priceAfterExit"
  que l'utilisateur peut renseigner plus tard sur un trade déjà clôturé)

Utilise recharts pour tous les graphiques, respecte la charte graphique Pulse.
Fais un commit "Advanced analytics page".
```

---

## Phase 5 — Analyse comportementale
**Modèle : Opus | Effort : élevé**
Ici on croise plusieurs dimensions entre elles (émotion × résultat, séquences de trades, détection de patterns) — de la vraie logique d'analyse, pas juste de l'affichage. Opus est plus fiable pour éviter les erreurs de logique sur des calculs imbriqués.

**Prompt Claude Code :**
```
Ajoute une page "Comportement" avec :
- Score de discipline global sur 100 (jauge circulaire), calculé à partir de :
  respect du plan, absence de revenge trading détecté, respect du risque max déclaré
  (permets à l'utilisateur de définir ce risque max en % dans un écran de réglages)
- Corrélation émotion déclarée (avant trade) vs résultat : barres horizontales
  montrant le PnL total et le win rate pour chaque émotion
- Détection de streaks : série de gains/pertes en cours et la plus longue série historique
- Comparaison trades "dans le plan" vs "hors plan" (PnL moyen, win rate des deux groupes)
- Vue "premier trade du jour" vs "trades suivants" : comparer la performance
  moyenne du 1er trade de chaque journée vs les trades pris après
- Vue "erreurs récurrentes" : si l'utilisateur tague un trade avec un type d'erreur
  (ajoute un champ multi-select "mistakeTypes" dans le formulaire : early exit,
  overtrading, poor risk management, no plan, revenge trade, autre), affiche
  un classement des erreurs les plus fréquentes avec le PnL cumulé perdu à cause
  de chacune, cliquable pour voir les trades concernés

Sois rigoureux sur les calculs de corrélation et de détection de séquences,
ce sont des stats qui doivent être fiables pour être utiles.
Fais un commit "Behavioral analysis page".
```

---

## Phase 6 — Alertes à seuils et règles personnelles
**Modèle : Opus | Effort : élevé**
De la vraie logique conditionnelle avec des seuils personnalisables et plusieurs règles qui interagissent. C'est la phase la plus délicate à bien faire fonctionner sans bug — Opus recommandé.

**Prompt Claude Code :**
```
Ajoute un écran "Réglages" où l'utilisateur définit ses propres seuils d'alerte :
- Nombre de trades perdants d'affilée avant alerte overtrading (défaut : 3)
- Perte journalière max en % du capital avant alerte "stop pour aujourd'hui" (défaut : 3%)
- Risque max autorisé par trade en % du capital (défaut : 1%)
- Liste de règles personnelles éditables en texte libre (ex: "jamais trader après 15h"),
  avec possibilité d'ajouter/supprimer des règles

Sur le Dashboard, ajoute une zone "Alertes actives" qui affiche en temps réel,
recalculée à chaque nouveau trade ajouté :
- Alerte si le nombre de pertes d'affilée dans la journée dépasse le seuil défini
- Alerte si la perte du jour dépasse le seuil % du capital défini
- Alerte si un trade récent a une taille de position anormalement plus grosse
  que la moyenne des 10 derniers trades ET qu'il suit une perte (signal de revenge trading)
- Alerte si un trade a été saisi sans stop loss renseigné

Sur le formulaire de saisie de trade (Phase 1), ajoute une checklist des règles
personnelles définies dans les réglages, à cocher avant de pouvoir valider le trade.

Fais un commit "Threshold alerts + personal rules system".
```

---

## Phase 7 — Calendrier, objectifs et finitions
**Modèle : Sonnet | Effort : moyen**
Retour à des fonctionnalités plus simples d'affichage/CRUD, Sonnet reprend la main.

**Prompt Claude Code :**
```
Ajoute une page "Calendrier" : vue mensuelle avec le PnL du jour affiché dans chaque
case, code couleur vert/rouge selon l'intensité du gain/perte, clic sur un jour
pour voir les trades de ce jour-là.

Ajoute une page "Objectifs" : l'utilisateur définit un objectif mensuel
(profit cible, ou win rate cible, ou nombre de trades), avec une barre de progression
mise à jour automatiquement.

Ajoute le suivi des dépôts/retraits de capital, séparé du PnL de trading,
pour que la courbe d'équité ne soit pas faussée par un dépôt externe.

Ajoute le multi-comptes : possibilité de créer plusieurs comptes (ex: "Compte principal",
"Prop firm X"), chaque trade est rattaché à un compte, et un sélecteur en haut
de l'app permet de basculer entre "Tous les comptes" et un compte spécifique.

Fais un commit "Calendar, goals, multi-account, deposits tracking".
```

---

## Phase 8 — Polish visuel et responsive
**Modèle : Sonnet | Effort : moyen**

**Prompt Claude Code :**
```
Passe en revue toute l'application pour :
- Vérifier la cohérence de la charte graphique Pulse partout (couleurs exactes,
  boutons en forme de pilule, effet glow subtil sur les éléments d'accent)
- Rendre l'app responsive (mobile, tablette, desktop) — c'est un usage
  principalement mobile donc priorise cet affichage
- Ajouter des états vides propres (ex: "Aucun trade enregistré" avec incitation
  à en ajouter un) partout où une liste peut être vide
- Ajouter des transitions douces sur les changements d'onglet et l'ouverture des modals
- Vérifier qu'aucune donnée sensible ne fuit dans la console ou le localStorage
  de façon non structurée

Fais un commit final "V1 polish + responsive".
Une fois terminé, propose un plan de test manuel : liste les 15-20 actions
à tester pour valider que toute la V1 fonctionne (ajouter un trade, vérifier
les stats, déclencher une alerte, etc.).
```

---

## Récap modèle/effort par phase

| Phase | Contenu | Modèle | Effort |
|---|---|---|---|
| 0 | Fondations projet | Sonnet | Faible |
| 1 | Formulaire de saisie | Sonnet | Moyen |
| 2 | Liste + détail trades | Sonnet | Moyen |
| 3 | Dashboard stats de base | Sonnet | Moyen-élevé |
| 4 | Analytics avancées | Sonnet | Moyen-élevé |
| 5 | Analyse comportementale | **Opus** | Élevé |
| 6 | Alertes à seuils | **Opus** | Élevé |
| 7 | Calendrier/objectifs/finitions | Sonnet | Moyen |
| 8 | Polish visuel | Sonnet | Moyen |

Règle générale : Sonnet pour tout ce qui est CRUD, affichage, formulaires, graphiques simples.
Opus pour les phases où plusieurs règles/calculs interagissent entre eux et où une erreur
de logique serait difficile à repérer à l'œil (comportemental, alertes).

## Non inclus dans cette V1 (à ajouter plus tard si besoin)
- Import automatique broker/CSV
- Simulateur "et si" (what-if)
- Export PDF
- Mode replay / rejouer un trade
- Comparaison entre comptes/brokers réels (au-delà du multi-compte simple)
- Rappels/notifications push (nécessite une vraie backend, pas juste du local)
