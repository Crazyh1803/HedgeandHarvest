# Cozy Fieldwork
Build an offline, dependency-free browser game from original.html. Retain tractor carving and maze running, expand with three field sizes, four seasons, six animal runners, reliable image and versioned JSON sharing, local saves, undo, touch input and accessible controls.

Architecture: index.html for semantic UI, styles.css for responsive storybook layout, game.js for pure model and canvas rendering/controller; expose pure model to Node tests without browser globals. JSON is data only, validated and bounded before applying. Canvas toy aesthetic is procedural code (no separate art assets).

Split: Claude implementation of index.html, styles.css, game.js and tests/game.test.cjs, at most these four files. Codex handles integration, .agent.env, README, verification and review. Existing original.html is preserved as reference. No external dependencies or CDNs. Test with ak-test and browser desktop/mobile smoke checks. Future ports retain versioned map data and isolated core logic.
