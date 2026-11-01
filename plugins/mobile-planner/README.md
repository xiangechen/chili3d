# Mobile Crane Lift Planner — 3D Boom Clearance Engine

> **Planning aid, not a certified lift plan.** This exact disclaimer must appear in the UI and on every report.

**Owner:** Abhishek (Mobile Crane Lift Planner Team: Rushikesh, Ajit, Sujal, Abhishek)  
**Milestone:** Task M5 (Distance Dry Run — Check-in 1: Wed 28 Oct 2026)

---

## 1. Overview

This module provides 3D CAD clearance calculations between mobile crane components (boom, hook, load) and site obstacles (buildings, structures, power lines).

It queries the OpenCASCADE C++ WebAssembly kernel (`BRepExtrema_DistShapeShape` via Chili3D's `IShape.extremaDistance` and `IShapeFactory.booleanCommon`) to compute the exact minimum Euclidean distance between solids and detect volume penetration (collisions).

All public interface calculations and coordinates are in **metres (m)**, with conversion to/from OpenCASCADE kernel units (**millimetres**, ×1000) handled at the module boundary.

---

## 2. API Usage for Teammates

### Calling it from a plugin

Inside the running app, use the application's own shape factory. Do **not** create a `ShapeFactory` from
`@chili3d/wasm` in plugin code: the app has already initialised the kernel, and a plugin must not bundle a
second copy of it.

```typescript
// from any file under plugins/mobile-planner/src/ (e.g. the M6 boom/load check)
import { getCurrentApplication } from "@chili3d/core";
import { computeClearanceDistance, createBoomCylinder, createBuildingBox } from "./clearance/distance";

const factory = getCurrentApplication().shapeProvider.factory;

// Building solid (origin and size in metres). Illustrative numbers, not site data.
const buildingSolid = createBuildingBox(factory, { x: 0, y: 0, z: 0 }, { dx: 40, dy: 22, dz: 75 });

// Boom solid (base centre, radius, length in metres, optional direction). Illustrative numbers.
const boomSolid = createBoomCylinder(factory, { x: 42.5, y: 10, z: 0 }, 0.4, 35);

const result = computeClearanceDistance(buildingSolid, boomSolid, factory);
console.log(result.distanceM, result.isCollision, result.isTouching);
```

`factory` is **required**. A minimum distance of 0 means "touching *or* overlapping"; the factory is what
tells them apart (`booleanCommon` volume). If that boolean test fails or throws, the result is reported as a
**collision**, never as "touching", so a planning aid cannot under-report a clash.

In unit tests there is no running app, so tests create `new ShapeFactory()` from `@chili3d/wasm` after
`initWasm()` (see `test/setup.ts`).

### Return Type (`ClearanceResult`)

| Property | Type | Description |
|---|---|---|
| `distanceM` | `number` | Minimum surface-to-surface distance in metres |
| `distanceMm` | `number` | Minimum distance in kernel millimetres |
| `isCollision` | `boolean` | `true` if solids penetrate/overlap each other |
| `isTouching` | `boolean` | `true` if solids touch tangentially (0 gap) without volume penetration |

### Errors and fail-safe behaviour

| Situation | Result |
|---|---|
| Solids are apart (gap greater than the kernel tolerance) | `distanceM > 0`, `isCollision = false`, `isTouching = false` |
| Gap is 0 and the shared volume is tiny (at most 1 mm³, numerical noise) | `isTouching = true` |
| Gap is 0 and the shared volume is larger than 1 mm³ | `isCollision = true` |
| Gap is 0 and the overlap test (`booleanCommon`) fails or throws | `isCollision = true` (fail safe, never "touching") |
| Gap is 0 and `booleanCommon` returns an empty shape (no shared volume) | `isTouching = true` |
| `extremaDistance` returns a negative value (empty or invalid shape) | `Error` is thrown. Catch it and show "distance unavailable". Never treat it as 0 or as safe. |
| `createBuildingBox` / `createBoomCylinder` cannot build the solid | `Error` is thrown with the kernel message |

---

## 3. Verified Acceptance Test Cases (Task M5)

8 automated tests pass against OpenCASCADE with hand-worked verification: a units check, the 4 backlog dry-run cases (1 to 4), 2 safety cases (5 and 6) and 1 inclined boom case (7):

1. **2.0 m separation:** Box $[0, 10]\,\text{m}$, Cylinder center $X = 12.5\,\text{m}$, $R = 0.5\,\text{m}$.  
   Nearest surface = $12.5 - 0.5 = 12.0\,\text{m}$. Distance $= 12.0 - 10.0 = \mathbf{2.00\,\text{m}}$ ($\pm 0.1\,\text{m}$).
2. **0.5 m separation:** Box $[0, 10]\,\text{m}$, Cylinder center $X = 11.0\,\text{m}$, $R = 0.5\,\text{m}$.  
   Nearest surface = $11.0 - 0.5 = 10.5\,\text{m}$. Distance $= 10.5 - 10.0 = \mathbf{0.50\,\text{m}}$ ($\pm 0.1\,\text{m}$).
3. **0.0 m (Touching):** Box $[0, 10]\,\text{m}$, Cylinder center $X = 10.5\,\text{m}$, $R = 0.5\,\text{m}$.  
   Nearest surface $= 10.0\,\text{m}$. Distance $= \mathbf{0.00\,\text{m}}$, `isTouching = true`, `isCollision = false`.
4. **Overlap (Collision):** Box $[0, 10]\,\text{m}$, Cylinder center $X = 10.0\,\text{m}$, $R = 0.5\,\text{m}$.  
   Cylinder penetrates $0.5\,\text{m}$ into the box volume. Distance $= 0.00\,\text{m}$, `isCollision = true`.

5. **Boom fully inside the building:** Cylinder $R = 0.5\,\text{m}$ at $(5, 5)$ lies wholly within Box $[0, 10]\,\text{m}$.
   Distance $= 0$, shared volume $= \pi \cdot 0.5^2 \cdot 15 = 11.78\,\text{m}^3$, so `isCollision = true`.
6. **Overlap test unavailable (fail safe):** if `booleanCommon` throws, a zero distance is reported as
   `isCollision = true`, never as `isTouching`.
7. **Inclined boom (45 degrees):** Box $10 \times 10 \times 20\,\text{m}$ at the origin, cylinder $R = 0.5\,\text{m}$, base centre $(12.5, 5, 5)\,\text{m}$,
   axis tilted 45 degrees from vertical, away from the building. The nearest rim point of the tilted base disc is at
   $x = 12.5 - 0.5\cos 45^\circ = 12.146\,\text{m}$. Distance $= 12.146 - 10 = \mathbf{2.146\,\text{m}}$.

---

## 4. Running Tests

```bash
npx rstest plugins/mobile-planner/test/clearance.test.ts
```
# Mobile Crane Planner

This plugin ports the Cycle 3 mobile-crane KIT and exact load-chart lookup.
Calculations use metres; conversion to Chili3D millimetres is intentionally not
part of M1.

> Planning aid, not a certified lift plan.

The M1 chart values have been verified against the official Grove GMK5250L-1
load-chart PDF, page 17. See [SOURCES.md](SOURCES.md) for the complete source
record and the traceable page-17 transcription.
