# Charte graphique — TradeLens

Version 1.1 — 26/08/2026
Statut : dérivée de la planche de marque et de la maquette de dashboard fournies. Le **nom (TradeLens), le logo et la typographie restent non arrêtés** à ce stade — traiter les sections 1.2 et 3.1 comme des pistes de travail, pas des décisions. Ce qui est en revanche exploité comme base solide : la **palette de couleurs** (section 2) et les **patrons de composants** observés sur la maquette (boutons, cards, tableaux, graphiques — sections 4 à 7), qui restent valables même si le nom/logo/typo changent. Les valeurs de couleur elles-mêmes sont estimées par lecture visuelle des captures — à recaler sur les fichiers sources (Figma, exports SVG/PNG) dès qu'ils sont disponibles (cf. points ouverts, section 8).

Ce document complète `docs/cahier-des-charges.md` : il ne redéfinit aucune fonctionnalité, il habille celles déjà spécifiées. Chaque composant renvoie, quand c'est pertinent, à la fonctionnalité du cahier des charges qu'il habille.

---

## 1. Identité de marque

### 1.1 Nom et signature
- **Nom** : TradeLens (nom de travail — non définitivement arrêté).
- **Signature** : « Clarté. Discipline. Performance. » — trois mots séparés par des points, capitales, espacement de lettres large. Reprend directement le principe directeur du produit (cf. cahier des charges, 1.2).
- **Écriture du nom** : un seul mot, casse mixte interne (« TradeLens », pas d'espace, pas de point médian).
- **Lockup** : la signature se lit **juste après le nom**, sur la même ligne de composition (« TradeLens — Clarté. Discipline. Performance. »), et non empilée dessous comme un sous-titre séparé — c'est la seule règle de position actée à ce stade.

### 1.2 Logo
> **Statut : non arrêté.** Le mark ci-dessous (anneaux concentriques) est une exploration reçue avec la maquette de dashboard, pas une décision de logo définitive. Cette section documente cette piste pour mémoire ; elle sera réécrite dès qu'un logo est choisi. Ne pas le considérer comme livrable en l'état.
- **Anatomie de la piste explorée** : deux anneaux concentriques excentrés, en dégradé bleu → violet, avec un halo lumineux doux — évoque une lentille/objectif (cohérent avec « Lens ») et un cadran de performance.
- **Déclinaisons fournies avec cette piste** :
  - **Logo principal** : anneaux + nom + signature, sur fond quasi-noir.
  - **Icône compacte** : anneaux seuls dans un carré à coins arrondis, fond quasi-noir.
  - **Icône d'application** : anneaux seuls, fond en dégradé bleu-violet pleine surface.
- **Ce qui reste vrai quel que soit le logo retenu** : le dégradé bleu → violet (section 2.1) restera vraisemblablement l'accent de marque même si le mark change, puisqu'il porte déjà les boutons et l'état actif de la navigation — un nouveau logo devra rester compatible avec cette teinte, ou la palette sera revue en même temps.
- **Point ouvert** : tant que le logo n'est pas choisi, ne pas produire d'espace de protection, de tailles minimales ni de variante fond clair définitifs — ce travail est prématuré (cf. section 8).

### 1.3 Ton et principes
- **Sobre, jamais criard** : la donnée financière porte déjà sa propre charge émotionnelle (gains/pertes) ; l'interface ne doit pas en rajouter par des couleurs saturées hors du rôle sémantique gain/perte.
- **Data-first** : la couleur d'accent (bleu-violet) sert la navigation et l'action, jamais l'affichage d'une métrique — une métrique se colore uniquement selon sa sémantique (gain/perte/neutre, section 2.2).
- **Discipline visuelle = discipline de trading** : alignement rigoureux sur grille, chiffres alignés (tabulaires), hiérarchie typographique constante — l'interface elle-même doit incarner la rigueur que l'outil encourage chez le trader.

---

## 2. Couleur

### 2.1 Palette de marque
Sept couleurs de base, lues sur la planche de marque, de la plus sombre à la plus claire :

| Token | Rôle | Hex (estimé) |
|---|---|---|
| `--tl-ink-950` | Fond d'application, quasi-noir bleuté | `#0A0D18` |
| `--tl-navy-800` | Surface élevée (cards, panneaux) | `#1B2140` |
| `--tl-blue-500` | Accent primaire — début de dégradé | `#5B72C8` |
| `--tl-violet-400` | Accent secondaire — fin de dégradé | `#9483E4` |
| `--tl-cream-100` | Neutre clair chaud — texte sur fond sombre, boutons secondaires | `#F1EADD` |
| `--tl-sage-500` | Sémantique gain (source) | `#5FA98A` |
| `--tl-coral-500` | Sémantique perte (source) | `#E0695C` |

Le dégradé de marque (logo, bouton primaire, éléments actifs) va de `--tl-blue-500` à `--tl-violet-400`, à 135°.

### 2.2 Tokens sémantiques (gain / perte / neutre)
Distincts de l'accent de marque — l'accent bleu-violet ne doit jamais être utilisé pour signifier un résultat chiffré, et inversement le vert/rouge sémantique ne doit jamais servir à autre chose qu'un résultat (cf. section 1.3). Deux intensités par couleur : une version « texte/icône » plus lumineuse pour rester lisible sur fond sombre, une version « fond de badge » très assourdie.

| Token | Usage | Dark | Light |
|---|---|---|---|
| `--tl-gain-text` | Texte/icône gain (PnL positif, badge « Gain », sparkline haussière) | `#5FCB9E` | `#2F8F68` |
| `--tl-gain-surface` | Fond de badge/chip gain | `#16302A` | `#E3F3EC` |
| `--tl-loss-text` | Texte/icône perte | `#F0776B` | `#C64435` |
| `--tl-loss-surface` | Fond de badge/chip perte | `#3A211E` | `#FBE9E7` |
| `--tl-neutral-text` | Texte/icône neutre (breakeven, statut neutre) | `#B9BECF` | `#5B6270` |
| `--tl-neutral-surface` | Fond de badge/chip neutre | `#20233A` | `#EEEFF3` |

**Règle d'accessibilité** : la couleur n'est jamais le seul vecteur d'information. Un badge « Gain »/« Perte »/« Neutre » porte toujours un libellé texte (et un point de statut), jamais une pastille de couleur seule — cf. maquette (section 7).

### 2.3 Thème sombre (référence — celui de la maquette fournie)
| Token | Rôle | Hex |
|---|---|---|
| `--surface-0` | Fond de la zone de contenu | `#0A0D18` (= `--tl-ink-950`) |
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

L'accent de marque (`--tl-blue-500` → `--tl-violet-400`) reste identique dans les deux thèmes ; en mode clair, vérifier son contraste sur `--surface-0` clair et l'assombrir légèrement si besoin sur le texte de lien (cf. section 8, point ouvert).

### 2.5 Contraste
Toute paire texte/fond doit atteindre au minimum le ratio WCAG AA (4.5:1 pour le texte courant, 3:1 pour le texte large ≥ 24px ou 19px gras). Les valeurs `--tl-gain-text` et `--tl-loss-text` du thème clair (section 2.2) sont volontairement plus saturées/foncées que leurs équivalents « source » de la palette de marque (section 2.1) pour cette raison — ne pas les remplacer par les couleurs de la planche de marque telles quelles sur fond clair.

---

## 3. Typographie

### 3.1 Police
> **Statut : non arrêté.** SF Pro Display figurait sur la planche de marque reçue, mais le choix typographique définitif dépend du nom et du logo qui restent eux-mêmes à trancher (section 1) — ne pas considérer ce choix comme figé. Cette section documente la piste reçue et une pile de secours cohérente, à réviser dès que la typographie est actée.
- **Police explorée** : SF Pro Display (Apple), graisses Light à Bold, telle que montrée sur la planche de marque.
- **Pile web de repli, si cette piste est confirmée** :
  `font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif;`
  Sur macOS/iOS, cette pile résout nativement vers San Francisco. Sur les autres plateformes, **Inter** sert de repli — géométrie et graisses très proches, disponible via Google Fonts.
- **Si le nom ou le logo changent de direction**, revoir ce choix en cohérence : une piste plus « donnée financière » (une police à chiffres tabulaires marqués) ou plus « éditoriale » (une empattée pour les titres) resterait compatible avec le reste de cette charte (couleurs, grille, composants), tant que l'échelle de la section 3.2 et la règle des chiffres tabulaires (3.3) sont conservées.

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
| **Primaire** | Dégradé `--tl-blue-500` → `--tl-violet-400`, 135°, reflet interne haut | `--tl-cream-100`, semibold | Action principale unique par écran (« Nouveau trade ») |
| **Secondaire** | `--tl-cream-100` plein, reflet interne façon galet | `--tl-ink-950`, semibold | Action alternative (« Annuler ») |
| **Tertiaire** | Transparent | `--tl-violet-400`, medium, soulignement fin | Navigation en ligne (« Voir plus ») |
| **Destructif** | Fond `--tl-loss-surface` | `--tl-loss-text`, semibold | Suppression, action irréversible |

Forme : pilule (`--radius-pill`), padding `20px / 12px`. États : *hover* — éclaircir le dégradé de 5% et lever le bouton de 1px avec une ombre plus marquée ; *focus* — anneau de focus 2px `--tl-violet-400`, décalage 2px, toujours visible au clavier ; *disabled* — opacité 45%, dégradé désaturé, curseur désactivé.

### 5.2 Badges de statut
Pilule compacte : point de statut (6px) + libellé. Couleurs : `--tl-gain-surface`/`--tl-gain-text` (Gain), `--tl-loss-surface`/`--tl-loss-text` (Perte), `--tl-neutral-surface`/`--tl-neutral-text` (Neutre). Usage direct dans le cahier des charges : statut d'un trade (gagnant/perdant/breakeven, cf. 2.2 du cahier des charges), respect d'une règle (respectée/non respectée, cf. 2.4), résultat d'une alerte.

### 5.3 Cards
- **Card de base** : `--surface-2`, `--radius-lg`, `--shadow-card`, bordure `--border-hairline`.
- **Stat/KPI card** (cf. widgets « Performance » du cahier des charges, 3.8.3) : libellé + icône d'info en tête, chiffre clé en style KPI (3.2), delta coloré selon sa sémantique juste en dessous, sparkline pleine largeur ancrée en bas de card.
- **Card d'insight** (cf. Insights/IA, cahier des charges 3.5) : icône de repère à gauche, titre en gras, description en body, pas de bordure interne — la liste se sépare par un filet `--border-hairline`.

### 5.4 Navigation latérale
Item de nav = icône (20px) + libellé, `--radius-md`, padding `12px / 16px`. Actif : fond teinté à 12% d'opacité du dégradé de marque + texte/icône `--tl-violet-400`. Inactif : `--text-secondary`. Survol : fond `--surface-2`. Pied de sidebar : avatar + nom + forfait, séparé par un filet `--border-hairline`.

### 5.5 Barre supérieure
Sélecteur de compte et sélecteur de période : chip `--surface-3`, `--radius-pill` ou `--radius-md`, icône + texte sur deux lignes + chevron. Reflète directement le multi-comptes (cahier des charges, 3.7.5) et le filtre par période (3.7.8). Bouton de notification : icône cloche + point d'accent si notification non lue (cf. alertes à seuils, 3.6).

### 5.6 Tableaux de données
Lignes de hauteur 44px, séparateur `--border-hairline` (pas de zébrage). Colonne « Sens » : texte coloré directement (`--tl-gain-text` pour Long, `--tl-loss-text` pour Short) plutôt qu'un badge, pour rester léger sur une table dense. Colonnes chiffrées alignées à droite, tabulaires (3.3).

### 5.7 Iconographie
Style trait fin (1.5px), coins arrondis, monochrome héritant de la couleur du texte environnant — à l'exception du logo de marque qui seul porte le dégradé. Taille par défaut 20px dans la nav et les boutons, 16px dans les tableaux/labels.

---

## 6. Visualisation de données

Chaque type de graphique ci-dessous habille une fonctionnalité déjà spécifiée dans le cahier des charges — se référer à ce dernier pour la donnée sous-jacente, ce document ne fixe que le rendu.

| Visualisation | Rendu | Fonctionnalité habillée |
|---|---|---|
| **Courbe d'équité / aire** | Trait 2px `--tl-blue-500`→`--tl-violet-400`, remplissage en dégradé vers transparent, grille horizontale à 4% d'opacité, tooltip = card élevée avec pointeur | Courbe d'équité (3.3.7), PnL net en tête de dashboard |
| **Sparkline** | Trait 1.5px, couleur sémantique (gain/perte) ou accent selon le contexte, sans axe | Mini-graphique de chaque stat card (3.8.3) |
| **Donut de répartition** | Segments multicolores (palette catégorielle, 6.7), valeur totale au centre | Performance par stratégie (3.3.16) |
| **Jauge en arc** | Demi-anneau segmenté par session, lecture au centre (meilleure/pire session) | Performance par session (3.3.9) |
| **Histogramme** | Barres à coin supérieur arrondi, vert au-dessus de la ligne de base, rouge en dessous | Performance par heure (3.3.9), distribution des R-multiples (3.3.8) |
| **Heatmap calendrier** | Cellule par jour, teinte verte par palier d'intensité (gain) ou rouge (perte), cellule neutre `--surface-3` si aucun trade | Calendrier de trading et heatmap P&L (3.7.1, 3.3.11) |

### 6.7 Palette catégorielle étendue
Pour les visualisations à plusieurs séries non sémantiques (ex. répartition par stratégie, par setup), étendre l'accent de marque par une palette de 6 teintes perceptuellement distinctes, dérivées de la palette de base : `--tl-blue-500`, `--tl-violet-400`, `--tl-sage-500`, `--tl-coral-500`, plus deux teintes additionnelles à définir (un doré/ambre et un bleu-sarcelle) pour couvrir jusqu'à 6 catégories sans confusion avec le sens gain/perte.

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

- **Nom** : TradeLens est un nom de travail, non arrêté (cf. 1.1).
- **Logo** : non arrêté — le mark à anneaux n'est qu'une exploration reçue avec la maquette, pas une décision (cf. 1.2). Ne pas produire de règles d'usage définitives (espace de protection, tailles minimales, variante fond clair) avant ce choix.
- **Typographie** : non arrêtée — SF Pro Display documente la piste reçue, à revoir une fois le nom/logo tranchés (cf. 3.1).
- **Valeurs hexadécimales** de la section 2.1 estimées visuellement — à recaler sur les fichiers sources (Figma, exports) dès qu'ils sont transmis.
- **Police de repli web** : Inter proposé par défaut pour les plateformes non-Apple si SF Pro Display est confirmé — sinon à redéfinir avec le choix final.
- **Deux teintes catégorielles additionnelles** (6.7) à définir précisément pour compléter la palette de répartition à 6 séries.
- **Mode clair** : direction proposée en section 2.4, à valider visuellement une fois un premier écran assemblé (le contraste de l'accent bleu-violet sur fond clair doit être revérifié en conditions réelles).
