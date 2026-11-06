# rate-limit-exhaustion

Seed parameters:

```json
{ "pages": 1, "eventsPerPage": 3, "failures": { "getAttachmentByUrl": { "atCall": 1, "kind": "http-429-retryAfter" } }, "maxRetries": 0 }
```

The fake port is scripted to fail the first `getAttachmentByUrl` with a
`429`-with-`Retry-After` shape and a zero retry budget, so the port's client
posts its ultimate failure immediately. The surface answers 429
`RATE_LIMITED` from fixed constants — zero history bytes, no credential
named, no retries of its own (component call count equals the port's).
