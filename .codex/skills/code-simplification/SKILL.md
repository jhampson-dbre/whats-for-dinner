---
name: code-simplification
description: Investigate one coordinator-authorized $ponytail-review candidate on a materially changed, stabilized green diff without changing behavior.
---

# Code Simplification

Use this coordinator-owned pass only for one bounded candidate from the single
`$ponytail-review` proposal pass. Proposals are not edit authority. Provide the
candidate, authorized files, behavior constraints, diff, and green evidence.

Trace callers and observable behavior. Remove only the named cost with the smallest
safe edit or decline. Prefer deletion and existing or native mechanisms. Do not perform
unrelated cleanup, speculative refactoring, or line-count compression. Preserve public
APIs, schemas, errors, ordering, security, and determinism as applicable.

Run the smallest check that would catch a regression. The coordinator verifies and
routes only an actual changed diff. A no-edit result is valid; unchanged evidence never
starts another pass.
