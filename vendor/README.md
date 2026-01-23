# Vendor Libraries (Local Fallback)

This folder contains local copies of CDN dependencies used as final fallback when both primary and secondary CDNs fail.

## Files

| File | Library | Version | Source | Global |
|------|---------|---------|--------|--------|
| `supabase.min.js` | Supabase JS Client | 2.48.1 | https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.48.1/dist/umd/supabase.min.js | `window.supabase` |
| `tween.umd.js` | TWEEN.js | 23.1.1 | https://cdn.jsdelivr.net/npm/@tweenjs/tween.js@23.1.1/dist/tween.umd.js | `window.TWEEN` |
| `jspdf.umd.min.js` | jsPDF | 2.5.1 | https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js | `window.jspdf` |
| `xlsx.full.min.js` | SheetJS (XLSX) | 0.18.5 | https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js | `window.XLSX` |
| `three.min.js` | THREE.js | 0.160.0 | https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js | `window.THREE` (UMD) |
| `three.module.js` | THREE.js | 0.160.0 | https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js | (ES module) |
| `OrbitControls.js` | THREE OrbitControls | 0.160.0 | https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js | (ES module, bare import) |
| `OrbitControls.module.js` | THREE OrbitControls | 0.160.0 | Derived from `OrbitControls.js` with local `./three.module.js` import | (ES module) |

## Load Strategy

1. **Primary CDN** → Load from jsdelivr/cdnjs
2. **Secondary CDN** → Fallback to unpkg/alternate CDN
3. **Local** → Final fallback to `/vendor/` files (this folder)

## Notes

- These files are only loaded if both CDN attempts fail (e.g., offline mode, firewall blocking CDNs).
- THREE.js uses ESM imports and has a separate fallback mechanism in index.html (CDN primary -> CDN fallback -> local modules).
- Local files are intentionally NOT checked into version control (add to .gitignore if deploying).
- Downloaded on: 2026-01-23

## License

Each library retains its original license. See respective project repositories for details.
