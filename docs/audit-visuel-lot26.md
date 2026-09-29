# Audit visuel — lot 26

Audit fait **avant toute modification** avec `scripts/visual-audit.mjs` (Playwright, Chromium headless, faux backend du navigateur) : 26 écrans/onglets + 6 états (mode édition du dashboard, bibliothèque de widgets, carte de trade, réglages sécurité, réglages données/PDF, écran de verrouillage), à 1280×720, 1440×900, 1920×1080 et 2560×1440, en état **vide** (aucune donnée) et **chargé** (jeu de démonstration de `scripts/seed-demo.mjs` : 2 comptes, 47 trades dont un ouvert sans stop, règles, checklist, journal, objectifs, trades manqués). Au total 232 vues inspectées automatiquement (défilement horizontal, éléments hors fenêtre, texte coupé, cibles trop petites, éléments sans nom accessible, focus invisible, tailles de titres) puis relues à l'œil sur les captures. Captures « avant » : `docs/captures/lot26-avant-*.png`.

**Limite honnête** : Chromium sous Linux, faux backend. Rien n'a été vérifié sur un vrai Windows / WebView2, ni avec un lecteur d'écran, ni sur un écran physique très grand.

## Ce que l'audit automatique a trouvé (et ce qu'il n'a pas trouvé)
- Titres de page : **28 px / 600 partout** (26 écrans) — cohérent.
- Focus clavier : **visible partout** (14 tabulations par écran, aucun focus invisible détecté) ; mais 3 styles différents (contour blanc navigateur sur les liens de la barre latérale, contour violet ailleurs, anneau sur les champs).
- Aucune erreur JavaScript dans la console sur les 232 vues.
- 1 seul défilement horizontal, sur Replay à 1280 px.

## Défauts (D = à corriger dans ce lot, S = signalé sans correction, hors périmètre)

### Navigation et coque
| # | Défaut | Où | Statut |
|---|---|---|---|
| 1 | **La barre latérale déborde à 720 px de haut** : 14 entrées sur une seule liste sans défilement, « Calculateur » et « Paramètres » sont hors de l'écran à 1280×720 (fenêtre minimale de la charte). | toutes | D : regroupement + défilement + mode compact |
| 2 | Aucun regroupement : Insights, Coach, Calculateur, Comparaisons… sont mélangés avec les écrans de base. | Sidebar | D |
| 3 | Les adresses `/alerts` et `/calendar/news` n'allument aucune entrée de la barre latérale (impossible de savoir où l'on est). | Sidebar | D (entrée active héritée) |
| 4 | La cloche de la barre du haut ne fait rien (bouton mort avec un libellé « Notifications »). | TopBar | D : elle ouvre l'historique des alertes |
| 5 | Les boutons de période (1J … Tout) n'ont pas de style de focus dédié ; le sélecteur de compte fait 20 px de haut (cible trop petite). | TopBar | D |
| 6 | Les deux bandeaux (garde-fou + rappel du journal) prennent ~250 px de haut avant le titre de la page : à 720 px, le contenu commence à mi-écran. Les boutons passent sous le texte même à 1440 px. | AlertBanner, ReminderBanner | D : disposition compacte |
| 7 | Bandeau du garde-fou : trois lignes pour une seule alerte (titre, message, « Voir l'historique »). | AlertBanner | D |

### Mise en page
| # | Défaut | Où | Statut |
|---|---|---|---|
| 8 | **Replay à 1280 px : la colonne « Les niveaux du trade » dépasse de sa carte de 35 px** (valeur en R hors carte) → défilement horizontal du contenu. | ReplayPage | D |
| 9 | **Comportement : la carte « Simulation » est trop étroite** : le tableau des trois scénarios écrit un mot par ligne (« Sans / hors / plan / 11 retirés »). Les deux cartes voisines sont hautes et presque vides. | BehaviorPage / PlanCard | D |
| 10 | Mode édition du dashboard : la barre de poignée de chaque widget **recouvre son titre** (« Capital » écrit deux fois l'un sur l'autre, « P&L NET » sous la barre). | EditableGrid | D |
| 11 | KPI du dashboard : la mini-courbe est **coupée en bas** de la carte (surtout à 1920 et 2560). | widgets KPI | D si simple, sinon S |
| 12 | Titre de page **sous** un sélecteur d'onglets sur Calendrier (onglets puis titre) alors que Journal et Analyses mettent le titre d'abord : ordre incohérent. | CalendarPage | D |
| 13 | Détail d'un trade : ligne de dates se termine par « · » orphelin quand la session est vide ; « — · net de 1,50 $ de frais » commence par un tiret sans sens quand il n'y a pas de R. | TradeDetailPage | D |
| 14 | Paramètres : page très longue (13 sections) sans aucun repère de navigation interne. | SettingsPage | D : raccourcis de section |
| 15 | Aperçu de la bibliothèque de widgets : « Chargement… » en 10 px au centre d'une grande zone vide pendant l'affichage. | WidgetLibrary | S (aucune incidence fonctionnelle) |

### Cohérence (montants, boutons, composants)
| # | Défaut | Où | Statut |
|---|---|---|---|
| 16 | **Montants avec un nombre de décimales variable** : « +213,453 $ », « +11,934 $ » (3 décimales) à côté de « −17,80 $ » ; capital « 62 213,453 $ » à côté de « 60 000,00 $ ». Le calendrier écrit « +11,253 » sans devise. Cause : `formatMoney` ne retire que les zéros de fin et conserve les décimales saisies (prix à 4-5 décimales × multiplicateur). | dashboard, calendrier, listes | D : **arrondi au centime à l'affichage seulement** (comme les Analyses), la valeur exacte reste celle de `pulse-core` |
| 17 | Bandeaux : le composant `Notice` place toujours les actions sous le texte ; pas de variante compacte. | ui.tsx | D |
| 18 | Deux façons d'écrire un lien-bouton : `btn-link` (14 px, 20 px de haut) et des liens `text-tx-accent underline` faits à la main (15 px de haut) ; « Modifier / Archiver / Supprimer » de Paramètres en 13 px `text-tx-accent` sans classe commune. | plusieurs | D : un seul `btn-link` |
| 19 | États vides : un `EmptyState` sans icône ; certains écrans écrivent leur propre message dans un `<p>` (Coach, Replay, Insights). | plusieurs | D : icône + phrase + action dans `EmptyState` |
| 20 | Deux styles d'onglets : `Segmented` (42 px, rempli en dégradé) pour Analyses/Journal, pilules pour le calendrier, boutons-texte ailleurs. | plusieurs | S partiel (la couche `Segmented` reste la référence) |

### Accessibilité
| # | Défaut | Où | Statut |
|---|---|---|---|
| 21 | **Boîtes de dialogue sans piège de focus** : Tab sort de la boîte vers la page derrière ; le fond reste accessible aux lecteurs d'écran. | `Modal` | D |
| 22 | Le tiroir « Bibliothèque de widgets » n'est pas une boîte de dialogue : pas de rôle, pas d'Échap, pas de retour de focus. | WidgetLibrary | D |
| 23 | Cibles trop petites (< 24 px de haut, WCAG 2.2 AA 2.5.8) : en-têtes de colonnes triables (20 px) sur Trades et Analyses, `btn-link` (20 px), dates du journal (20 px), étoiles (20×24), curseurs (6 px de haut). | Trades, Analyses, Journal, formulaire | D (sauf curseurs natifs : zone cliquable élargie) |
| 24 | Pas de règle de focus globale : liens et boutons de la barre latérale, période, cloche dépendent chacun de leur classe. | index.css | D : `:focus-visible` global |
| 25 | Aucun respect de `prefers-reduced-motion` (aucune règle) ; aucun réglage « Réduire les effets » alors que le CSS `data-effects='reduced'` existe déjà mais **n'est jamais activé**. | index.css | D |
| 26 | Le texte `tx3` (`#6B7290`) sert à des libellés lus (légendes, mentions « Local · 2 comptes ») : contraste calculé : 4,0:1 sur le fond `#0B0E27` mais **3,6:1 sur une carte** (`#171B33`) et 3,2:1 sur `#1E2347`, sous les 4,5:1 du texte courant. | plusieurs | D : `tx3` éclairci de `#6B7290` à `#8088AA` (5,4:1 sur le fond, 4,9:1 sur une carte). **Petit écart à la palette de la charte, à confirmer par l'utilisateur** : la charte réserve `tx3` au texte non essentiel, mais il sert aujourd'hui à du texte lu. |

### Effets et coût de rendu
| # | Constat | Statut |
|---|---|---|
| 27 | Chaque carte (`glass-card`) porte `backdrop-filter: blur(20px)` : un dashboard de 20 widgets = 20 flous d'arrière-plan. Or le fond est un dégradé lisse **sans contenu** derrière les cartes : le flou n'y change rien à l'œil. Mesure avant/après dans `docs/retours-utilisateur.md` (lot 26). | D |
| 28 | Aucune animation d'aurore n'existe (le fond est statique) ; le « fond animé » de la consigne n'a donc rien à réduire, seuls les transitions et les flous. | info |

### Textes
| # | Défaut | Statut |
|---|---|---|
| 29 | Espace ordinaire avant « : », « ; », « ? », « ! » (coupure de ligne possible entre le mot et la ponctuation). | D : espace insécable dans `src/i18n/*.ts` |
| 30 | Voir la relecture détaillée dans « Relecture des textes » plus bas (tutoiement / vouvoiement : vouvoiement partout, cohérent). | D |

### Bugs fonctionnels croisés (signalés, NON corrigés)
- Le pied de la barre latérale affiche « Local · 0 compte » tant que des comptes sont créés hors de l'écran des comptes (déjà signalé au lot 20).
- Tableau de bord sans trade : écran d'accueil au lieu des widgets (déjà signalé au lot 25).
- Le champ « Jour » du journal suit la langue du navigateur (format américain `09/29/2026` sous Chromium en anglais) ; sous WebView2 français il doit suivre Windows : à vérifier sur un vrai Windows.
