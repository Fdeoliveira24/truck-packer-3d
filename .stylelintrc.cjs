/**
 * @file .stylelintrc.cjs
 * @description Stylelint configuration for CSS linting in the Truck Packer 3D workspace.
 * @module stylelint.config
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

module.exports = {
  extends: ['stylelint-config-standard', 'stylelint-config-html'],
  rules: {
    // Customize rules to avoid breaking existing styles
    'selector-class-pattern': null, // Allow any class naming convention
    'selector-id-pattern': null, // Allow any ID naming convention
    'custom-property-pattern': null, // Allow any CSS variable naming
    'declaration-block-no-redundant-longhand-properties': null, // Allow explicit properties
    'no-descending-specificity': null, // Allow existing specificity patterns
    'font-family-no-missing-generic-family-keyword': null, // Allow custom fonts

    // Style preferences (avoid churn; Prettier handles formatting)
    'alpha-value-notation': null,
    'color-function-notation': null,
    'custom-property-empty-line-before': null,
    'length-zero-no-unit': null,
    'value-keyword-case': null,
    'color-hex-length': null,
    'keyframes-name-pattern': null,
    'rule-empty-line-before': null,
    'declaration-empty-line-before': null,
    'media-feature-range-notation': null,

    // Real errors - catch bugs
    'color-no-invalid-hex': true,
    'function-calc-no-unspaced-operator': true,
    'keyframe-declaration-no-important': true,
    'property-no-unknown': true,
    'unit-no-unknown': true,
    'selector-pseudo-class-no-unknown': true,
    'selector-pseudo-element-no-unknown': true,
    'selector-type-no-unknown': [
      true,
      {
        ignoreTypes: ['/^custom-/'],
      },
    ],
    'declaration-block-no-duplicate-properties': [
      true,
      {
        ignore: ['consecutive-duplicates-with-different-values'],
      },
    ],
    'no-duplicate-selectors': true,
    'block-no-empty': true,
    'comment-no-empty': true,

    // Best practices (warnings)
    'max-nesting-depth': [4, { severity: 'warning' }],
    'shorthand-property-no-redundant-values': null,
    'declaration-block-no-shorthand-property-overrides': [true, { severity: 'warning' }],

    // Allow vendor prefixes (might be needed for compatibility)
    'property-no-vendor-prefix': null,
    'value-no-vendor-prefix': null,
    'selector-no-vendor-prefix': null,
    'at-rule-no-vendor-prefix': null,
  },
  ignoreFiles: ['node_modules/**', 'cleanup/reports/**', 'dist/**', 'build/**', '**/*.min.css'],
};
