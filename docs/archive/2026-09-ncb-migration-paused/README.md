# NCB Migration Investigation — Paused (September 2026)

In September 2026, Cargo Planner 3D investigated NoCodeBackend (NCB) as a possible
replacement for Supabase. The investigation showed that NCB could be a viable future
backend.

The migration was paused so that product, domain, email, billing, settings, and
workspace-behavior work could be completed first. No migration or NCB server
implementation is authorized by this record.

## Current state

- Supabase remains the temporary development backend.
- Cases, Load Plans, and related business data remain browser-local during this
  development phase.
- NCB remains the preferred future migration target.

## For a future migration

A future migration must repeat the provider and source audit against the application
state that exists at that time. No other client's database, schema, credentials,
screenshots, users, or infrastructure may be reused.

## Full audits

The full September 2026 discovery and live-state audits are retained privately outside
this Git repository, in the user's private Cargo Planner project archive. They are not
included here.
