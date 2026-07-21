---
"@shared/observability": patch
"@pulse/app": patch
"@osn/ui": patch
"@osn/social": patch
---

Dependency review: bump `@opentelemetry/exporter-{logs,metrics,trace}-otlp-http` and `@opentelemetry/sdk-logs` `^0.219.0` → `^0.220.0` (the 0.220.0 breaking change to `BatchLogRecordProcessor`/`SimpleLogRecordProcessor` constructors is not used in this codebase), and align the declared `vite` devDependency range to `^7.3.5` to match the root override that already forces vite 7.3.5 (no resolution change).
