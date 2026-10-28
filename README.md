# Hedge and Harvest

A cozy browser game for carving cornfield art, making mazes, and exploring them as a farm animal. The original supplied prototype is preserved in `original.html`.

## Run

Open `index.html` in a modern browser. No install, build step, account, or internet connection is required. Keep `index.html`, `styles.css`, `game.js`, `audio.js`, and `favicon.svg` together when copying the game.

## Create and play

Every load opens a fully planted art field, with an overview of the whole field. Continue saved field in Play restores your last carving explicitly. Opening the game or adjusting preferences does not replace that saved creation. Open the sidebar Settings tab to choose field size, season, and animal runner. The Play tab keeps your editing and sharing tools at hand. Carve with the tractor using arrow keys / WASD, the on-screen controls, or pointer dragging.

Use View for an optional close-up. The full-field minimap remains visible above the sidebar tabs, with the active character, maze gates, and the current camera area. Runners have visible alternating legs, slower movement-driven strides, and front, back, and side views that follow their movement. Most corn stalks rest while a few do short, independent sways from their rooted bases. The three stalks in each clump have different timing. Settings offers Device, Full, and Reduced motion: Device follows your system preference, Full enables the animations, and Reduced freezes the corn and runner poses. PNG exports use static poses.

Turn on Maze when you want a playable puzzle. Place the start and finish on the field, choose an animal, and switch to Run. The toggle preserves your carved design. You can also generate a maze as a separate action. Undo, reset, and hints help with editing and play.

## Audio

Music and Sounds have independent toggles and are both off by default. Five original upbeat songs rotate automatically after 32 bars (about 65 seconds each), including the previous tune as Cornfield Bounce. Use the top Now playing bar to select a song or skip backward/forward. Its title follows the audible track during rotation. Automatic rotation can be enabled or disabled in Settings. Selecting songs while music is off keeps it off. Preferences are remembered, and audio pauses while the tab is hidden.

## Share

Export a PNG for a picture of the field. Export a creation file to share editable art or a playable maze, including its start and finish. Another player opens this game and imports that file. Creation files contain versioned JSON data, not executable HTML or JavaScript. Recipients need the game files as well as your creation file. Version 1 files remain importable as mazes; version 2 files also distinguish art from mazes and allow unfinished gate placement.

The browser saves actual edits when storage is available. A new load starts planted; use Continue saved field to resume. A checkpoint protects the previous creation before a new carving first replaces its autosave. This is a small local history, so export creation files for durable backups; browser data can be cleared or restricted.

## Development

Run `ak-test` (configured in `.agent.env`) for the Node core tests. No package installation is required.

For browser checks, install Playwright or set `PLAYWRIGHT_MODULE` to an existing Playwright module directory. Set `BROWSER_TESTS=1`, then run `ak-test` to include all seven browser suites: interaction/sharing, rendering, storage, settings/minimap/gaits, visible-pose/corn/playlist checks, native mobile touch, and branding/support/directional polish. They use installed Microsoft Edge by default; set `BROWSER_CHANNEL=chrome` for installed Chrome. PowerShell example: `$env:BROWSER_TESTS='1'; ak-test`. Screenshots are saved in `.ai/previews/`. Checks include idle pixels, camera stability, resize clearing, sharing, input, audio controls, tab keyboard navigation, minimap coordinates, all six running cycles, and reduced motion. The default Node suite tests the game core, audio scheduler, original-song fingerprint, five distinct melodies, muted selection, and musical rotation without Playwright or a browser.

Procedural canvas graphics keep the current version small and offline. A fixed oblique toy view uses shaded volumes, visible corn stalks and ears, and grounded shadows for depth. These are 2.5D drawings; the game does not yet use a real 3D engine or model pipeline.

The game model and map format are separate from rendering and browser input. Future mobile/PC work can retain the data model while adding a native renderer, packaging, performance tuning, and platform controls. The current release focuses on corn; future crops should be versioned additions to the map schema.




## Support and publication

Optional Buy Dan a coffee links point to https://buymeacoffee.com/AppsbyDan on Play, Settings, sharing, successful design loading, and maze completion. They open only after a deliberate click and do not restrict any feature.

Mobile uses a direct screen-relative D-pad: down moves down, with no reverse gear or vehicle-relative steering. Dragging from the tractor or runner towards a field cell is also supported. Native touch emulation covers hold, release, cancellation, scrolling and several viewport sizes; a hands-on physical phone check remains part of publication readiness. This repository remains a local static build until a hosting destination is chosen.
