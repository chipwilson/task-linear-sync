## Phase 2: Create-failure drill

- [ ] 2.1: Probe the indeterminate gauge
  Probe body — exists only in the spec; the scripted create failure plus zero
  identity matches leaves the intent indeterminate (data-model §8).

  - [ ] 2.1.1: Recalibrate the probe needle
    Needle body — child of the probe; its creation must abort with the parent
    (FR-012) and never be replayed.

- [ ] 2.2: [ACME-1] Land the healthy ledger
  Healthy ledger body — mirrored on the tracker copy.

  Spec-side paragraph added since the last sync; this update must still land
  after the probe's indeterminate abort (FR-012).
