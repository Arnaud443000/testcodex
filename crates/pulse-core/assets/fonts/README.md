# Polices du PDF (lot 23)

`Inter-Regular.ttf` et `Inter-Bold.ttf` : Inter (SIL Open Font License 1.1, https://rsms.me/inter/), instanciée en graisse 400 / 700 depuis `src/assets/fonts/inter.woff2` (police variable de l'interface) puis réduite au latin étendu, à la ponctuation courante, à « − » (U+2212), à l'espace insécable et à « € ». Sans hinting ni tables de mise en forme (aucune ligature nécessaire). Elles sont embarquées dans le binaire (`include_bytes!`) : aucune police système, aucun réseau.

Le sous-ensemble ne contient pas l'espace fine insécable U+202F (absente de la police d'origine) : le générateur la remplace par l'espace insécable U+00A0.
