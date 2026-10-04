# What's for Dinner?

<!-- impeccable:product-schema 1 -->

## Platform

web

Responsive web app, with phone use primary and desktop use supported. No native app is in the release scope.

## Users

The primary audience is a small invited cohort of households. Household members coordinate one shared dinner for everyone expected to eat, including planning, shopping, preparation, and recovery when the day changes.

The release supports a household creator and invited members. All current members can edit household data; creator-only responsibilities include inviting and revoking members. An operator issues creator invitations and handles production backup and recovery.

## Product Purpose

Help households get dinner handled through **Plan -> Shop -> Cook -> Learn -> Adapt**. A plan is a starting point, not an obligation to follow the original dinner.

Success means everyone expected at dinner can eat the shared meal. Accepted same-day simplification, swaps, and appropriate confirmed recovery count as success. Preparing separate entrees or running two dinner timelines is an anti-goal.

Dinner obtained and planning success are distinct evidence. Planned takeout is successful when eaten. Same-day takeout after an unforeseeable disruption may be successful recovery; takeout caused by predictable timing, effort, preparation, or acceptance failure remains an unsuccessful planning outcome. Absence and lack of hunger are neutral, rather than meal rejection.

## Positioning

The product improves the reliability of a household's own dinners. It uses familiar meals, explicit dietary constraints, schedule capacity, available ingredients, leftovers, and corrected household outcomes to explain recommendations and adapt future plans.

It is not a recipe-discovery or chat-first product. Variety and learning serve the shared-dinner outcome; they do not override safety, household acceptance, or practical effort.

## Operating Context

- Household setup records expected diners, explicit hard dietary restrictions, and household schedule exceptions. An ordinary night, a quick-cook night, and a hands-off dinner window have different capacity requirements.
- Meal setup can use existing Recipe Keeper ZIP recipes or name-only meals. A meal is the planning concept; a recipe is one way to prepare it. Recipe association requires review rather than automatic merging.
- Weekly planning previews seven days, including intentional leftovers and explicitly chosen takeout. Familiar compatible meals can participate without prior feedback; users do not need to enter a complete recipe manually to get started.
- Shopping is based on confirmed ingredient information and records completion or partial availability. Missing information stays visible rather than becoming invented groceries.
- Cooking supports start-to-ready timing and recording a completed dinner without timing. Feedback is available immediately after completion, remains optional, and can be corrected later.
- When plans change, users can choose useful recovery options without a mandatory diagnosis step. Ask for a reason only when it changes the alternatives, outcome classification, or learning.

## Capabilities and Constraints

### Current implementation and release target

The current frontend is a browser-local household prototype. Household access, bounded record APIs, and operator backup/restore are implemented backend foundations; the frontend does not yet connect to those capabilities. Their presence does not establish a deployed or launch-ready shared app.

The agreed release target is a small invited cohort using the shared app across devices. Production households start empty; no pilot-data migration or import is planned. Verified signup may be open, but household access requires an email-bound invitation. Shared use is online only.

The backend uses Supabase Auth/Postgres and thin server endpoints intended for Vercel. Secrets stay server-side and each read or write checks current membership. The release must expose loading, pending, saved, failed, conflict, and revoked-access states. A conflict retains the user's draft and requires resolution; no automatic merge, realtime collaboration, or offline editing is in scope.

Production data uses bounded records and paginated reads rather than one ever-growing state file. Full production recipes, outcomes, repairs, and retained history must remain available. Operator recovery uses encrypted backups and staged restore to an empty destination; the approved recovery policy permits up to one week of data loss. Deployment and operational readiness are separate release work.

### Rules future interfaces must preserve

- Hard dietary restrictions are explicit and never inferred or relaxed. Unknown or ambiguous compatibility blocks planning until the household explicitly confirms it. The app is a review aid, not an allergy-safety certification.
- Adaptations preserve one coordinated cooking session and solve the actual acceptance or capacity problem. If none work, change the whole household's dinner rather than creating a separate entree.
- Takeout is an explicit user choice, never an automatic planner fallback. Unknown ingredients, effort, or timing remain unknown.
- Repairs show all affected dinners, leftover links, and grocery effects before confirmation. Preserve completed dinners and existing shopping, cooking, outcome, leftover, and repair history; corrections must remain auditable.
- A Today view may select a dinner automatically only when exactly one confirmed plan/slot matches the date. No match needs an empty state; multiple matches need explicit plan choice. Carry plan and slot identity and the expected household revision through actions. Refreshed data invalidates stale previews; do not persist an implicit current-plan pointer.
- Keep hands-on effort distinct from elapsed cooking time. A hands-off night needs valid leftover coverage or a household-confirmed suitable slow-cooker recipe. Do not invent a cooking start when recording dinner afterward.
- Learning uses corrected outcomes and confidence-aware explanations. A leftover serving or takeout correction must not become false cooking or recipe evidence.

Pantry inventory, commerce, ordering, store pricing, new recipe sources, AI discovery/chat, production machine learning, and individual schedule modeling are outside the agreed release scope.

## Brand Commitments

Preserve the product name **What's for Dinner?** and the distinction between meals and recipes. Use plain-language reasons and truthful action labels. No binding visual world, palette, typography, or new brand voice has been selected by this initialization.

## Evidence on Hand

- `docs/specs/2026-08-16-adaptive-dinner-planning-mvp.md` records the existing product rules, MVP acceptance signals, and delivered pilot corrections. Its browser-only/deferred-auth boundary describes the original MVP; it is not the boundary for the invited-cohort release.
- `src/App.tsx`, `src/domain/`, `src/import/`, and `src/state/` contain the current prototype, planning/recovery behavior, Recipe Keeper intake, and local persistence. `src/App.test.tsx`, domain/storage tests, and `e2e/` provide executable behavior evidence.
- `docs/household-access.md`, `docs/records-api.md`, and `docs/production-backup-restore.md` describe the implemented backend and operator contracts. They do not demonstrate frontend integration or production deployment.
- Trekker EPIC-6 records the invited-cohort release scope. TREK-36 owns the later mobile-first design, task map, navigation, representative prototypes, and user approval before UI implementation.
- The existing interface is a working prototype, not an approved production design. No customer testimonials, adoption figures, proven cohort outcomes, pricing, or marketing proof were established during init; do not fabricate them.

## Product Principles

1. Optimize for one shared dinner everyone expected can eat, rather than adherence to the initial plan.
2. Make recovery easy to choose, while previewing and confirming consequential changes.
3. Treat explicit safety constraints and unknown evidence honestly.
4. Learn from the household's real, correctable outcomes without discarding history.
5. Make shared-state status and authority clear so users can trust what was saved and what needs action.

## Accessibility & Inclusion

Preserve accessibility basics across phone and desktop: semantic controls, meaningful labels, keyboard access, visible focus, readable content, and status/error information that does not depend on color alone. Do not trade these away for visual expression. A specific conformance target, additional assistive-technology requirements, and localization scope remain open decisions.

## Open Decisions

The production navigation, interaction details, visual direction, and representative difficult states still need shaping and concrete prototype approval under TREK-36. This product record captures confirmed intent and existing capabilities; it does not approve a production UI or authorize its implementation.
