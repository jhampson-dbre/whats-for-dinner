---
name: epic-development-branch-completion
description: Finish a single-task or multi-task/epic branch by opening its pull request after required verification and review.
---

# Epic Development-Branch Completion

Use this coordinator-owned workflow when a single-task branch or the agreed scope of
a multi-task/epic branch is locally verified. Apply the delivery-unit and publication
rules in `AGENTS.md`. This does not replace task-level verification or authorize
reviewers to update tracking, commit, push, merge, or create a pull request.

## 1. Establish evidence

1. State the target branch and compute `git merge-base <target> HEAD`.
2. Inspect `<merge-base>...HEAD` and confirm every intended task commit is present.
3. Inspect `git status --short --branch`, `git diff`, and `git diff --cached`. Commit any
   omitted in-scope change before review. Preserve unrelated residue and exclude it
   from reviewer scope.
4. Confirm each intended task has evidence tied to its deliverable's commit and verification.

## 2. Select routing

Use the single-task fast path when one task contains all intended changes, reviewed HEAD
and approved intent are unchanged, evidence remains valid, and no concrete integration
concern exists. Otherwise dispatch independent cumulative `epic-reviewer` and
`spec-reviewer` reviews from the same packet: target, merge base, committed range,
approved intent, task evidence, verification, named risks, and `reviewed_sha = HEAD`.

## 3. Resolve findings

For an accepted finding, make the smallest additive fix, run proportionate verification,
commit it, and inspect `reviewed_sha..HEAD`. Route only the changed concern to its review
authority when history remains ancestral, approved intent is unchanged, no high-risk
boundary expands, and prior evidence remains applicable. Rerun both cumulative gates
only for a named material invalidator. After two unsuccessful scoped rounds on one path,
record a Checkpoint and escalate.

## 4. Open the pull request and finish the delivery unit

1. Confirm required reviews and proportionate verification are satisfied. A user opt-out
   or publication failure leaves a checkpoint and an open delivery unit; local
   readiness alone does not finish this workflow.
2. Push the reviewed commits and open a draft PR, or update the existing PR for this
   unit. Confirm its head contains the final verified deliverables and attach the PR
   to this chat. A multi-task branch uses one cumulative PR for its agreed scope;
   do not create a PR for every constituent task.
3. Check visible PR checks. Report their results, pending checks and concrete residual
   risks; failures or unavailable checks require an explanation and exact next step.
4. Record the PR URL and commit/verification evidence in the delivery unit's summary,
   then close only the standalone task or epic whose full scope is satisfied. A PR
   for a subset of an epic does not close the larger epic.
5. Return the PR link, scope, review/check results and any remaining work. Do not end
   with only a local-readiness report when publication is part of the authorized work.

The coordinator retains tracker writes and final communication. Merge and deployment
remain separate actions under `AGENTS.md`.
