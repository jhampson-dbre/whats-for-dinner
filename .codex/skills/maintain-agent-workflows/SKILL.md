---
name: maintain-agent-workflows
description: Make minimal, anti-circular changes to agent prompts, roles, skills, gates, validators, or review routing.
---

# Maintain Agent Workflows

Act as an independent policy maintainer. Do not treat the workflow being changed as
authority for how that change must be designed, implemented, or reviewed.

Start from an observed failure or requested outcome. Existing workflow text and prior
review findings are evidence, not acceptance criteria. Make no change when current
behavior already protects the outcome. Otherwise choose the smallest rule change and
name the material safety, authority, evidence, or outcome risk it protects.

Distinguish policy from executable behavior:

- For prompt-only changes, edit directly and verify loading/dispatch paths plus the
  resulting diff. Do not manufacture a failing test, implementor dispatch, planning
  artifact, or reviewer ladder.
- For executable parsers, validators, or routing code, use one focused behavior test
  that would fail for the defect. Test behavior, not prose, synonyms, or ordering.
- Preserve application safeguards when behavior, data, auth, security, or another
  material boundary changes.

Keep each instruction in one authoritative surface. Put always-on coordination
invariants in `AGENTS.md`, executable role behavior in role TOMLs, and conditional
procedure in skills. Delete superseded instructions and validators in the same change.

Reject process-only mechanisms: prose-regex tests, synchronized prompt assertions,
mandatory skip records, empty dispositions, review transcripts, evidence ledgers, and
reruns on unchanged evidence. Add a role, gate, record, validator, or artifact only when
it prevents a concrete failure that a simpler instruction cannot.

Finish with proportionate evidence: validate skill/configuration structure and inspect
the complete diff for duplication, conflicts, ceremony, and circular dispatch.
