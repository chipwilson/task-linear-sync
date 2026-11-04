# completion-toggle

Checkbox movement ONLY, descriptions identical to the checkpoint baselines
(seed `expected/checkpoint-seed.json`). Task 1.1 is newly **checked** (checkpoint
`checked: false`, live line `- [x]`) with body text hashing to the stored baseline ⇒
`checkedChanged ∧ ¬descriptionConflict` maps to the configured done state "Done"
(→ synthetic id …0203 via the fake `discoverMetadata` snapshot) as
`update-issue(stateTypeId)` + one `checkbox-changed` history event (FR-006, US1 AC5).
Task 1.2 is newly **unchecked** ⇒ the configured backlog state "Backlog" (…0201). Task
1.3 is the untouched control. The world proves the completion path is independent of the
description-conflict machinery (matrix §5): zero conflicts, zero marker logic. Titles are
stable (no titleChanged). Placeholders only; fixed clock.
