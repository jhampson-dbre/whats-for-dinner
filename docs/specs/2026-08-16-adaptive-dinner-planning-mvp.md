# What's for Dinner? Adaptive Planning MVP

Status: Architecture and delivery reviewed; approved for implementation
Date: 2026-08-16
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
- Recipe Keeper candidate recipes and selection of 8-12 active household meals.
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
- Recipe Keeper bulk-export parsing until a representative export is available.
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

The planner may offer at most one unfamiliar meal per week. Its actions are **Use this
meal**, **Make it work for us**, and **Not for us**. Taking no action uses a proven
household fallback. The optimizer never adds takeout; the user may select it during
planning.

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

The individual share page supplied during discovery exposes structured recipe HTML but
does not permit cross-origin browser fetching. The MVP may therefore use one narrowly
allowlisted same-origin endpoint.

The browser extracts the Recipe Keeper identifier. The server accepts only that
identifier and constructs:

```text
https://recipekeeperonline.com/recipe/<validated-id>
```

The endpoint must:

- Accept `POST /api/recipekeeper-import` with a small JSON body containing only the
  Recipe Keeper identifier; it never accepts an upstream URL.
- Validate identifiers with a bounded URL-safe character pattern before making a
  request.
- Reject any other host, scheme, path, port, credentials, query, fragment, redirect,
  or arbitrary URL.
- Omit credentials and disable redirects.
- Abort the upstream request after five seconds and reject responses larger than 512
  KB, including streamed responses whose declared size is absent or incorrect.
- Require a successful response with an HTML content type.
- Parse only the fixture-proven fields into a narrow recipe draft.
- Return neither raw HTML nor a remote response pass-through.
- Persist nothing server-side.
- Leave application state unchanged on fetch or parse failure.
- Reject non-POST methods, non-JSON content, oversized request bodies, unknown body
  fields, and identifiers that do not match the exact bounded schema before any fetch.
- Do not log Recipe Keeper identifiers, request bodies, or upstream response bodies.

The normalized response may contain only bounded text and arrays for title, source
metadata, course/category, prep and cook duration, yield, ingredients, and
instructions. Source links are metadata and are never fetched by the proxy. Recipe
images are outside the MVP.

Use a Vercel TypeScript function and `node-html-parser` for the fixture-proven
microdata selectors. Return explicit errors for invalid identifiers, unavailable or
unparseable recipes, upstream timeout/failure, and oversized responses. Do not enable
cross-origin access; the application calls the function from the same origin.

This is an importer endpoint, not a generic proxy or import framework. Revisit it only
if the MVP succeeds.

Same-origin access is not an abuse control. Before enabling the importer on a public
deployment, use provider-native rate and spend protection. If the selected hosting
plan cannot bound public prototype exposure, keep the importer disabled outside a
controlled preview. Do not add custom authentication or a proxy framework for the MVP.
TREK-3 must verify that protection or verify that the importer remains preview-only or
disabled; escalate before public enablement if neither condition can be met.

## State and architecture

Use a React and TypeScript Vite application hosted on Vercel. Use plain CSS with design
tokens, native browser APIs, `useReducer`, local storage, and file-based state
export/import. Use Zod at the persisted-state, uploaded-backup, and importer boundaries.
Add Vitest, React Testing Library, ESLint, and one late Playwright smoke
flow. Do not add a router, global-state package, component framework, utility-CSS
framework, database, auth, repository layer, or live AI dependency.

Recipe images are not imported or persisted in the MVP.

`AppStateV1` is the single persisted document:

- `schemaVersion: 1` is the top-level discriminator.
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

The storage contract is:

- The fixed key is `whats-for-dinner.app-state`.
- A missing key initializes a new V1 document. A valid V1 document restores exactly.
- Malformed data or an unsupported schema version is never overwritten during startup.
  The app enters recovery where the user may download the untouched raw value or reset
  it explicitly.
- The complete validated document is written after committed reducer changes without
  deleting the previous value first. A failed write keeps the in-memory state, leaves
  the last stored value untouched, and visibly marks changes as unsaved.
- Normal export downloads only a validated V1 document. Import validates before any
  mutation and, after confirmation, replaces the whole document; it never merges.
- V1 has no predecessor to migrate. Reject unsupported versions now and add a migration
  only when a later schema version exists.

Keep candidate eligibility, scoring, plan construction, repair preview, grocery
derivation, and learning summaries as pure domain functions. The storage module alone
loads, validates, saves, exports, and imports application state.

## Delivery plan

1. **TREK-1: App foundation and local persistence**
   Create the application, `AppStateV1`, validation, local persistence, recovery, and
   whole-document state export/import. Do not add migration machinery before V2 exists.

2. **TREK-2: Household onboarding and meal library**
   Add minimal profiles, restrictions, household exceptions, active meal selection,
   name-only meals, and safety review.

3. **TREK-3: Recipe Keeper importer**
   Add the allowlisted endpoint, fixture parser, preview, contextual association, and
   explicit import destination.

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

Implementation remains paused. Before dispatching TREK-1, commit this canonical plan
and align TREK-1 evidence with V1 persistence/reload, malformed and unsupported-version
recovery without overwrite, and whole-document import replacement. TREK-1 must state
that no migration is required before V2. An `in_progress` tracker status does not
override this implementation pause.

## Verification

Use focused TDD for every behavior slice. After each task, run:

```powershell
npm test -- --run
npm run lint
npm run build
```

Use pure fixtures for import parsing, scoring, exclusions, grocery merging, repairs,
leftovers, and learning. Storage checks cover V1 load/save/reload, malformed and future
version recovery without overwrite, whole-document import replacement, write failure,
and cooking/feedback restoration after reload. Importer checks cover rejection before
fetch, redirects, timeout, content type, declared and streamed size limits, bounded
output, and unchanged application state on failure. Planner checks cover unknown
dietary safety remaining ineligible until explicit confirmation. Use Testing Library
for the task's primary interaction flow. After the final task, add one browser smoke
path for onboarding -> plan -> shop -> cook -> feedback. A broad end-to-end matrix is
not required. Add migration fixtures only when a later schema version exists.

## MVP acceptance signals

- A household reaches a seven-day plan without entering a full recipe manually.
- The plan includes intentional leftovers and reflects constrained nights.
- Name-only meals remain plannable without creating fictitious groceries.
- Recipe Keeper imports preserve meal/recipe separation.
- Grocery output clearly distinguishes known and incomplete ingredients.
- Broken leftovers and schedule changes produce confirmed minimal repairs.
- Shared-meal adaptations avoid a second entree.
- Same-day recovery is treated as a first-class success where appropriate.
- Corrected and repeated outcomes alter future explanations and recommendations.
- The next plan can identify at least one decision changed by household evidence.
