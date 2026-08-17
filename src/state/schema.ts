import { z } from 'zod'

const entitySchema = z.object({ id: z.string().min(1) }).passthrough()

export const appStateV1Schema = z.object({
  schemaVersion: z.literal(1),
  household: z
    .object({
      diners: z.array(entitySchema),
      restrictions: z.array(entitySchema),
      scheduleExceptions: z.array(entitySchema),
    })
    .passthrough(),
  meals: z.array(entitySchema),
  recipes: z.array(entitySchema),
  plans: z.array(entitySchema),
  leftoverLots: z.array(entitySchema),
  outcomes: z.array(entitySchema),
}).strict()

export type AppStateV1 = z.infer<typeof appStateV1Schema>
