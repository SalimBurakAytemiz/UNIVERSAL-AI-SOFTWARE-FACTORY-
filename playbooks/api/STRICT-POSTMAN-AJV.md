<!-- //TR: Bu dosya API QA agentının bir servisi OpenAPI/contract üzerinden keşfedip strict JSON Schema, Ajv, Postman/Newman, recursive null/empty ve negative matrix ile doğrulamasını adım adım tanımlar. -->
# Strict Postman + Ajv API QA Playbook

1. Endpoint/method/auth/contract discovery.
2. Determine source of truth. A sample response alone is marked INFERRED, never silently promoted to expected contract.
3. Validate status + contract-required headers before body.
4. Build/normalize JSON Schema with all contract-required fields in `required`.
5. Null is forbidden by default under the strict factory profile unless the contract explicitly permits it.
6. Empty string/whitespace/array/object rules run recursively with explicit path exceptions.
7. Ajv compiles and validates the selected schema; all validation errors are collected.
8. Run cross-field/business assertions not expressible safely in schema.
9. Generate negative/boundary/auth/authz/idempotency/concurrency tests.
10. Run collection via Postman/Newman/approved CLI path and capture reports.
11. DLP-redact request/response evidence and link it to commit/build/environment/validator version.
