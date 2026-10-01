// Lot 36 : bilan hebdomadaire. Typographie française : espace insécable (U+00A0) avant : ; ? ! % » et après «.
// Rattachés à `fr` sous la clé `review`. Vouvoiement ; un constat, jamais un conseil ni un reproche ; « en même temps »,
// jamais « parce que ». Les libellés des trois questions sont ici : changer une question ne demande aucune migration.
import type { AnswerKey, FactReason, IntentionOutcome, ReviewErrorCode, ReviewState } from '../types/review'

const NB = ' '
const plural = (n: number, one: string, many: string) => `${n}${NB}${n > 1 ? many : one}`

export const frReview = {
  title: 'Bilan hebdomadaire',
  subtitle: 'Un rendez-vous avec vous-même : les faits de la semaine, trois questions et vos intentions pour la suivante',
  intro:
    'Les faits sont recalculés par Pulse à partir de vos trades et de vos autres pages : ils décrivent ce qui s’est passé, ils ne disent pas quoi faire. Vos réponses restent sur cet ordinateur et ne sont envoyées nulle part.',
  loading: 'Chargement du bilan…',
  loadError: (detail: string) => `Impossible de charger le bilan : ${detail}`,
  mixedCurrencies: 'Choisissez un compte : vos comptes n’ont pas la même devise, et Pulse ne les additionne jamais.',
  noAccountTitle: 'Aucun compte de trading',
  noAccountText: 'Le bilan relit vos trades : créez d’abord un compte de trading.',

  week: {
    title: (week: number) => `Semaine ${week}`,
    range: (from: string, to: string) => `du ${from} au ${to}`,
    previous: 'Semaine précédente',
    next: 'Semaine suivante',
    current: 'Cette semaine',
    periodState: { past: 'Terminée', current: 'En cours', future: 'À venir' } as Record<'past' | 'current' | 'future', string>,
  },
  states: { todo: 'À faire', draft: 'Brouillon', done: 'Fait' } as Record<ReviewState, string>,
  stateHelp: {
    todo: 'Aucun bilan enregistré pour cette semaine.',
    draft: 'Un brouillon est enregistré : vous pouvez le reprendre et le terminer plus tard.',
    done: 'Ce bilan est terminé. Vous pouvez encore le modifier.',
  } as Record<ReviewState, string>,
  futureWeek: 'Cette semaine n’a pas commencé : son bilan se fait pendant ou après la semaine.',

  facts: {
    title: 'Les faits de la semaine',
    note: 'Calculés à partir des trades clôturés dans la semaine, avec les mêmes définitions que le reste de Pulse. Un « — » veut dire que la valeur n’existe pas (jamais zéro).',
    labels: {
      closedTrades: 'Trades clôturés',
      netPnl: 'Résultat net',
      winRate: 'Taux de réussite',
      expectancy: 'Expectancy',
      discipline: 'Score de discipline',
      goals: 'Objectifs de comportement',
      pauses: 'Pauses',
      ideas: 'Idées à surveiller',
      mistake: 'Erreur la plus coûteuse',
      journal: 'Journal',
    },
    closedTradesValue: (n: number) => plural(n, 'trade', 'trades'),
    disciplineValue: (score: string) => `${score}${NB}/${NB}100`,
    pausesValue: (pauses: number, during: number) =>
      `${plural(pauses, 'pause commencée', 'pauses commencées')}, ${plural(during, 'trade pris pendant une pause', 'trades pris pendant une pause')}`,
    ideasValue: (closed: number) => `${plural(closed, 'clôturée', 'clôturées')} cette semaine`,
    ideasToReview: (n: number) => `${n}${NB}à revoir`,
    mistakeValue: (label: string, count: number) => `${label}, sur ${plural(count, 'trade', 'trades')}`,
    journalValue: (n: number) => `${plural(n, 'jour rempli', 'jours remplis')} sur 7`,
    goalsPending: (n: number) => plural(n, 'objectif', 'objectifs'),
    seeGoals: 'Voir les objectifs',
    seeTrades: 'Voir les trades',
    seePauses: 'Voir les pauses',
    reasons: {
      noClosedTrade: 'Aucun trade clôturé cette semaine.',
      noRTrade: 'Aucun trade clôturé n’avait de stop prévu : pas de R.',
      notEnoughTrades: 'Pas assez de trades notés pour établir un score.',
      noGoals: 'Aucun objectif de comportement pour cette semaine.',
      noMistake: 'Aucune erreur signalée sur les trades de la semaine.',
      notEnoughMistakeTrades: 'Cette erreur n’est citée qu’à partir de 3 trades.',
      noMistakeCost: 'Les trades marqués d’une erreur n’ont pas perdu d’argent.',
      onlyCurrentWeek: 'Disponible pour la semaine en cours seulement.',
    } as Record<FactReason, string>,
    /** Raison + chiffres utiles : « 4 trades notés sur 5 nécessaires ». */
    notEnoughTrades: (scored: number, min: number) => `Pas assez de trades notés pour établir un score${NB}: ${scored} sur ${min} nécessaires.`,
  },

  lastWeek: {
    title: 'Intentions de la semaine passée',
    from: (week: number) => `Fixées dans le bilan de la semaine ${week}`,
    hint: 'Dites simplement ce qu’il en est. Il n’y a pas de mauvaise réponse, et « Je ne sais pas » est une réponse.',
    none: 'Aucune intention n’avait été fixée dans le bilan de la semaine d’avant.',
    outcomes: { kept: 'Tenue', partly: 'En partie', notKept: 'Pas tenue' } as Record<IntentionOutcome, string>,
    unknown: 'Je ne sais pas',
    notEvaluated: 'Pas encore évaluée',
    choiceLabel: (text: string) => `Où en est l’intention « ${text} »`,
    streak: (n: number) => `${n} semaines de suite où au moins une intention est tenue`,
    streakHelp: 'Un simple compteur : il s’arrête à la première semaine sans intention tenue ou sans suivi.',
    saveError: (detail: string) => `Impossible d’enregistrer ce suivi : ${detail}`,
  },

  answers: {
    title: 'Vos réponses',
    hint: 'Trois questions courtes, toutes facultatives. Quelques mots suffisent.',
    questions: {
      wentWell: 'Qu’est-ce qui s’est bien passé cette semaine ?',
      doDifferently: 'Qu’est-ce que je referais autrement ?',
      nextPriority: 'Quelle est ma priorité pour la semaine prochaine ?',
    } as Record<AnswerKey, string>,
    counter: (n: number, max: number) => `${n}${NB}/${NB}${max}`,
  },

  intentions: {
    title: 'Intentions pour la semaine prochaine',
    hint: 'De 1 à 3 intentions courtes et précises, si vous le souhaitez. Vous direz dans le bilan suivant ce qu’il en est.',
    fieldLabel: (n: number) => `Intention ${n}`,
    placeholder: 'Par exemple : un stop sur chaque trade',
    add: 'Ajouter une intention',
    remove: (n: number) => `Retirer l’intention ${n}`,
    counter: (n: number, max: number) => `${n}${NB}/${NB}${max}`,
    max: 'Trois intentions au plus : mieux vaut peu, mais tenues.',
  },

  actions: {
    saveDraft: 'Enregistrer le brouillon',
    saveChanges: 'Enregistrer les modifications',
    complete: 'Terminer le bilan',
    saving: 'Enregistrement…',
    savedDraft: 'Brouillon enregistré.',
    savedDone: 'Bilan terminé.',
    savedChanges: 'Modifications enregistrées.',
    delete: 'Supprimer ce bilan',
    deleteConfirm: 'Supprimer ce bilan et ses intentions ?',
    deleteYes: 'Oui, supprimer',
    cancel: 'Annuler',
    deleted: 'Bilan supprimé.',
    emptyHint: 'Un bilan entièrement vide n’est pas enregistré : écrivez au moins une réponse ou une intention.',
  },
  errors: {
    empty: 'Un bilan entièrement vide n’est pas enregistré : écrivez au moins une réponse ou une intention.',
    answerTooLong: 'Une réponse est trop longue (1 000 caractères au plus).',
    intentionTooLong: 'Une intention est trop longue (200 caractères au plus).',
    tooManyIntentions: 'Trois intentions au plus.',
    future: 'Cette semaine n’a pas encore commencé.',
    badTime: 'L’heure doit s’écrire comme 18:00.',
    badDay: 'Le rappel a lieu le dimanche.',
  } as Record<ReviewErrorCode, string>,
  saveError: (detail: string) => `Impossible d’enregistrer le bilan : ${detail}`,
  deleteError: (detail: string) => `Impossible de supprimer le bilan : ${detail}`,

  history: {
    title: 'Bilans passés',
    empty: 'Aucun bilan enregistré pour l’instant.',
    show: (n: number) => `Afficher ${plural(n, 'bilan passé', 'bilans passés')}`,
    hide: 'Masquer les bilans passés',
    open: 'Ouvrir cette semaine',
    noAnswer: 'Pas de réponse.',
    intentionsTitle: 'Intentions',
    loadError: (detail: string) => `Impossible de charger les bilans passés : ${detail}`,
  },

  banner: {
    title: 'Votre bilan de la semaine est prêt',
    detail: (trades: number, days: number) =>
      [trades > 0 ? plural(trades, 'trade clôturé', 'trades clôturés') : null, days > 0 ? plural(days, 'jour de journal', 'jours de journal') : null]
        .filter(Boolean)
        .join(', '),
    open: 'Faire le bilan',
    later: 'Plus tard',
  },

  widget: {
    subtitle: (from: string, to: string) => `Semaine du ${from} au ${to}`,
    statusLabel: 'Bilan de la semaine',
    intentionsTitle: 'Vos intentions',
    intentionsFrom: (week: number) => `Fixées dans le bilan de la semaine ${week}`,
    noIntentions: 'Aucune intention en cours.',
    open: { todo: 'Faire le bilan', draft: 'Reprendre le brouillon', done: 'Ouvrir le bilan' } as Record<ReviewState, string>,
    manage: 'Ouvrir le bilan',
  },

  reminder: {
    title: 'Rappel du bilan hebdomadaire',
    intro:
      'Chaque dimanche, Pulse affiche dans l’application une bannière « Votre bilan de la semaine est prêt ». Elle n’apparaît qu’une fois par semaine, et seulement s’il y a eu au moins un trade clôturé ou une entrée de journal dans la semaine.',
    enabled: 'Activer le rappel du dimanche',
    time: 'Heure du rappel',
    day: 'Jour du rappel',
    dayValue: 'Dimanche',
    saved: 'Réglage enregistré.',
    note: 'Le jour est fixe. Le rappel n’apparaît que si Pulse est ouvert (même réduit) ; il n’y a pas de notification Windows.',
    saveError: (detail: string) => `Impossible d’enregistrer le rappel : ${detail}`,
    loadError: (detail: string) => `Impossible de charger le rappel : ${detail}`,
  },
}
