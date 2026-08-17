import { correctedOutcomes, type RawOutcome } from './outcomes'

export function mealLearning(outcomes: RawOutcome[], mealId: string): { confidence: 'Estimated' | 'Learning' | 'Established'; relevant: number; contradictory: boolean } {
  const relevant = correctedOutcomes(outcomes).filter((outcome) => outcome.mealId === mealId && (outcome.acceptance === 'accepted' || outcome.acceptance === 'rejected'))
  const contradictory = relevant.some((outcome) => outcome.acceptance === 'accepted') && relevant.some((outcome) => outcome.acceptance === 'rejected')
  return { confidence: contradictory || relevant.length < 3 ? relevant.length ? 'Learning' : 'Estimated' : 'Established', relevant: relevant.length, contradictory }
}
