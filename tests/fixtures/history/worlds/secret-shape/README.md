# secret-shape

Seed parameters:

```json
{ "pages": 1, "eventsPerPage": 2, "secretShape": true }
```

Page 0 carries two events; one description and one reference carry
secret-shaped placeholder values (a fake prefixed token and an `api_key=`
pair, both synthetic). HTML and JSON render those values screened — only
`[blocked:<category>]` sentinels ship; the benign event renders normally.
