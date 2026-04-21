import type { RecommendationItem } from './courses-api'

/** Client route for a recommended structure item or SRS card. */
export function hrefForRecommendationItem(courseCode: string, item: RecommendationItem): string {
  const id = encodeURIComponent(item.itemId)
  const code = encodeURIComponent(courseCode)
  switch (item.itemType) {
    case 'quiz':
      return `/courses/${code}/modules/quiz/${id}`
    case 'content_page':
      return `/courses/${code}/modules/content/${id}`
    case 'assignment':
      return `/courses/${code}/modules/assignment/${id}`
    case 'external_link':
      return `/courses/${code}/modules/external-link/${id}`
    case 'review_card':
      return `/review`
    default:
      return `/courses/${code}/modules`
  }
}

export function surfaceLabel(surface: string): string {
  switch (surface) {
    case 'continue':
      return 'Continue'
    case 'strengthen':
      return 'Strengthen'
    case 'challenge':
      return 'Challenge'
    case 'review':
      return 'Review'
    default:
      return surface
  }
}
