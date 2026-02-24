/**
 * @file model-loader.js
 * @description Stub model loader interface for future 3D model support.
 * @module features/editor/model-loader
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export const ModelLoader = {
  // Phase 2 placeholder: retained for API shape, but not implemented yet.
  isAvailable: false,
  async loadGLTF(_url) {
    throw new Error('3D model loading not implemented (Phase 2 placeholder)');
  },
};
