# Charte graphique — Pulse

Version 1.2 — 26/08/2026
Statut : nom, logo, palette de couleurs et typographie **arrêtés** — planche de marque définitive reçue (logo dans ses quatre déclinaisons, boutons, badges de statut, palette en hex, échelle typographique). Remplace la version 1.1, qui documentait « TradeLens » comme nom de travail non tranché. Les **patrons de composants** observés sur la maquette de dashboard (boutons, cards, tableaux, graphiques — sections 4 à 7) restent la référence d'agencement ; les tokens de thème qui en sont dérivés (sections 2.3/2.4, au-delà de la palette de marque elle-même) restent des estimations de lecture visuelle, à recaler sur les fichiers sources (Figma, exports SVG/PNG) dès qu'ils sont disponibles (cf. points ouverts, section 8).

Ce document complète `docs/cahier-des-charges.md` : il ne redéfinit aucune fonctionnalité, il habille celles déjà spécifiées. Chaque composant renvoie, quand c'est pertinent, à la fonctionnalité du cahier des charges qu'il habille.

---

## 1. Identité de marque

### 1.1 Nom et signature
- **Nom** : **Pulse** — nom définitif de l'application (remplace le nom de travail « TradeLens » utilisé jusqu'au 26/08/2026).
- **Signature** : « Clarté. Discipline. Performance. » — trois mots séparés par des points, capitales, espacement de lettres large. Reprend directement le principe directeur du produit (cf. cahier des charges, 1.2).
- **Écriture du nom** : un seul mot, casse initiale capitale (« Pulse »), typographie fine (cf. logo principal, 1.2).
- **Lockup** : dans le logo principal, l'icône et le nom « Pulse » se lisent sur la même ligne, la signature apparaissant sous l'ensemble en petites capitales espacées (cf. déclinaison « Logo principal », 1.2). Hors logo (ex. en-tête de document, écran de connexion), le nom seul suffit ; la signature s'utilise ponctuellement, jamais comme sous-titre systématique.

### 1.2 Logo
> **Statut : retenu.** Planche de marque définitive reçue le 26/08/2026, avec les quatre déclinaisons ci-dessous. Remplace l'exploration précédente en anneaux concentriques (version 1.1 de ce document).
- **Anatomie** : icône façon égaliseur audio — barres verticales de hauteurs variables disposées en losange autour d'un vide circulaire central, en dégradé bleu → violet avec un éclat lumineux au centre. Évoque à la fois un battement/pulsation et un signal de données, cohérent avec le nom « Pulse ».
- **Déclinaisons livrées** :
  - **Logo principal** : icône + nom « Pulse » + signature, sur fond quasi-noir.
  - **Icône seule** : icône sur fond transparent, pour usage sur fond clair ou sombre variable.
  - **Icône d'application** : icône dans un carré à coins très arrondis, fond en dégradé bleu marine → violet pleine surface.
  - **Favicon** : version simplifiée et compacte de l'icône, lisible en très petite taille.
- **Cohérence avec la palette** : le dégradé bleu → violet du logo est directement celui de l'accent de marque (section 2.1) — il porte aussi les boutons primaires et l'état actif de la navigation.
- **Point ouvert restant** : l'espace de protection, les tailles minimales d'usage et le comportement exact sur fond clair ne sont pas encore formalisés (cf. section 8) — à définir à partir des fichiers source (SVG/Figma) plutôt que de la seule planche fournie en image.

### 1.3 Ton et principes
- **Sobre, jamais criard** : la donnée financière porte déjà sa propre charge émotionnelle (gains/pertes) ; l'interface ne doit pas en rajouter par des couleurs saturées hors du rôle sémantique gain/perte.
- **Data-first** : la couleur d'accent (bleu-violet) sert la navigation et l'action, jamais l'affichage d'une métrique — une métrique se colore uniquement selon sa sémantique (gain/perte/neutre, section 2.2).
- **Discipline visuelle = discipline de trading** : alignement rigoureux sur grille, chiffres alignés (tabulaires), hiérarchie typographique constante — l'interface elle-même doit incarner la rigueur que l'outil encourage chez le trader.

---

## 2. Couleur

### 2.1 Palette de marque
Sept couleurs de base, valeurs hex définitives fournies sur la planche de marque, de la plus sombre à la plus claire :

| Token | Rôle | Hex |
|---|---|---|
| `--pulse-ink-950` | Fond d'application, quasi-noir bleuté | `#0B0E27` |
| `--pulse-navy-800` | Surface élevée (cards, panneaux) | `#1E2347` |
| `--pulse-blue-500` | Accent primaire — début de dégradé | `#4A5FD9` |
| `--pulse-violet-400` | Accent secondaire — fin de dégradé | `#8B7FE8` |
| `--pulse-cream-100` | Neutre clair chaud — texte sur fond sombre, boutons secondaires | `#F0EDE4` |
| `--pulse-sage-500` | Sémantique gain (source) | `#6FA88A` |
| `--pulse-coral-500` | Sémantique perte (source) | `#D96659` |

Le dégradé de marque (logo, bouton primaire, éléments actifs) va de `--pulse-blue-500` à `--pulse-violet-400`, à 135°.

### 2.2 Tokens sémantiques (gain / perte / neutre)
Distincts de l'accent de marque — l'accent bleu-violet ne doit jamais être utilisé pour signifier un résultat chiffré, et inversement le vert/rouge sémantique ne doit jamais servir à autre chose qu'un résultat (cf. section 1.3). Deux intensités par couleur : une version « texte/icône » plus lumineuse pour rester lisible sur fond sombre, une version « fond de badge » très assourdie.

| Token | Usage | Dark | Light |
|---|---|---|---|
| `--pulse-gain-text` | Texte/icône gain (PnL positif, badge « Gain », sparkline haussière) | `#5FCB9E` | `#2F8F68` |
| `--pulse-gain-surface` | Fond de badge/chip gain | `#16302A` | `#E3F3EC` |
| `--pulse-loss-text` | Texte/icône perte | `#F0776B` | `#C64435` |
| `--pulse-loss-surface` | Fond de badge/chip perte | `#3A211E` | `#FBE9E7` |
| `--pulse-neutral-text` | Texte/icône neutre (breakeven, statut neutre) | `#B9BECF` | `#5B6270` |
| `--pulse-neutral-surface` | Fond de badge/chip neutre | `#20233A` | `#EEEFF3` |

**Règle d'accessibilité** : la couleur n'est jamais le seul vecteur d'information. Un badge « Gain »/« Perte »/« Neutre » porte toujours un libellé texte (et un point de statut), jamais une pastille de couleur seule — cf. maquette (section 7).

### 2.3 Thème sombre (référence — celui de la maquette fournie)
| Token | Rôle | Hex |
|---|---|---|
| `--surface-0` | Fond de la zone de contenu | `#0B0E27` (= `--pulse-ink-950`) |
| `--surface-1` | Fond de la sidebar / barre supérieure | `#0D1120` |
| `--surface-2` | Fond des cards et panneaux | `#171B33` |
| `--surface-3` | Fond des éléments interactifs au repos (chip compte, chip date) | `#1F2440` |
| `--border-hairline` | Bordure fine sur fond sombre | `rgba(255,255,255,0.08)` |
| `--text-primary` | Texte principal | `#F5F2EC` |
| `--text-secondary` | Texte atténué (labels, sous-titres) | `#9AA0C0` |
| `--text-faint` | Texte très atténué (légendes d'axes) | `#6B7290` |

### 2.4 Thème clair (dérivé)
À construire en miroir du thème sombre, en conservant les mêmes rôles de tokens (jamais de couleur codée en dur dans un composant — toujours via un token, cf. exigence non-fonctionnelle du cahier des charges, section 6) :

| Token | Rôle | Hex |
|---|---|---|
| `--surface-0` | Fond de la zone de contenu | `#F7F4EE` |
| `--surface-1` | Fond de la sidebar / barre supérieure | `#FFFFFF` |
| `--surface-2` | Fond des cards et panneaux | `#FFFFFF` (+ ombre portée, cf. 4.3) |
| `--surface-3` | Fond des éléments interactifs au repos | `#EFECE3` |
| `--border-hairline` | Bordure fine sur fond clair | `rgba(10,13,24,0.08)` |
| `--text-primary` | Texte principal | `#12162A` |
| `--text-secondary` | Texte atténué | `#565C74` |
| `--text-faint` | Texte très atténué | `#8A8FA3` |

L'accent de marque (`--pulse-blue-500` → `--pulse-violet-400`) reste identique dans les deux thèmes ; en mode clair, vérifier son contraste sur `--surface-0` clair et l'assombrir légèrement si besoin sur le texte de lien (cf. section 8, point ouvert).

### 2.5 Contraste
Toute paire texte/fond doit atteindre au minimum le ratio WCAG AA (4.5:1 pour le texte courant, 3:1 pour le texte large ≥ 24px ou 19px gras). Les valeurs `--pulse-gain-text` et `--pulse-loss-text` du thème clair (section 2.2) sont volontairement plus saturées/foncées que leurs équivalents « source » de la palette de marque (section 2.1) pour cette raison — ne pas les remplacer par les couleurs de la planche de marque telles quelles sur fond clair.

---

## 3. Typographie

### 3.1 Police
> **Statut : confirmée.** SF Pro Display est la police retenue, sur la base de la planche de marque définitive (nom, logo et typographie sont désormais alignés — section 1).
- **Police retenue** : SF Pro Display (Apple), graisses Light, Regular, Medium, Semibold et Bold — jeu complet majuscules/minuscules/chiffres confirmé sur la planche de marque.
- **Pile web** :
  `font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif;`
  Sur macOS/iOS, cette pile résout nativement vers San Francisco. Sur les autres plateformes, **Inter** sert de repli — géométrie et graisses très proches, disponible via Google Fonts.
- **Point ouvert restant** : le rendu réel de la pile de repli (Inter) sur Windows/Android n'a pas encore été vérifié à l'écran — à valider une fois un premier écran assemblé (cf. section 8).

### 3.2 Échelle typographique
| Style | Taille | Graisse | Usage |
|---|---|---|---|
| Display | 2.75rem / 44px | Bold | Valeur héros (Net PnL en tête de dashboard) |
| H1 | 1.75rem / 28px | Semibold | Titre de page (« Trading Performance ») |
| H2 | 1.125rem / 18px | Semibold | Titre de card/panneau |
| KPI | 1.75rem / 28px | Semibold, tabulaire | Chiffre clé dans une stat card |
| Body | 0.9375rem / 15px | Regular | Texte courant |
| Label | 0.8125rem / 13px | Medium | Libellé de champ, légende de card |
| Caption | 0.75rem / 12px | Medium, majuscules, +0.06em | Étiquettes de navigation, en-têtes de colonne |

### 3.3 Règles
- **Chiffres tabulaires** (`font-variant-numeric: tabular-nums`) sur toute donnée financière alignée en colonne : PnL, tableaux de trades, KPI — indispensable pour que les montants restent alignés verticalement (cohérent avec l'exigence de fiabilité des calculs du cahier des charges, section 6).
- **Signes explicites** : un PnL positif s'affiche toujours précédé de `+`, jamais de couleur seule (cf. règle d'accessibilité, 2.5).
- **Labels en majuscules** réservés aux éléments de repère courts (nav, en-têtes de colonne, badges) — jamais pour du texte de lecture longue.
- **Largeur de ligne** : le texte courant (post-mortem, thèse de trade, description d'insight) ne dépasse pas ~70 caractères par ligne pour rester lisible.

---

## 4. Grille, espacement, forme

### 4.1 Échelle d'espacement
Base 4px : `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48px` (`--space-1` à `--space-12`). L'espacement entre cards d'une même grille est de `--space-6` (24px) ; le padding interne d'une card est de `--space-5` à `--space-6` (20–24px).

### 4.2 Rayons de bordure
| Token | Valeur | Usage |
|---|---|---|
| `--radius-sm` | 8px | Chips, petits contrôles |
| `--radius-md` | 14px | Cards standards |
| `--radius-lg` | 20px | Grands panneaux (insights, hero) |
| `--radius-pill` | 999px | Boutons, badges, sélecteurs |

### 4.3 Élévation
Sur fond sombre, l'élévation se lit par une ombre portée diffuse plutôt qu'un changement de teinte marqué :
- `--shadow-card` : `0 1px 2px rgba(0,0,0,.35), 0 8px 24px -12px rgba(0,0,0,.5)`.
- `--shadow-button-primary` : ombre portée teintée de l'accent (`0 6px 16px -6px rgba(91,114,200,.5)`) + reflet interne haut (`inset 0 1px 0 rgba(255,255,255,.25)`) pour l'effet « glossy » du bouton primaire de la maquette.
- Sur fond clair, remplacer les ombres noires par des ombres neutres plus douces (`rgba(20,20,30,.08)`), l'effet glossy du bouton primaire restant identique (l'accent ne change pas de thème).

### 4.4 Grille du dashboard
- **Sidebar** : largeur fixe 248px, non repliable en desktop ; passe en tiroir superposé sous 960px.
- **Barre supérieure** : hauteur 72px, fixe en haut de la zone de contenu.
- **Zone de contenu** : grille en 12 colonnes, gouttière `--space-6` (24px) ; les cards déclarent leur emprise en colonnes (ex. le graphique héros = 8 colonnes, le panneau Insights = 4 colonnes — cf. maquette, section 7).
- **Dashboard personnalisable** (cahier des charges, 3.8) : cette même grille 12 colonnes est le système de positionnement que manipule le glisser-déposer (3.8.2) — un widget occupe toujours un nombre entier de colonnes et de lignes.

---

## 5. Composants

### 5.1 Boutons
| Variante | Fond | Texte | Usage |
|---|---|---|---|
| **Primaire** | Dégradé `--pulse-blue-500` → `--pulse-violet-400`, 135°, reflet interne haut | `--pulse-cream-100`, semibold | Action principale unique par écran (« Nouveau trade ») |
| **Secondaire** | `--pulse-cream-100` plein, reflet interne façon galet | `--pulse-ink-950`, semibold | Action alternative (« Annuler ») |
| **Tertiaire** | Transparent | `--pulse-violet-400`, medium, soulignement fin | Navigation en ligne (« Voir plus ») |
| **Destructif** | Fond `--pulse-loss-surface` | `--pulse-loss-text`, semibold | Suppression, action irréversible |

Forme : pilule (`--radius-pill`), padding `20px / 12px`. États : *hover* — éclaircir le dégradé de 5% et lever le bouton de 1px avec une ombre plus marquée ; *focus* — anneau de focus 2px `--pulse-violet-400`, décalage 2px, toujours visible au clavier ; *disabled* — opacité 45%, dégradé désaturé, curseur désactivé.

### 5.2 Badges de statut
Pilule compacte : point de statut (6px) + libellé. Couleurs : `--pulse-gain-surface`/`--pulse-gain-text` (Gain), `--pulse-loss-surface`/`--pulse-loss-text` (Perte), `--pulse-neutral-surface`/`--pulse-neutral-text` (Neutre). Usage direct dans le cahier des charges : statut d'un trade (gagnant/perdant/breakeven, cf. 2.2 du cahier des charges), respect d'une règle (respectée/non respectée, cf. 2.4), résultat d'une alerte.

### 5.3 Cards
- **Card de base** : `--surface-2`, `--radius-lg`, `--shadow-card`, bordure `--border-hairline`.
- **Stat/KPI card** (cf. widgets « Performance » du cahier des charges, 3.8.3) : libellé + icône d'info en tête, chiffre clé en style KPI (3.2), delta coloré selon sa sémantique juste en dessous, sparkline pleine largeur ancrée en bas de card.
- **Card d'insight** (cf. Insights/IA, cahier des charges 3.5) : icône de repère à gauche, titre en gras, description en body, pas de bordure interne — la liste se sépare par un filet `--border-hairline`.

### 5.4 Navigation latérale
Item de nav = icône (20px) + libellé, `--radius-md`, padding `12px / 16px`. Actif : fond teinté à 12% d'opacité du dégradé de marque + texte/icône `--pulse-violet-400`. Inactif : `--text-secondary`. Survol : fond `--surface-2`. Pied de sidebar : avatar + nom + forfait, séparé par un filet `--border-hairline`.

### 5.5 Barre supérieure
Sélecteur de compte et sélecteur de période : chip `--surface-3`, `--radius-pill` ou `--radius-md`, icône + texte sur deux lignes + chevron. Reflète directement le multi-comptes (cahier des charges, 3.7.5) et le filtre par période (3.7.8). Bouton de notification : icône cloche + point d'accent si notification non lue (cf. alertes à seuils, 3.6).

### 5.6 Tableaux de données
Lignes de hauteur 44px, séparateur `--border-hairline` (pas de zébrage). Colonne « Sens » : texte coloré directement (`--pulse-gain-text` pour Long, `--pulse-loss-text` pour Short) plutôt qu'un badge, pour rester léger sur une table dense. Colonnes chiffrées alignées à droite, tabulaires (3.3).

### 5.7 Iconographie
Style trait fin (1.5px), coins arrondis, monochrome héritant de la couleur du texte environnant — à l'exception du logo de marque qui seul porte le dégradé. Taille par défaut 20px dans la nav et les boutons, 16px dans les tableaux/labels.

---

## 6. Visualisation de données

Chaque type de graphique ci-dessous habille une fonctionnalité déjà spécifiée dans le cahier des charges — se référer à ce dernier pour la donnée sous-jacente, ce document ne fixe que le rendu.

| Visualisation | Rendu | Fonctionnalité habillée |
|---|---|---|
| **Courbe d'équité / aire** | Trait 2px `--pulse-blue-500`→`--pulse-violet-400`, remplissage en dégradé vers transparent, grille horizontale à 4% d'opacité, tooltip = card élevée avec pointeur | Courbe d'équité (3.3.7), PnL net en tête de dashboard |
| **Sparkline** | Trait 1.5px, couleur sémantique (gain/perte) ou accent selon le contexte, sans axe | Mini-graphique de chaque stat card (3.8.3) |
| **Donut de répartition** | Segments multicolores (palette catégorielle, 6.7), valeur totale au centre | Performance par stratégie (3.3.16) |
| **Jauge en arc** | Demi-anneau segmenté par session, lecture au centre (meilleure/pire session) | Performance par session (3.3.9) |
| **Histogramme** | Barres à coin supérieur arrondi, vert au-dessus de la ligne de base, rouge en dessous | Performance par heure (3.3.9), distribution des R-multiples (3.3.8) |
| **Heatmap calendrier** | Cellule par jour, teinte verte par palier d'intensité (gain) ou rouge (perte), cellule neutre `--surface-3` si aucun trade | Calendrier de trading et heatmap P&L (3.7.1, 3.3.11) |

### 6.7 Palette catégorielle étendue
Pour les visualisations à plusieurs séries non sémantiques (ex. répartition par stratégie, par setup), étendre l'accent de marque par une palette de 6 teintes perceptuellement distinctes, dérivées de la palette de base : `--pulse-blue-500`, `--pulse-violet-400`, `--pulse-sage-500`, `--pulse-coral-500`, plus deux teintes additionnelles à définir (un doré/ambre et un bleu-sarcelle) pour couvrir jusqu'à 6 catégories sans confusion avec le sens gain/perte.

---

## 7. Application au dashboard de référence

La maquette fournie sert de référence canonique d'assemblage des composants ci-dessus. Correspondance directe avec la bibliothèque de widgets du cahier des charges (3.8.3) :

- **Sélecteur de compte + période** (barre supérieure) → multi-comptes (3.7.5), filtre par période (3.7.8).
- **Net P&L + courbe** (card héros, 8 colonnes) → PnL net (3.3.1), courbe d'équité (3.3.7).
- **Rangée de 5 KPI** (Net Rate, Profit Factor, Average Trade, Risk/Reward, Max Drawdown) → win rate et R:R réel (3.3.2), profit factor (3.3.4), max drawdown (3.3.6).
- **Performance Insights** (panneau latéral, 4 colonnes) → insights automatiques (3.5.1–3.5.3).
- **Trading Sessions** (jauge en arc) → performance par session (3.3.9).
- **Hourly Performance** (histogramme) → performance par heure (3.3.9).
- **Strategy Performance** (donut) → comparaison de stratégies (3.3.16).
- **Trading Activity** (mini-calendrier) → calendrier de trading / heatmap (3.7.1, 3.3.11).
- **Recent Trades** (tableau) → historique des trades, base du mode replay (3.7.4).

Cet agencement précis constitue le **dashboard par défaut** (cahier des charges, 3.8.6) proposé à l'installation — les widgets qui le composent restent, comme tous les autres, ajoutables/retirables et déplaçables (3.8.1, 3.8.2).

---

## 8. Points ouverts

- **Nom, logo, typographie et palette de marque (section 2.1)** : arrêtés depuis le 26/08/2026 (planche de marque définitive) — ne sont plus des points ouverts.
- **Logo — usage** : espace de protection, tailles minimales et variante fond clair non encore formalisés ; à définir à partir des fichiers source (SVG/Figma) plutôt que de la planche fournie en image (cf. 1.2).
- **Police de repli web** : Inter confirmé par défaut pour les plateformes non-Apple ; rendu à l'écran non encore vérifié en conditions réelles (cf. 3.1).
- **Tokens de thème dérivés** (surfaces 1 à 3, texte, bordures — sections 2.3/2.4) : toujours des estimations de lecture visuelle de la maquette de dashboard, distincts de la palette de marque elle-même désormais définitive — à recaler sur les fichiers sources dès qu'ils sont transmis.
- **Deux teintes catégorielles additionnelles** (6.7) à définir précisément pour compléter la palette de répartition à 6 séries.
- **Mode clair** : direction proposée en section 2.4, à valider visuellement une fois un premier écran assemblé (le contraste de l'accent bleu-violet sur fond clair doit être revérifié en conditions réelles).
