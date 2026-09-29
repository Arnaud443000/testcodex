# Charte graphique — Pulse

Version 2.0 — 28/09/2026
Statut : **direction arrêtée, style « A+D »** (structure et palette Pulse + panneaux en verre et lueurs d'aurore). Remplace la v1.2. Les valeurs de ce document sont **celles réellement utilisées** dans les maquettes validées (`docs/maquettes/`), plus des estimations.

Ce document complète `docs/cahier-des-charges.md` (v2.0) : il ne redéfinit aucune fonctionnalité, il habille celles déjà spécifiées.

**Références visuelles (source de vérité)**
| Écran | Fichier |
|---|---|
| Dashboard | `docs/maquettes/style-ad.html` / `.png` |
| Nouveau trade | `docs/maquettes/screen-form.html` / `.png` |
| Détail d'un trade | `docs/maquettes/screen-detail.html` / `.png` |
| Comportement | `docs/maquettes/screen-behavior.html` / `.png` |
| Générateur | `docs/maquettes/build.py` |

Les autres styles explorés (B minimal clair, C terminal, D glass, E carnet de bord, F « Maison » luxe) sont conservés dans le même dossier à titre d'archive ; ils ne font pas partie de la charte.

---

## 1. Identité de marque

- **Nom** : Pulse. **Signature** : « Clarté. Discipline. Performance. » — utilisée ponctuellement (écran d'accueil, à propos), jamais comme sous-titre systématique.
- **Logo** : icône « égaliseur » — barres verticales de hauteurs variables formant un losange autour d'un vide circulaire central, dégradé bleu → violet avec léger halo. Déclinaisons : logo principal (icône + « Pulse » en Light), icône seule, icône d'application (carré très arrondi, dégradé pleine surface), favicon simplifié.
- **Fichier logo source** : la version des maquettes est redessinée en SVG (`logo()` dans `build.py`). Elle est à **remplacer par le fichier officiel** si l'utilisateur en fournit un ; sinon elle sert de version de travail.
- **Principes**
  - **Sobre sur la donnée** : la donnée financière porte déjà sa charge émotionnelle ; la couleur n'est jamais décorative.
  - **Accent = action, pas métrique** : le dégradé bleu-violet sert la navigation, l'action et la courbe d'équité ; vert/corail ne signifient **que** un gain ou une perte.
  - **Discipline visuelle = discipline de trading** : grille stricte, chiffres tabulaires, hiérarchie constante.

---

## 2. Couleur (thème sombre — thème unique en v2.0)

### 2.1 Palette de marque
| Token | Rôle | Valeur |
|---|---|---|
| `--bg` | Fond d'application | `#0B0E27` |
| `--bg-deep` | Fond de base sous l'aurore | `#080B20` |
| `--blue` | Accent primaire (début de dégradé) | `#4A5FD9` |
| `--violet` | Accent secondaire (fin de dégradé) | `#8B7FE8` |
| `--cream` | Neutre clair chaud | `#F0EDE4` |
| `--grad` | Dégradé de marque, 135° | `linear-gradient(135deg,#4A5FD9,#8B7FE8)` |

### 2.2 Texte
| Token | Usage | Valeur |
|---|---|---|
| `--tx` | Texte principal | `#F5F2EC` |
| `--tx2` | Texte atténué (libellés, sous-titres) | `#9AA0C0` |
| `--tx3` | Texte très atténué (axes, légendes) | `#8088AA` (lot 26 : éclairci depuis `#6B7290`, qui ne tenait pas 4,5:1 sur une carte) |
| `--tx-accent` | Texte d'accent / lien / élément actif | `#A79DF2` |

### 2.3 Sémantique
| Token | Usage | Texte/icône | Fond de badge |
|---|---|---|---|
| `--gain` | Gain, positif | `#5FCB9E` | `#16302A` |
| `--loss` | Perte, négatif, règle non respectée | `#F0776B` | `#3A211E` |
| `--warn` | Alerte, avertissement (ex. coût d'opportunité, taille anormale) | `#D9A85A` | `rgba(217,168,90,.12)` |
| `--neutral` | Breakeven, neutre | `#B9BECF` | `#20233A` |

**Règle d'accessibilité** : la couleur n'est jamais le seul vecteur d'information. Un gain/perte porte toujours un signe `+`/`−` ou un libellé (« Gain », « Perte », « Plan followed »), avec point de statut sur les badges.

### 2.4 Palette catégorielle (répartitions non sémantiques)
`#4A5FD9` (bleu), `#8B7FE8` (violet), `#5FCB9E` (vert), `#D9A85A` (ambre), puis 2 teintes additionnelles à valider à l'usage : sarcelle `#4FB8C9` et rose poudré `#C98BB0`. Le vert/rouge sémantique n'est pas réutilisé pour une catégorie quand la répartition porte sur des résultats.

### 2.5 Fond d'application : l'aurore
Le fond est `--bg-deep` recouvert de quatre lueurs radiales, toujours dans les tons bleu-violet (le magenta de l'exploration D est **écarté** pour rester fidèle au logo) :
```
radial-gradient(900px 620px at 8% 6%,   rgba(74,95,217,.42),  transparent 60%),
radial-gradient(800px 600px at 95% 10%, rgba(139,127,232,.30), transparent 60%),
radial-gradient(900px 700px at 65% 108%, rgba(74,95,217,.30),  transparent 60%),
radial-gradient(600px 420px at 3% 96%,  rgba(95,203,158,.10),  transparent 60%),
#080B20
```

### 2.6 Surfaces « verre »
| Token | Valeur | Usage |
|---|---|---|
| `--glass` | `linear-gradient(160deg,rgba(255,255,255,.085),rgba(255,255,255,.03))` | Fond des cartes et panneaux |
| `--glass-border` | `rgba(255,255,255,.10)` | Bordure des cartes |
| `--hairline` | `rgba(255,255,255,.08)` | Séparateurs, bordures de barre latérale/supérieure |
| `--glass-bar` | `rgba(12,16,40,.55)` + `backdrop-filter: blur(22px)` | Barre latérale et barre supérieure |
| `--control` | `rgba(255,255,255,.05)` (bord `rgba(255,255,255,.10)`) | Champs, chips, sélecteurs au repos |
| `--blur-card` | `blur(20px)` | Flou d'arrière-plan des cartes |

### 2.7 Contraste
Toute paire texte/fond atteint WCAG AA (4,5:1 texte courant, 3:1 texte large). `--tx3` est réservé à du texte secondaire non essentiel (légendes) ; ne jamais l'utiliser pour une donnée à lire.

---

## 3. Typographie

- **Police unique : Inter** (variable, graisses 300 à 700), **embarquée dans l'application** (fichier `woff2` local, aucune dépendance réseau). SF Pro Display, envisagée en v1.2, est abandonnée : elle n'existe pas sous Windows.
- Repli : `system-ui, "Segoe UI", sans-serif`.
- **Chiffres tabulaires** (`font-variant-numeric: tabular-nums`) sur toute donnée financière alignée.
- **Signes explicites** : `+` devant tout PnL positif, `−` (vrai signe moins) devant tout négatif.

| Style | Taille | Graisse | Usage |
|---|---|---|---|
| Display | 46px | 700, interlettrage −0.02em | P&L net en tête de dashboard (dégradé blanc → `#C9D2FF` en option) |
| Titre de page | 28px | 600, −0.02em | « Behavior », « New trade » |
| Titre de carte | 16px | 600 | En-tête de carte |
| KPI | 28px | 600 | Chiffre clé d'une stat card |
| Corps | 14–15px | 400 | Texte courant |
| Libellé | 13px | 500 | Libellé de champ |
| Caption majuscules | 11–12px | 600, +0.06em, majuscules | En-têtes de section, libellés de KPI |
| Wordmark | 26px | 300 | « Pulse » dans la barre latérale |

Règles : largeur de ligne ≤ ~70 caractères pour les textes longs (thèse, post-mortem) ; majuscules réservées aux repères courts.

---

## 4. Grille, espacement, forme

### 4.1 Espacement
Base 4px : `4 · 8 · 12 · 16 · 20 · 24 · 32`. Espace entre cartes : **24px** (dashboard) / **20px** (écrans denses). Padding de carte : `22px 24px`. Marge de la zone de contenu : `24px 28px`.

### 4.2 Rayons
| Token | Valeur | Usage |
|---|---|---|
| `--r-sm` | 10px | Petits contrôles internes |
| `--r-md` | 14px | Champs, items de navigation |
| `--r-card` | **24px** | Cartes et panneaux |
| `--r-inner` | 16px | Blocs à l'intérieur d'une carte (comparaisons, notices) |
| `--r-pill` | 999px | Boutons, chips, badges, sélecteurs |

### 4.3 Élévation et lueur
- `--shadow-card` : `0 20px 50px -24px rgba(0,0,0,.65), inset 0 1px 0 rgba(255,255,255,.10)`.
- `--shadow-btn` : `0 10px 30px -8px rgba(139,127,232,.85), inset 0 1px 0 rgba(255,255,255,.35)`.
- **Lueur (glow) — réservée à** : la courbe d'équité (`drop-shadow(0 0 8px rgba(139,127,232,.95))`), le bouton primaire, l'élément actif de navigation et de période, les jours forts du calendrier (`box-shadow: 0 0 14px -2px` de la couleur du résultat). **Jamais** sur du texte courant ni sur plus de 3 éléments par écran.

### 4.4 Structure de l'application (fenêtre Windows)
- **Fenêtre** : taille de référence 1920×1080 ; **taille minimale 1280×720** ; pas de version mobile.
- **Barre latérale** : 248px, libellés + icônes (Dashboard, Trades, Calendar, Analytics, Behavior, Journal, Goals, Settings) ; pied avec avatar et « Local · N accounts ».
- **Barre supérieure** : 72px ; sélecteur de compte, sélecteur de période (1D 1W 1M 3M 1Y ALL), notifications, bouton « New trade ».
- **Zone de contenu** : grille de 12 colonnes, gouttière 24px ; les cartes déclarent leur emprise en colonnes (héro = 8, insights = 4, KPI = 5 × ⅕ de 12, rangée basse = 4 × 3). C'est le système de positionnement du dashboard personnalisable (cahier des charges 3.8).

---

## 5. Composants

### 5.1 Boutons (pilule)
| Variante | Style | Usage |
|---|---|---|
| **Primaire** | Fond `--grad`, texte blanc 600 15px, padding `12px 22px`, `--shadow-btn` | Une action principale par écran (« New trade », « Save trade ») |
| **Secondaire** | Fond `--control`, bordure `rgba(255,255,255,.14)`, texte `--tx` | « Cancel », « Quick add », « Edit » |
| **Tertiaire** | Transparent, texte `--tx-accent` | Liens en ligne |
| **Destructif** | Fond `--loss` à 14 %, texte `#F5A198` | Suppression |

États : *hover* +5 % de luminosité et 1px de relief ; *focus* anneau 2px `--violet` décalé de 2px (toujours visible au clavier) ; *disabled* opacité 45 %.

### 5.2 Navigation latérale
Item : icône 20px + libellé 15px/500, padding `12px 16px`, `--r-md`. Actif : fond `linear-gradient(135deg,rgba(74,95,217,.30),rgba(139,127,232,.20))`, texte blanc, halo `0 8px 24px -10px rgba(139,127,232,.7)`. Inactif : `--tx2`.

### 5.3 Cartes
Fond `--glass`, bordure `--glass-border`, `--r-card`, `--shadow-card`, flou `--blur-card`.
- **Carte KPI** : libellé + icône info, chiffre 28px, delta coloré selon sa sémantique, sparkline pleine largeur ancrée en bas.
- **Carte insight** : pastille icône 36px (dégradé bleu-violet translucide) + titre 600 + description `--tx2`, séparateur `--hairline`.
- **Carte de comparaison** (in-plan / out-of-plan, premier trade / suivants) : deux blocs `--r-inner` fond `rgba(255,255,255,.04)`, libellé caption, valeur 26px, précision `--tx2`.

### 5.4 Champs de formulaire
Libellé caption (11.5px, majuscules, `--tx3`) au-dessus ; champ hauteur **42px**, `--r-md`, fond `--control`, texte 14px ; suffixe d'unité à droite en `--tx3` (`lots`, `USD`, `planned`). Champ calculé automatiquement (ex. session déduite de l'heure) : bordure `rgba(139,127,232,.45)` + pastille « AUTO ». Zone de texte : min 90px, interligne 1,55.

### 5.5 Contrôles
- **Contrôle segmenté** (Long/Short, Discrétionnaire/Système) : conteneur `--control` 42px, segment actif teinté (vert translucide pour Long, gradient bleu-violet pour les choix neutres).
- **Chips** (setup, condition de marché, émotions) : pilule `--control` ; sélectionnée : gradient `rgba(74,95,217,.38)→rgba(139,127,232,.26)`, bord `rgba(139,127,232,.6)`, texte blanc ; chip d'erreur : fond `rgba(240,119,107,.14)`, bord `rgba(240,119,107,.45)`.
- **Curseur** (conviction 1–10) : piste 6px, remplissage `--grad`, poignée blanche 20px avec anneau `rgba(139,127,232,.35)`.
- **Note d'exécution** : 5 segments de 30×8px, remplis en `--grad`. **Étoiles** : `#D9A85A`, 18px.
- **Interrupteur** : 46×26px, actif en `--grad`.
- **Case à cocher** : 19px, `--r-sm`, cochée = `--grad` ; règle non respectée = bord et croix `--loss`.

### 5.6 Notices (bandeaux)
Pilule de rayon `--r-inner`, padding `13px 15px`, 13px. Trois niveaux : **ok** (vert `#9BE3C4` sur `rgba(95,203,158,.10)`), **avertissement** (ambre `#F0CE8E` sur `rgba(217,168,90,.12)`), **critique** (corail `#F5A198` sur `rgba(240,119,107,.12)`), chacune avec bordure de la même teinte à ~35 % et une icône. Sert aux alertes à seuils (cahier des charges 3.6) et aux règles non respectées.

### 5.7 Badges de statut
Pilule 12.5px/600 avec point 6px : Gain (`#16302A`/`--gain`), Loss (`#3A211E`/`--loss`), Neutre (`#20233A`/`--neutral`), « Plan followed » / « Plan broken ». Usage : statut d'un trade, respect d'une règle, résultat d'une alerte.

### 5.8 Tableaux
Lignes de 44–48px, séparateur `--hairline`, pas de zébrage. Colonne « Side » : texte coloré (`--gain` Long, `--loss` Short). Colonnes numériques alignées à droite, tabulaires. En-têtes en caption.

### 5.9 Zone de dépôt de screenshot
Bordure pointillée 1,5px `rgba(255,255,255,.22)`, `--r-inner`, hauteur 96px, texte `--tx3`, accepte le glisser-déposer et le collage depuis le presse-papiers.

### 5.10 Iconographie
Trait fin 1,6px, extrémités arrondies, monochrome (couleur du texte), 20px dans la navigation et les boutons, 16px dans les tableaux. Seul le logo porte le dégradé.

---

## 6. Visualisation de données

| Visualisation | Rendu | Fonctionnalité (cahier des charges) |
|---|---|---|
| Courbe d'équité | Trait 2,4px `--blue → --violet`, remplissage en dégradé vers transparent, grille à 5 %, point final lumineux, halo (cf. 4.3) | 3.3.7 |
| Sparkline | Trait 1,6px, couleur sémantique (gain/perte), remplissage léger | KPI (3.8.3) |
| Anneau de score | Trait 16–18px arrondi, dégradé `--blue → --violet`, valeur au centre 52px/600 et « / 100 » | Score de discipline (3.4.1) |
| Histogramme horaire | Barres à coins arrondis, vert au-dessus de la ligne de base, corail en dessous | 3.3.9, 3.3.8 |
| Donut | Segments palette catégorielle (2.4), total au centre | 3.3.16 |
| Calendrier / heatmap | Cellule 62px `--r-sm+`, teinte gain/perte à 3 paliers (`.18 / .38 / .62`), halo sur le palier fort, cellule neutre `rgba(255,255,255,.05)` | 3.7.1, 3.3.11 |
| Barres émotion → résultat | Barres divergentes autour d'un axe central, gain à droite / perte à gauche, valeur et win rate à droite | 3.4.2 |
| Chandeliers (détail d'un trade) | Bougies vert/corail, lignes horizontales Entry (violet), SL (corail, pointillé), TP (vert, pointillé) avec étiquettes pilule | 3.1.4, 3.7.4 |

---

## 7. Adaptation à l'application Windows (Tauri)

- **Police embarquée** (Inter en `woff2` local) ; aucune ressource distante.
- **Effets de verre** : `backdrop-filter` est pris en charge par WebView2 ; prévoir un réglage **« Réduire les effets »** (fond uni `--bg`, cartes `#171B33`, sans flou ni halo) pour les machines modestes et l'accessibilité. Le rendu de secours reprend le style A pur.
- **Mode sombre uniquement en v2.0.** Un thème clair est repoussé (cf. cahier des charges, exigence « sombre/clair » : à réévaluer à l'étape 5).
- **Barre de titre** : barre native Windows dans un premier temps ; barre personnalisée intégrée à la barre supérieure à envisager plus tard.
- **Écran de démarrage / icône d'application** : icône d'application du logo (carré très arrondi, dégradé pleine surface) aux tailles exigées par Windows (16 à 256px, `.ico`).
- **Notifications** : notifications natives Windows ; libellé court, un clic ouvre le journal du jour (cahier des charges 3.2.8).

---

## 8. Points ouverts

- Remplacer le logo redessiné par le **fichier officiel** (SVG) s'il existe ; définir espace de protection et tailles minimales.
- Valider les deux teintes catégorielles additionnelles (2.4) à l'usage.
- Thème clair : à concevoir plus tard, avec les mêmes rôles de tokens.
- Vérifier le rendu du verre et des halos sur une vraie machine Windows (performances WebView2) une fois l'étape 1 installable.
- Écrans restants à maquetter au fil des étapes : liste des trades, calendrier plein écran, objectifs, paramètres/alertes, journal quotidien, import CSV.
