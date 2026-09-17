# Chili3D coding guidelines

## Build & Test

```bash
npm run dev            # Rspack dev server → localhost:8080
npm run build          # Production build (Rspack + SWC)
npm run test           # All tests (Rstest + Happy-DOM); npm run testc = with coverage
npm run check          # Biome lint + auto-fix (run before commits)
npm run format         # Biome + clang-format across all files
npm run build:wasm     # C++ → WebAssembly (CMake + Emscripten); setup:wasm = one-time deps

npx rstest packages/core/test/result.test.ts   # single file
npx rstest -t "should handle error case"       # filter by name
```

## Monorepo Structure

Browser-based parametric 3D CAD: OCCT C++ kernel compiled to WebAssembly, rendered with Three.js. npm workspace under `packages/`:

```
web ──> builder ──> app ──> core
                  ──> i18n / three / wasm ──> core
                  ──> ui ──> core + element
                  ──> parametric ──> core
```

- **`core`** — Everything abstract: shape interfaces, math, document model, reactive data (`Observable`, `Binding`, `PubSub`), `Result<T,E>`, undo, commands, serialization, plugins, services, UI abstractions
- **`parametric`** — Parametric feature-list bodies (Onshape-style) plus the 2D sketch module (`src/sketch/`, wrapping the garlic constraint solver). A body stores no shapes — only an ordered feature list replayed through `registerFeature` handlers, so any upstream edit re-evaluates the chain; the bulk of the module is stable identity for sub-shapes across rebuilds (kernel history → tracked ids → stored `EdgeRef`/`ProfileRef`) and the timeline rules for which shape a reference resolves against.
- **`wasm`** — Concrete `ShapeFactory` → OCCT via Emscripten; exports `initWasm()`
- **`three`** — Three.js viewport, camera controller, visuals, highlighter, gizmo, mesh export
- **`element`** — Custom reactive DOM elements (radio groups, expanders, data converters)
- **`ui`** — App chrome: main window, ribbon, property panels, project tree, dialogs, toast, status bar
- **`app`** — `Application`, body nodes (`bodys/`), command implementations, `CommandService`, `HotkeyService`
- **`builder`** — `AppBuilder` fluent chain (`.useIndexedDB().useWasmOcc().useParametric().useThree().useUI().build()`), default ribbon layout; `mergeRibbonProfiles` merges module contributions (`SketchRibbonProfiles` from `@chili3d/parametric`, `ParametricRibbonProfiles`) into `DefaultRibbon`
- **`i18n`** / **`storage`** / **`web`** — Locale data (en, zh-cn, pt-br) / IndexedDB persistence / entry point (loading screen, `?plugin=`/`?url=`/`?model=` params)

Import via workspace names (`import { ... } from "@chili3d/core"`); one root `tsconfig.json` covers all packages.

## C++ WASM (`cpp/`)

OCCT v8.0.0 → `chili-wasm.wasm` via Emscripten. `cpp/src/`: `factory.cpp` (shape creation; the tracked ops report per-output history twice — single-valued `faceMap`/`edgeMap` keeping the first ancestor, plus flat (out, in) `faceAncestors`/`edgeAncestors` pairs keeping every derivation so boolean-merged faces record all their inputs), `shape.cpp` (topology traversal), `converter.cpp` (STEP/IGES/BREP/STL), `mesher.cpp` (B-rep → mesh), `geometry.cpp` (curve/surface queries). The Release build sets `-sDISABLE_EXCEPTION_CATCHING=1`, so any OCCT raise aborts the whole module and C++ try/catch is ineffective — the query files (`shape.cpp`/`mesher.cpp`/`geometry.cpp`) guard degenerate and null-geometry paths preventively (`IsGeometric`/`IsNull`/`IsDone` prechecks; `Edge::curve` reports degenerate edges through a JS-level throw, which still works with catching disabled), and the tracked sweep ops report cap faces through a separate `capFaces` channel on the tracked result (`LastShape()` of the sweep; empty when it coincides with `FirstShape()`, e.g. a 360° revolve). Output: `packages/wasm/lib/chili-wasm.{wasm,js,d.ts}`. C++ style: WebKit (clang-format); license LGPL-3.0 (TS is AGPL-3.0).

## Key Patterns

- **Interface-driven** — `core` defines interfaces; feature packages implement; `AppBuilder` wires at startup.
- **Result pattern** — Fallible ops return `Result.ok(value)` / `Result.err(error)` (`core/src/foundation/result.ts`); never throw for expected failures.
- **Reactive data** — `Observable` uses `getPrivateValue(key)` / `setPrivateValue(key, value)`; setting emits `emitPropertyChanged`. `ObservableCollection` powers property editor and project tree.
- **Serialization** — `@serializable()` on classes, `@serialize()` on fields → `{ __cla$$__: "ClassName", ...props }`.
- **Body nodes** — `app/src/bodys/`; extend `ParameterShapeNode`, implement `generateShape(): Result<IShape>`, `setPropertyEmitShapeChanged()` triggers re-evaluation.
- **Commands** — `ICommand.execute(application): Promise<void>`; `CancelableCommand` adds `cancel()`, `AsyncController`, dispose stack.
- **Undo/redo** — `Transaction` records snapshots, `History` keeps the stack; commands create transactions automatically.
- **Plugins** — Loaded from URLs or `?plugin=`; manager in `core/src/plugin/` + `app/src/pluginManager.ts`; examples in `plugins/`.
- **Global singleton** — `getCurrentApplication()` (from `core`) instead of DI threading.
- **MCP server** — a separate package (`chili3d-mcp`, moved out of this repo): its `live_*` tools drive the user's open browser tab, and headless tools (`run_cad_program`, `render_preview`, …) are a server-side scratchpad. Units: millimetres; angles: degrees.

## Testing

- Rstest (not Jest/Vitest) + Happy-DOM; root `rstest.config.ts`, globals enabled (`describe`, `test`, `expect`); tests in `packages/*/test/`; legacy decorators enabled.
- Reuse shared mocks from `@chili3d/core/test-utils` (`TestDocument`, `createMockDocument`, `createMockApplication`, `createMockVisual`, ...) instead of per-package copies; package-specific facades (e.g. `packages/ui/test/_helpers/`) extend them. `initializeI18n()` runs automatically via rstest `setupFiles` — never call it in test files.
- Assertions must execute: none hidden in event callbacks (unless the callback is also asserted to fire), no tautologies (`x === true || x === false`), no `if (x) expect(...)` — assert the precondition, then the behavior; `await` every promise whose `.then` asserts.
- Assert behavior, not absence of crashes: bare `not.toThrow()` / `toBeDefined()` is a smell; `querySelector` results need `not.toBeNull()`.
- Restore global monkeypatches (`PubSub.default.pub`, `globalThis.fetch`, ...) in `finally`/`afterEach`, or use `rs.stubGlobal` + `rs.unstubAllGlobals()`.
- Type `rs.fn` mocks with the real signature (`rs.fn((_edges: IEdge[]) => ...)`) so `mock.calls` typechecks; use `test.each` for near-identical repeated cases.

## Code Style

- Biome: 4-space indent, 110-col width, double quotes, semicolons always
- `I`-prefixed behavioral interfaces — plain data-carrier shapes stay unprefixed (`...Data`, `...Ref`, `...Options`, e.g. `SketchData`, `EdgeRef`); `camelCase` functions/variables/files; `PascalCase` classes; `UPPER_SNAKE_CASE` constants
- CSS Modules (`*.module.css`); type-only imports (`import type { IFoo }`)
- Every TS file starts with the AGPL-3.0 header:

```ts
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.
```

## Git

Commits: `<emoji> <type>(<scope>): <description>` — ✨ `feat` · 🐛 `fix` · ♻️ `refactor` · ✅ `test` · 📝 `docs` · 💄 `style` · 🔧 `chore`. Scope = package name. Active branch: `dev` → PR to `main`.
