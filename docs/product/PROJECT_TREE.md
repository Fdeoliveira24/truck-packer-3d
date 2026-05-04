# File Tree: Truck Packer 3D

**Generated:** 5/3/2026, 10:38:37 AM
**Root Path:** `/Users/franciscooliveira/Library/CloudStorage/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D`

```
├── 📁 backups
│   ├── ⚙️ .gitignore
│   ├── 📄 backup-20260502-2343.sql
│   └── 📄 backup-20260502-2345.sql
├── 📁 docs
│   ├── 📁 archive
│   │   ├── 📁 2026-01-cleanup-docs
│   │   │   ├── 📁 reports
│   │   │   │   └── ⚙️ .gitkeep
│   │   │   ├── 📁 scripts
│   │   │   │   └── 📄 eslint-report.mjs
│   │   │   ├── 📝 AUDIT_APP_STRUCTURE.md
│   │   │   ├── 📝 AUDIT_PACK_PREVIEW_AND_FILTERS.md
│   │   │   ├── 📝 ESLINT_WARNINGS_SUMMARY.md
│   │   │   ├── 📝 QUICKSTART.md
│   │   │   ├── 📝 README.md
│   │   │   ├── 📝 REPO_MAP_PACK_PREVIEW.md
│   │   │   ├── 📝 SETUP_SUMMARY.md
│   │   │   └── 📝 github-raw-urls.md
│   │   ├── 📁 2026-02-autopack
│   │   │   └── 📝 autopack-logic.md
│   │   ├── 📁 2026-02-phase1
│   │   │   └── 📝 MIGRATION_PHASE1.md
│   │   ├── 📁 2026-02-supabase-stripe
│   │   │   ├── 📝 Supabase SQL migrations Stripe Setup v1 - 02-09-2026.md
│   │   │   └── 📝 Supabase SQL migrations Stripe Setup v2 - 02-11-2026.md
│   │   ├── 📁 2026-03-old-todos
│   │   │   └── 📝 TP3D-MASTER-TODO-V2.md
│   │   └── 📝 README.md
│   ├── 📁 audits
│   │   ├── 📝 ARCHITECTURE_DIAGRAM.md
│   │   ├── 📝 CONTRADICTIONS_REPORT.md
│   │   ├── 📝 CROSS_BROWSER_REPORT.md
│   │   ├── 📝 DATA_INTEGRITY_REPORT.md
│   │   ├── 📝 FORENSIC_CODEBASE_MAP.md
│   │   ├── 📝 NETWORK_RESILIENCE_REPORT.md
│   │   ├── 📝 P0_OWNER_ONLY_BILLING_AUDIT.md
│   │   ├── 📝 PATCH_LOG.md
│   │   ├── 📝 PERFORMANCE_REPORT.md
│   │   ├── 📝 RELEASE_GATE_CHECKLIST.md
│   │   ├── 📝 RUNTIME_STABILITY_REPORT.md
│   │   ├── 📝 SECURITY_REPORT.md
│   │   ├── 📝 TEST_PLAN.md
│   │   ├── 📝 account-deletion-audit.md
│   │   ├── 📝 auth-session-race-audit-2026-02-05.md
│   │   ├── 📝 css-audit-footer-overlay.md
│   │   ├── 📝 phase1-resources-audit.md
│   │   ├── 📝 settings-tab-desync-audit.md
│   │   └── 📝 ui-rearrangement-audit.md
│   ├── 📁 dev
│   │   ├── 📝 billing-status-curl.md
│   │   ├── 📝 billing-status-setup.md
│   │   ├── 📝 local-supabase-setup.md
│   │   └── 📝 stripe-functions-secrets-checklist.md
│   ├── 📁 product
│   │   ├── 📝 BILLING_ENTITLEMENT_RULES.md
│   │   ├── 📝 TP3D-MASTER-TODO-V3.md
│   │   ├── 📝 autopack-logic-v2.md
│   │   └── 📝 truckpacker-comparison-v1-2026-04-19.md
│   ├── 📁 review
│   │   ├── 📝 P0.6-DB-HEALTH-CHECKLIST.md
│   │   ├── 📝 PROJECT_TREE.md
│   │   ├── 📝 README.md
│   │   ├── 📝 SUPABASE_CURRENT_STATE_02_07_2026-V1.md
│   │   ├── 📝 TP3D_BILLING_FIXES_02_12_2026.md
│   │   ├── 📝 browser-diagnostics.md
│   │   ├── 📝 tp3d-supabase-infra-record-2026-02-03.md
│   │   ├── 📝 tp3d-supabase-issue-summary-2026-02-03.md
│   │   ├── 📝 truck-packer-supabase-current-state.md
│   │   └── 📝 ui-bug-fixes-2026-01-29.md
│   └── 📝 README.md
├── 📁 src
│   ├── 📁 auth
│   │   ├── 📄 permissions.js
│   │   └── 📄 session.js
│   ├── 📁 config
│   │   ├── 📄 features.js
│   │   ├── 📄 plans.js
│   │   └── 📄 roles.js
│   ├── 📁 core
│   │   ├── 📁 dev
│   │   │   └── 📄 dev-helpers.js
│   │   ├── 📁 utils
│   │   │   └── 📄 index.js
│   │   ├── 📄 app-helpers.js
│   │   ├── 📄 browser.js
│   │   ├── 📄 constants.js
│   │   ├── 📄 defaults.js
│   │   ├── 📄 event-bus.js
│   │   ├── 📄 events.js
│   │   ├── 📄 normalizer.js
│   │   ├── 📄 session.js
│   │   ├── 📄 state-store.js
│   │   ├── 📄 state.js
│   │   ├── 📄 storage.js
│   │   ├── 📄 supabase-client.js
│   │   ├── 📄 utils.js
│   │   └── 📄 version.js
│   ├── 📁 data
│   │   ├── 📁 models
│   │   │   ├── 📄 case.model.js
│   │   │   ├── 📄 org.model.js
│   │   │   ├── 📄 pack.model.js
│   │   │   └── 📄 user.model.js
│   │   ├── 📁 repositories
│   │   │   ├── 📄 base.repository.js
│   │   │   └── 📄 local.repository.js
│   │   ├── 📁 services
│   │   │   ├── 📄 analytics.service.js
│   │   │   ├── 📄 billing.service.js
│   │   │   ├── 📄 cases.service.js
│   │   │   ├── 📄 collaboration.service.js
│   │   │   ├── 📄 maps.service.js
│   │   │   ├── 📄 packs.service.js
│   │   │   └── 📄 users.service.js
│   │   └── 📄 trailer-presets.js
│   ├── 📁 editor
│   │   ├── 📄 geometry-factory.js
│   │   └── 📄 scene-runtime.js
│   ├── 📁 features
│   │   └── 📁 editor
│   │       └── 📄 model-loader.js
│   ├── 📁 screens
│   │   ├── 📄 cases-screen.js
│   │   ├── 📄 editor-screen.js
│   │   └── 📄 packs-screen.js
│   ├── 📁 services
│   │   ├── 📄 case-library.js
│   │   ├── 📄 category-service.js
│   │   ├── 📄 cog-service.js
│   │   ├── 📄 import-export.js
│   │   ├── 📄 oog-service.js
│   │   ├── 📄 pack-library.js
│   │   └── 📄 preferences-manager.js
│   ├── 📁 types
│   │   └── 📄 global.d.ts
│   ├── 📁 ui
│   │   ├── 📁 helpers
│   │   │   └── 📄 import-dialog-utils.js
│   │   ├── 📁 overlays
│   │   │   ├── 📄 account-overlay.js
│   │   │   ├── 📄 auth-overlay.js
│   │   │   ├── 📄 card-display-overlay.js
│   │   │   ├── 📄 help-modal.js
│   │   │   ├── 📄 import-app-dialog.js
│   │   │   ├── 📄 import-cases-dialog.js
│   │   │   ├── 📄 import-pack-dialog.js
│   │   │   └── 📄 settings-overlay.js
│   │   ├── 📄 error-overlay.js
│   │   ├── 📄 system-overlay.js
│   │   ├── 📄 table-footer.js
│   │   └── 📄 ui-components.js
│   ├── 📁 utils
│   │   ├── 📄 debounce.js
│   │   ├── 📄 json.js
│   │   └── 📄 uuid.js
│   ├── 📁 vendor
│   │   └── 📄 loader.js
│   ├── 📝 CLAUDE.md
│   ├── 📄 app.js
│   ├── 📄 debugger-old.js
│   ├── 📄 debugger.js
│   └── 📄 router.js
├── 📁 styles
│   └── 🎨 main.css
├── 📁 supabase
│   ├── 📁 .branches
│   │   └── 📄 _current_branch
│   ├── 📁 functions
│   │   ├── 📁 _shared
│   │   │   ├── 📄 auth.ts
│   │   │   ├── 📄 cors.ts
│   │   │   └── 📄 stripe.ts
│   │   ├── 📁 ban-user
│   │   │   ├── ⚙️ deno.json
│   │   │   └── 📄 index.ts
│   │   ├── 📁 billing-status
│   │   │   └── 📄 index.ts
│   │   ├── 📁 delete-account
│   │   │   ├── ⚙️ .npmrc
│   │   │   ├── ⚙️ deno.json
│   │   │   └── 📄 index.ts
│   │   ├── 📁 org-invite
│   │   │   └── 📄 index.ts
│   │   ├── 📁 org-invite-accept
│   │   │   └── 📄 index.ts
│   │   ├── 📁 org-member-remove
│   │   │   └── 📄 index.ts
│   │   ├── 📁 org-member-role-update
│   │   │   └── 📄 index.ts
│   │   ├── 📁 request-account-deletion
│   │   │   └── 📄 index.ts
│   │   ├── 📁 stripe-create-checkout-session
│   │   │   └── 📄 index.ts
│   │   ├── 📁 stripe-create-portal-session
│   │   │   └── 📄 index.ts
│   │   ├── 📁 stripe-webhook
│   │   │   └── 📄 index.ts
│   │   ├── 📁 unban-user
│   │   │   ├── ⚙️ deno.json
│   │   │   └── 📄 index.ts
│   │   └── ⚙️ .env.example
│   ├── 📁 migrations
│   │   ├── 📄 2026021501_create_profiles.sql
│   │   ├── 📄 2026021601_create_org_schema.sql
│   │   ├── 📄 20260216_account_deletion.sql
│   │   ├── 📄 2026021700_create_billing_schema.sql
│   │   ├── 📄 2026021701_org_member_rls_hardening.sql
│   │   ├── 📄 2026021702_stripe_webhook_reliability.sql
│   │   ├── 📄 2026021703_organization_invites.sql
│   │   ├── 📄 2026021901_org_trial_seed.sql
│   │   ├── 📄 2026021912_fix_webhook_and_billing_projection.sql
│   │   ├── 📄 2026041801_auto_org_on_signup.sql
│   │   ├── 📄 2026041802_billing_rls.sql
│   │   ├── 📄 2026041803_storage_buckets_and_rls.sql
│   │   ├── 📄 2026042201_organizations_rls.sql
│   │   ├── 📄 2026042301_org_members_select_self.sql
│   │   └── 📄 2026042901_stop_repeat_workspace_trials.sql
│   ├── 📁 snippets
│   ├── ⚙️ .gitignore
│   └── ⚙️ config.toml
├── 📁 tests
│   ├── 📁 audit
│   │   ├── 📄 import-export.spec.mjs
│   │   └── 📄 security-and-invariants.spec.mjs
│   └── 📄 stress.spec.js
├── 📁 tools
│   ├── 📄 app-graph.js
│   └── ⚙️ tp3d-graph.json
├── 📁 vendor
│   ├── 📄 OrbitControls.js
│   ├── 📄 OrbitControls.module.js
│   ├── 📝 README.md
│   ├── 📄 fa-brands-400.woff2
│   ├── 📄 fa-solid-900.woff2
│   ├── 📄 three.module.js
│   └── 📄 tween.umd.js
├── ⚙️ .depcheckrc
├── ⚙️ .editorconfig
├── ⚙️ .gitignore
├── ⚙️ .htmlvalidate.json
├── ⚙️ .prettierignore
├── ⚙️ .prettierrc
├── ⚙️ .stylelintignore
├── ⚙️ .stylelintrc.cjs
├── 📝 CLAUDE.md
├── 📝 README.md
├── 📄 eslint.config.js
├── 🌐 index.html
├── ⚙️ knip.json
├── ⚙️ package.json
└── ⚙️ tsconfig.json
```

---
*Generated by FileTree Pro Extension*