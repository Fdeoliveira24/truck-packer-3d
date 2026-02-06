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
    TruckPackerApp?: any;
    jspdf?: any;
    jsPDF?: any;
    supabase?: { createClient?: any } | any;
    __TP3D_SUPABASE_CLIENT?: any;
    __TP3D_SUPABASE_API?: any;
    __TP3D_SUPABASE?: any;
    SupabaseClient?: any;
    __tp3dVendorAllReady?: any;
    TP3D?: any;
    msCrypto?: Crypto;
  }

  interface HTMLElement {
    _tp3dCleanup?: () => void;
  }
}
