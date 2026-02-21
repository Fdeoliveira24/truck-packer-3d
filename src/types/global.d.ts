export {};

// Global browser/runtime shims for checkJs

declare global {
  const THREE: any;
  const TWEEN: any;

  interface Window {
    THREE?: any;
    TWEEN?: any;
    XLSX?: any;
    __TP3D_BOOT?: any;
    __TP3D_UI?: any;
    __TP3D_BILLING?: any;
    __TP3D_DIAG__?: any;
    __TP3D_ORG_METRICS__?: any;
    __TP3D_STRIPE_PRICE_MONTHLY?: any;
    __TP3D_BUILD_STAMP_LOGGED__?: any;
    __TP3D_DIAG_PERSIST_KEY__?: any;
    __TP3D_FORCE_DEBUG__?: any;
    __TP3D_WRAPPER_DETECTIVE__?: any;
    TruckPackerApp?: any;
    jspdf?: any;
    jsPDF?: any;
    supabase?: { createClient?: any } | any;
    __TP3D_SUPABASE_CLIENT?: any;
    __TP3D_SUPABASE_API?: any;
    __TP3D_SUPABASE?: any;
    SupabaseClient?: any;
    SettingsOverlay?: any;
    AccountOverlay?: any;
    OrgContext?: any;
    __tp3dVendorAllReady?: any;
    TP3D?: any;
    msCrypto?: Crypto;
  }

  interface Event {
    detail?: any;
  }

  interface Function {
    __tp3dWrapped?: boolean;
  }

  interface HTMLElement {
    _tp3dCleanup?: () => void;
  }
}
