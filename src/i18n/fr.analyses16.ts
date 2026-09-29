/** Textes des analyses complémentaires du lot 16. Rattachés à `fr` sous la clé `analysesMore`. */

export const frAnalysesMore = {
  tabsLabelMore: 'Autres analyses',
  tabs: {
    opportunity: 'Coût d’opportunité',
    year: 'Année précédente',
    duration: 'Temps en position',
  },
  loading: 'Calcul en cours…',
  opportunity: {
    intro:
      'Estimation des gains laissés sur la table en sortant avant votre objectif. On compare le take profit prévu au prix que vous avez noté après la sortie : seuls les trades qui ont ces deux informations comptent. C’est un constat sur le passé, pas un conseil.',
    coverage: (eligible: number, total: number) => `${eligible} ${eligible > 1 ? 'trades pris' : 'trade pris'} en compte sur ${total}`,
    excluded: (excluded: number, noTarget: number, noAfter: number) =>
      `${excluded} ${excluded > 1 ? 'trades exclus' : 'trade exclu'} faute de donnée : ${noTarget} sans take profit valide, ${noAfter} sans prix après sortie (un trade qui manque des deux compte dans les deux).`,
    fillHint: 'Renseignez le take profit prévu et le « prix après sortie » dans la fiche du trade pour l’inclure.',
    lowSample: (min: number) => `Moins de ${min} trades pris en compte : ce total est très fragile.`,
    leftTitle: 'Gain laissé sur la table',
    leftLines: (count: number, avg: string | null) => [
      `${count} ${count > 1 ? 'sorties' : 'sortie'} avant l’objectif`,
      avg === null ? 'Aucune sortie prématurée' : `${avg} en moyenne par sortie`,
    ],
    leftNote: 'Plafonné à votre take profit prévu : au-delà, ce serait de la spéculation.',
    avoidedTitle: 'Sorties bien placées',
    avoidedLines: (count: number) => [`${count} ${count > 1 ? 'trades' : 'trade'} où le prix est allé contre vous après la sortie`],
    avoidedNote: 'Montant épargné par la sortie, non plafonné : la contrepartie du chiffre de gauche.',
    netTitle: 'P&L net des trades pris en compte',
    netLine: 'Pour situer l’ordre de grandeur',
    tableTitle: 'Détail par trade',
    tableSubtitle: 'Les plus gros gains laissés d’abord. Un clic ouvre la fiche du trade.',
    columns: {
      symbol: 'Actif',
      exit: 'Sortie',
      target: 'TP prévu',
      after: 'Après sortie',
      move: 'Mouvement après sortie',
      left: 'Laissé sur la table',
      net: 'P&L net',
    },
    moveHint: 'Écart de prix après la sortie, en argent, dans le sens du trade (signe − : le prix est allé contre vous).',
    open: (symbol: string) => `Ouvrir le trade ${symbol}`,
    emptyTitle: 'Rien à mesurer pour l’instant',
    emptyNoTrade: 'Aucun trade clôturé sur cette période.',
    emptyNoData: (total: number) =>
      `${total} ${total > 1 ? 'trades clôturés' : 'trade clôturé'} sur la période, mais aucun n’a à la fois un take profit prévu valide et un prix après sortie. Ouvrez un trade, renseignez ces deux champs, et l’analyse apparaîtra ici.`,
    caution: 'Estimation : elle dépend d’un prix noté à la main et suppose qu’on aurait pu sortir au meilleur prix. Les frais ne sont pas pris en compte.',
  },
  year: {
    intro:
      'Votre période (celle choisie dans la barre du haut) comparée aux mêmes dates calendaires un an plus tôt. Seuls les trades clôturés comptent, les dépôts et retraits ne sont jamais de la performance.',
    currentLabel: 'Cette période',
    previousLabel: 'Il y a un an',
    range: (from: string, to: string) => `${from} → ${to}`,
    columns: { metric: 'Indicateur', current: 'Cette période', previous: 'Il y a un an', gap: 'Écart' },
    metrics: {
      trades: 'Trades clôturés',
      netPnl: 'P&L net',
      winRate: 'Taux de réussite',
      profitFactor: 'Facteur de profit',
      expectancyR: 'Espérance (R moyen)',
      maxDrawdown: 'Drawdown maximal',
    },
    netPnlPct: (pct: string) => `${pct} du P&L de l’an dernier`,
    lowSample: (min: number) => `Moins de ${min} trades sur au moins une des deux périodes : les écarts sont à interpréter avec prudence.`,
    lowBadge: 'Échantillon faible',
    unavailableTitle: 'Pas de comparaison pour « Tout »',
    unavailableText: 'Toute la durée de votre historique n’a pas d’année précédente équivalente. Choisissez 1J, 1S, 1M, 3M ou 1A dans la barre du haut.',
    previousEmptyTitle: 'Rien à comparer avec l’an dernier',
    reasons: {
      historyTooShort: 'Votre historique commence après la fin de la période équivalente de l’an dernier : il n’y a pas encore d’année précédente.',
      noTrades: 'Aucun trade clôturé sur la même période l’an dernier.',
    },
    previousEmptyHint: 'Aucun écart n’est chiffré contre une période vide. Votre période actuelle reste affichée ci-dessous.',
    currentEmptyTitle: 'Aucun trade clôturé sur cette période',
    currentEmptyText: 'Élargissez la période dans la barre du haut ou saisissez un trade.',
    drawdownHint: 'Un écart positif signifie un creux plus profond que l’an dernier.',
    caution: 'Deux périodes ne se ressemblent jamais : marchés, taille des positions et nombre de trades ont pu changer. C’est un constat, pas une explication.',
  },
  duration: {
    intro: 'Combien de temps vos trades gagnants et perdants restent ouverts, de l’entrée à la sortie. Seuls les trades clôturés comptent.',
    winnersTitle: 'Trades gagnants',
    losersTitle: 'Trades perdants',
    breakevenTitle: 'Trades à plat',
    average: (v: string) => `Durée moyenne : ${v}`,
    median: (v: string) => `Durée médiane : ${v}`,
    noneInGroup: 'Aucun trade dans ce groupe',
    breakevenLine: (count: number, avg: string) => `${count} ${count > 1 ? 'trades' : 'trade'} à plat, durée moyenne ${avg} : affichés à part, hors du ratio.`,
    ratioTitle: 'Gagnants contre perdants',
    ratioSubtitle: 'Durée moyenne des gagnants divisée par celle des perdants',
    ratioAverage: 'Sur la durée moyenne',
    ratioMedian: 'Sur la durée médiane',
    ratioSentence: (ratio: string) => `Vos gagnants durent en moyenne ${ratio} fois la durée de vos perdants.`,
    ratioMedianSentence: (ratio: string) => `En médiane : ${ratio} fois.`,
    ratioNote: 'Ce ratio décrit vos habitudes de tenue ; il ne dit pas si c’est bien ou mal, et un ratio supérieur à 1 n’est pas un objectif en soi.',
    notComparable: (min: number) => `Trop peu de trades pour chiffrer le ratio : il en faut au moins ${min} gagnants et ${min} perdants sur la période.`,
    undefinedRatio: 'Ratio non défini : la durée moyenne des perdants est nulle.',
    excluded: (open: number, invalid: number) => {
      const parts = []
      if (open > 0) parts.push(`${open} ${open > 1 ? 'trades ouverts' : 'trade ouvert'} (sans heure de sortie)`)
      if (invalid > 0) parts.push(`${invalid} ${invalid > 1 ? 'trades' : 'trade'} dont la sortie précède l’entrée`)
      return `Exclus du calcul : ${parts.join(' et ')}.`
    },
    emptyTitle: 'Rien à mesurer pour l’instant',
    emptyText: 'Aucun trade clôturé sur cette période : la durée se mesure entre l’heure d’entrée et l’heure de sortie.',
  },
}
