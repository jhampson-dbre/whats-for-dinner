# Community noticeboard production UI prototype

Status: code-first design checkpoint; rendered inspection, finish review, design-system documentation, and concrete prototype approval are pending.

The user selected the community noticeboard direction and a full phone-primary, desktop-capable prototype. Planning the week and shopping are the focal tasks. This artifact uses sample household data; it does not connect to Auth, APIs, production storage, or the browser-local MVP state.

## Artifact and navigation

Open `docs/prototypes/production-ui/index.html` through the existing Vite development server. The prototype has five ordinary destinations: Today, Plan, Shop, Recipes, and Household. Plan is the initial view. Phone navigation stays at the bottom; desktop navigation occupies a cobalt rail. A phone action dock keeps the next confirm-or-shop action available while the week scrolls.

`Try a situation` belongs to the prototype viewer, outside the product shell. It switches between sample planning, shopping, cooking, feedback, failed-leftover recovery, multiple/no matching plans, empty/invited onboarding, loading, pending, failed, conflict, revoked access, a larger recipe library, and a correction with a completed leftover dependency. None of these states represents a real save or verified real-world account.

## Task map

| Destination | Primary job | Consequential action and preserved context |
| --- | --- | --- |
| Plan | Review seven dinners, schedule capacity, and leftover links | Week confirmation follows a review; dinner repair carries explicit plan/slot identity and the household revision captured by its preview |
| Shop | Check known ingredients and record partial availability | Shopping confirmation distinguishes checked, unchecked, unavailable, and incomplete ingredients; a recorded shopping snapshot is retained |
| Today | Complete the selected dinner and handle changed plans | A unique confirmed date match can lead; ambiguous matches require plan choice; completion supports timing or no timing |
| Recipes/detail | Search meals and read a complete preparation method | Meal/recipe identity remains distinct; name-only information stays unknown; hard-restriction compatibility requires an explicit household assertion |
| Household | Maintain diners, hard restrictions, household capacity, and member invitations | Restriction/capacity changes require review of affected dinners; invitations are email-bound and creator-managed in the release contract |

## Planning and shopping

The first view is a dated list, rather than a gallery of equal-weight meal cards. Every cooking row names the meal and known hands-on effort; hands-off and quick-cook exceptions appear beside the affected dinner. Leftover serving names its source and has no second cooking timer. Takeout is visibly a household choice.

The readiness column and phone action dock lead from reviewing the week to confirming it and then shopping. Grocery content is grounded in the selected cooking recipes. Leftover servings do not duplicate cooking ingredients, and name-only meals do not invent a list. Ambiguous quantities stay separate.

Confirmed-plan repair is a protected review. It lists the selected dinner and every required unfinished dependency change, then requires one confirmation. A source change must not leave a hands-off leftover target with an incompatible or unknown replacement. Completed dependent dinners block contradictory source changes until corrected first. A stale household revision cannot apply the preview.

## Cooking, feedback, and corrections

`Start cooking` provides the observed start. `Dinner's ready` records completion; `Record dinner without timing` leaves elapsed time unknown. Feedback becomes available without opening itself. Individual acceptance and neutral absence/lack-of-hunger responses are distinct; refusal by an expected diner means the shared dinner was not accepted by everyone.

Leftover serving and takeout do not collect active cooking effort. A takeout correction keeps completion and the earlier raw record, removes false cooking evidence, and previews required unfinished leftover changes. Its reason can distinguish unforeseeable disruption from timing/effort/preparation or acceptance failure without changing the immediate recovery options.

## Shared-state and difficult states

The production integration must keep loading, pending, saved, failed, conflict, and revoked access explicit. Failure preserves the draft and offers retry. Conflict compares retained draft intent with refreshed household data; refreshing invalidates stale previews. Revocation removes household content from the screen and explains the route back to authorized access. No automatic merge, offline editing, or persisted current-plan pointer is authorized.

The prototype simulates these states. The state scenarios and model checks demonstrate selected constraints; they are not a replacement for the production adapters or complete domain behavior in the MVP.

## Visual direction

Community noticeboard clarity uses Public Sans, a cobalt shell, pale periwinkle work surfaces, yellow selected/next actions, and ink text. Date divisions and readable meal names organize the week. State meaning always has text or an icon as well as color. The signature weekly readiness strip connects the source cooking dinner, its leftover target, and the shopping decision. Only a short state-settling moment is intended; reduced motion snaps.

The development-only direction contract is in `.impeccable/surfaces/docs-prototypes-production-ui-index-html.md`. Final token-bearing `DESIGN.md` and `.impeccable/design.json` must be extracted from a rendered, reviewed artifact. They have not been written as if the proposed system were already verified or approved.

## Verification checkpoint and next gate

`node scripts/check-production-ui.mjs` verifies source/leftover repair, stale-preview rejection without plan mutation, explicit-context correction, retained raw feedback/timing history, completed-dependent protection, and confirmed compatibility for replacements. `node --check docs/prototypes/production-ui/prototype.js` verifies syntax. These checks do not establish visual quality or complete UI interaction acceptance.

The Impeccable hook initially found tiny text; the affected styles were increased and the next hook scan reported no deterministic findings. No findings were suppressed. No rendered screenshot round or finish-review verdict exists yet: the browser permission check rejected opening the local prototype at `127.0.0.1:4173`.

Next: allow local browser access, inspect phone and desktop together, run one executable Plan–Shop–Cook–feedback–recovery path and the defining difficult states, batch any material corrections, obtain the independent finish review, extract the design system, and present the concrete prototype for user approval. TREK-36 stays open. Production UI implementation is separate work after that approval.
