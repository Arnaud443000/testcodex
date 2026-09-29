/** Textes des comparaisons et de l'exposition (lot 17). Rattachés à `fr` sous la clé `comparisons`. */

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

export const frComparisons = {
  title: 'Comparaisons',
  subtitle: (period: string) => `Comptes, risque par trade et exposition · ${period}`,
  tabsLabel: 'Type de comparaison',
  tabs: { accounts: 'Comptes', risk: 'Risque max', exposure: 'Exposition' },
  loadError: (detail: string) => `Impossible de charger la comparaison : ${detail}`,
  noAccountTitle: 'Créez d’abord un compte',
  noAccountText: 'Ces comparaisons se calculent à partir des trades clôturés de vos comptes.',
  createAccount: 'Créer un compte',
  mixedTitle: 'Comptes en devises différentes',
  mixedText: 'Le risque et l’exposition ne mélangent jamais deux devises. Choisissez un seul compte dans la barre du haut (ou des comptes de même devise).',
  noTradesTitle: 'Aucun trade clôturé sur cette période',
  noTradesText: 'Ces analyses portent sur les trades clôturés dans la période choisie. Élargissez la période ou saisissez un trade.',
  addTrade: 'Nouveau trade',
  lowSample: 'Échantillon faible',
  lowSampleHint: 'Trop peu de trades clôturés pour en tirer une conclusion : à interpréter avec prudence.',
  assetClasses: {
    forex: 'Forex',
    index: 'Indices',
    crypto: 'Crypto',
    stock: 'Actions',
    commodity: 'Matières premières',
    future: 'Futures',
    other: 'Autres',
  } as Record<string, string>,

  // --- 3.7.6 : comparaison entre comptes ---
  accounts: {
    intro:
      'Les indicateurs de chaque compte, côte à côte, calculés sur les trades clôturés de la période. Chaque compte est calculé seul : rien n’est additionné entre comptes, et aucun compte n’est déclaré « meilleur ».',
    pickerLabel: 'Comptes à comparer',
    pickerHint: 'Cochez au moins deux comptes. Par défaut, tous vos comptes actifs.',
    needTwoTitle: 'Choisissez au moins deux comptes',
    needTwoText: 'Une comparaison a besoin de deux comptes ou plus. Créez un second compte dans Paramètres, ou cochez-en un autre ci-dessus.',
    onlyOneAccountTitle: 'Un seul compte pour l’instant',
    onlyOneAccountText: 'Il faut au moins deux comptes pour les comparer. Ajoutez-en un dans Paramètres > Comptes.',
    settings: 'Ouvrir les paramètres',
    mixedWarning: (currencies: string[]) =>
      `Ces comptes n’ont pas la même devise (${currencies.join(', ')}). Les montants en argent ne sont ni additionnés ni comparables : seuls les indicateurs sans unité (réussite, R moyen, profit factor, drawdown en %, part des frais) se comparent. Les lignes en argent sont grisées.`,
    metricsTitle: 'Indicateurs côte à côte',
    metricsHint: 'Les montants sont arrondis au centime à l’affichage. « — » : pas assez de données pour l’indicateur.',
    noTrades: 'Aucun trade clôturé',
    rows: {
      trades: 'Trades clôturés',
      winRate: 'Taux de réussite',
      avgR: 'R moyen (espérance)',
      expectancyMoney: 'Espérance en argent par trade',
      profitFactor: 'Profit factor',
      maxDrawdownPct: 'Drawdown max (en %)',
      maxDrawdown: 'Drawdown max (en argent)',
      feesPerTrade: 'Frais par trade',
      feesShare: 'Part des frais dans le brut',
      netPnl: 'P&L net',
    },
    rowHints: {
      avgR: 'Moyenne des R des trades qui ont un stop prévu : c’est l’espérance en R du glossaire.',
      feesShare: 'Frais / P&L brut, seulement quand le brut est positif.',
      feesPerTrade: 'Positif = coût, négatif = crédit (swap positif).',
    },
    moneyRow: 'Montant : non comparable entre devises',
    hintsTitle: 'Pistes à vérifier',
    hintsCaution:
      'Ce sont des pistes, pas des conclusions : un écart peut venir du courtier (frais, spread, glissement), mais aussi de la stratégie, des horaires, de la taille des positions ou du hasard. À vérifier, par exemple avec les relevés du courtier ou en comparant le même actif au même moment.',
    noHints: 'Aucun écart notable de frais ou de R moyen entre ces comptes, sur les instruments qu’ils ont en commun.',
    hintsNeed: (min: number) =>
      `Pas de piste possible : il faut au moins ${min} trades clôturés sur chaque compte comparé, et au moins un instrument tradé sur les deux comptes (sinon l’écart peut venir de ce qui est tradé, pas du courtier).`,
    hintFees: (worse: string, other: string, gap: string, shared: number) =>
      `« ${worse} » paie une plus grande part de son P&L brut en frais que « ${other} » (écart de ${gap}). Piste : commissions ou spread plus élevés chez ce courtier. Instruments en commun : ${shared}.`,
    hintExecution: (worse: string, other: string, gap: string, shared: number) =>
      `Le R moyen de « ${worse} » est inférieur à celui de « ${other} » de ${gap}. Piste : qualité d’exécution (glissement, spread, requotes) possiblement moins bonne chez ce courtier. Instruments en commun : ${shared}.`,
    thresholds: (fees: string, r: string) => `Une piste apparaît à partir d’un écart de ${fees} points de part de frais, ou de ${r} R de R moyen, entre deux comptes qui ont chacun assez de trades.`,
    hintKind: { fees: 'Frais', execution: 'Exécution' },
  },

  // --- 3.4.11 : benchmark du risque max ---
  risk: {
    intro:
      'Le risque pris à chaque trade (risque initial en % du solde du compte à l’entrée) comparé à votre limite de risque max. Un trade exactement à la limite est respecté.',
    noLimitTitle: 'Aucune limite de risque réglée',
    noLimitText:
      'Fixez le risque maximum par trade (en % du solde) dans Paramètres > Seuils de discipline pour comparer chaque trade à votre objectif. Tant qu’il n’est pas réglé, aucun trade n’est jugé.',
    goSettings: 'Régler la limite',
    limit: 'Limite de risque',
    limitValue: (percent: string) => `${percent} % du solde`,
    compliance: 'Taux de respect',
    complianceHint: (n: number, of: number) => `${n} sur ${of} trades évalués`,
    overCount: 'Dépassements',
    evaluated: 'Trades évalués',
    evaluatedHint: (evaluated: number, total: number, noStop: number) =>
      `${evaluated} sur ${total} trades clôturés${noStop > 0 ? ` (${plural(noStop, 'trade sans stop prévu n’est pas évalué', 'trades sans stop prévu ne sont pas évalués')})` : ''}`,
    avgRisk: 'Risque moyen',
    maxRisk: 'Risque maximum',
    trendTitle: 'Tendance',
    trend: {
      notEnoughData: (min: number) => `Pas assez de trades évalués pour dégager une tendance (il en faut au moins ${min}).`,
      improving: 'Le respect de la limite s’améliore : la moitié la plus récente des trades la respecte davantage que la plus ancienne.',
      stable: 'Le respect de la limite est stable entre la moitié ancienne et la moitié récente des trades.',
      worsening: 'Le respect de la limite se dégrade : la moitié la plus récente des trades la respecte moins que la plus ancienne.',
    },
    trendDetail: (older: string, recent: string) => `Moitié ancienne : ${older} de trades dans la limite · moitié récente : ${recent}. Une tendance décrit ce qui s’est passé, pas pourquoi.`,
    chartTitle: 'Risque de chaque trade',
    chartSubtitle: 'Un point par trade évalué, du plus ancien au plus récent. La ligne pointillée est votre limite ; un losange signale un dépassement.',
    chartLabel: (n: number, over: number) => `Risque de ${plural(n, 'trade', 'trades')}, dont ${plural(over, 'dépassement', 'dépassements')}`,
    limitLine: (percent: string) => `Limite ${percent}`,
    monthsTitle: 'Respect par mois',
    monthsColumns: { month: 'Mois', evaluated: 'Trades évalués', over: 'Dépassements', rate: 'Respect' },
    violationsTitle: 'Dépassements de la limite',
    violationsHint: 'Du plus récent au plus ancien. Cliquez sur un trade pour l’ouvrir.',
    noViolationsTitle: 'Aucun dépassement',
    noViolationsText: 'Tous les trades évalués de la période respectent votre limite.',
    columns: { date: 'Sortie', asset: 'Actif', risk: 'Risque pris', pct: 'En % du solde', limit: 'Limite à ce moment', excess: 'Au-dessus de la limite', open: 'Trade' },
    factor: (f: string) => `×${f} la limite`,
    openTrade: (symbol: string) => `Voir le trade ${symbol}`,
    over: 'Trades au-dessus de la limite',
    within: 'Tous les trades évalués sont dans la limite',
    noEvalTitle: 'Aucun trade évalué sur cette période',
    noEvalText: 'Il faut des trades clôturés avec un stop loss prévu pour juger le risque pris.',
  },

  // --- 3.7.9 : exposition par catégorie d'actif ---
  exposure: {
    intro:
      'Comment le risque pris se répartit entre les catégories d’actifs, sur les trades clôturés de la période. Le risque d’un trade est le montant perdu si son stop est touché ; un trade sans stop prévu n’ajoute aucun risque connu.',
    totalRisk: 'Risque total pris',
    totalRiskHint: (n: number) => `sur ${plural(n, 'trade clôturé', 'trades clôturés')}`,
    totalPct: 'Risque cumulé en % du capital',
    totalPctHint: 'Somme du risque de chaque trade, en % du solde à son entrée.',
    noStop: 'Trades sans stop',
    noStopHint: 'Risque inconnu : non compté dans les parts.',
    chartTitle: 'Part du risque total par catégorie',
    chartLabel: 'Répartition du risque par catégorie d’actif',
    tableTitle: 'Détail par catégorie',
    tableHint: 'La part du risque total est calculée en argent ; le % du capital additionne les pourcentages de chaque trade (il ne s’agit pas d’un solde).',
    columns: { asset: 'Catégorie', trades: 'Trades', risk: 'Risque pris', share: 'Part du risque total', pct: 'Risque cumulé (% du capital)', avg: 'Risque moyen par trade', noStop: 'Sans stop' },
    unknown: 'Risque inconnu',
    unknownHint: 'Tous les trades de cette catégorie sont sans stop prévu : le risque ne peut pas être mesuré.',
    byAsset: 'Voir la performance par actif',
    concentration: (label: string, share: string) => `${label} concentre ${share} du risque pris.`,
    noTradesTitle: 'Aucun trade clôturé sur cette période',
  },
}
