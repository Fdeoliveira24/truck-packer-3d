# Vendor Libraries (Local Fallbacks and Test Fixtures)

This folder contains local copies of non-Three.js CDN dependencies used as final fallbacks. It also
keeps one Three.js r160 module as an existing automated-test fixture; that fixture is not an active
browser runtime dependency and is not emitted into the Vite production build.

## Files

| File               | Library               | Version | Source                                                                             | Global              |
| ------------------ | --------------------- | ------- | ---------------------------------------------------------------------------------- | ------------------- |
| `supabase.min.js`  | Supabase JS Client    | 2.48.1  | https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.48.1/dist/umd/supabase.min.js | `window.supabase`   |
| `tween.umd.js`     | TWEEN.js              | 23.1.1  | https://cdn.jsdelivr.net/npm/@tweenjs/tween.js@23.1.1/dist/tween.umd.js            | `window.TWEEN`      |
| `jspdf.umd.min.js` | jsPDF                 | 2.5.1   | https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js                | `window.jspdf`      |
| `xlsx.full.min.js` | SheetJS (XLSX)        | 0.18.5  | https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js                     | `window.XLSX`       |
| `three.module.js`  | THREE.js test fixture | 0.160.0 | https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js                   | Test-only ES module |

## Load Strategy

1. **Three.js and OrbitControls** → Imported from pinned `three@0.160.0` npm package and bundled by
   Vite into application-owned assets.
2. **Other primary CDNs** → Load from the existing jsdelivr/cdnjs URLs.
3. **Other secondary CDNs** → Fallback to the existing unpkg/alternate CDN URLs.
4. **Other local fallbacks** → Final fallback to `/vendor/` files emitted by the Vite build.

## Notes

- The non-Three.js fallback files are only loaded if their CDN attempts fail (for example, offline
  mode or a firewall blocking those CDNs).
- `three.module.js` remains because `tests/audit/security-and-invariants.spec.mjs` imports it as an
  existing r160 geometry reference. Production runtime code does not import it.
- Three.js runtime rollback is handled through Git and the previous tested static build; there is no
  dual npm/CDN runtime path.

## License

Each library retains its original license. See respective project repositories for details.
