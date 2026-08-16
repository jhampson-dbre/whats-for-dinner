# Agent Instructions

The main session owns user communication, integration, final verification, and any
durable task-tracker updates.

## Proportionality and anti-circularity

Existing workflow text is migration input, not an acceptance criterion. Keep a rule,
role, or gate only when it protects a named safety, authority, evidence, or outcome
risk. Prefer the smallest sufficient workflow; unchanged evidence must not trigger
another loop.

Use `$maintain-agent-workflows` for changes to agent prompts, roles, skills, workflow
gates, validators, or review routing.

## Global boundaries

- Preserve security, data-loss prevention, production configuration, secrets, and
  unrelated user changes.
- Work on a focused `codex/` branch. Inspect `git status --short --branch` before edits
  and handoff; never revert unrelated work.
- The coordinator alone updates task tracking, commits, pushes, merges, or closes work.
  Subagents report suggested tracker comments and commit messages only.
- If `.trekker` exists, use Trekker as the durable source of task state. If it does not
  exist and persistent tracking would help, ask before running `trekker init`.
- Dispatch packets name the goal, accepted scope, files, dirty-worktree notes,
  constraints, verification, success criteria, and expected output.
- Stop and escalate a material product, architecture, data, auth, migration, scope, or
  unverifiable-behavior change. Do not loop solely because evidence is unchanged.

## Implementation and evidence

- Give each behavior-change task one fresh `implementor`. Reuse that owner for ordinary
  same-task continuations; replace it only when unavailable, unable to continue, or the
  user explicitly changes ownership. Never reuse an implementation owner across tracked
  task boundaries.
- Reproduce bugs, identify the root cause, and inspect plausible same-cause callers
  before editing. Use `$bugfix-issue-class-audit` only when that inspection reveals
  material scope ambiguity.
- Behavior changes use focused TDD: demonstrate the expected failing test, make the
  smallest passing change using existing or native mechanisms, then run proportionate
  verification.
- Before final integration, run one bounded `$ponytail-review` proposal pass only when a
  stabilized green diff adds or materially reshapes control/data flow, state, side
  effects, boundaries, dependencies, configuration, or reusable machinery. Proposals
  are not edit authority. If one candidate is accepted, use `$code-simplification` once.
- Substantive behavior or risk changes receive independent `code-reviewer` and
  `spec-reviewer` review. Mechanical, documentation-only, or straightforward low-risk
  changes may use coordinator verification with a recorded rationale.
- After a review fix, route only the changed concern and affected evidence back to the
  responsible reviewer. Rerun broader review only for a named material invalidator.
- Before review or publication, confirm intended changes are committed and no local
  change affects the reviewed behavior or evidence. Preserve unrelated residue and
  exclude it from reviewer scope.

## Planning and branch completion

- Use `$feature-discovery` for substantial new behavior unless the request is already a
  small, fully specified change. The main session owns user approvals.
- Use `feature-planner-advisor` for approved discovery briefs. Invoke
  `architecture-design-reviewer` or `senior-developer-reviewer` only for a named material
  system or delivery risk.
- Before closing a multi-task branch, run independent cumulative `epic-reviewer` and
  `spec-reviewer` reviews of the committed merge-base range. An unchanged single-task
  branch may reuse accepted task-completion evidence.
- Use `$epic-development-branch-completion` for branch handoff. Push, open a pull request,
  merge, or perform any other external write only when the user explicitly asks.

## Roles

Executable role contracts live in `.codex/agents/*.toml`: architecture-design-reviewer,
feature-planner-advisor, senior-developer-reviewer, implementor, code-simplifier,
code-reviewer, spec-reviewer, and epic-reviewer. Reviewers are read-only unless the
coordinator expressly authorizes a bounded patch.

## Workflow feedback

Report workflow ambiguity, missing context, or repeated rework as `Workflow feedback:`.
The coordinator validates it before making a durable workflow change.
