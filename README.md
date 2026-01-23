# Truck Packer 3D

A professional 3D truck packing visualization tool for planning equipment loads, tours, and
logistics. Built with Three.js for real-time 3D rendering and interactive packing simulations.

![Truck Packer 3D](https://img.shields.io/badge/Three.js-0.160.0-049EF4?logo=three.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

- **3D Interactive Editor**: Real-time visualization with orbit controls, zoom, and pan
- **Pack Management**: Create, organize, and manage multiple truck packing projects
- **Case Library**: Build a reusable library of equipment cases with custom dimensions and colors
- **Auto-Pack Engine**: Intelligent automatic packing algorithm to optimize space utilization
- **Export/Import**: Save and share packs as JSON, export to PDF and Excel
- **Dark/Light Theme**: Modern UI with theme switching
- **Grid & Shadows**: Toggle visual aids for better spatial awareness
- **Keyboard Shortcuts**: Efficient workflow with comprehensive keyboard controls
- **Dev Overlay**: Toggle FPS/memory/renderer stats in the editor (press `P`)
- **Hardened Imports**: CDN error capture, ESM Three.js/OrbitControls, and sanitized JSON imports

## Quick Start

1. **Serve the app (recommended)**: Use VSCode Live Server (or any static HTTP server) and open
   `index.html`. ES module imports do not reliably work from `file://`.
2. **Create a pack**: Click "New Pack" on the Packs screen
3. **Add cases**: Go to Cases library and create equipment cases with dimensions
4. **Start packing**: Open your pack in the Editor and drag cases from the sidebar to the 3D truck
5. **Export**: Save your work as JSON or export to PDF/Excel for sharing

## Phase 1 (SaaS-Ready Foundation)

Phase 1 introduces a session/org foundation, plan/role-aware feature flags, and hash routing. See
`MIGRATION_PHASE1.md` for details.

## Keyboard Shortcuts

### Global

- `Ctrl/Cmd + O` - Open pack dialog
- `Ctrl/Cmd + P` - Auto-pack cases

### Editor

- `Delete` / `Backspace` - Delete selected cases
- `Ctrl/Cmd + C` - Copy selected cases
- `Ctrl/Cmd + V` - Paste copied cases
- `Ctrl/Cmd + A` - Select all cases
- `G` - Toggle grid visibility
- `S` - Toggle shadows
- `F` - Focus on selected case
- `P` - Toggle dev performance overlay (FPS, frame time, memory, Three.js stats)
- `Esc` - Deselect all / Clear search

### Navigation

- **Left Mouse Drag** - Rotate camera (orbit)
- **Right Mouse Drag** - Pan camera
- **Mouse Wheel** - Zoom in/out
- **Click Case** - Select/deselect
- **Shift + Click** - Multi-select

## Usage

### Creating a Pack

1. Navigate to the **Packs** screen
2. Click **New Pack** button
3. Fill in pack details:
   - Title (required)
   - Client name (optional)
   - Project name (optional)
   - Drawn by (optional)
4. Choose truck dimensions or select from presets
5. Click **Create Pack**

### Managing Cases

1. Go to **Cases** from the sidebar
2. Click **New Case** to add equipment
3. Define case properties:
   - Name
   - Dimensions (Length × Width × Height in inches)
   - Color (for visual identification)
   - Weight (optional)
4. Cases appear in the Editor sidebar when packing

### Packing in 3D Editor

1. Open a pack from the **Packs** screen
2. In the Editor:
   - Drag cases from the left sidebar onto the truck bed
   - Click and drag cases to reposition them
   - Use mouse controls to orbit/zoom the camera
   - Select cases to see dimensions and properties
3. Use **Auto Pack** for automatic space optimization

### Exporting

**Export Full App**:

- Click **Export** in the topbar to download complete app state as JSON
- Includes all packs, cases, and preferences

**Export Single Pack**:

- Open pack's menu (three vertical dots)
- Select **Export JSON**
- Share the file with others

**Export to PDF/Excel**:

- In Editor, click **Export PDF** or **Export Excel**
- Generates professional reports with pack details and case lists

### Importing

**Import App Backup**:

- Click **Import** in topbar
- Select a previously exported app JSON file
- App state will be restored

**Import Pack**:

- On Packs screen, click **Import Pack**
- Select a pack JSON file (from someone else or backup)
- Pack will be added to your library

## Technical Details

- **Framework**: Vanilla JavaScript (ES6+)
- **3D Engine**: Three.js v0.160.0
- **File Format**: Single HTML file (~6100 lines)
- **Storage**: Browser localStorage with JSON export/import
- **Browser Requirements**: Modern browser with WebGL support

## File Structure

```
truck-packer-3d/
├── index.html          # Complete application (HTML/CSS/JS)
└── README.md           # This file
```

## Tips & Best Practices

1. **Save Often**: Use Export to create backups before major changes
2. **Case Library**: Build your case library first before creating packs
3. **Colors**: Use distinct colors for different case types for easy visual identification
4. **Auto-Pack**: Try auto-pack first, then manually adjust as needed
5. **Search**: Use search on Packs screen to quickly find projects (press Esc to clear)
6. **Theme**: Toggle theme from sidebar bottom for comfortable viewing
7. **Performance Debugging**: Press `P` in the editor to see FPS, frame time, memory, and renderer
   stats; useful when testing on lower-end devices or 4K displays
8. **Safe Imports**: Imports and backups are sanitized to drop `__proto__`/`constructor`/`prototype`
   keys; malformed JSON shows a toast instead of breaking the app

## Browser Compatibility

- ✅ Chrome 90+ (ES2020 support)
- ✅ Firefox 103+ (backdrop-filter support; 88-102 partial support)
- ✅ Safari 13.1+ (optional chaining support; 14+ recommended)
- ✅ Edge 90+ (ES2020 support)

**Note**: Requires ES2020 features including optional chaining (`?.`) and nullish coalescing (`??`).

## Help

Click the **Help** button in the topbar for quick reference on Export/Import features.

## Security & Performance

- **Three.js/OrbitControls via ESM**: Loaded from `esm.sh`, ready on Safari 14+ without import maps;
  app init waits for Three.js to be ready.
- **Sanitized JSON**: All imports and localStorage loads strip dangerous keys (`__proto__`,
  `prototype`, `constructor`) to reduce prototype pollution risk.
- **Safe Rendering**: User/imported text now uses `textContent` instead of `innerHTML` in dialogs
  and headers.
- **Dev Overlay**: Press `P` in the editor to view FPS, frame time, memory (if available), and
  renderer info (draw calls, tris, geometries, textures) with periodic console logs.

## License

MIT License - Feel free to customize and use for your projects.

## Credits

Built with:

- [Three.js](https://threejs.org/) - 3D graphics library
- [Font Awesome](https://fontawesome.com/) - Icons
- [jsPDF](https://github.com/parallax/jsPDF) - PDF generation
- [SheetJS](https://sheetjs.com/) - Excel export

---

**Version**: 1.0.0  
**Author**: 360 Virtual Tour Solutions  
**Last Updated**: January 2026

## Recent Changes (Jan 2026)

- Cases UI: made search icon styling consistent between Packs and Cases screens.
- Case editor: moved to a more compact 2-column grid layout for faster editing.
- Categories: added inline rename + color editing in the Case modal and a redesigned "Manage
  Categories" modal (card layout, delete confirmation, New Category action).
- Table: added column sorting (Name, Manufacturer, Volume, Weight, Category) with visual sort
  indicators; improved weight formatting to 2 decimal places.
- UX: reduced modal width for a tighter, more professional look; removed redundant per-case color
  field (cases inherit category color by default).

These changes improve inventory workflows and streamline case/category management.
