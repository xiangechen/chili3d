# Scenarios

A scenario is a committed script for the real app in a real browser
(`npm run test:scenarios`, see `scripts/scenario.mjs`). Steps address things rather than
pixels — a command by name, a point in model millimetres — and by default every step waits
for the app to report itself settled (`__chiliTest.settled()`), so a scenario says nothing
about timing except where timing is the thing under test.

```jsonc
{
    "//": "What this scenario is for, in a sentence or two.",
    "start": "document", // optional: open a document (and its viewport) first
    "steps": [
        { "kind": "runCommand", "name": "edit.undo" },
        { "kind": "clickWorld", "x": 20, "y": 15 },
        { "kind": "dragWorld", "from": [0, 0], "to": [40, 20] },
        { "kind": "clickEval", "point": "globalThis.clickPoint" },
        { "kind": "dragEval", "from": "globalThis.dragStart", "to": "globalThis.dragEnd" },
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
- **`clickEval` evaluates `point`, and `dragEval` evaluates `from` and `to`, to viewport-pixel
  coordinates**, then performs real Chrome mouse input. Use them for handles whose coordinates
  are computed at runtime; unlike calling an event handler directly, dragging also exercises
  pointer capture.
- **A step that opens an interactive tool never settles.** A pick session or a drag
  handle holds work in flight for as long as it is up, which is the settle signal telling
  the truth — and it means the default wait after that step runs its full 30 s and fails
  the run. Answer the tool before the step ends when possible. To inspect a persistent
  tool mid-session, set `"settle": false` on the affected steps and synchronize their
  own DOM or rendering state explicitly; close the tool before returning to ordinary
  settled steps. Leaving a sketch _drawing_ tool takes two Escapes; the first closes the
  chain it is drawing, the second leaves the tool, and until the second the sketch is
  still picking with that tool rather than selecting.
- **`clickWorld` is measured from the view's element, not from the window.**
  `ThreeView.worldToScreen` measures against the view's own element, while the step hands
  the answer to the browser as a cursor position in the window — `Input.dispatchMouseEvent`
  takes viewport pixels, so no scroll correction is involved in it. The click therefore
  misses by wherever the app's viewport sits in the window (the project/attribute panel
  alone is a few hundred pixels). A step that has to land on geometry adds the element's
  own box:

  ```js
  const at = view.worldToScreen({ x, y, z: 0 });
  const box = view.dom.getBoundingClientRect(); // the view's own element
  return { x: box.left + at.x, y: box.top + at.y };
  ```

- **Requires a running dev server** (`npm run dev`) — the runner does not start one.
- **Screenshots land in `test/scenario-results/<name>/`** and are gitignored; they are for
  looking at, not for asserting on.
