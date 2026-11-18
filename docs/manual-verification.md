# Manual verification checklist

Automated coverage: unit tests (engine, checkpoints, configuration, pacing, session behaviour), headless full replays
of both examples, and an integration suite that drives both examples through the real extension commands inside a VS
Code extension host. The following behaviours involve real keyboard focus or visual judgement and should be checked by
a person before presenting:

- [ ] Pressing **Enter** in an editor runs the next step only while presentation mode is on.
- [ ] Pressing Enter in the **integrated terminal** sends a newline to the shell and does not run a step.
- [ ] While IntelliSense is open during typing, pressing Enter does not accept a completion.
- [ ] Pressing Enter in the rename box, find widget and Quick Open behaves normally.
- [ ] After *Exit Presentation Mode*, Enter inserts a newline again.
- [ ] Human Mode *feels* natural; adjust the `betterLiveCoding.*` delays if not.
- [ ] IntelliSense and parameter hints appear briefly with your language extensions installed.
- [ ] The status bar shows `Stage x · Step y/z`, `Thinking · …`, `Switching file · …` and `Paused`.
- [ ] The *Better Live Coding* sidebar preview stays out of the editor area and updates after each step.
- [ ] *Reload Window* in the middle of a step, then *Start Presentation Mode*: the restore dialog lists only declared
      files.
- [ ] `Ctrl+Alt+P/S/R/Q` do not collide with your other keybindings.
