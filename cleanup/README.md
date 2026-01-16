# Code Quality & Formatting Setup

This directory contains tooling configuration for automated code quality checks and formatting.

## 🎯 Purpose

- **Catch bugs** without changing behavior
- **Enforce consistent formatting** across HTML/CSS/JS
- **Validate markup** to prevent broken HTML
- **Automate** quality checks for CI/CD

## 📦 Prerequisites

- **Node.js** 18+ and **npm** 9+
- Works on macOS, Windows, and Linux

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Quality Checks

```bash
# Run all checks (lint + format check)
npm run validate

# Auto-fix everything possible
npm run quality
```

## 📋 Available Commands

### Linting (Find Issues)

```bash
# Lint everything (JS, CSS, HTML)
npm run lint

# Lint JavaScript only
npm run lint:js

# Lint CSS only
npm run lint:css

# Lint HTML markup only
npm run lint:html

# Auto-fix linting issues
npm run lint:fix
```

### Formatting (Code Style)

```bash
# Auto-format all files
npm run format

# Check formatting without changes
npm run format:check
```

### Combined Commands

```bash
# Validate everything (CI-ready)
npm run validate

# Fix + format everything at once
npm run quality

# Generate CI report
npm run quality:ci
```

## 🛠️ Tools Used

### ESLint (JavaScript)

- **Config**: `eslint.config.js`
- **Plugin**: `eslint-plugin-html` for inline `<script>` tags
- **Rules**: Focused on catching bugs, not style (Prettier handles that)
- Globals: `THREE`, `TWEEN` pre-configured

### Prettier (Formatting)

- **Config**: `.prettierrc`
- **Ignore**: `.prettierignore`
- Formats HTML, CSS, JS, JSON, Markdown
- Enforces consistent code style

### Stylelint (CSS)

- **Config**: `.stylelintrc.cjs`
- **Ignore**: `.stylelintignore`
- Lints inline `<style>` tags via `stylelint-config-html`
- Catches CSS errors and bad patterns

### HTML Validate (Markup)

- **Config**: `.htmlvalidate.json`
- Validates HTML5 structure
- Catches duplicate IDs, broken tags, missing attributes

### EditorConfig

- **Config**: `.editorconfig`
- Ensures consistent editor settings across IDEs

## 📊 Reports

Reports are saved to `cleanup/reports/` when running:

```bash
npm run quality:ci
```

## 🔒 Security & 🛠️ Performance Notes

- Three.js + OrbitControls now load as ESM via `esm.sh`; app boot waits for Three to be ready.
- JSON imports/localStorage loads are sanitized (drops `__proto__`/`constructor`/`prototype`).
- UI text that comes from user/imported data uses `textContent` instead of `innerHTML`.
- Dev overlay in the editor (press `P`) shows FPS, frame time, memory (if available), and Three.js
  renderer stats.

View the report:

```bash
cat cleanup/reports/quality-report.txt
```

## Recent Updates (Jan 2026)

- Cases UI: refined search UI, compact case editor layout, inline category rename/color, and
  a redesigned Manage Categories modal with confirmation for deletes.
- UX: Added sorting on Cases table and rounded weight display to two decimals for readability.

## 🔧 Configuration Files (Repo Root)

```
.
├── .editorconfig          # Editor settings
├── .eslintrc.cjs          # ESLint config (deprecated format)
├── eslint.config.js       # ESLint flat config (new)
├── .prettierrc            # Prettier formatting rules
├── .prettierignore        # Files Prettier should skip
├── .stylelintrc.cjs       # Stylelint CSS rules
├── .stylelintignore       # Files Stylelint should skip
├── .htmlvalidate.json     # HTML validation rules
└── package.json           # npm scripts + dependencies
```

## 🎨 Editor Integration

### VS Code

Install extensions:

- **ESLint** (`dbaeumer.vscode-eslint`)
- **Prettier** (`esbenp.prettier-vscode`)
- **Stylelint** (`stylelint.vscode-stylelint`)
- **EditorConfig** (`EditorConfig.EditorConfig`)

Add to `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true,
    "source.fixAll.stylelint": true
  }
}
```

### WebStorm / IntelliJ IDEA

- Settings → Languages & Frameworks → JavaScript → Code Quality Tools → ESLint
- Settings → Languages & Frameworks → Stylesheets → Stylelint
- Settings → Editor → Code Style → Enable EditorConfig support

## 🚨 Troubleshooting

### "Cannot find module" errors

```bash
rm -rf node_modules package-lock.json
npm install
```

### Prettier conflicts with ESLint

- `eslint-config-prettier` is already included to disable conflicting rules

### Stylelint not finding CSS in HTML

- Ensure `stylelint-config-html` is installed
- Check `.stylelintrc.cjs` extends includes `'stylelint-config-html'`

### HTML validation false positives

- Adjust rules in `.htmlvalidate.json`
- Use `"off"` or `"warn"` for overly strict rules

## 📝 Notes

- **No logic changes**: All tools configured for safety (warn over error)
- **Inline scripts/styles**: Fully supported via plugin configuration
- **Incremental adoption**: Fix issues gradually; warnings won't block CI
- **Customization**: Edit config files to adjust strictness

## 🔄 CI/CD Integration

Add to your CI pipeline (GitHub Actions, GitLab CI, etc.):

```yaml
- name: Install dependencies
  run: npm ci

- name: Run quality checks
  run: npm run validate
```

For detailed reports:

```yaml
- name: Quality report
  run: npm run quality:ci

- name: Upload report
  uses: actions/upload-artifact@v3
  with:
    name: quality-report
    path: cleanup/reports/
```

## 📚 Resources

- [ESLint Documentation](https://eslint.org/docs/latest/)
- [Prettier Documentation](https://prettier.io/docs/en/)
- [Stylelint Documentation](https://stylelint.io/)
- [HTML Validate Documentation](https://html-validate.org/)
- [EditorConfig Documentation](https://editorconfig.org/)

---

**Last Updated**: January 2026  
**Maintained by**: 360 Virtual Tour Solutions
