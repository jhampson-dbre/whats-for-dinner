# What's for Dinner? Adaptive Planning MVP

Status: Implemented; hands-off-night pilot correction approved for review, implementation paused
Date: 2026-08-22
Tracker: EPIC-1, EPIC-4, TREK-15

The pilot onboarding and adaptive replanning corrections completed 2026-08-22. Pilot
validation is active.

## Product outcome

Build a responsive, single-household prototype that proves this loop:

> Plan -> Shop -> Cook -> Learn -> Adapt

The product succeeds when it helps the household prepare or obtain a shared dinner
that everyone expected at dinner can eat. Same-day simplification, swaps, and other
confirmed recovery are successful outcomes. The plan is a starting point, not a
contract the household must obey.

The planner should maximize the likelihood that planned dinners are actually prepared
or obtained and eaten. Acceptance, effort, schedule fit, adaptations, variety,
leftovers, and household history are evidence for that outcome rather than independent
goals.

## MVP boundaries

### Included

- One household stored in one browser.
- Diner names or labels and explicit hard dietary restrictions.
- Household-level schedule exceptions; assume everyone is home otherwise.
- Recipe Keeper ZIP candidate recipes and selection of 8-12 active household meals.
- Name-only meals with conservative provisional capabilities.
- A seven-day plan with intentional leftovers and fewer than seven cooking nights when
  appropriate.
- Conservative grocery generation from confirmed ingredients.
- Shopping completion and partial-availability confirmation.
- Start-cooking and dinner-ready elapsed timing.
- Plans-changed recovery with confirmed minimal plan repairs.
- Correctable dinner outcomes and confidence-aware household learning.
- Planned takeout as an explicit user choice.
- Distinct quick-cook and hands-off household schedule exceptions.

### Deferred

- Accounts, invitations, multi-device synchronization, and remote persistence.
- Individual schedule modeling.
- Generic recipe-site import.
- Pantry inventory, store pricing, ordering, coupons, and commerce integrations.
- Production machine-learning infrastructure.
- Automatic dietary-safety interpretation or allergy certification.
- Separate picky-eater entrees.
- Silent plan repair.
- AI recipe discovery or an AI-chat-first experience.

Remote persistence is P1 only if the MVP is successful. The MVP should retain a
versioned serializable state document, isolate browser storage, keep domain logic free
of storage APIs, and support state export/import. It should not pre-build repositories,
authentication, synchronization, or conflict resolution.

## Core product rules

### Meals and recipes

A meal is the planning concept. A recipe is one way to prepare it.

- Import review offers **Add as a new meal**, **Add as a version of an existing
  meal**, and **Save recipe only**.
- When a title resembles an existing meal, the app suggests that association but does
  not merge automatically.
- A result is an adaptation when the household would still call it the same dinner.
- A result is a distinct linked recovery meal when the household would independently
  name and schedule it.
- Most active MVP meals should be recipe-backed so the grocery list is useful, but a
  linked recipe is not required for a meal to participate in planning.
- Name-only meals never fabricate ingredients or detailed ingredient-level
  adaptations.

### Safety

Hard dietary restrictions are explicit, non-negotiable planning constraints. They are
never inferred or relaxed. When a household has a relevant hard restriction, unknown
or ambiguous recipe safety blocks planning until the user explicitly confirms
compatibility. Compatibility is never inferred from parsed ingredients or a meal name.
The product is a review aid and must not claim to certify allergy safety.

### Planner

Hard dietary restrictions and genuinely impossible household capacity exclude a
candidate. All other evidence contributes to one deterministic, explainable dinner
reliability score.

Initial implementation terms are:

| Term | Initial weight |
| --- | ---: |
| Household acceptance and observed history | 32 |
| Effort and time fit | 18 |
| Household schedule context | 12 |
| Viable shared-meal adaptation | 12 |
| Variety and repetition | 12 |
| Confirmed or predicted leftover fit | 8 |
| Evidence confidence | 6 |

The weights are implementation defaults, not a user-facing tuning system. Each
recommendation retains plain-language reasons. Raw outcomes remain available so a
later learning model can replace the initial scoring without discarding history.

The planner may offer at most one explicitly unfamiliar meal per week. Its actions are
**Use this meal**, **Make it work for us**, and **Not for us**. Taking no action uses
an active, compatible familiar household fallback; prior accepted outcomes are not
required. The optimizer never adds takeout; the user may select one or more takeout
dates during planning. Takeout dates are fixed inputs to the preview and never expose
cooking, timing, effort, or leftover controls.

`provisional: true` means that the household explicitly marked the meal **New to our
household**. An absent or false value means familiar. Familiar, active, compatible
meals are immediately eligible even without outcomes. Corrected accepted outcomes may
make an explicitly unfamiliar meal familiar for selection without rewriting the
persisted choice. Outcomes affect ranking, reasons, and confidence, not familiar-meal
eligibility or fallback eligibility.

For each cooking slot, first restrict selection to eligible meals with the lowest
current-preview non-leftover cooking count. Score and stable ID break ties only inside
that pool. With seven or more eligible cooking choices, the first seven cooking
selections are distinct. With two through six choices, cooking counts differ by at
most one and adjacent duplicates are avoided whenever another least-used meal fits the
date. An explicitly planned leftover slot is the only planned duplicate exception and
does not increment the cooking-selection count.

Constrained-night fit measures hands-on effort rather than total elapsed cooking time.
Use the unrounded average of defined `activeEffortMinutes` from corrected outcomes when
household evidence exists; otherwise use recipe `prepMinutes`. Unknown hands-on effort
remains unknown capacity on a constrained night. `cookMinutes` and observed
start-to-ready elapsed time may inform explanations, but never establish hard-fit
eligibility. This keeps slow-cooker and other make-ahead meals eligible when their
known hands-on effort fits the initial 30-minute constrained-night threshold.

The hands-off-night pilot correction separates three date capacities. An absent schedule
exception is normal. `constrained: true` means a quick-cook night and retains the known
30-minute hands-on threshold above. `handsOff: true` means the household cannot actively
cook during the dinner window: a reserved planned-leftover target ranks first, followed
by a selected recipe explicitly marked `handsOffSlowCooker: true`. Leftovers are a soft
ranking preference, not a requirement; multiple hands-off nights may exceed available
planned yields. Quick meals, name-only meals, and unmarked recipes do not fit a hands-off
night. If neither leftovers nor a marked recipe can cover the date, preview is
non-confirmable guidance or no-eligible—not automatic takeout. Takeout remains an
explicit user choice. For the MVP, the recipe marker is a household assertion that its
slow-cooker start window is feasible; timing and appliance-safety modeling are deferred.

`plannedLeftoverDinner` remains the explicit assertion that one cooking occurrence
produces one additional household dinner. The planner assigns that coverage to the
earliest unfilled later hands-off night, then the earliest unfilled later constrained
night, then the earliest unfilled later normal night in the same seven-day plan, even
when another dinner occurs between source and leftovers. A flagged meal cannot be
selected as a cooking source when no later target can be reserved, and leftover-fit
points are awarded only after reservation. Multiple sources reserve distinct targets.
Each coverage unit is consumed once, retains its link to the earlier source slot,
never increments cooking usage, and is never inferred from recipe yield alone.

A linked leftover target is serving or reheating, not a second cooking occurrence. It
does not expose **Start cooking**, may use **Dinner's ready** without a cooking-start
timestamp, and never records active-effort or elapsed-cooking evidence. Acceptance and
leftover outcome feedback remain available. If takeout replaces either end of an
unfinished leftover link, the preview removes that dependency and replans its affected
unfinished slot; it never silently converts the target into an ordinary cooking night.

Planner preview output is discriminated:

- `plan` contains exactly seven slots.
- `guidance` covers one viable familiar meal or unfamiliar meals without a familiar
  fallback and gives an actionable next step.
- `no-eligible` is reserved for candidates excluded by inactivity, incompatibility,
  or date-capacity constraints that prevent a complete plan.

Guidance and failed previews remain transient, cannot be confirmed, and never mutate
persisted state. The planner must not manufacture seven copies of one meal or expose a
partial result as a confirmable weekly plan.

### Shared-meal adaptations

An adaptation must solve the rejection-driving issue while preserving one coordinated
cooking session. Good patterns include:

- Spaghetti and meatballs -> Swedish meatballs with pasta when the sauce swap uses
  available ingredients and comparable effort.
- Chicken fajitas -> reserve chicken before combining it with vegetables, or cook the
  vegetables separately.
- Grilled buffalo chicken -> split only the final seasoning between buffalo and the
  household's traditional seasoning.

Reject adaptations that create a second entree, fail to solve the identified issue,
require an unplanned non-staple protein, add a separate cooking timeline, or increase
effort when a simpler shared-meal adjustment exists.

When the app lacks enough context, it may ask which diner and which ingredient or
preparation is the problem. It should then present two to four meaningfully different
options where evidence permits. **None of these work** moves the whole household to a
different dinner rather than creating a separate entree.

### Plan repair

Initial planning and repair use one pure constraint-aware replanning path. A repair
starts from a user-selected unfinished date in an explicitly selected plan; the app
never implicitly chooses the latest plan or first unfinished slot. If more than one plan
contains the date, the user selects the plan. Every repair is previewed and requires
confirmation. A new plan cannot be confirmed while any proposed date overlaps an
unfinished slot in another confirmed plan; the user is routed to repair that plan.
Legacy or imported overlaps require explicit plan selection. Grocery, shopping,
cooking, feedback, and repair operations receive an explicit transient `planId`; no
persisted current-plan pointer is added.

Completed days remain fixed. Takeout slots, confirmed planned-leftover coverage, and
confirmed shopping commitments are fixed inputs except for the explicitly targeted slot
and its required dependency closure. Other unfinished days remain unchanged unless
changing them is required to restore a valid plan. The preview lists every changed slot,
leftover link, and grocery effect before one atomic confirm.

One planned source links to at most one later target, and each actual leftover lot
reserves at most one dinner. Replacing a source removes and replans unfinished targets;
replacing a target removes its link. Replacing an unfinished actual-leftover target
reactivates its reserved lot, while completed consumers remain fixed. Confirmation
appends repair-revision evidence for every changed slot.

On a hands-off repair, either a valid planned-leftover dependency or a user-selected
available confirmed leftover lot satisfies capacity, and each remains single-consumer.
Initial planning prefers and reserves planned coverage; it never silently consumes an
actual leftover lot.

Restrictions, schedule exceptions, recipe selection, grocery availability, and
leftover outcomes invalidate an open preview. Changes affecting a confirmed plan mark
its affected unfinished dates for review and offer replanning; they never silently save
a repair. One pure effective-capacity resolver is shared by initial planning, every
repair action including both destinations of a swap, and confirmed-plan revalidation.
Every proposed plan revalidates active state, explicit dietary compatibility, capacity,
recipe version, shopping commitments, and leftover links. A hands-off cooking slot is
valid only when its exact selected `recipeId` references a recipe marked
`handsOffSlowCooker: true`; planned- and actual-leftover consumer slots bypass cooking
capability checks. A replacement cannot use a meal or recipe that fails those checks.

**Plans changed** may offer:

- A simpler version using the planned core ingredients.
- A swap with another planned household meal.
- Confirmed leftovers.
- A linked recovery meal.
- Whole-household takeout selected by the user.

**Just show me options** bypasses diagnosis. Otherwise, ask a reason only when it
changes immediate alternatives, success classification, or future recommendations.
Never ask why and then show the same options.

Recipe choice preserves an unchanged slot's recipe. A changed slot uses the meal's
`recipeIds` association order and then recipe storage order; opaque ID sorting never
selects a version. **Simpler version** is offered only when an existing adaptation
selects a materially different stored recipe.

Planned takeout is successful when eaten. Same-day takeout after an unforeseeable
external disruption may be successful recovery. Takeout caused by predictable timing,
effort, preparation, or acceptance failure is an unsuccessful planning outcome even
though dinner was obtained. Replacing an accepted meal with same-day takeout routes
through reason-aware recovery.

### Shopping and leftovers

**Shopping done** confirms either all planned items or identifies unavailable/skipped
items. Before confirmation, purchased-food preservation is provisional. Afterward,
confirmed perishables receive stronger protection during repair.

The confirmed shopping snapshot is immutable historical evidence; later derivation never
replaces its item IDs, availability statuses, source lines, or provenance with new
grocery-row data. When present, each `sourceSlotIds` entry is position-aligned with one
`sourceLines` entry, has equal length, and references a slot in the snapshot's plan.
Targeting first verifies that referenced slots still match. Otherwise it conservatively
scans every unfinished slot in the selected plan by normalized parsed ingredient or
exact normalized raw line. No match preserves the evidence and offers no targeted
repair. Legacy snapshots without source-slot provenance use the same conservative scan.
Removing or reducing any recorded perishable contribution requires explicit
acknowledgement. Repair deltas are derived without rewriting the snapshot.

Grocery consolidation:

- Normalizes obvious equivalents.
- Combines quantities only when units are directly compatible.
- Preserves original recipe lines for traceability.
- Leaves ambiguous items separate.
- Identifies meals whose ingredients are incomplete.
- Never presents a partial grocery list as complete.

Post-meal leftover coverage is recorded as:

- Nothing.
- Some, but not enough for dinner.
- Enough for one household dinner.
- Enough for more than one household dinner.

One planned leftover yield represents exactly one reservable future household dinner;
additional reported leftovers are feedback and are not auto-allocated in the MVP. If a
source meal does not produce that dinner, its dependent unfinished dinner is immediately
flagged and repaired. Future leftover planning for that meal is suspended until the user
chooses either **Remove leftover planning** or **Increase recipe quantity**.

Increasing quantity is a future preference on the specific failed leftover-producing
recipe; it cannot repair food already cooked. Name-only meals can only remove leftover
planning. The user selects `1.5x` or `2x`, and the immediate dependent dinner is still
repaired. After a failed `2x` yield, further increase is not offered and leftover
planning remains suspended until removed. The preference and immediate repair are saved
only together after preview and confirmation. Grocery derivation scales only quantities
the existing decimal-and-known-unit parser can parse. Other raw ingredient lines remain
unchanged and are visibly marked **Manual quantity adjustment**.

### Cooking outcomes and learning

**Start cooking** and **Dinner's ready** are the only MVP source of observed elapsed
time. Missing either action leaves timing unknown. Active effort is a separate signal.

**Dinner's ready** begins eating and must not immediately ask for feedback. Outcome
feedback becomes eligible after a delay and opens on the next app visit. It remains
dismissible and recoverable.

A household dinner is unsuccessful when an expected diner refuses the shared meal,
even if other diners eat it. Positive person-level acceptance is still retained.
Absence, eating separately, or lack of hunger is neutral rather than rejection.
Recent outcomes can be corrected; derived evidence is recalculated afterward.

Confidence is internal:

- **Estimated**: no household evidence.
- **Learning**: one or two relevant outcomes.
- **Established**: at least three reasonably consistent outcomes.

Contradictory evidence lowers confidence rather than producing false precision.
Context-specific evidence may remain distinct, such as a meal working on weekends but
being abandoned on constrained nights.

## Recipe Keeper import boundary

The supplied representative Recipe Keeper export contains one `recipes.html` document
with repeated `.recipe-details` records and local image entries. The MVP imports that
ZIP entirely in the browser. It does not add a server endpoint or retain support for
individual share links.

Use `fflate` only to inspect and extract the ZIP container. Require a ZIP signature,
maximum 32 MiB selected file, at most 1,000 entries, entry names no longer than 255
characters, and exactly one root `recipes.html`. Reject absolute, drive-qualified,
backslash, dot-segment, encrypted, malformed, or unsupported archives. Check declared
sizes before extraction and cap decoded `recipes.html` at 5 MiB. Never extract or open
image entries. Support the supplied export's ZIP64 per-entry size fields while keeping
ZIP64 archive directories, counts, and offsets unsupported.

Parse at most 1,000 `.recipe-details` records with the native `DOMParser`. Read only
fixture-proven Recipe Keeper fields for external recipe ID, title, source metadata,
course/category, prep and cook duration, yield, ingredients, and instructions. Never
render imported HTML or fetch source or image links. Bound title, source, category, and
yield to 1 KiB each; ingredients and instructions to 500 items, 2 KiB per item, and
128 KiB aggregate per field.

ZIP bytes, HTML, images, and normalized candidates remain transient. Zod validates
normalized drafts before review. Malformed, unnamed, or duplicate-ID records are
skipped with a visible count; fail when no valid candidates remain. Boundary failure
clears transient results and leaves runtime state unchanged.

Candidate review offers **Add as a new meal**, **Add as a version of an existing
meal**, and **Save recipe only**, with contextual title suggestions. **Add as a new
meal** defaults to familiar; an unchecked-by-default **New to our household** opt-in
sets `provisional: true`. Adding a recipe version preserves the target meal's
familiarity while still requiring safety reconfirmation when the recipe or household
restrictions make that necessary. Only explicit confirmation dispatches normalized
recipe and meal changes through the reducer. Never silently merge or overwrite an
existing recipe. This is a fixture-specific local importer, not a generic ZIP or
recipe-import framework; revisit share links only if users cannot obtain exports.

## State and architecture

Use a React and TypeScript Vite application hosted on Vercel. Use plain CSS with design
tokens, native browser APIs, `useReducer`, local storage, and file-based state
export/import. Use Zod at the persisted-state, uploaded-backup, and importer boundaries.
Use `fflate` for the local Recipe Keeper ZIP boundary and native `DOMParser` for its
HTML. Add Vitest, React Testing Library, ESLint, and one late Playwright smoke
flow. Do not add a router, global-state package, component framework, utility-CSS
framework, database, auth, repository layer, or live AI dependency.

Recipe images are not imported or persisted in the MVP.

`AppStateV2` is the currently implemented runtime and persisted document. V2 retains
the V1 document shape and reference refinements; the discriminator and familiarity
semantics are its only schema-version changes:

- `schemaVersion: 2` is the top-level discriminator.
- IDs are stable opaque strings generated with the native `crypto.randomUUID()` API.
- Calendar dates use `YYYY-MM-DD`, timestamps use UTC ISO 8601 strings, and durations
  use non-negative integer minutes.

- `household`: diners, hard restrictions, and household schedule exceptions.
- `meals`: active state, provisional attributes, safety-review state, recipe references,
  adaptations, and linked recovery meals.
- `recipes`: source metadata, optional meal association, ingredients, method, serving
  data, and preparation-specific attributes.
- `plans`: confirmed slots, variants, score reasons, leftover dependencies, and repair
  revisions.
- `leftoverLots`: plan-derived dinner coverage only, not pantry inventory.
- `outcomes`: raw timing, availability, acceptance, leftovers, corrections, and
  recovery classification.

Adaptive replanning introduced `AppStateV3`. V1 and V2 schemas remain frozen. V3 adds
three optional fields: `recipes.leftoverQuantityMultiplier` is `1.5` or `2`, shopping
items may carry position-aligned `sourceSlotIds`, and outcomes may carry
`leftoverServing: true`. An absent multiplier means `1x`; absent provenance uses the
conservative matching above; absent leftover-serving status is derived from the
referenced slot's planned or actual leftover link. The frozen V2-to-V3 migration changes
only the discriminator and writes `leftoverServing: true` where derivable. Corrections
preserve the marker.

The hands-off-night correction introduces `AppStateV4`. V1, V2, and V3 remain frozen.
V4 adds only optional `household.scheduleExceptions[].handsOff: true` and
`recipes[].handsOffSlowCooker: true`. V3-to-V4 changes only the discriminator; absent
fields preserve all prior meanings, so existing constrained dates remain quick-cook
dates and imported recipes remain unmarked. When duplicate exceptions exist for one
date, effective capacity resolves `handsOff` before `constrained` before normal without
rewriting imported or legacy state. The canonical writer replaces all records for the
edited date with at most one record: `handsOff: true`, `constrained: true`, or neither
capacity field for normal. It retains the replacement note when supplied, otherwise the
latest existing nonblank note; a normal date without a note stores no record. Load and
import continue to accept V1 through V4; normal save and export emit only the current V4.

Confirming a replan constructs and validates the complete next V4 document before
changing memory or storage. It atomically includes slot and dependency changes, one
repair revision for every changed slot, affected leftover lots, shopping provenance,
perishable acknowledgements, and quantity-preference consequences. Validation failure
changes neither memory nor storage. A storage failure may retain the already-valid V4 in
memory as visibly unsaved while preserving the prior exact stored raw value. Every
committed state mutation invalidates all transient previews; no persisted revision token
is added.

Referenced records are not hard-deleted in the MVP. They are marked inactive,
superseded, or corrected so historical plans and outcomes remain valid. Load and
import validation reject dangling references. Learning summaries are derived from the
current corrected raw records rather than persisted as a second source of truth.

Leftover-target outcomes are marked as servings of an earlier cooking occurrence. They
retain household acceptance evidence but do not contribute a second cooking-reliability,
elapsed-time, or active-effort observation. Constrained-night effort uses corrected
outcomes for the selected recipe version; only name-only meals fall back to meal-level
evidence.

The relevant plan slot persists `cookingStartedAt`, `dinnerReadyAt`,
`feedbackEligibleAt`, and feedback dismissal state. **Dinner's ready** makes feedback
eligible 30 minutes later. The next full page load after eligibility may open the
prompt; dismissing it leaves the outcome available from the plan history rather than
discarding it.

The storage and migration contract is:

- The fixed key remains `whats-for-dinner.app-state`; no second key, backup copy,
  history table, cross-tab synchronization, or rollback protocol is added.
- `migrateV1ToV2` accepts only a fully valid V1 document, changes the discriminator,
  removes `provisional` from every meal, changes nothing else, and validates the V2
  result. This is an intentional semantic mapping for documents produced by the pilot
  UI, whose Recipe Keeper flow set `provisional: true` by default and offered no
  explicit unfamiliar choice. It cannot preserve an externally authored V1 meaning
  that the old schema did not distinguish.
- `migrateV2ToV3` accepts only fully valid frozen V2, changes the discriminator, writes
  only derivable legacy leftover-serving markers, and validates the V3 result. The other
  optional fields remain absent. `migrateV3ToV4` accepts only fully valid frozen V3,
  changes only the discriminator, and validates the V4 result; both new optional fields
  remain absent. V1 loads and imports pass through V1 -> V2 -> V3 -> V4.
- A missing key initializes an empty V4 document. Valid V4 loads directly.
- Valid V1, V2, or V3 loads as migrated V4 and attempts one same-key write without
  deleting the old value first. Success enters ready/saved state. Failure leaves the
  exact prior raw value stored, runs the migrated V4 in memory, and visibly enters
  ready/unsaved state.
- Malformed V1-, V2-, V3-, or V4-shaped data enters malformed recovery. Any other
  discriminator enters unsupported-version recovery. Startup never overwrites the exact
  raw value in either case.
- Import accepts a fully valid V1, V2, V3, or V4 document. Older versions are migrated
  before the existing restriction-change safety reset and final V4 validation.
  Confirmation occurs before whole-document replacement; imports never merge.
- After import confirmation, a failed write leaves the prior stored raw value untouched,
  keeps the imported V4 in memory as unsaved, and reports **Loaded but not saved
  locally** rather than claiming the backup was imported successfully.
- Normal export validates and emits only the current in-memory V4, including a valid
  unsaved V4. V1 through V3 remain accepted only as migration input.
- Recovery reset reloads only after a successful V4 write. A failed reset leaves
  recovery visible and reports the error.
- Later committed reducer changes continue to write the complete validated V4 without
  deleting the previous value first. A failed write keeps memory, preserves the last
  stored raw value, and visibly marks changes as unsaved.

Keep candidate eligibility, scoring, plan construction, repair preview, grocery
derivation, and learning summaries as pure domain functions. The storage module alone
loads, validates, saves, exports, and imports application state.

## Original EPIC-1 delivery plan

1. **TREK-1: App foundation and local persistence**
   Create the application, initial `AppStateV1`, validation, local persistence,
   recovery, and whole-document state export/import.

2. **TREK-2: Household onboarding and meal library**
   Add minimal profiles, restrictions, household exceptions, active meal selection,
   name-only meals, and safety review.

3. **TREK-3: Recipe Keeper importer**
   Add bounded local ZIP selection and extraction, the fixture parser, candidate
   search/preview, contextual association, and explicit import destination.

4. **TREK-4: Weekly planning**
   Add deterministic scoring, explanations, confidence, intentional leftovers, and
   optional variety.

5. **TREK-5: Shopping and confirmed repair**
   Add conservative groceries, shopping confirmation, adaptation/recovery options,
   smallest-patch previews, and confirmation.

6. **TREK-6: Cooking outcomes and learning**
   Add timing, delayed feedback, household/person outcomes, leftovers, corrections,
   confidence derivation, and next-plan learning.

Each task depends on the preceding task. Trekker is the durable execution source of
truth.

## Pilot onboarding correction delivery plan

Implementation completed after senior developer review accepted this dependency plan.

1. **Persisted familiarity semantics**
   Add `AppStateV2`, the bounded V1-to-V2 migration and storage/import/export failure
   behavior above. Update Recipe Keeper's new-meal destination with the explicit
   familiarity opt-in. Preserve target familiarity when adding a recipe version and
   preserve all safety-review data during migration.

2. **First-plan selection and guidance**
   Depend on slice 1's V2 runtime contract. Add least-used-first cooking selection,
   familiar fallback semantics, discriminated preview results, actionable guidance,
   and recipe timing through either schema-supported meal association direction.

For the completed pilot-onboarding correction, do not change the Recipe Keeper ZIP
parser, infer dietary compatibility, add a second familiarity field, add dependencies,
or introduce migration/history infrastructure beyond its single V1-to-V2 function. The
separate adaptive-replanning correction below adds only the bounded V2-to-V3 step
specified above.

## Adaptive replanning correction delivery plan

Architecture and senior developer review accepted this dependency plan. Implementation
is complete and pilot validation is active.

1. **Foundation: V3 and shared replanning core**
   Own `schema.ts`, `storage.ts`, `weeklyPlan.ts`, `repair.ts`, `grocery.ts`,
   `learning.ts`, their focused tests, and only the minimal V3 typing/storage adaptation
   in `App.tsx` needed to keep the app buildable. Add one pure `replanRemainingWeek`
   path for both initial planning and repair; retain `buildWeeklyPlan` as its
   initial-preview wrapper. Freeze V1/V2 and add only the V3 fields and bounded migration
   above. Reuse repair revisions for persisted takeout and existing grocery parsing; do
   not add the new interaction flows in this slice.
   Prove valid V1/V2 migration and V3 persistence plus fixed completed/takeout slots,
   explicit target scope, safety/active/recipe/effort exclusions, one-source/one-target
   and one-lot/one-consumer semantics, unavailable/perishable inputs, recipe precedence,
   and non-duplicated leftover learning. Complete with focused unit/storage tests, lint,
   and build.

2. **Initial planning and confirmed-plan repair**
   Depend on slice 1. Support multiple transient takeout dates, explicit plan/date
   repair selection, review-needed presentation, overlap routing, and one preview that
   shows every slot, dependency, and grocery change before atomic confirm. Each
   restriction, schedule, recipe-selection, shopping-availability, or leftover-outcome
   change makes an open preview unconfirmable; confirmation independently revalidates
   the complete V3 document.
   Prove new-plan overlap rejection, legacy-overlap plan selection, explicit date repair,
   completed-slot preservation, fixed commitments outside the targeted dependency
   closure, valid multi-takeout plans, takeout without cooking controls, failed validation
   changing neither memory nor storage, and no implicit current-plan selection. Complete
   with the primary Testing Library flow, full suite, lint, and build.

3. **Shopping and failed-leftover triggers**
   Depend on slice 2. Preserve confirmed shopping controls, target unavailable-item
   repairs through source-slot provenance with a legacy fallback, require perishable
   acknowledgement, and implement the failed-yield remove-or-multiply preview. Prove
   shared unavailable ingredients, position-aligned immutable provenance, stale and
   legacy conservative fallback, no-target evidence preservation, perishable quantity
   reduction, one-lot/one-consumer reservation and unfinished-target reactivation,
   immediate dependent repair, `1.5x` then `2x` recipe-scoped scaling, removal-only after
   a failed `2x`, and manual marking of unparsed quantities. Complete with focused
   interaction/domain tests, full suite, lint, and build.

Do not add a rules engine, pantry or grocery-history ledger, automatic repair, takeout
provider workflow, recipe-version preference UI, broader quantity parser, individual
schedule model, or separate-entree path. The dependency order is 1 -> 2 -> 3; no finer
task split is justified for the MVP.

Stop and return to planning if the three V3 additions cannot express an invariant
without rewriting historical evidence or widening the schema; a valid repair must alter
a fixed slot outside the targeted dependency closure; overlap resolution needs an
implicit current-plan policy; or leftover behavior requires multiple planned targets or
multiple consumers of one actual lot.

## Hands-off-night pilot correction delivery plan

Planning is approved and architecture review is required before implementation. This
section does not authorize implementation.

1. **One vertical V4 hands-off-capacity slice**
   Freeze V1 through V3 and add the two optional V4 markers and bounded V3-to-V4
   migration above. Let the household select normal, constrained/quick-cook, or
   hands-off capacity for a date and explicitly mark a selected recipe as slow-cooker
   capable. Align initial planning, repair, confirmed-plan revalidation, preview
   invalidation, explanations, import/export, and storage behavior. On hands-off dates,
   use one available reserved leftover target first and otherwise allow only a marked
   selected recipe. Preserve one-source/one-target semantics and explicit takeout.

Do not add time-of-day scheduling, automatic slow-cooker detection, appliance safety
claims, yield prediction, additional leftover capacity, automatic takeout, a rules
engine, or a separate recipe-preference system. No finer task split is justified unless
architecture review identifies a foundation dependency.

## Verification

Use focused TDD for every behavior slice. After each task, run:

```powershell
npm test -- --run
npm run lint
npm run build
```

Use pure fixtures for import parsing, scoring, exclusions, grocery merging, repairs,
leftovers, and learning. Storage checks cover frozen V1 -> V2 -> V3 -> V4 plus direct
V2 -> V3 and V3 -> V4 migrations; valid V4 direct load, import, reload, and
saved/unsaved export; derivation and correction preservation of `leftoverServing`;
absent V3 and V4 field meanings; startup migration success and failure; exact old-raw
preservation after failed migration, import, reset, or save writes; initial unsaved
state; retry on a later mutation; malformed V1/V2/V3/V4 recovery; future-version
recovery; restriction safety reset; and memory/disk divergence.
Importer checks cover rejection before
extraction for invalid signature, file/entry/name/path limits, missing or duplicate
`recipes.html`, encrypted or unsupported compression, decoded size, malformed records,
duplicate IDs, bounded output, and unchanged application state on failure. Planner
checks cover unknown dietary safety remaining ineligible until explicit confirmation;
familiar meals with zero outcomes; unfamiliar fallback without an accepted outcome;
7, 6, 2, and 1 viable-meal cases; strong scores not defeating rotation; adjacency;
intentional leftovers; discriminated guidance/no-eligible results; and both supported
recipe association directions. Import interaction coverage verifies familiar-by-default
new meals, persisted unfamiliar opt-in, and version imports preserving target familiarity. App interaction
coverage verifies that `guidance` and `no-eligible` omit or disable plan confirmation
and leave the V4 `plans` collection unchanged. Use Testing Library
for the task's primary interaction flow. After the final task, add one browser smoke
path for onboarding -> plan -> shop -> cook -> feedback, including one confirmed replan
only if it fits that bounded path. A second broad end-to-end matrix is not required.

For the hands-off correction, add focused schema/migration coverage and pure planner,
repair, and revalidation cases proving: normal behavior is unchanged; constrained keeps
the known 30-minute hands-on threshold; hands-off rejects ordinary quick meals; one
yield covers only one later hands-off dinner; two hands-off nights with one yield use
leftovers then a marked slow-cooker recipe; missing coverage is non-confirmable and
never automatic takeout; capacity or recipe-marker edits invalidate affected previews;
and imported recipes default unmarked. Cover canonical capacity replacement and note
preservation, both swap destinations, valid planned and selected actual leftovers, and
the rule against silently consuming actual lots. Add one Testing Library flow that marks
a night and recipe, then previews the resulting plan.

## MVP acceptance signals

- A household reaches a seven-day first plan without entering a full recipe manually
  or recording prior dinner outcomes.
- The plan includes intentional leftovers and distinguishes quick-cook from hands-off
  nights.
- Name-only meals remain plannable without creating fictitious groceries.
- Recipe Keeper imports preserve meal/recipe separation.
- Grocery output clearly distinguishes known and incomplete ingredients.
- Broken leftovers and schedule changes produce confirmed minimal repairs.
- Shared-meal adaptations avoid a second entree.
- Same-day recovery is treated as a first-class success where appropriate.
- Corrected and repeated outcomes alter future explanations and recommendations.
- The next plan can identify at least one decision changed by household evidence.
