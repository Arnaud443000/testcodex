/** La revue du matin a changé (une idée revue, reportée, clôturée…) : la bannière de la coque se remet à jour tout de suite. */
export const REVIEW_CHANGED = 'pulse-review-changed'
export const notifyReviewChanged = () => window.dispatchEvent(new Event(REVIEW_CHANGED))
