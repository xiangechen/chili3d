// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Skill } from "./types";

export const modelingRecipes: Skill = {
    name: "modeling-recipes",
    description:
        "Proven op compositions for common parts and edits: flange/bracket patterns, fillet & chamfer workflow, hole patterns, compounds",
    content: `Modeling recipes (units: mm, angles: degrees). Compose these in ONE run_program when possible.

General loop:
1. Plan exact dimensions first (footprint, heights, hole positions as coordinates).
2. Chain ops with ids in a single run_program; later ops reference earlier ids.
3. Edit-style ops (booleanCut/booleanFuse/booleanCommon, fillet, chamfer, pushPull, makeThickSolid*, removeFeature/removeFillet/removeSubShape/replaceSubShapes, simplifyShape, fillet2d/chamfer2d) CONSUME their input nodes and create a replacement node — afterwards reference the NEW op id, the old node is gone. Creation ops (box, cylinder, prism, revolve, sweep, loft, sewing, combine, transformedMul, ...) keep their inputs in the scene — hide or delete the ones that were only scaffolding (a tool solid cut away by a later boolean), and leave the parts the user asked for in the scene.
4. Default to separate parts: a model of several parts is several nodes. Do NOT booleanFuse unrelated bodies just to end up with fewer nodes. fuse only when the parts really are one solid (a boss fused onto its plate); to group parts without merging them, use combine([...]).
   Grouping in the MODEL TREE is a different thing from combining geometry: create_folder (pass the part ids as nodeIds) puts nodes under one collapsible folder and changes no shape, and move_nodes re-parents them later or sends them back to the root. Reach for a folder to keep a multi-part result tidy for the user; reach for combine only when the parts must become one compound shape.

Fillet / chamfer workflow:
- { method: "shape.findSubShapes", target: "body", id: "e", args: { subshapeType: "edge" } } -> results.e = { count, refs }.
- Identify the edges you want by geometry: query edge.ends (or edge.length, edge.curve) on candidates like e#0, e#1 — e.g. vertical edges have equal x/y at both ends; top edges have max z.
- { method: "fillet", id: "f1", args: { shape: "body", edges: [<indices>], radius: 2 } } — the number in an edge ref e#3 IS the index for "edges". fillet consumes "body"; the result is the new node f1. Too-large radius fails — keep radius below half the smallest adjacent face dimension.

Flange (base plate + boss + bolt circle):
1. base: box(plane at corner, dx, dy, dz) id "base".
2. boss: cylinder(normal +Z, center at plate center on top face, radius r, dz h) id "boss".
3. body: booleanFuse(["base"], ["boss"], true) id "body" — consumes both: plate and boss really are one solid, so fusing is right here.
4. one hole tool: cylinder at first bolt position, radius holeR, dz = plate+boss height + margin, id "h0".
5. copies: transformedMul rotate around the flange axis (axis {0,0,1} through the center) by 90/180/270 degrees, ids "h1".."h3" — transformedMul does NOT consume h0.
6. cut: booleanCut(["body"], ["h0","h1","h2","h3"]) id "flange" — one op cuts all holes and consumes the tools.

Patterns / arrays:
- Linear: transformedMul with translate = i * spacing per copy. Circular: transformedMul with rotate around the pattern axis. Create copies first, then one boolean op with all of them in shape2.

Placement reminders (details in the modeling-api skill):
- box/rect/pyramid: plane.origin is a CORNER. Center a box at P: origin = P - (dx/2, dy/2, dz/2).
- cylinder/cone: center is the BASE-face center, extends +dz along normal.

Compounds:
- combine([...]) groups shapes into one compound node without fusing them; shape.volume and shape.boundingBox work on compounds (volume sums the solids inside). Fusing disjoint solids is not a recipe — it yields a compound of loose solids anyway.

Verify: after the build, select_nodes the result, fit_content, capture_screenshot — check proportions, and check that no scaffolding node is left behind (hide or delete those). The parts the user asked for stay in the scene as nodes of their own.`,
};
