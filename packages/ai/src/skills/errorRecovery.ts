// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Skill } from "./types";

export const errorRecovery: Skill = {
    name: "error-recovery",
    description:
        "What common run_program / tool errors mean and how to fix them: failed booleans, bad fillet radius, stale refs, wrong ref kinds, missed clicks",
    content: `Error recovery. Strategy: read the message, fix the cause, re-run ONLY the failed ops — refs persist across run_program calls, so retries are cheap. Load shape-query for the full query reference when a query fails.

"unknown method "x"" — the method is not in the modeling catalog. Query methods (owner.name like face.area) are listed in the shape-query skill; modeling methods in the modeling-api skill. Check spelling and casing.

"must be a finite number" / "must be one of a|b|c" / "must be { x, y, z }" — argument encoding wrong. Re-check the JSON encoding section: XYZ={x,y,z}, Line={point,direction} (NOT {start,end}), Plane={origin, normal?, xvec?}, enum params list values inline.

"Missing required parameter "x"" — the op left out a required argument; nothing ran. Add it and re-run that op (the signatures are in the modeling-api skill).

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

'ref "x" is a <kind>, but a shape is required' — the op wanted a shape and got a curve/surface ref (or the reverse). Pass a ref of the kind the parameter takes (see the modeling-api skill).

click_view "hits": [] — nothing of that shapeType at the pixel. Retake capture_screenshot (the view may have moved), nudge coordinates toward the target's center, and prefer shapeType face over edge — edges are only a few pixels wide. If several attempts miss, fall back to shape.findSubShapes + geometry, or ask the user to describe the shape in words.

The highlight in a click_view screenshot is on the wrong shape — the pixel missed, or several shapes overlap there. Re-click using the hit list's point (it names the world position you actually hit) or switch to shape.findSubShapes on the node and pick indices by geometry. Never operate on a selection you have not seen highlighted.

click_view "x and y must be numbers in [0,1]" — the coordinates were missing or outside the image; both are normalized fractions of the screenshot (x: 0=left/1=right, y: 0=top/1=bottom).

'query op "x" requires an id' / 'requires a target' — a query op is missing the "id" it reports its value under, or the "target" it inspects. Add the missing field; nothing else in the program is affected.

Query returns null (e.g. curve.parameter, surface.parameter, face.intersectLine) — the point/line does not map onto the geometry; it is a valid answer, not an error.`,
};
