/** Textes des analyses complémentaires du lot 16. Rattachés à `fr` sous la clé `analysesMore`. */

export const frAnalysesMore = {
  tabsLabelMore: 'Autres analyses',
  tabs: {
    opportunity: 'Coût d’opportunité',
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
}
