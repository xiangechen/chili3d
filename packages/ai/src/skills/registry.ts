// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AppGuideStore } from "@chili3d/core";
import { queryApiDoc } from "../tools/capabilities.generated";
import { appGuideDoc, resolveCommandRefs } from "./appGuide";

export interface Skill {
    name: string;
    description: string;
    /** Read when the tool is called, so a skill is free to assemble its content lazily. */
    content: string;
}

/**
 * The manual the assistant reads: the built-in text unless someone replaced it, followed by
 * every section modules and plugins registered (see AppGuideStore). Assembled on demand, not
 * when the skill is constructed — registration happens as plugins load, and a contributed
 * section may use the same `{command.key}` references the built-in text uses.
 */
function buildAppGuideDoc(): string {
    const override = AppGuideStore.getBase();
    // The built-in manual resolves its own references; an override and the contributed
    // sections are resolved here, so a module can write the same `{command.key}` references.
    const parts = [override === undefined ? appGuideDoc() : resolveCommandRefs(override)];
    for (const section of AppGuideStore.getSections()) {
        parts.push(resolveCommandRefs(`## ${section.name}\n${section.content}`));
    }
    return parts.join("\n\n");
}

/**
 * The app's own manual. Unlike the other skills this one is about the UI rather than the
 * modeling API, so it is the answer to "how do I…" and "where is…" questions: it maps every
 * command to its ribbon tab/group and hotkey, and explains navigation, selection, the model
 * tree, sketch mode and the parametric feature list.
 */
const appGuide: Skill = {
    name: "app-guide",
    description:
        'How to operate the Chili3D app itself: where every command lives (ribbon tabs and groups, toolbars, hotkeys), viewport navigation and selection, the model tree and property panel, sketch mode, parametric features, file operations and settings — load it to answer any "how do I…" or "where is…" question',
    get content() {
        return buildAppGuideDoc();
    },
};

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

Placement reminders (details in the capability list):
- box/rect/pyramid: plane.origin is a CORNER. Center a box at P: origin = P - (dx/2, dy/2, dz/2).
- cylinder/cone: center is the BASE-face center, extends +dz along normal.

Compounds:
- combine([...]) groups shapes into one compound node without fusing them; shape.volume and shape.boundingBox work on compounds (volume sums the solids inside). Fusing disjoint solids is not a recipe — it yields a compound of loose solids anyway.

Verify: after the build, select_nodes the result, fit_content, capture_screenshot — check proportions, and check that no scaffolding node is left behind (hide or delete those). The parts the user asked for stay in the scene as nodes of their own.`,
};

const errorRecovery: Skill = {
    name: "error-recovery",
    description:
        "What common run_program / tool errors mean and how to fix them: failed booleans, bad fillet radius, stale refs, wrong ref kinds, missed clicks",
    content: `Error recovery. Strategy: read the message, fix the cause, re-run ONLY the failed ops — refs persist across run_program calls, so retries are cheap. Load shape-query for the full query reference when a query fails.

"unknown method "x"" — the method is not in the modeling catalog. Query methods (owner.name like face.area) are listed in the shape-query skill; modeling methods in the system prompt's capability list. Check spelling and casing.

"must be a finite number" / "must be one of a|b|c" / "must be { x, y, z }" — argument encoding wrong. Re-check the JSON encoding section: XYZ={x,y,z}, Line={point,direction} (NOT {start,end}), Plane={origin, normal?, xvec?}, enum params list values inline.

"Missing required parameter "x"" — the op left out a required argument; nothing ran. Add it and re-run that op (the signatures are in the system prompt's capability list).

"The radius is too small." — the radius is at or below the kernel's minimum (1e-7 mm), i.e. effectively zero. Pass a positive radius.

"Failed to fillet" / "Failed to chamfer" (or "Fillet Error: …") — the radius/distance is too large for the adjacent faces, or the picked edges are unsuitable. Query edge.length / face.area around the target and lower the value; typical cause is a radius larger than half the shortest adjacent edge.

"The edges is empty." — fillet/chamfer needs edge indices: run shape.findSubShapes(target, edge) first and pick indices (ref e#3 -> index 3) by edge.ends geometry.

"ref "x" is no longer valid: its source node was removed" — the node behind the ref was consumed by an edit-style op or deleted. Use the id of the op that replaced it, or re-run the query that produced the ref against the new node.

"node not found: <id>" (delete_node / set_node_visible / transform_node / create_folder / move_nodes) — the node is gone, most likely consumed by an edit-style op: run_program's response "removed" lists those nodes. Do NOT retry or hide consumed nodes; call get_document_state if you need the current node list.

"folder not found: <id>" / "<id> is a <Type>, not a folder" / "cannot move <id>: …" / "cannot move <id> into itself or one of its own descendants" (create_folder / move_nodes) — the grouping target is wrong: the id is not a folder (a shape node or a body), or the node belongs to a parametric body that rebuilds it, or the move would nest a folder inside itself. get_document_state lists the FolderNode ids and every node's parentId — re-issue the move against a real folder id.

'Unknown ref "x"' — the id was never registered: no successfully-run op defined it (ops run in order, so an op cannot reference an id defined later in the same program), or you guessed it from a numbering pattern. The error lists the currently available refs — run the op that defines x first (or fix the op order), then re-run only the failed ops.

'Ref "x" was defined but its query returned null' — the defining op ran but produced no geometry (e.g. an empty intersection). x is unusable; re-run the defining query on a different target. (Only the "Unknown ref" message lists what is available — this one does not.)

"ref "x" is no longer valid: its source shape changed" — a sub-shape index no longer exists after the source was edited. Re-run shape.findSubShapes (or the original query) on the current shape and re-pick indices.

"requires a <kind> target, got a <other> ref" / "requires a <type> curve" — wrong ref kind or sub-shape type. Curve queries accept edge refs and surface queries accept face refs directly (auto-derived), and every curve member except curve.* / trimmedCurve.* unwraps trimmedCurve→basisCurve for you — so this means the target is neither (e.g. a solid or wire), or the edge's underlying curve is a different type. Inspect with shape.shapeType / trimmedCurve.basisCurve + curve.curveType and pass the right ref. Mutation queries (curve.reverse, trimmedCurve.setTrim) are the exception: they need an explicit edge.curve ref.

'<owner>.<name> does not apply to this target: it has no "<name>"' — the query asked for a member the target's kind does not have (a surface member on a face whose surface is another kind, most often). Curve owners are checked up front and fail with "requires a <type> curve" instead, so this is mostly surfaces: read the members the surface DOES have, or re-derive it (face.surface on the right face) and check with the family members first.

"BooleanCut Error" / "BooleanFuse Error" / "BooleanCommon Error" (or a raw OCCT diagnostic) — the kernel could not complete the operation. Do not assume the cause: a disjoint fuse SUCCEEDS (it returns a compound of loose solids, not one solid — that is why booleanFuse is only for touching solids). Compare the operands with shape.boundingBox / shape.extremaDistance, check that both are solids of the expected size, fix placement (corner vs base-center vs true-center rules) or the operand choice, and retry.

"To face failed" (wire.toFace) or "Failed to create prism" / "Prism Error: …" (prism) — the wire is not usable as a profile: polygon points must ALL lie on one plane and number at least 3 (fewer points or scattered 3D points produce an open/non-planar wire). Re-issue the corners on a single plane in perimeter order, repeating the first point as the last so the wire is closed.

prism/revolve on a polygon wire returns a shell or breaks downstream booleans — the wire was not CLOSED (a closed one is turned into a face and sweeps a solid). Re-run polygon with the first point repeated as the last point, then extrude again.

"Failed to create box / cylinder / face / polygon / solid / ellipse" — the factory rejected the parameters (a zero or negative size, a degenerate profile). Check the arguments the message names and re-run that op.

'ref "x" is a <kind>, but a shape is required' — the op wanted a shape and got a curve/surface ref (or the reverse). Pass a ref of the kind the parameter takes (see the capability list).

click_view "hits": [] — nothing of that shapeType at the pixel. Retake capture_screenshot (the view may have moved), nudge coordinates toward the target's center, and prefer shapeType face over edge — edges are only a few pixels wide. If several attempts miss, fall back to shape.findSubShapes + geometry, or ask the user to describe the shape in words.

The highlight in a click_view screenshot is on the wrong shape — the pixel missed, or several shapes overlap there. Re-click using the hit list's point (it names the world position you actually hit) or switch to shape.findSubShapes on the node and pick indices by geometry. Never operate on a selection you have not seen highlighted.

click_view "x and y must be numbers in [0,1]" — the coordinates were missing or outside the image; both are normalized fractions of the screenshot (x: 0=left/1=right, y: 0=top/1=bottom).

'query op "x" requires an id' / 'requires a target' — a query op is missing the "id" it reports its value under, or the "target" it inspects. Add the missing field; nothing else in the program is affected.

Query returns null (e.g. curve.parameter, surface.parameter, face.intersectLine) — the point/line does not map onto the geometry; it is a valid answer, not an error.`,
};

export const SKILLS: Skill[] = [appGuide, shapeQuery, modelingRecipes, errorRecovery];
