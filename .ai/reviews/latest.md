VERDICT: APPROVE
FINDINGS:
- [MED] game.js:1326 — Continue visibility is not refreshed after releasing save ownership. If this session created the first saved carving, the card remains hidden because it previously checked the empty checkpoint, even though `ui.resumeRaw` now contains the carving. — Call `updateResume()` after replacing the field; add a regression starting with empty storage.