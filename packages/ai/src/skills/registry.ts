// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { queryApiDoc } from "../tools/capabilities.generated";

export interface Skill {
    name: string;
    description: string;
    content: string;
}

const shapeQuery: Skill = {
    name: "shape-query",
    description:
        "Query and measure shapes, curves and surfaces: length/area/volume, bounding boxes, distances, parameter evaluation, sub-shape refs",
    content: queryApiDoc,
};

const modelingRecipes: Skill = {
    name: "modeling-recipes",
    description:
        "Proven op compositions for common parts and edits: flange/bracket patterns, fillet & chamfer workflow, hole patterns, compounds",
    content: `Modeling recipes (units: mm, angles: degrees). Compose these in ONE run_program when possible.

General loop:
1. Plan exact dimensions first (footprint, heights, hole positions as coordinates).
2. Chain ops with ids in a single run_program; later ops reference earlier ids.
3. Edit-style ops (booleanCut/booleanFuse/booleanCommon, fillet, chamfer, pushPull, makeThickSolid*, removeFeature/removeFillet/removeSubShape/replaceSubShapes, simplifyShape, fillet2d/chamfer2d) CONSUME their input nodes and create a replacement node — afterwards reference the NEW op id, the old node is gone. Creation ops (box, cylinder, prism, revolve, sweep, loft, sewing, combine, transformedMul, ...) keep their inputs in the scene — delete or hide leftover tool nodes when they are not meant to stay visible, or prefer edit-style booleans which clean up for you.

Fillet / chamfer workflow:
- { method: "shape.findSubShapes", target: "body", id: "e", args: { subshapeType: "edge" } } -> results.e = { count, refs }.
- Identify the edges you want by geometry: query edge.ends (or edge.length, edge.curve) on candidates like e#0, e#1 — e.g. vertical edges have equal x/y at both ends; top edges have max z.
- { method: "fillet", id: "f1", args: { shape: "body", edges: [<indices>], radius: 2 } } — the number in an edge ref e#3 IS the index for "edges". fillet consumes "body"; the result is the new node f1. Too-large radius fails — keep radius below half the smallest adjacent face dimension.

Flange (base plate + boss + bolt circle):
1. base: box(plane at corner, dx, dy, dz) id "base".
2. boss: cylinder(normal +Z, center at plate center on top face, radius r, dz h) id "boss".
3. body: booleanFuse(["base"], ["boss"], true) id "body" — consumes both, one solid.
4. one hole tool: cylinder at first bolt position, radius holeR, dz = plate+boss height + margin, id "h0".
5. copies: transformedMul rotate around the flange axis (axis {0,0,1} through the center) by 90/180/270 degrees, ids "h1".."h3" — transformedMul does NOT consume h0.
6. cut: booleanCut(["body"], ["h0","h1","h2","h3"]) id "flange" — one op cuts all holes and consumes the tools.

Patterns / arrays:
- Linear: transformedMul with translate = i * spacing per copy. Circular: transformedMul with rotate around the pattern axis. Create copies first, then one boolean op with all of them in shape2.

Placement reminders (details in the capability list):
- box/rect/pyramid: plane.origin is a CORNER. Center a box at P: origin = P - (dx/2, dy/2, dz/2).
- cylinder/cone: center is the BASE-face center, extends +dz along normal.

Compounds:
- combine([...]) groups shapes into one compound node without fusing; booleanFuse of disjoint solids is NOT a recipe — fuse touching solids only. shape.volume and shape.boundingBox work on compounds (volume sums the solids inside).

Verify: after the build, select_nodes the result, fit_content, capture_screenshot — check proportions and that no leftover tool nodes remain; hide or delete strays.`,
};

const errorRecovery: Skill = {
    name: "error-recovery",
    description:
        "What common run_program / tool errors mean and how to fix them: failed booleans, bad fillet radius, stale refs, wrong ref kinds, missed clicks",
    content: `Error recovery. Strategy: read the message, fix the cause, re-run ONLY the failed ops — refs persist across run_program calls, so retries are cheap. Load shape-query for the full query reference when a query fails.

"unknown method "x"" — the method is not in the modeling catalog. Query methods (owner.name like face.area) are listed in the shape-query skill; modeling methods in the system prompt's capability list. Check spelling and casing.

"must be a finite number" / "must be one of a|b|c" / "must be { x, y, z }" — argument encoding wrong. Re-check the JSON encoding section: XYZ={x,y,z}, Line={point,direction} (NOT {start,end}), Plane={origin, normal?, xvec?}, enum params list values inline.

"The radius is too small." / fillet or chamfer fails — radius/distance too large for the adjacent faces, or edges unsuitable. Query edge.length / face.area around the target and lower the value; typical cause is a radius larger than half the shortest adjacent edge.

"The edges is empty." — fillet/chamfer needs edge indices: run shape.findSubShapes(target, edge) first and pick indices (ref e#3 -> index 3) by edge.ends geometry.

"ref "x" is no longer valid: its source node was removed" — the node behind the ref was consumed by an edit-style op or deleted. Use the id of the op that replaced it, or re-run the query that produced the ref against the new node.

"node not found: <id>" (delete_node / set_node_visible / transform_node) — the node is gone, most likely consumed by an edit-style op: run_program's response "removed" lists those nodes. Do NOT retry or hide consumed nodes; call get_document_state if you need the current node list.

'Unknown ref "x"' — the id was never registered: no successfully-run op defined it (ops run in order, so an op cannot reference an id defined later in the same program), or you guessed it from a numbering pattern. The error lists the currently available refs — run the op that defines x first (or fix the op order), then re-run only the failed ops.

'Ref "x" was defined but its query returned null' — the defining op ran but produced no geometry (e.g. an empty intersection). x is unusable; pick another ref from the available list or re-run the defining query on a different target.

"ref "x" is no longer valid: its source shape changed" — a sub-shape index no longer exists after the source was edited. Re-run shape.findSubShapes (or the original query) on the current shape and re-pick indices.

"requires a <kind> target, got a <other> ref" / "requires a <type> curve" — wrong ref kind or sub-shape type. Curve queries accept edge refs and surface queries accept face refs directly (auto-derived), and type-specific curve members unwrap trimmedCurve→basisCurve for you — so this means the target is neither (e.g. a solid or wire), or the edge's underlying curve is a different type. Inspect with shape.shapeType / trimmedCurve.basisCurve + curve.curveType and pass the right ref. Mutation queries (curve.reverse, trimmedCurve.setTrim) are the exception: they need an explicit edge.curve ref.

Boolean op fails (booleanCut/booleanFuse/booleanCommon) — almost always the shapes do not overlap as expected. Check with shape.boundingBox on both, or shape.extremaDistance; fix placement (corner vs base-center vs true-center rules) and retry.

"To face failed" (wire.toFace / prism on a polygon wire) — the wire is not usable as a profile: polygon points must ALL lie on one plane and number at least 3 (fewer points or scattered 3D points produce an open/non-planar wire). Re-issue the corners on a single plane in perimeter order, repeating the first point as the last so the wire is closed.

prism/revolve on a polygon wire returns a shell or breaks downstream booleans — the wire was not closed. Re-run polygon with the first point repeated as the last point, then extrude again.

click_view "hits": [] — nothing of that shapeType at the pixel. Retake capture_screenshot (the view may have moved), nudge coordinates toward the target's center, and prefer shapeType face over edge — edges are only a few pixels wide. If several attempts miss, fall back to findSubShapes + geometry, or ask the user via pick_shapes.

pick_shapes returns { cancelled: true } — the user dismissed the picker. Do not retry blindly; continue without the pick or ask the user what to do.

Query returns null (e.g. curve.parameter, surface.parameter, face.intersectLine) — the point/line does not map onto the geometry; it is a valid answer, not an error.`,
};

export const SKILLS: Skill[] = [shapeQuery, modelingRecipes, errorRecovery];
