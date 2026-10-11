# Scenarios

A scenario is a committed script for the real app in a real browser
(`npm run test:scenarios`, see `scripts/scenario.mjs`). Steps address things rather than
pixels — a command by name, a point in model millimetres — and every step waits for the
app to report itself settled (`__chiliTest.settled()`), so a scenario says nothing about
timing except where timing is the thing under test.

```jsonc
{
    "//": "What this scenario is for, in a sentence or two.",
    "start": "document",        // optional: open a document (and its viewport) first
    "steps": [
        { "kind": "runCommand", "name": "edit.undo" },
        { "kind": "clickWorld", "x": 20, "y": 15 },
        { "kind": "dragWorld", "from": [0, 0], "to": [40, 20] },
        { "kind": "key", "text": "Escape" },
        { "kind": "type", "text": "40" },
        { "kind": "waitFor", "selector": "canvas" },
        { "kind": "eval", "expression": "...", "log": true },
        { "kind": "screenshot", "name": "01-before" }
    ]
}
```

Notes worth knowing before writing one:

- **A command that opens a dialog never settles** until the dialog is answered. That is
  the signal working, not a bug: the scenario has to click the dialog's button (or
  `waitFor` its appearance) before the next step. `create.box` and the sketch commands
  are dialog-driven; `edit.undo`, `edit.redo` and `doc.new` are not.
- **`eval` steps are the escape hatch** and the honest place to assert: they run in the
  page with `globalThis.app`, `globalThis.activeDocument` and `globalThis.__chiliTest`
  available, and a thrown error fails the step. `"log": true` prints the value.
- **Requires a running dev server** (`npm run dev`) — the runner does not start one.
- **Screenshots land in `test/scenarios/<name>/`** and are gitignored; they are for
  looking at, not for asserting on.
