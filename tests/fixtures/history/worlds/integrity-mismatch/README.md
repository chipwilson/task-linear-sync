# integrity-mismatch

Seed parameters:

```json
{ "pages": 3, "eventsPerPage": 3, "corruptPage": 1, "corruptKind": "task-uuid" }
```

The page-1 continuation record carries a different synthetic `taskUuid` than
its addressed URL. Any read attempt yields the fixed 502 integrity posture —
never a partial view, never page content in the body.
