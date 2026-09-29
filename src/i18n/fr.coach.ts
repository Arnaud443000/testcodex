/** Textes du coach IA (lot 21). Rattachés à `fr` sous la clé `coach`. */

export const frCoach = {
  title: 'Coach IA',
  subtitle: 'Posez une question sur vos propres données : l’IA interroge les statistiques déjà calculées par Pulse.',
  simulation: 'Simulation',
  simulationHint: 'Aperçu dans un navigateur : réponses fictives, aucun appel réseau.',
  generated: 'Généré par IA',
  notAdvice: 'Ce n’est pas un conseil financier : des constats sur votre passé, jamais une recommandation d’achat ou de vente.',
  loadError: (d: string) => `Le coach n’a pas pu être chargé : ${d}`,

  reminder: {
    title: 'Ce qui part, et ce qui ne part jamais',
    sent: 'Envoyé à chaque question : votre question, la date du jour, les numéros des comptes de la barre du haut, et les résultats chiffrés des outils que l’IA demande (agrégats de Pulse), plus l’historique de cette conversation.',
    never: 'Jamais envoyé : notes, thèse, texte du journal, captures, nom, courtier et capital des comptes, autres conversations. Les noms de vos tags, règles et actifs peuvent apparaître dans les résultats.',
    to: (host: string, model: string) => `Vers ${host} (Anthropic, modèle ${model}), avec votre clé ; facturé sur votre compte.`,
    notAutomatic: 'Rien n’est envoyé avant que vous cliquiez sur « Envoyer ».',
    toolsSummary: (n: number) => `Voir les ${n} outils que l’IA peut appeler (lecture seule)`,
  },

  blocked: {
    disabledTitle: 'L’IA est désactivée',
    disabled: 'Le coach utilise l’IA optionnelle de Pulse, désactivée par défaut. Tant qu’elle l’est, rien ne peut partir. Vos conversations passées restent lisibles.',
    noKeyTitle: 'Aucune clé API',
    noKey: 'Ajoutez votre clé API Anthropic dans Paramètres > IA pour poser une question.',
    vaultTitle: 'Coffre d’identifiants indisponible',
    vault: 'Le coffre d’identifiants Windows est indisponible : la clé ne peut pas être lue. Pulse ne l’écrit jamais ailleurs.',
    openSettings: 'Ouvrir Paramètres > IA',
  },

  list: {
    title: 'Conversations',
    new: 'Nouvelle conversation',
    empty: 'Aucune conversation pour l’instant.',
    turns: (n: number) => `${n} ${n > 1 ? 'questions' : 'question'}`,
    readOnly: 'Lecture seule',
    full: 'Complète',
    deleteAll: 'Tout supprimer',
    confirmDeleteAll: (n: number) => `Supprimer ${n > 1 ? `les ${n} conversations` : 'la conversation'} ? C’est définitif.`,
    confirmDeleteAllYes: 'Oui, tout supprimer',
    deletedAll: 'Toutes les conversations ont été supprimées.',
  },

  conversation: {
    rename: 'Renommer',
    renameLabel: 'Titre de la conversation',
    save: 'Enregistrer',
    delete: 'Supprimer',
    confirmDelete: 'Supprimer cette conversation et toutes ses réponses ? C’est définitif.',
    confirmDeleteYes: 'Oui, supprimer',
    readOnly: 'Cette conversation a été écrite avec une ancienne liste d’outils : elle reste lisible, mais on ne peut plus y poser de question.',
    full: (max: number) => `Cette conversation a atteint sa limite (${max} questions ou historique trop long). Commencez-en une nouvelle.`,
  },

  empty: {
    title: 'Que voulez-vous comprendre ?',
    text: 'Le coach répond à partir de vos statistiques, de votre discipline, de vos erreurs et de vos insights. Choisissez un exemple (il remplit le champ, sans rien envoyer) ou écrivez votre question.',
    examples: [
      'Résume ma semaine',
      'Pourquoi je perds le vendredi ?',
      'Quelles erreurs me coûtent le plus ce mois-ci ?',
      'Ma discipline progresse-t-elle ?',
      'Est-ce que je tiens mes gagnants moins longtemps que mes perdants ?',
    ],
  },

  turn: {
    you: 'Vous',
    meta: (model: string, date: string) => `${model} · ${date}`,
    unverifiedTitle: 'Chiffres à vérifier',
    unverified: (list: string) =>
      `${list} : introuvable${list.includes(',') ? 's' : ''} dans les données que Pulse a fournies pour cette conversation. L’IA l’a peut-être calculé ou inventé : vérifiez-le dans Pulse avant de vous y fier.`,
    failed: 'Pas de réponse',
    retry: 'Reposer la question',
    usage: (input: number, output: number, requests: number) =>
      `${input.toLocaleString('fr-FR')} jetons envoyés, ${output.toLocaleString('fr-FR')} reçus, ${requests} requête${requests > 1 ? 's' : ''}`,
  },

  sent: {
    summary: (calls: number) => `Données envoyées (${calls} appel${calls > 1 ? 's' : ''} d’outil)`,
    failedNote: 'La réponse n’est pas arrivée, mais ce qui suit a pu quitter votre ordinateur.',
    provider: (provider: string, model: string) => `Fournisseur : ${provider} · modèle demandé : ${model}`,
    question: 'Votre question',
    context: 'Ligne de contexte ajoutée par Pulse',
    history: (turns: number) =>
      turns === 0 ? 'Aucun tour précédent renvoyé (nouvelle conversation).' : `Historique de cette conversation renvoyé tel quel : ${turns} tour${turns > 1 ? 's' : ''} précédent${turns > 1 ? 's' : ''}.`,
    fixed: 'Envoyés aussi, identiques pour tout le monde : les consignes du coach et la liste des outils (aucune donnée).',
    noTool: 'Aucun outil appelé : l’IA n’a reçu aucun chiffre de Pulse pour ce tour.',
    params: 'Paramètres',
    result: 'Résultat envoyé',
    error: 'Erreur renvoyée à l’IA',
    limitReached: 'Limite d’appels d’outils atteinte : l’IA a dû répondre avec les données déjà obtenues.',
  },

  composer: {
    label: 'Votre question',
    placeholder: 'Par exemple : pourquoi je perds le vendredi ?',
    count: (n: number, max: number) => `${n} / ${max}`,
    send: 'Envoyer',
    running: 'Le coach interroge vos statistiques… Seuls les résultats chiffrés des outils partent.',
    tooLong: (max: number) => `${max} caractères au maximum.`,
  },

  consent: {
    title: 'Avant votre première question au coach',
    paragraphs: [
      'Le coach envoie votre question à Anthropic (Claude), avec votre clé API. Chaque question est facturée sur votre compte Anthropic ; une question peut entraîner plusieurs requêtes (au plus 6) quand l’IA demande des chiffres.',
      'L’IA ne lit pas votre base : elle demande des résultats à des outils de Pulse, en lecture seule, qui renvoient des statistiques déjà calculées (PnL, win rate, expectancy, discipline, erreurs, insights…). Les noms de vos tags, règles et actifs peuvent y figurer.',
      'Ne partent jamais : notes, thèse, texte du journal, captures, nom, courtier et capital des comptes, autres conversations.',
      'Rien n’est automatique : rien ne part avant que vous cliquiez sur « Envoyer ». Chaque réponse est un texte généré par IA, pas un conseil financier ; les chiffres qui ne viennent pas de Pulse sont signalés.',
    ],
    check: 'J’ai compris ce qui est envoyé et à qui.',
    send: 'Envoyer',
    cancel: 'Annuler',
  },

  /** Libellés des outils, par nom. */
  tools: {
    list_accounts: 'Comptes de la portée',
    period_summary: 'Résumé de période',
    segments: 'Découpage par segment',
    recurring_mistakes: 'Erreurs récurrentes',
    discipline: 'Score de discipline',
    streaks_and_sequences: 'Séries et enchaînements',
    plan_and_rules: 'Plan et règles',
    risk: 'Risque par trade',
    external_factors: 'Facteurs externes',
    fees_and_holding_time: 'Frais et temps en position',
    insights: 'Insights automatiques',
    alerts_today: 'Alertes du jour',
    trade_list: 'Liste de trades',
  } as Record<string, string>,

  /** Erreurs propres au coach ; les autres codes `ai:…` viennent de `fr.ai.errors`. */
  errors: {
    consentRequired: 'La question n’a pas été validée : rien n’est parti.',
    questionInvalid: 'La question est vide ou trop longue.',
    conversationClosed: 'Cette conversation ne prend plus de question : commencez-en une nouvelle.',
    truncated: 'La réponse a été coupée avant la fin : posez une question plus précise.',
    refused: 'Le modèle a refusé de répondre à cette question.',
  } as Record<string, string>,
}
