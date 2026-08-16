---
name: feature-discovery
description: Collaboratively discover and stress-test proposed features before formal planning. Use for substantial new behavior unless the request is already small and fully specified.
---

# Feature Discovery

Turn a feature idea into a decision-ready brief. This is discovery, not implementation
planning or task-tracker mutation.

1. Inspect relevant repository code, specs, tests, and tracked work before asking what
   the repository can answer.
2. State the problem, intended audience, constraints, and assumptions in plain language.
3. Ask one high-value question at a time only when a material user decision is needed.
4. Examine outcome, minimality, alternatives, system fit, failure/recovery behavior,
   security/data implications, delivery slices, dependencies, and testability.
5. Compare the preferred approach with at least one materially simpler end-to-end
   option. Add state, schemas, dependencies, validators, roles, or gates only for a
   named outcome or material risk.
6. Keep a decision log of approved choices, rejected alternatives with reasons,
   assumptions, and unresolved questions.
7. Do not create an epic, create task records, dispatch formal reviewers, or start
   implementation during discovery.

Before handoff, present a concise Discovery Brief covering the problem, audience, goals,
non-goals, smallest sufficient outcome, alternatives, expected behavior, important edge
cases, system constraints, acceptance signals, risks, and unresolved assumptions. Ask
the user whether to send the approved brief to `feature-planner-advisor`.

Match depth to risk. Preserve explicit decisions and reopen them only when new evidence
creates a material conflict. If the request is a bug, refactor, or fully specified task,
hand it to the appropriate workflow instead of forcing discovery.
