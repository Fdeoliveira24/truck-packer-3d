# Truck Packer 3D — Project File Tree

Note: `.git/` and `node_modules/` are omitted for brevity.

```
Truck Packer 3D/
├── .editorconfig
├── .gitignore
├── .htmlvalidate.json
├── .prettierignore
├── .prettierrc
├── .stylelintignore
├── .stylelintrc.cjs
├── .vscode/
├── MIGRATION_PHASE1.md
├── README.md
├── cleanup/
│   └── (files...)
├── docs/
│   ├── audits/
│   ├── truck-packer-supabase-current-state.md
│   └── ui-bug-fixes-2026-01-29.md
├── eslint-report.json
├── eslint.config.js
├── index-backup.html
├── index.html
├── package-lock.json
├── package.json
├── src/
│   ├── app.js
│   ├── auth/
│   │   ├── permissions.js
│   │   └── session.js
│   ├── config/
│   │   ├── features.js
│   │   ├── plans.js
│   │   └── roles.js
│   ├── core/
│   │   ├── app-helpers.js
│   │   ├── browser.js
│   │   ├── constants.js
│   │   ├── defaults.js
│   │   ├── dev/
│   │   │   └── dev-helpers.js
│   │   ├── event-bus.js
│   │   ├── events.js
│   │   ├── normalizer.js
│   │   ├── session.js
│   │   ├── state-store.js
│   │   ├── state.js
│   │   ├── storage.js
│   │   ├── supabase-client.js
│   │   ├── utils/
│   │   │   └── index.js
│   │   ├── utils.js
│   │   └── version.js
│   ├── data/
│   │   ├── models/
│   │   │   ├── case.model.js
│   │   │   ├── org.model.js
│   │   │   ├── pack.model.js
│   │   │   └── user.model.js
│   │   ├── repositories/
│   │   │   ├── base.repository.js
│   │   │   └── local.repository.js
│   │   ├── services/
│   │   │   ├── analytics.service.js
│   │   │   ├── billing.service.js
│   │   │   ├── cases.service.js
│   │   │   ├── collaboration.service.js
│   │   │   ├── maps.service.js
│   │   │   ├── orgs.service.js
│   │   │   ├── packs.service.js
│   │   │   └── users.service.js
│   │   └── trailer-presets.js
│   ├── editor/
│   │   └── scene-runtime.js
│   ├── features/
│   │   └── editor/
│   │       └── model-loader.js
│   ├── router.js
│   ├── screens/
│   │   ├── cases-screen.js
│   │   ├── editor-screen.js
│   │   └── packs-screen.js
│   ├── services/
│   │   ├── case-library.js
│   │   ├── category-service.js
│   │   ├── import-export.js
│   │   ├── pack-library.js
│   │   └── preferences-manager.js
│   |
│   ├── ui/
│   │   ├── components/
│   │   │   └── account-switcher.js
│   │   ├── overlays/
│   │   │   ├── account-overlay.js
│   │   │   ├── auth-overlay.js
│   │   │   ├── card-display-overlay.js
│   │   │   ├── help-modal.js
│   │   │   ├── import-app-dialog.js
│   │   │   ├── import-cases-dialog.js
│   │   │   ├── import-pack-dialog.js
│   │   │   └── settings-overlay.js
│   │   ├── system-overlay.js
│   │   ├── table-footer.js
│   │   └── ui-components.js
│   ├── utils/
│   │   ├── debounce.js
│   │   ├── json.js
│   │   └── uuid.js
│   └── vendor/
│       └── loader.js
├── styles/
│   └── main.css
├── supabase/
│   ├── config.toml
│   ├── edge-function/
│   │   ├── request-account-deletion.js
│   │   ├── cancel-account-deletion.js
│   │   ├── delete-account.js
│   │   └── purge-deleted-users.js
│   ├── functions/
│   └── .temp/
├── vendor/
└── MIGRATION_PHASE1.md
```

Omitted directories: `.git/` (repo metadata) and `node_modules/` (external packages). If you want
those included too I can generate a full listing, but it will be very large.
