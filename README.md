# Cornfield Carver

A cozy browser game for carving cornfield art, making mazes, and exploring them as a farm animal. The original supplied prototype is preserved in `original.html`.

## Run

Open `index.html` in a modern browser. No install, build step, account, or internet connection is required. Keep `index.html`, `styles.css`, `game.js`, and `audio.js` together when copying the game.

## Create and play

Choose a field size, season, and animal. Carve paths with the tractor or generate a maze, then switch to the runner and find the exit. Use arrow keys / WASD or the on-screen controls. The interface provides editing, undo, reset, and hints.

## Audio

Music and Sounds have independent toggles and are both off by default. Music is an original, sparse procedural loop with warm pads and soft keys. Effects use gentle short tones; the abrasive tractor drone has been removed. Preferences are remembered, and audio pauses while the tab is hidden.

## Share

Export a PNG for a picture of the field. Export a maze file to share an editable, playable creation. Another player opens this game and imports that file. The maze file is versioned JSON data, not executable HTML or JavaScript. Recipients need the game files as well as your maze file.

The browser keeps a local save when browser storage is available. Export a maze file for a durable backup; browser data can be cleared or restricted.

## Development

Run `ak-test` (configured in `.agent.env`) for the Node core tests. No package installation is required.

Procedural canvas graphics keep the current version small and offline. The aesthetic uses rounded forms, seasonal palettes, warm shadows, and raised miniature scenery. This is a browser prototype, with procedural 2D art rather than a 3D asset pipeline.

The game model and map format are separate from rendering and browser input. Future mobile/PC work can retain the data model while adding a native renderer, packaging, performance tuning, and platform controls. The current release focuses on corn; future crops should be versioned additions to the map schema.

