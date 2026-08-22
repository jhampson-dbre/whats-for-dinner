# What's for Dinner? Adaptive Planning MVP

Status: Pilot onboarding correction architecture and senior reviewed; implementation paused
Date: 2026-08-21
Tracker: EPIC-1

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
required. The optimizer never adds takeout; the user may select it during planning.

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

Every repair is previewed and requires confirmation. Completed days remain fixed and
unaffected future days remain unchanged.

**Plans changed** may offer:

- A simpler version using the planned core ingredients.
- A swap with another planned household meal.
- Confirmed leftovers.
- A linked recovery meal.
- Whole-household takeout selected by the user.

**Just show me options** bypasses diagnosis. Otherwise, ask a reason only when it
changes immediate alternatives, success classification, or future recommendations.
Never ask why and then show the same options.

Planned takeout is successful when eaten. Same-day takeout after an unforeseeable
external disruption may be successful recovery. Takeout caused by predictable timing,
effort, preparation, or acceptance failure is an unsuccessful planning outcome even
though dinner was obtained. Replacing an accepted meal with same-day takeout routes
through reason-aware recovery.

### Shopping and leftovers

**Shopping done** confirms either all planned items or identifies unavailable/skipped
items. Before confirmation, purchased-food preservation is provisional. Afterward,
confirmed perishables receive stronger protection during repair.

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

If a source meal does not produce expected leftovers, dependent future dinners are
flagged and the smallest repair is proposed. The repair requires confirmation.

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

`AppStateV2` is the single runtime and persisted document. V2 retains the V1 document
shape and reference refinements; the discriminator and familiarity semantics are the
only schema-version changes:

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

Referenced records are not hard-deleted in the MVP. They are marked inactive,
superseded, or corrected so historical plans and outcomes remain valid. Load and
import validation reject dangling references. Learning summaries are derived from the
current corrected raw records rather than persisted as a second source of truth.

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
- A missing key initializes an empty V2 document. Valid V2 loads directly.
- Valid V1 loads as migrated V2 and attempts one same-key write without deleting the
  old value first. Success enters ready/saved state. Failure leaves the exact V1 raw
  value stored, runs the migrated V2 in memory, and visibly enters ready/unsaved state.
- Malformed V1- or V2-shaped data enters malformed recovery. Any other discriminator
  enters unsupported-version recovery. Startup never overwrites the exact raw value in
  either case.
- Import accepts a fully valid V1 or V2 document. V1 is migrated before the existing
  restriction-change safety reset and final V2 validation. Confirmation occurs before
  whole-document replacement; imports never merge.
- After import confirmation, a failed write leaves the prior stored raw value untouched,
  keeps the imported V2 in memory as unsaved, and reports **Loaded but not saved
  locally** rather than claiming the backup was imported successfully.
- Normal export validates and emits only the current in-memory V2, including a valid
  unsaved V2. V1 remains accepted only as migration input.
- Recovery reset reloads only after a successful V2 write. A failed reset leaves
  recovery visible and reports the error.
- Later committed reducer changes continue to write the complete validated V2 without
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

Implementation remains paused until senior developer review accepts this dependency
plan.

1. **Persisted familiarity semantics**
   Add `AppStateV2`, the bounded V1-to-V2 migration and storage/import/export failure
   behavior above. Update Recipe Keeper's new-meal destination with the explicit
   familiarity opt-in. Preserve target familiarity when adding a recipe version and
   preserve all safety-review data during migration.

2. **First-plan selection and guidance**
   Depend on slice 1's V2 runtime contract. Add least-used-first cooking selection,
   familiar fallback semantics, discriminated preview results, actionable guidance,
   and recipe timing through either schema-supported meal association direction.

Do not change the Recipe Keeper ZIP parser, infer dietary compatibility, add a second
familiarity field, add dependencies, or introduce migration/history infrastructure
beyond the single V1-to-V2 function.

## Verification

Use focused TDD for every behavior slice. After each task, run:

```powershell
npm test -- --run
npm run lint
npm run build
```

Use pure fixtures for import parsing, scoring, exclusions, grocery merging, repairs,
leftovers, and learning. Storage checks cover full-field V1-to-V2 migration, startup
migration success and failure, exact old-raw preservation, initial unsaved state, retry
on a later mutation, V2 reload, malformed V1/V2 recovery, future-version recovery,
failed recovery reset, V1/V2 backup import, restriction safety reset, failed-import
memory/disk divergence, and V2-only export from saved and unsaved state. Importer checks cover rejection before
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
and leave the V2 `plans` collection unchanged. Use Testing Library
for the task's primary interaction flow. After the final task, add one browser smoke
path for onboarding -> plan -> shop -> cook -> feedback. A broad end-to-end matrix is
not required.

## MVP acceptance signals

- A household reaches a seven-day first plan without entering a full recipe manually
  or recording prior dinner outcomes.
- The plan includes intentional leftovers and reflects constrained nights.
- Name-only meals remain plannable without creating fictitious groceries.
- Recipe Keeper imports preserve meal/recipe separation.
- Grocery output clearly distinguishes known and incomplete ingredients.
- Broken leftovers and schedule changes produce confirmed minimal repairs.
- Shared-meal adaptations avoid a second entree.
- Same-day recovery is treated as a first-class success where appropriate.
- Corrected and repeated outcomes alter future explanations and recommendations.
- The next plan can identify at least one decision changed by household evidence.
