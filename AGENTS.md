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
                  ──> ai ──> core
                  ──> parametric ──> core
```

- **`core`** — Everything abstract: shape interfaces, math, document model, reactive data (`Observable`, `Binding`, `PubSub`), `Result<T,E>`, undo, commands, serialization, plugins, services, UI abstractions
- **`parametric`** — Parametric feature-list bodies (Onshape-style) plus the 2D sketch module (`src/sketch/`, wrapping the garlic constraint solver). A body stores no shapes — only an ordered feature list replayed through `registerFeature` handlers, so any upstream edit re-evaluates an active body's chain, while a dormant off-tree body catches up when it resumes; the bulk of the module is stable identity for sub-shapes across rebuilds (kernel history → tracked ids → stored `EdgeRef`/`ProfileRef`) and the timeline rules for which shape a reference resolves against.
- **`wasm`** — Concrete `ShapeFactory` → OCCT via Emscripten; exports `initWasm()`
- **`three`** — Three.js viewport, camera controller, visuals, highlighter, gizmo, mesh export
- **`element`** — Custom reactive DOM elements (radio groups, expanders, data converters)
- **`ui`** — App chrome: main window, ribbon, property panels, project tree, dialogs, toast, status bar
- **`app`** — `Application`, body nodes (`bodys/`), command implementations, `CommandService`, `HotkeyService`
- **`ai`** — The in-app assistant: the chat panel, the tools it acts through, the skills it loads on demand, and the capability engine that runs its `run_program` modeling ops; also the `?bridge=<port>` client (`src/bridge/`) that hands the same tool registry to a local process over a WebSocket, driven by the separate `@chili3d/mcp` package
- **`builder`** — `AppBuilder` fluent chain (`.useIndexedDB().useWasmOcc().useParametric().useThree().useUI().build()`), default ribbon layout; `mergeRibbonProfiles` merges module contributions (`SketchRibbonProfiles` from `@chili3d/parametric`, `ParametricRibbonProfiles` from builder's own `ribbon.ts`) into `DefaultRibbon`
- **`i18n`** / **`storage`** / **`web`** — Locale data (en, zh-cn, pt-br) / IndexedDB persistence / entry point (loading screen, `?plugin=`/`?url=`/`?model=` params)

Import via workspace names (`import { ... } from "@chili3d/core"`); one root `tsconfig.json` covers all packages.

## C++ WASM (`cpp/`)

OCCT v8.0.0 → `chili-wasm.wasm` via Emscripten. `cpp/src/`: `factory.cpp` (shape creation; the tracked ops report their whole derivation as flat (out, in) `faceAncestors`/`edgeAncestors` pairs — one relation, not a first-ancestor-only map beside it, so a sub-shape merged from several inputs records each of them whichever operation merged it; the single "first ancestor" index most callers want is derived on the TS side (`primaryAncestors` in `core`)) — except the thicken, whose pairs report the input face as its own descendant AND report the parallel copy off it, so that copy travels through separate `offsetFaceMap`/`offsetEdgeMap` channels instead and the wall it raises has no derivation at all, while a shell's `MakeThickSolidByJoin` DELETES its closing faces and subtracts them from those same channels — a removed face has no parallel copy, and the rim the opening leaves would otherwise come back as one), `shape.cpp` (topology traversal), `converter.cpp` (STEP/IGES/BREP/STL), `mesher.cpp` (B-rep → mesh), `geometry.cpp` (curve/surface queries). The Release build sets `-sDISABLE_EXCEPTION_CATCHING=1`, so any OCCT raise aborts the whole module and C++ try/catch is ineffective — the query files (`shape.cpp`/`mesher.cpp`/`geometry.cpp`) guard degenerate and null-geometry paths preventively (`IsGeometric`/`IsNull`/`IsDone` prechecks; `Edge::curve` reports degenerate edges through a JS-level throw, which still works with catching disabled), and the tracked sweep ops report cap faces through a separate `capFaces` channel on the tracked result (`LastShape()` of the sweep; empty when it coincides with `FirstShape()`, e.g. a 360° revolve), while the draft's `BRepOffsetAPI_DraftAngle` needs two guards of its own for that same reason: `Perform()` — which `Build()` calls with no try/catch — raises while any added face is problematic, so a failed `Add` must return before `Build()` (`AddDone()` reports that state, and it is `ProblematicShape().IsNull()`, NOT `IsDone()`), and a face that is not a sub-shape of the shape must be rejected up front because the algorithm never checks membership and its edge index raises on a foreign face's edges). The batch-3 additions validate every input before ANY `Add`/`Build` for that same reason: `filletVariable(Tracked)` (per-edge `(R1, R2)` pairs — radii flattened two-per-edge — to `BRepFilletAPI_MakeFillet::Add(R1, R2, edge)`, the linear R1→R2 blend along the edge; OCCT builds the blend's boundary curves as B-splines whose end trims sag to (√2−1)·R mid-span, so a TS-side derivation probe must hit the ENDPOINTS, not the mid-curve), `chamferTwoDist(Tracked)` (`Add(d1, d2, edge, face)` with `faces[i]` the reference face of `edges[i]` — the face d1 is measured on), and `sweepMode(Tracked)` (`BRepOffsetAPI_MakePipeShell` with the three SetModes: 0 = `SetMode(true)` Frenet, 1 = corrected Frenet (no `SetMode` call), 2 = fixed binormal `SetMode(gp_Dir)`; the legacy `sweep(Tracked)` delegates with `isFrenet ? 0 : 1`, byte-identical behavior). `offsetFacesTracked` is a per-face `BRepOffset_MakeOffset` (global offset 0, `SetOffsetOnFace` per pick, `GeomAbs_Intersection` joins) whose three refusals each guard something OCCT does NOT report as a failure: a body that is not a solid, one with more than one shell (a sealed void), and one whose smooth chain has a sharp edge inside it (`smoothChains`, normals within 4° — dot > 0.99756 — since OCCT corrupts the wasm heap on such a body whichever face is moved, the floor included; a trap cannot be caught); what it builds is then checked (`offsetIsGood`: `BRepCheck_Analyzer`, the volume's SIGN against a 1e-6 slack — which needs `integrateVolume`'s Gauss-Kronrod/bounded forms, OCCT's fixed order being 1-3 % out on a B-spline body — the moved faces' distance to their images at least 0.999|d| − 1e-3, and `farFacesKept`, the areas and centres of the faces that neither move nor touch a moving one, which catches a valid-but-smaller body built out of a face pushed through), a body with a seam retries through `buildDividedOffset` (divide the closed faces, offset, merge back — the merge must leave the volume alone), and a failure is CLASSIFIED rather than worded: the `offsetReport` channel on the tracked result carries `[status, maxDistance×1000]` (1 too far, 2 nothing works, 3 not a solid, 4 a sealed void, 5 OCCT raised, 6 a sharp-edged smooth chain, 7 the rounds beside a moving face cannot be kept) with the "too far" bound found by a 7-step bisection, because the caller words the message per locale. Status 7 is reported ONLY on a `requireRounds` call, and only when the plain path would have succeeded — a distance or a body the plain path refuses keeps its own status (1/2/6), because that is the actionable answer. Its history is generated-only — nothing is `Modified`, so a moved face derives from the face it was — which is why its TS feature takes the raw `primaryAncestors` instead of `completeTrackedHistory` (that pass drops any claim whose output does not overlap its input, and moving a face away is the whole point). When the caller also hands over the round faces of a fillet it wants KEPT (`keepRounds`), `buildReblendedOffset` runs first and the plain path above is its fallback: the rounds are removed (`BRepAlgoAPI_Defeaturing` extends their neighbours to meet), the moving faces are then found as OCCT finds them but WITHOUT crossing a round — so a face past one stays where it is — and each round is made again at its own radius on the edge between the faces its two sides became, its old face recorded `Modified` into the new ones so it keeps its name. Without that, OCCT offsets a round with the face it runs into and it comes back at a changed radius, dragging the faces past it along (measured: a 40 × 30 × 20 block with two vertical edges rounded 3 mm, the +x face moved 4 mm, gave 7 mm rounds and pushed the front and back out 4 mm). The caller finds those rounds by NAME (`:f` on every leaf of an id `edgeCorner.ts` minted) and the kernel tells a round from a chamfer's flat `:f` faces by surface type. Output: `packages/wasm/lib/chili-wasm.{wasm,js,d.ts}`. C++ style: WebKit (clang-format); license LGPL-3.0 (TS is AGPL-3.0).

## Key Patterns

- **Interface-driven** — `core` defines interfaces; feature packages implement; `AppBuilder` wires at startup.
- **Result pattern** — Fallible ops return `Result.ok(value)` / `Result.err(error)` (`core/src/foundation/result.ts`); never throw for expected failures.
- **Reactive data** — `Observable` uses `getPrivateValue(key)` / `setPrivateValue(key, value)`; setting emits `emitPropertyChanged`. `ObservableCollection` powers property editor and project tree.
- **Serialization** — `@serializable()` on classes, `@serialize()` on fields → `{ __cla$$__: "ClassName", ...props }`. Bump `package.json`'s `documentVersion` in the same change whenever the persisted shape moves: `Document.load` compares it for equality and refuses anything else (no migration, by design), so an unbumped schema change would let old files load into code that no longer understands them. `version` is the release number and moves on its own (`scripts/release.mjs`); only `documentVersion` gates documents.
- **Body nodes** — `app/src/bodys/`; extend `ParameterShapeNode`, implement `generateShape(): Result<IShape>`, `setPropertyEmitShapeChanged()` triggers re-evaluation.
- **Commands** — `ICommand.execute(application): Promise<void>`; `CancelableCommand` adds `cancel()`, `AsyncController`, dispose stack.
- **Undo/redo** — `Transaction` records snapshots, `History` keeps the stack; commands create transactions automatically.
- **Plugins** — Loaded from URLs or `?plugin=`; manager in `core/src/plugin/` + `app/src/pluginManager.ts`; examples in `plugins/`.
- **Global singleton** — `getCurrentApplication()` (from `core`) instead of DI threading.
- **AI ops** — the assistant's `run_program` ops are applied in one `Transaction` and land as `EditableShapeNode`s: a shape, never a body feature (`BoxNode`, `TextNode`, …). Features come from commands and the document, not from an op. Units: millimetres; angles: degrees.

## Testing

- Scenario runs — `npm run test:scenarios` drives the real app in headless Chrome from
`packages/parametric/test/scenarios/*.json`, waiting on the app's own settle signal
(`pendingWork`) instead of on timers. It needs `npm run dev` up. See that directory's
README for the step vocabulary before writing one; a command that opens a dialog never
settles until the dialog is answered.

Rstest (not Jest/Vitest) + Happy-DOM; root `rstest.config.ts`, globals enabled (`describe`, `test`, `expect`); tests in `packages/*/test/`; legacy decorators enabled.
- Reuse shared mocks from `@chili3d/core/test-utils` (`TestDocument`, `createMockDocument`, `createMockApplication`, `createMockVisual`, ...) instead of per-package copies; package-specific facades (e.g. `packages/ui/test/_helpers/`) extend them. `initializeI18n()` runs automatically via rstest `setupFiles` — never call it in test files.
- Assertions must execute: none hidden in event callbacks (unless the callback is also asserted to fire), no tautologies (`x === true || x === false`), no `if (x) expect(...)` — assert the precondition, then the behavior; `await` every promise whose `.then` asserts.
- Assert behavior, not absence of crashes: bare `not.toThrow()` / `toBeDefined()` is a smell; `querySelector` results need `not.toBeNull()`.
- Restore global monkeypatches (`PubSub.default.pub`, `globalThis.fetch`, ...) in `finally`/`afterEach`, or use `rs.stubGlobal` + `rs.unstubAllGlobals()`.
- Type `rs.fn` mocks with the real signature (`rs.fn((_edges: IEdge[]) => ...)`) so `mock.calls` typechecks; use `test.each` for near-identical repeated cases.

## Code Style

- Biome: 4-space indent, 110-col width, double quotes, semicolons always
- `I`-prefixed behavioral interfaces — plain data-carrier shapes stay unprefixed (`...Data`, `...Ref`, `...Options`, e.g. `SketchData`, `EdgeRef`); `camelCase` functions/variables/files; `PascalCase` classes; `UPPER_SNAKE_CASE` constants
- Functions stay under ~30 lines unless there is a reason (a flat recipe often reads worse in pieces). Cut out the part that does something whole — a per-case translation, a per-item build — rather than by line count.
- CSS Modules (`*.module.css`); type-only imports (`import type { IFoo }`)
- Every TS file starts with the AGPL-3.0 header:

```ts
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.
```

## Git

Commits: `<emoji> <type>(<scope>): <description>` — ✨ `feat` · 🐛 `fix` · ♻️ `refactor` · ✅ `test` · 📝 `docs` · 💄 `style` · 🔧 `chore`. Scope = package name. Active branch: `dev` → PR to `main`.
