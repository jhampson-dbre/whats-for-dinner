import { correctedOutcomes, type RawOutcome } from './outcomes'

type PlanSlotContext = { id: string; leftoverFromSlotId?: string; leftoverLotIds?: string[] }

export function mealLearning(outcomes: RawOutcome[], mealId: string, slots: PlanSlotContext[] = []): { confidence: 'Estimated' | 'Learning' | 'Established'; relevant: number; contradictory: boolean } {
  const leftoverSlots = new Set(slots.filter((slot) => slot.leftoverFromSlotId || slot.leftoverLotIds?.length).map((slot) => slot.id))
  const relevant = correctedOutcomes(outcomes).filter((outcome) => outcome.mealId === mealId && !(outcome as RawOutcome & { leftoverServing?: true }).leftoverServing && !leftoverSlots.has((outcome as RawOutcome & { planSlotId?: string }).planSlotId ?? '') && (outcome.acceptance === 'accepted' || outcome.acceptance === 'rejected'))
  const contradictory = relevant.some((outcome) => outcome.acceptance === 'accepted') && relevant.some((outcome) => outcome.acceptance === 'rejected')
  return { confidence: contradictory || relevant.length < 3 ? relevant.length ? 'Learning' : 'Estimated' : 'Established', relevant: relevant.length, contradictory }
}
