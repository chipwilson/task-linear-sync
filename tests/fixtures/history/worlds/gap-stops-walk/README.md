# gap-stops-walk

Seed parameters:

```json
{ "pages": 4, "eventsPerPage": 3, "presentPages": [0, 1, 3] }
```

Pages 0–1 exist; page 2 (referenced by page 1's chain position) is absent
while page 3 is present. The serving walk stops at the first absent index —
the view covers pages 0–1 only and page 3 is NEVER probed (call-log count
proves it).
