# Cornfield Carver

A cozy browser game for carving cornfield art, making mazes, and exploring them as a farm animal. The original supplied prototype is preserved in `original.html`.

## Run

Open `index.html` in a modern browser. No install, build step, account, or internet connection is required. Keep `index.html`, `styles.css`, `game.js`, and `audio.js` together when copying the game.

## Create and play

New fields open as art projects, with an overview of the whole field. Choose a size and season, then carve your design with the tractor using arrow keys / WASD, the on-screen controls, or pointer dragging. Zoom in explicitly when you want a closer look.

Turn on Maze when you want a playable puzzle. Place the start and finish on the field, choose an animal, and switch to Run. The toggle preserves your carved design. You can also generate a maze as a separate action. Undo, reset, and hints help with editing and play.

## Audio

Music and Sounds have independent toggles and are both off by default. Music is an original procedural loop with warm pads and soft keys, paced at 86 BPM. Effects use gentle short tones. Preferences are remembered, and audio pauses while the tab is hidden.

## Share

Export a PNG for a picture of the field. Export a creation file to share editable art or a playable maze, including its start and finish. Another player opens this game and imports that file. Creation files contain versioned JSON data, not executable HTML or JavaScript. Recipients need the game files as well as your creation file. Version 1 files remain importable as mazes; version 2 files also distinguish art from mazes and allow unfinished gate placement.

The browser keeps a local save when browser storage is available. Export a maze file for a durable backup; browser data can be cleared or restricted.

## Development

Run `ak-test` (configured in `.agent.env`) for the Node core tests. No package installation is required.

Procedural canvas graphics keep the current version small and offline. A fixed oblique toy view uses shaded volumes, visible corn stalks and ears, and grounded shadows for depth. These are 2.5D drawings; the game does not yet use a real 3D engine or model pipeline.

The game model and map format are separate from rendering and browser input. Future mobile/PC work can retain the data model while adding a native renderer, packaging, performance tuning, and platform controls. The current release focuses on corn; future crops should be versioned additions to the map schema.

