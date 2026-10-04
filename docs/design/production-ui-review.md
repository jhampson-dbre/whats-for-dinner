# TREK-36 prototype review evidence

Status: design prototype awaiting concrete user approval. No production UI, auth, backend, persistence, or migration changes are included.

## Scope and artifacts

The user selected Community noticeboard, code-first, the five destinations, and weekly planning plus shopping as the anchor. The clickable sample prototype is `docs/prototypes/production-ui/index.html`; its interaction contract is `docs/design/production-ui-interactions.md`. The initial prototype checkpoint is `cdb6610`; the scoped interaction corrections are `6925fce` and plan-boundary fixes are `78f4ea7`.

## Rendered acceptance

The local browser permission issue is resolved. Vite serves the artifact at `http://127.0.0.1:4173/docs/prototypes/production-ui/index.html`. Captures were inspected at 1440 × 1000 desktop, 390 × 844 phone, and the user's original 1280 × 720 viewport. The prototype viewer's sample controls remain outside the product shell.

One browser acceptance path confirmed the week, checked all 26 known grocery items, confirmed shopping, started and recorded dinner, saved neutral feedback with missing leftovers, and confirmed Tuesday's protected replacement. The repaired date uses the explicit simulated sample date, not an arbitrary unfinished dinner.

After the correction batch, browser checks verified:

- Phone `Open the recipe` is visible and opens full preparation detail.
- Recording without timing leaves elapsed time unknown. New diner and leftover feedback begins `Not reported`.
- A subsequent response correction preserves the previous responses, effort, and leftover answer in expandable `Earlier feedback`; a reopened record retains the negative leftover answer.
- The failed-leftover review names `Tue: Fajita leftovers`, its cooking source, and actual added ingredients. Confirmation preserves unrelated dinners and repair history.
- Multiple confirmed matches require an explicit dinner choice; choosing the second match opens that matching plan and slot. No confirmed match has an empty state.
- Recipe search filters the sample library and full recipe detail remains available. Loading, pending, failed save, conflict, revoked access, invitation, empty household, and completed-dependent correction protection were inspected.
- Reviewing the unchanged Monday meal reports that it is already selected and preserves Tuesday's leftover link. Confirming partial shopping on one plan, switching to the other, and switching back preserves each plan's own status, checks, and history.

The native model checks also cover repaired current groceries versus retained shopping history, stale-preview rejection without mutation, compatibility/capacity changes, and multiple slots on one confirmed date. These are prototype checks, not verification of the future remote adapter.

## Screenshots and provenance

All listed images are direct browser captures of the local sample-data prototype. They are evidence images, not generated product imagery. Full-page phone captures retain fixed navigation at the capture viewport's position; `mobile-viewport.jpg` shows the actual first viewport.

- `.impeccable/review/desktop.jpg`, `mobile.jpg`, `user-1280.jpg`: required viewport captures.
- `mobile-viewport.jpg`, `mobile-today.jpg`, `mobile-shop.jpg`, `mobile-household.jpg`, `mobile-recipes.jpg`, `mobile-recipe-detail.jpg`, `mobile-conflict.jpg`: representative tasks and state.
- `mobile-repair.jpg`, `mobile-repair-bottom.jpg`, `mobile-feedback-history.jpg`: corrected consequential review and inspectable history.
- `mobile-plan-shopping.jpg`, `mobile-unchanged-dinner.jpg`: plan-boundary code-review corrections at `78f4ea7`. Earlier layout captures remain representative; that delta changes no styles or baseline composition.

## Verification and review

`node scripts/check-production-ui.mjs`, `node --check docs/prototypes/production-ui/prototype.js`, and `git diff --check` pass. The final scoped `impeccable detect --json --target docs/prototypes/production-ui/index.html` returned `[]`. The TDD check initially failed on the absent grocery-effect behavior export, then passed with the scoped implementation. Actual browser acceptance verifies recipe control visibility; no CSS-string assertion substitutes for that check.

The first independent finish review returned `fix` for phone recipe access, concrete grocery effects, leftover naming, unknown/reopened feedback, and inspectable prior records. A fresh independent agent used the shipped review contract because the named Impeccable reviewer role is unavailable in this session. The selected direction has no recovered QUALITY BAR image or decision comp; its craft ceiling is unscored, while the rendered direction contract remains reviewable.

Final finish verdict: `ship` for the five scored fixes, all resolved; no material regressions observed in that fix batch. This verdict does not claim a new whole-surface or QUALITY BAR assessment.

Independent conformance review identified Today matching, grocery/history, feedback, and readiness contradictions. Scoped remediation review at `78f4ea7` reports all four resolved, with no remaining finding in its assigned delta. Independent code review identified unchanged source-meal dependency replacement and shopping status crossing plan boundaries; both fixes failed focused checks before implementation, then passed. Scoped independent re-review reports both resolved with no actionable regression in the affected delta.

The independent documenter extracted root `DESIGN.md` and the schema-version-2 `.impeccable/design.json` sidecar, including 15 actual CSS colors and 10 component snippets. JSON and canonical section structure were validated. A fresh agent used the shipped documenter contract because the named role is unavailable. Context's visual-implementation detection misses this nested artifact; that drift was reported without changing configuration.

One bounded Ponytail proposal pass found no material simplification needed for the native controls, `dialog`, array/Set comparisons, and assertion script. The unused sample `visibleMeals` field was left as nonessential residue; no simplification candidate was accepted.

## Approval and delivery boundary

The updated draft PR contains a reviewable design deliverable when published. TREK-36 and EPIC-6 remain open until the concrete prototype and interaction brief are approved. A design approval is recorded separately from any later UI implementation task; no implementation task starts as a side effect of this review.
