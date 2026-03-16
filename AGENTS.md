# Chili3D Agent Guidelines

This document provides coding guidelines and build instructions for agentic coding agents working in the Chili3D codebase.

## Project Overview

Chili3D is a 3D CAD/WebGL application framework with WebAssembly integration. It's a TypeScript monorepo with 10 packages and a C++ WebAssembly module built with OpenCascade.

- **Tech Stack**: TypeScript, Rspack, Biome, Rstest, C++/Emscripten, Three.js
- **Architecture**: Modular monorepo with package-based organization

## Build Commands

```bash
# Development
npm run dev          # Start development server with Rspack
npm run build        # Production build
npm run preview      # Preview production build

# WebAssembly (C++)
npm run build:wasm   # Build C++ WASM module with CMake
npm run setup:wasm   # Setup WASM dependencies

# Code Quality
npm run check        # Biome linting and auto-fix (run before commits!)
npm run format       # Format all code (Biome + clang-format)

# Testing
npm run test         # Run all tests with Rstest
npm run testc        # Run tests with coverage
npx rstest path/to/file.test.ts       # Run single test file
npx rstest -t "test name"             # Run tests matching pattern
npx rstest packages/core/test/        # Run all tests in directory
```

## Code Style Guidelines

### TypeScript/JavaScript

**Biome Configuration** (biome.json):
- Indentation: 4 spaces
- Line width: 110 characters
- Quotes: Double quotes
- Semicolons: Required
- CSS Modules: Enabled

**Import Conventions**:
```typescript
// Internal packages - use package names, not relative paths
import { AppBuilder } from "@chili3d/builder";
import { type IApplication, Logger } from "@chili3d/core";

// Type-only imports
import type { ICommand } from "./command";

// External packages
import * as THREE from "three";
```

**File Headers** (required):
```typescript
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.
```

**Naming Conventions**:
- Interfaces: `IName` (e.g., `IApplication`)
- Classes: `PascalCase` (e.g., `Application`)
- Functions/Variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Files: `kebab-case.ts` or `kebab-case.test.ts`

**Error Handling**:
- Use `Result<T>` pattern for operations that can fail
- Prefer async/await over promises
- Avoid `any` type (Biome warns)

### C++ (WebAssembly)

- Style: WebKit with clang-format
- Standard: C++17
- License header: LGPL-3.0 (different from TypeScript)

```cpp
// Part of the Chili3d Project, under the LGPL-3.0 License.
// See LICENSE-chili-wasm.text file in the project root for full license information.
```

## Testing Guidelines

**Framework**: Rstest with Happy-DOM

**Test Structure**:
```typescript
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, test, expect } from "@rstest/core";
import { TestDocument } from "../src/test-utils";

describe("FeatureName", () => {
    test("should do something", () => {
        const doc = new TestDocument();
        const result = someFunction();
        expect(result).toEqual(expectedValue);
    });
});
```

## Package Architecture

| Directory | Package Name |
|-----------|--------------|
| `app` | `@chili3d/app` |
| `builder` | `@chili3d/builder` |
| `core` | `@chili3d/core` |
| `element` | `@chili3d/element` |
| `i18n` | `@chili3d/i18n` |
| `storage` | `@chili3d/storage` |
| `three` | `@chili3d/three` |
| `ui` | `@chili3d/ui` |
| `wasm` | `@chili3d/wasm` |
| `web` | `@chili3d/web` |

**Module Resolution**: Use package names for internal imports, not relative paths.

## Git Commit Guidelines

Format: `<type>(<scope>): <description>`

**Types** (with emoji):
- ✨ `feat`: New feature
- 🐛 `fix`: Bug fix
- 📝 `docs`: Documentation
- 💄 `style`: Code style (formatting, semicolons)
- ♻️ `refactor`: Code refactoring
- ✅ `test`: Add/update tests
- 🔧 `chore`: Build, deps, maintenance

**Scope**: Package name (e.g., core, three, ui, wasm)

Examples:
```
✨ feat(core): add observable collection for reactive data binding
🐛 fix(three): resolve texture loading error in WebGL renderer
✅ test(core): add unit tests for result pattern error handling
📝 docs(readme): update installation instructions
♻️ refactor(ui): extract button component
🔧 chore(deps): upgrade typescript to 5.9.3
```

## Development Workflow

1. Run `npm run check` before committing
2. Run `npm run test` before pushing
3. Run `npm run build:wasm` after C++ modifications
4. Use `npm run format` for comprehensive formatting

## Important Notes

- **Biome**: Handles linting and formatting (no separate tools needed)
- **Rstest**: Testing framework (not Jest/Vitest)
- **Rspack**: Build tool (not Webpack)
- **C++ license**: LGPL-3.0 (TypeScript is AGPL-3.0)
- **CSS**: Use CSS Modules for component styles

## Common Patterns

- **Result Pattern**: Return `Result<T>` instead of throwing exceptions
- **ObservableCollection**: For reactive collections
- **ICommand**: For user actions
- **Factory**: For creating shapes and visuals
- **Dependency Injection**: Use service container
