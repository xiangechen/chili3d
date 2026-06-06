# Chili3D coding guidelines

This document provides coding guidelines and build instructions for agentic coding agents working in the Chili3D codebase.

## Build & Test

```bash
npm run dev            # Rspack dev server → localhost:8080
npm run build          # Production build (Rspack + SWC)
npm run test           # Run all tests (Rstest + Happy-DOM)
npm run testc          # Tests with coverage
npm run check          # Biome lint + auto-fix (run before commits)
npm run format         # Biome + clang-format across all files
npm run build:wasm     # Build C++ → WebAssembly (CMake + Emscripten)
npm run setup:wasm     # One-time: download OCCT + Emscripten

# Single test file or filter
npx rstest packages/core/test/result.test.ts
npx rstest -t "should handle error case"
```

## Monorepo Structure

Chili3D is a browser-based parametric 3D CAD app — an OCCT C++ kernel compiled to WebAssembly, rendered with Three.js. The TS side is an npm workspace monorepo under `packages/`:

```
web ──> builder ──> app ──> core
                  ──> i18n ──> core
                  ──> three ──> core
                  ──> ui ──> core + element
                  ──> wasm ──> core
```

- **`core`** — Everything abstract: shape interfaces (`IShape`, `IShapeFactory`), math (`XYZ`, `Matrix4`, `Plane`), document model, reactive data (`Observable`, `Binding`, `PubSub`), `Result<T,E>`, transactions/undo, commands, serialization, plugin system, service container, UI abstractions
- **`wasm`** — Concrete `ShapeFactory` calling into OCCT via Emscripten bindings. Exports `initWasm()`.
- **`three`** — Three.js viewport (`ThreeView`), camera controller, visual objects, highlighter, outline pass, gizmo, mesh export
- **`element`** — Custom reactive DOM elements (radio groups, expanders, data converters)
- **`ui`** — Application chrome: main window, ribbon/toolbar, property panels, project tree, dialogs, toast, status bar
- **`app`** — Concrete `Application`, body node classes (box, sphere, cylinder, extrude, revolve, sweep, loft, boolean, etc.), command implementations (`create/`, `modify/`, `measure/`, `application/`), `CommandService`, `HotkeyService`
- **`builder`** — `AppBuilder` with fluent `.useIndexedDB().useWasmOcc().useThree().useUI().build()` chain. Default ribbon layout.
- **`i18n`** — Locale data (`en`, `zh-cn`, `pt-br`)
- **`storage`** — IndexedDB persistence
- **`web`** — Entry point: calls `AppBuilder`, shows loading screen, parses `?plugin=` / `?url=` / `?model=` URL params

Imports use workspace package names: `import { ... } from "@chili3d/core"`. One root `tsconfig.json` covers all packages (no per-package configs).

## C++ WASM (`cpp/`)

OCCT v8.0.0 compiled to `chili-wasm.wasm` via Emscripten. Sources in `cpp/src/`:

- `factory.cpp` — shape creation (box, sphere, extrude, revolve, boolean, fillet, chamfer, loft, sweep, pipe)
- `shape.cpp` — topology traversal, sub-shape queries
- `converter.cpp` — STEP/IGES/BREP/STL import/export
- `mesher.cpp` — B-rep tessellation → mesh for Three.js
- `geometry.cpp` — curve/surface geometry queries

Build output: `packages/wasm/lib/chili-wasm.{wasm,js,d.ts}`. C++ style is WebKit (clang-format). C++ license is LGPL-3.0 (TS is AGPL-3.0).

## Key Patterns

### Interface-driven with pluggable backends

`core` defines interfaces; feature packages implement them. `AppBuilder` wires them at startup.

### Result pattern

Fallible operations return `Result<T, E>` (from `core/src/foundation/result.ts`) — `Result.ok(value)` or `Result.err(error)`. Never throw for expected failures.

### Reactive data

Custom observables in `core/src/foundation/`. `Observable` base class uses `getPrivateValue<K>(key)` / `setPrivateValue<K>(key, value)` — setting triggers `emitPropertyChanged`. `ObservableCollection` powers the property editor and project tree.

### Serialization

`@serializable()` decorator on classes, `@serialize()` on fields. Serializes to `{ __cla$$__: "ClassName", ...props }`.

### Body nodes

Live in `packages/app/src/bodys/`. Each extends `ParameterShapeNode`, implements `generateShape(): Result<IShape>`, uses `setPropertyEmitShapeChanged()` to trigger re-evaluation when parameters change.

### Commands

`ICommand` with `execute(application): Promise<void>`. `CancelableCommand` base class adds `cancel()`, `AsyncController`, and a dispose stack.

### Undo/redo

`Transaction` records state snapshots; `History` maintains the stack. Commands create transactions automatically.

### Plugins

Loaded at runtime from URLs or `?plugin=` query param. Plugin manager in `core/src/plugin/` and `app/src/pluginManager.ts`. Example plugins in `plugins/`.

### Global singleton

`getCurrentApplication()` from `core` returns the global `IApplication` — widely accessed instead of DI threading.

### MCP server (`packages/mcp/`)

Wraps the geometry engine for AI-driven CAD. Two tool families:

- **LIVE** (`live_*`) — drives the user's open browser tab. Use when the user wants to see results.
- **HEADLESS** (`run_cad_program`, `get_properties`, `render_preview`, etc.) — server-side scratchpad for drafting and self-verification before pushing to live view.

All units are millimetres, angles are degrees.

## Testing

- Rstest (not Jest/Vitest) + Happy-DOM
- `rstest.config.ts` at root, globals enabled (`describe`, `test`, `expect`)
- Tests in `packages/*/test/`, co-located with source
- `TestDocument` helper in `packages/core/src/test-utils`
- Legacy decorator support enabled

## Code Style

- Biome for lint + format: 4-space indent, 110-char line width, double quotes, semicolons always
- Interfaces prefixed with `I` (`IShape`, `ICommand`)
- `camelCase` functions/variables, `PascalCase` classes, `UPPER_SNAKE_CASE` constants
- Files: `camelCase.ts`
- CSS Modules for component styles (`*.module.css`)
- Type-only imports: `import type { IFoo } from "..."`
- Every TS file starts with the AGPL-3.0 header:

```ts
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.
```

## Git

Commits use `<emoji> <type>(<scope>): <description>`:
- ✨ `feat`  ·  🐛 `fix`  ·  ♻️ `refactor`  ·  ✅ `test`  ·  📝 `docs`  ·  💄 `style`  ·  🔧 `chore`

Scope = package name. Active branch: `dev` → PR to `main`.
