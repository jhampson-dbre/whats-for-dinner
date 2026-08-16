---
name: bugfix-issue-class-audit
description: Resolve material scope ambiguity after reproducing a bug, identifying its root cause, and inspecting plausible same-cause usages.
---

# Bug-Fix Issue-Class Audit

Use this coordinator-owned workflow for scope control, not routine paperwork. Always
reproduce the bug, identify the root cause, and inspect plausible callers or same-cause
usages. Continue directly when the result is one cohesive localized fix.

When material ambiguity remains, decide whether affected surfaces share the confirmed
cause, fit approved intent, and remain one focused verifiable change. Separate a
different cause, ownership area, material system decision, or independently useful
change into an approved follow-up.

Record only the decision needed for implementation:

```text
Issue-class audit:
- Reproduction and root cause:
- Same-cause search result:
- Approved scope and focused regression check:
- Excluded scope or follow-up, with reason:
```

Only the coordinator changes tracked scope. Use a pre-implementation spec reviewer only
when the scope decision may conflict with approved intent; otherwise hand the decision
and focused regression check directly to the implementor.
