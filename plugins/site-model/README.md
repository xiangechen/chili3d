# Site Model Plugin (`@chili3d/site-model`)

Shared site planning foundation for DGOC Crane Planner (Cycle 4).  
Lead: Ajit Kolhatkar. Reviewed by Tower & Mobile planner teams.

> **"Planning aid, not a certified lift plan."**

---

## Capabilities (Check-in 1: S1–S4)

1. **S1 — DXF Parser & Dynamic Boundary Chaining**:
   - Parses AutoCAD DXF files (ASCII R12–2000+) using `dxf-parser`.
   - Reassembles `SITE_BOUNDARY` segments (`LINE` and `ARC`) by chaining endpoints dynamically into a closed polyline loop without any hardcoded coordinates.
   - Supports both counter-clockwise (CCW) and clockwise (CW) arc traversal, splicing sampled arc vertices seamlessly.
   - Calculates the exact enclosed site area using the Shoelace formula on the real chained polygon.
   - Verifies translation-invariance (a +100 m shift of DXF text coordinates preserves area and relocates the boundary).
   - Dynamically parses proposed buildings, temporary works, neighbour properties, supply zones, road corridors, power lines, and no-go zones from their respective layers and annotation text.

2. **S2 — Unit Conversion at Scene Boundary**:
   - Internal site data and JSON schema are strictly in **metres ($m$)**.
   - Chili3D / OpenCascade CAD scene boundary converts to **millimetres ($mm$)** ($40\text{ m} \leftrightarrow 40,000\text{ mm}$).
   - `metresToMm()` and `mmToMetres()` helpers enforce single-sourced unit transforms.

3. **S3 — 3D Building Extrusion**:
   - 2D footprint polygons are extruded along the Z-axis into 3D solid B-Rep shapes via the OpenCascade WebAssembly kernel.
   - Tested volume for Tower A ($40\text{ m} \times 22\text{ m} \times 75\text{ m} = 66,000\text{ m}^3$).

4. **S4 — Project JSON Schema v1**:
   - Standardized format (`SiteProject`) shared across both Tower Crane Planner and Mobile Crane Planner.
   - Full save/load round-trip validation.
   - Rejects invalid data and enforces the mandatory planning-aid disclaimer.

---

## Boundary Parser Specification & Known Limitations

The parser is designed for construction site layout drawings with the following specifications and current conventions:

| Entity / Feature | Implementation Status | Notes & Workarounds |
|:---|:---:|:---|
| **Boundary Lines (`LINE`)** | Supported | Chained endpoint-to-endpoint with $1\mu\text{m}$ tolerance (`1e-6`). |
| **Corner Fillet (`ARC`)** | Supported (CCW & CW) | Spliced at the matching endpoint. Both traversal directions handled. |
| **Loop Closure** | Enforced | Throws `Error("Boundary loop does not close: endpoints do not meet.")` if any segment is disconnected or endpoints do not rejoin. |
| **Boundary as `LWPOLYLINE`** | Deferred to v2 | Drawings should author site boundary as chained `LINE` and `ARC` entities (or explode polylines before export). |
| **Multiple Boundary Arcs** | Partial | Current sample site uses 1 corner fillet arc (R10 NE). Sites with multiple arcs should ensure continuous endpoint alignment. |
| **Building Labels & Heights** | Dynamic | Paired from the `ANNOTATION` `TEXT` entity following each `LWPOLYLINE`. Heights are parsed from label strings (e.g., `"TOWER A G+24 75.0 m"` $\to 75\text{ m}$) or overridden via options. |

---

## Build & Test

```bash
# Run acceptance test suite
npx rstest plugins/site-model/test/siteModel.test.ts

# Run production build
npm run build

# Preview plugin in local dev server (port 8686)
npm run preview
```

