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
- **`parametric`** — Parametric feature-list bodies (Onshape-style) plus the 2D sketch module (`src/sketch/`): the sketch side wraps the garlic constraint solver (`packages/parametric/lib`, init via `initGarlic()`/`initGarlicSync()`) with `SketchSolver` + serializable `SketchNode`; the body side's `ParametricBodyNode` replays an ordered `featuresJson` list (extrude/revolve from a referenced sketch, fillet/chamfer via edge fingerprints in `features/edgeRef.ts`, boolean against tool nodes, `variable` features defining expression scope) without shape snapshots; per-kind behavior lives in `features/` behind `registerFeature`. Numeric parameters accept expression strings (`features/expression.ts` — safe parser, no `eval`; trig in degrees). Rebuilds reuse a per-feature cache (feature JSON + variable scope + input/refs shape identity) and dispose evicted intermediate shapes; referenced nodes are watched so edits re-evaluate the chain. Boolean features consume their tool nodes by default (`consumeTools`): tools become children of the body via `NodeChildList` (`core/src/model/childList.ts`, the linked-list plumbing behind `INodeLinkedList`, shared with `FolderNode`) — hidden from the scene, still editable from the model tree. The property panel renders the list through core's `IFeatureListNode` contract (`core/src/model/featureList.ts`); its optional `referencedNodes()` exposes feature-referenced sketches, which the model tree shows as non-draggable mirror rows under the body (`ui/src/project/tree/treeItemReference.ts`) — double-clicking one enters sketch editing via the existing `nodeDoubleClicked` PubSub topic.
- **`wasm`** — Concrete `ShapeFactory` → OCCT via Emscripten; exports `initWasm()`
- **`three`** — Three.js viewport, camera controller, visuals, highlighter, gizmo, mesh export
- **`element`** — Custom reactive DOM elements (radio groups, expanders, data converters)
- **`ui`** — App chrome: main window, ribbon, property panels, project tree, dialogs, toast, status bar
- **`app`** — `Application`, body nodes (`bodys/`), command implementations, `CommandService`, `HotkeyService`
- **`builder`** — `AppBuilder` fluent chain (`.useIndexedDB().useWasmOcc().useParametric().useThree().useUI().build()`), default ribbon layout; `mergeRibbonProfiles` merges module contributions (`SketchRibbonProfiles` from `@chili3d/parametric`, `ParametricRibbonProfiles`) into `DefaultRibbon`
- **`i18n`** / **`storage`** / **`web`** — Locale data (en, zh-cn, pt-br) / IndexedDB persistence / entry point (loading screen, `?plugin=`/`?url=`/`?model=` params)

Import via workspace names (`import { ... } from "@chili3d/core"`); one root `tsconfig.json` covers all packages.

## C++ WASM (`cpp/`)

OCCT v8.0.0 → `chili-wasm.wasm` via Emscripten. `cpp/src/`: `factory.cpp` (shape creation), `shape.cpp` (topology traversal), `converter.cpp` (STEP/IGES/BREP/STL), `mesher.cpp` (B-rep → mesh), `geometry.cpp` (curve/surface queries). Output: `packages/wasm/lib/chili-wasm.{wasm,js,d.ts}`. C++ style: WebKit (clang-format); license LGPL-3.0 (TS is AGPL-3.0).

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
- **MCP server** (`packages/mcp/`) — `live_*` tools drive the user's open browser tab; headless tools (`run_cad_program`, `render_preview`, etc.) are a server-side scratchpad. Units: millimetres; angles: degrees.

## Testing

- Rstest (not Jest/Vitest) + Happy-DOM; root `rstest.config.ts`, globals enabled (`describe`, `test`, `expect`); tests in `packages/*/test/`; legacy decorators enabled.
- Reuse shared mocks from `@chili3d/core/test-utils` (`TestDocument`, `createMockDocument`, `createMockApplication`, `createMockVisual`, ...) instead of per-package copies; package-specific facades (e.g. `packages/ui/test/_helpers/`) extend them. `initializeI18n()` runs automatically via rstest `setupFiles` — never call it in test files.
- Assertions must execute: none hidden in event callbacks (unless the callback is also asserted to fire), no tautologies (`x === true || x === false`), no `if (x) expect(...)` — assert the precondition, then the behavior; `await` every promise whose `.then` asserts.
- Assert behavior, not absence of crashes: bare `not.toThrow()` / `toBeDefined()` is a smell; `querySelector` results need `not.toBeNull()`.
- Restore global monkeypatches (`PubSub.default.pub`, `globalThis.fetch`, ...) in `finally`/`afterEach`, or use `rs.stubGlobal` + `rs.unstubAllGlobals()`.
- Type `rs.fn` mocks with the real signature (`rs.fn((_edges: IEdge[]) => ...)`) so `mock.calls` typechecks; use `test.each` for near-identical repeated cases.

## Code Style

- Biome: 4-space indent, 110-col width, double quotes, semicolons always
- `I`-prefixed interfaces; `camelCase` functions/variables/files; `PascalCase` classes; `UPPER_SNAKE_CASE` constants
- CSS Modules (`*.module.css`); type-only imports (`import type { IFoo }`)
- Every TS file starts with the AGPL-3.0 header:

```ts
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.
```

## Git

Commits: `<emoji> <type>(<scope>): <description>` — ✨ `feat` · 🐛 `fix` · ♻️ `refactor` · ✅ `test` · 📝 `docs` · 💄 `style` · 🔧 `chore`. Scope = package name. Active branch: `dev` → PR to `main`.
