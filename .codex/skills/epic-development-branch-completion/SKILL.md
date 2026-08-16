---
name: epic-development-branch-completion
description: Finish a multi-task development branch for local integration review and an explicitly authorized pull-request handoff.
---

# Epic Development-Branch Completion

Use this coordinator-owned workflow after intended tasks are complete. It does not
replace task-level verification or authorize reviewers to update tracking, commit,
push, merge, or create a pull request.

## 1. Establish evidence

1. State the target branch and compute `git merge-base <target> HEAD`.
2. Inspect `<merge-base>...HEAD` and confirm every intended task commit is present.
3. Inspect `git status --short --branch`, `git diff`, and `git diff --cached`. Commit any
   omitted in-scope change before review. Preserve unrelated residue and exclude it
   from reviewer scope.
4. Confirm completed tracked tasks have summaries tied to their commit and verification.

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

## 4. Handoff

When local evidence is ready, report the branch, range, reviews, checks, and concrete
remaining risks. Push, open a pull request, or merge only when the user explicitly asks.
The coordinator retains task-tracker writes and final user communication.
