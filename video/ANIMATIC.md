# Pulse — « Le battement de ton trading »

Film de présentation, 45 s, 100 BPM (1 temps = 0,6 s = 18 images à 30 i/s), 75 temps.
Ce document est la proposition de direction artistique (moodboard) et l'animatic texte qui
a servi de plan de construction. La source de vérité du rythme est `src/timeline.ts` : la vidéo
**et** l'audio en lisent les temps.

## 1. Moodboard

| Référence | Ce qu'on en prend |
|---|---|
| Keynotes Apple (révélations produit) | Fond profond, un seul objet éclairé, texte court révélé par masque, silences assumés avant une révélation |
| Linear (site, films de lancement) | Lueurs bleu-violet sur noir, lignes fines lumineuses, interface montrée en vrai dans des panneaux en perspective, grain très léger |
| Stripe Sessions | Montage sur la musique, staggers serrés, ressorts avec léger dépassement, données réelles plutôt que décoratives |
| Titres Territory Studio (*Blade Runner 2049*, *Ex Machina*) | Interfaces holographiques, aberration chromatique sur les impacts, profondeur de champ, scintillement d'écran |
| Moniteur cardiaque / oscilloscope | La ligne d'ECG avec persistance de phosphore : fil rouge de tout le film |

**Palette** (charte v2.0, aucune couleur inventée) : fond `#0B0E27` / `#080B20` avec l'aurore de la charte
(lueurs `#4A5FD9` et `#8B7FE8`, touche verte `#5FCB9E` en bas à gauche) ; accent = dégradé 135° `#4A5FD9 → #8B7FE8`
(ligne de pouls, courbe d'équité, logo, anneau de score) ; gain `#5FCB9E`, perte `#F0776B`, avertissement `#D9A85A` ;
texte `#F5F2EC` / `#9AA0C0` / `#6B7290` ; verre `linear-gradient(160deg, rgba(255,255,255,.085), rgba(255,255,255,.03))`,
bord `rgba(255,255,255,.10)` ; rayons 24 (carte) / 16 (bloc interne) / 14 (contrôle) / 10 (petit).

**Typographie** : Inter seule (la police embarquée de l'app), chiffres tabulaires, vrai signe moins `−`,
format français (`+12 480,00 €`, `58 %`, `+0,42 R`). Titres 600 à −0,02 em, mot-symbole « Pulse » en Light 300.

**Lumière** : la ligne de pouls est la seule source lumineuse forte. Bloom uniquement sur la ligne, le logo,
le cadenas et les impacts ; jamais plus de trois éléments lumineux à l'écran (charte 4.3).

**Matière** : grain fin animé (≈ 5 %), vignette douce, aberration chromatique seulement sur les impacts,
flou de bougé réel par sous-images sur les mouvements rapides, profondeur de champ simulée (flou par couche
selon sa distance au plan de mise au point).

**Mouvement** : jamais linéaire. Courbes maison (`expoOut`, `quintInOut`, `anticipate`) et ressorts
avec 4 à 8 % de dépassement. Staggers de 1/16 de temps entre éléments frères. Textes révélés par masque
(ligne qui monte derrière une fenêtre de découpe).

**Grille** : 8 px. Marges de sécurité 160 px (horizontal) et 96 px (vertical) en 16:9 ; 96 / 160 px en 9:16.
Texte sur le tiers gauche, objet sur les deux tiers droits ; un seul point focal par plan.

## 2. Animatic (temps à 100 BPM)

### 1. Ouverture — temps 0 à 8 (0 à 4,8 s)
- **0–2** : noir presque total. Silence. Un point lumineux s'allume au tiers gauche, respire.
- **2** : premier battement (lub-dub sub-bass). Le point s'embrase, onde de choc circulaire.
- **3–7** : la ligne d'ECG part du point et traverse l'écran ; un pic à chaque temps (4, 5, 6, 7), persistance de phosphore. Lent travelling avant.
- **4–8** : « Chaque trade a un pouls. » révélé mot par mot par masque, sous la ligne (≈ 2,2 s à l'écran).
- **7,5–8** : la ligne se met à trembler, montée (riser).

### 2. Chaos — temps 8 à 20 (4,8 à 12 s)
- **8–12** : coupes à chaque temps. Bougies qui plongent (`EUR/USD 1,0842`), pile de notifications (« Stop touché · −380,00 € », « Marge utilisée 87 % »), P&L qui bascule de `+2 180,00 €` à `−3 460,00 €`, « FOMO ».
- **12–16** : coupes à la demi-mesure : « Trade de revanche », « Taille ×3 », « Stop déplacé », « 14 trades aujourd'hui », « 02:47 », ticket d'ordre ACHETER / VENDRE.
- **16–18** : coupes au quart de temps : fragments (chiffres, mots, bougies), saturation qui monte, tremblement de caméra.
- **18–19** : coupes au huitième de temps, aberration chromatique, flashs rouge / vert.
- **19** : coupe sèche au noir, silence total pendant un temps.

### 3. Révélation — temps 20 à 25 (12 à 15 s)
- **20** : un seul battement dans le noir. La ligne plate reprend, puis se redresse en **courbe d'équité** (dégradé bleu → violet, halo, point final lumineux).
- **21,5–22,5** : la courbe se replie et ses points deviennent les barres du **logo** (égaliseur en losange autour du vide circulaire), avec dépassement.
- **22,5** : « Pulse. » (Light 300). **22,75** : « Ton journal de trading, enfin lucide. »

### 4. Six super-pouvoirs — temps 25 à 60 (15 à 36 s)
Chaque plan : coupe sur le temps, la ligne lumineuse entre par la gauche et **devient** la visualisation du plan ; carte en verre en 3D à droite (vrais composants de l'app, données plausibles), texte sur le tiers gauche (`01 / 06`, titre, une phrase). La ligne sort par la droite au dernier demi-temps : raccord sur la ligne.

| Temps | Plan | Ce que la ligne devient | Caméra |
|---|---|---|---|
| 25–31 | **01 Résumé de période** : résultat net `+12 480,00 €`, taux de réussite 58 %, espérance `+0,42 R`, drawdown max `−6,2 %` | la courbe d'équité | travelling avant, légère orbite |
| 31–37 | **02 Discipline** : anneau 82 / 100, respect du plan 86 %, règles 91 %, checklist 74 %, stop loss prévu 97 % | l'anneau de score | orbite de gauche à droite |
| 37–43 | **03 Erreurs récurrentes** : trade de revanche `−1 620,00 €`, surtrading, sortie trop tôt… total `−5 010,00 €` | les barres de coût | plongée lente |
| 43–49 | **04 Risque** : heatmap jour × heure, drawdown avec zone de danger, risque max 1 % | la courbe de drawdown | mise au point qui bascule (rack-focus) de la heatmap au drawdown |
| 49–55 | **05 Séries** : série en cours 4 gains, records 9 / 5, moyenne après 2 pertes `−0,40 R`, taille après une perte `+23 %` | la suite G / P | travelling latéral |
| 55–60 | **06 Frais et durée de détention** : frais cumulés `1 284,60 €` (9,3 % du brut), gagnants tenus 42 min, perdants 1 h 18 | l'écart brut / net | recul |

### 5. Local et privé — temps 60 à 68 (36 à 40,8 s)
- **60–62** : la ligne dessine un cadenas (corps arrondi 24 px, anse) au centre ; des particules de données gravitent autour sans jamais franchir une sphère.
- **62** : l'anse se ferme : clic + impact, le cadenas s'illumine.
- **62,5** : « 100 % sur ton ordinateur. » **64** : « Tes données ne partent nulle part. » Puces : « Aucun serveur », « Aucun compte en ligne », « Ton fichier pulse.db ».

### 6. Final — temps 68 à 75 (40,8 à 45 s)
- **68–72** : la caméra recule : les six écrans du film flottent en constellation autour du logo, reliés par des fils lumineux, montée.
- **72** : dernier battement, impact, éclair, aberration chromatique.
- **70,5** : « Pulse — Trade avec méthode. » **72** : « Clarté. Discipline. Performance. » mot par mot sur les temps 72, 72,5, 73.
- **74,5–75** : fondu au noir sur le dernier écho.

## 3. Son (synthétisé en code, `scripts/audio.ts`)
Tout est généré depuis `src/timeline.ts` : battements lub-dub sub-bass (sinus avec chute de hauteur, « dub » 0,22 temps après « lub »), risers (bruit filtré + sinus montant), whooshes (bruit à filtre glissant, panoramique), clics d'interface (sinus court très aigu + transitoire), impact final (sub + bruit + réverbération), nappe (accords de scies désaccordées filtrées) sur les super-pouvoirs, réverbération de Schroeder. 48 kHz, stéréo, 16 bits.
