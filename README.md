# Cornfield Carver

A cozy browser game for carving cornfield art, making mazes, and exploring them as a farm animal. The original supplied prototype is preserved in `original.html`.

## Run

Open `index.html` in a modern browser. No install, build step, account, or internet connection is required. Keep `index.html`, `styles.css`, `game.js`, and `audio.js` together when copying the game.

## Create and play

New fields open as art projects, with an overview of the whole field. Open the sidebar Settings tab to choose field size, season, and animal runner. The Play tab keeps your editing and sharing tools at hand. Carve with the tractor using arrow keys / WASD, the on-screen controls, or pointer dragging.

Use View for an optional close-up. The full-field minimap remains visible above the sidebar tabs, with the active character, maze gates, and the current camera area. Runners have movement-driven strides and settle back to a neutral pose at rest. Reduced-motion mode keeps their pose static.

Turn on Maze when you want a playable puzzle. Place the start and finish on the field, choose an animal, and switch to Run. The toggle preserves your carved design. You can also generate a maze as a separate action. Undo, reset, and hints help with editing and play.

## Audio

Music and Sounds have independent toggles and are both off by default. The original procedural soundtrack uses a brighter rhythmic arrangement around 118 BPM, with percussion, bouncy bass, and short melodic notes. Effects use gentle short tones. Preferences are remembered, and audio pauses while the tab is hidden.

## Share

Export a PNG for a picture of the field. Export a creation file to share editable art or a playable maze, including its start and finish. Another player opens this game and imports that file. Creation files contain versioned JSON data, not executable HTML or JavaScript. Recipients need the game files as well as your creation file. Version 1 files remain importable as mazes; version 2 files also distinguish art from mazes and allow unfinished gate placement.

The browser keeps a local save when browser storage is available. Export a maze file for a durable backup; browser data can be cleared or restricted.

## Development

Run `ak-test` (configured in `.agent.env`) for the Node core tests. No package installation is required.

For browser checks, install Playwright or set `PLAYWRIGHT_MODULE` to an existing Playwright module directory. Set `BROWSER_TESTS=1`, then run `ak-test` to include all four browser suites: interaction/sharing, rendering, storage, and settings/minimap/gaits. They use installed Microsoft Edge by default; set `BROWSER_CHANNEL=chrome` for installed Chrome. PowerShell example: `$env:BROWSER_TESTS='1'; ak-test`. Screenshots are saved in `.ai/previews/`. Checks include idle pixels, camera stability, resize clearing, sharing, input, audio controls, tab keyboard navigation, minimap coordinates, all six running cycles, and reduced motion. The default Node suite tests the game core and audio scheduler without Playwright or a browser.

Procedural canvas graphics keep the current version small and offline. A fixed oblique toy view uses shaded volumes, visible corn stalks and ears, and grounded shadows for depth. These are 2.5D drawings; the game does not yet use a real 3D engine or model pipeline.

The game model and map format are separate from rendering and browser input. Future mobile/PC work can retain the data model while adding a native renderer, packaging, performance tuning, and platform controls. The current release focuses on corn; future crops should be versioned additions to the map schema.

