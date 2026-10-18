# Bounded provider HTTPS reads

This Rust transport accepts an explicit HTTPS origin and an externally supplied
bearer credential. It performs GET only, with no redirects, inherited proxy,
retries, pagination, API discovery or implicit login. Callers own vendor policy,
resource identity checks, IAM and interpretation; GET is not a claim of free use.

Requests have an overall 50 ms–40 s deadline and an explicit 1–32 request budget.
Responses are limited to 1 MiB and use the existing sensitive body collector.
Credentials, raw provider error bodies and request URLs never appear in errors.
Additional headers are limited to Accept and explicit X-*-Version values;
credential, host and method-override headers are rejected.
Unsuccessful status codes, including redirects, are returned without following.

This is source-only (`publish=false`). It does not implement cloud mutations,
credential issuance, host isolation or prove real-account acceptance.
