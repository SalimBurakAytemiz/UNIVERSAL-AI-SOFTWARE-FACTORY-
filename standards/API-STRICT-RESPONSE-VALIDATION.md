<!-- //TR: Bu dosya API QA agentının Postman/Newman/Ajv ile status/header/schema/type/required/null/empty/contract drift ve business assertion kontrollerini nasıl yapacağını canonical şirket standardı olarak tanımlar. -->
# Strict API Response Validation Standard

## Source-of-truth sırası
1. Approved API contract / OpenAPI / explicit JSON Schema.
2. Accepted requirements + domain invariants.
3. Existing compatible behavior when explicitly baselined.
4. Sample response yalnız **candidate schema inference** üretir; tek başına expected contract değildir.

## Mandatory checks
- status/response class
- required response headers
- content type/encoding
- JSON parseability
- required properties
- exact field types
- null policy
- empty-value policy
- nested object/array rules
- enum/const
- string length/pattern/format
- numeric ranges/precision
- arrays: item schema/min/max/uniqueness when contractual
- `additionalProperties` policy
- sensitive-data leakage
- business/cross-field invariants
- contract drift/backward compatibility
- redacted evidence.

## Default null/empty policy
Factory strict profile defaults to `DENY_UNLESS_CONTRACT_ALLOWS` for `null`.
Empty string/whitespace/array/object are independently configurable and path-based exceptions are explicit.

## Ajv
Ajv validation is mandatory for JSON-Schema-based Postman/Newman strict validation profiles unless project/runtime constraints require an approved equivalent validator.
Use all-errors + strict validation where compatible; exact JSON Schema dialect must be known.

Postman adapter must runtime-probe package support. Current Postman environments support built-in `require('ajv')` and modern `pm.require` package loading; the adapter records the actual validator/version used rather than assuming it.

## Header profile
Headers are contract-driven. Typical required profiles may include Content-Type, cache controls, correlation/request IDs, API version, rate-limit metadata and security-relevant headers. Never invent a required header without contract/policy evidence.

## Negative matrix
Missing, null, empty, wrong type, bounds, invalid enum/format, malformed payload, oversized payload, invalid auth, expired auth, wrong role/tenant/object, duplicate/replay, idempotency, concurrency, pagination/filter/sort, rate limit, timeout, encoding/content-type and safe injection probes under authorization.

## Evidence
Request/response/headers/status, schema + digest, validator/version, validation errors, test/run ID, collection/Newman output, environment/build/commit and DLP-redacted artifacts.
