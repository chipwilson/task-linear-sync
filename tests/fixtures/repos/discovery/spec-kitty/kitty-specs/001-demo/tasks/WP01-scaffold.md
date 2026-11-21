---
work_package_id: WP01
title: Scaffold
lane: planned
dependencies: []
subtasks:
  - T001
  - T002
phase: "Phase 1 — Foundations"
---

# WP01 — Scaffold

## Objectives & Success Criteria
- Deliver the mission scaffold so later work packages attach to a working entry point.
- Success: `demo run` starts with zero configuration and prints the placeholder banner.

## Context & Constraints
- The scaffold lives in the demo module tree; no new runtime dependencies.
- Placeholder identifiers only — no organization-specific literals.

## Subtask Guidance
T001 — Create the scaffold: lay out the module directories and the entry stub.
T002 — Implement charging: wire the placeholder charge loop behind the entry stub.

## Test Strategy
- Hermetic unit tests over the entry stub with the fake port; zero network.

## Definition of Done
- [ ] Scaffold builds
- [ ] Entry point starts and prints the banner
- [ ] Guidance sections above reflect the landed shape

## Activity Log
- 2026-11-02 — package opened from the mission roll-up index.
