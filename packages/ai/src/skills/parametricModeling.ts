// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Skill } from "./types";

export const parametricModeling: Skill = {
    name: "parametric-modeling",
    description:
        "How to build a PARAMETRIC body with run_parametric: the op catalog (sketch/extrude/revolve/fillet/chamfer/boolean/editFeature/features), sketch entity encodings, constraints, and how to pick edge indexes — load it before any run_parametric call",
    content: `Parametric modeling. run_parametric builds a feature TREE the user can re-edit; run_program builds throwaway geometry.

Which one: if the user should be able to change a dimension afterwards, roll the timeline back, or see the feature list — run_parametric. If it is a one-off shape, a measurement, or a geometry query — run_program. A parametric body is a long-lived asset: never feed it to run_program's edit-style ops (booleanCut/booleanFuse/fillet/pushPull/...), which DELETE their inputs and would destroy the feature history. To combine bodies, use run_parametric's own boolean op.

Ops run in order; later ops reference earlier ids. An op that EDITS a body (extrude with "body", fillet,
chamfer, boolean) also registers its own id as another name for that body, so any of them works as a
reference afterwards. Anywhere a reference is expected you may also pass the real node id of an existing
sketch or body. One call is one undo step, and ANY failure rolls the whole program back — nothing is
left half-built.

- { op: "sketch", id, plane?, entities, constraints?, name? }
  plane: "XY" (default) | "YZ" | "ZX" | { nodeId, faceIndex } to sketch on a planar face of an existing node.
  entities are in sketch (u, v) coordinates:
    line   params [x1, y1, x2, y2]
    circle params [cx, cy, r]
    arc    params [cx, cy, sx, sy, ex, ey]  (center, start, end; sweeps counter-clockwise)
  A closed profile needs its segments in perimeter order with the first point repeated as the last.
- { op: "extrude", id, sketch, depth, symmetric?, startOffset?, body?, operation? }
  Without "body" it starts a new body. With "body" + "operation" (fuse/cut/common) the new prism
  combines with that body's shape. All closed profiles of the sketch are extruded.
- { op: "revolve", id, sketch, axis: { point: {x,y,z}, direction: {x,y,z} }, angle? }
  Always starts a new body — there is no join/cut revolve. angle is in degrees, default 360.
- { op: "fillet", id, body, edgeIndexes, radius }  /  { op: "chamfer", id, body, edgeIndexes, distance }
- { op: "boolean", id, body, operation, tools }   // operation: fuse | cut | common
  "tools" are node ids (or op ids). They are HIDDEN UNDER the body, never deleted — they stop
  rendering but stay reachable from the body's feature list.
- { op: "editFeature", body, featureId, action, ... }
  action: "setParameter" (key, value) | "rename" (value) | "suppress" (value) | "moveTo" (index) | "remove"
- { op: "features", body }   // reads the feature list: ids, names, parameters, errors

Variables. Every feature parameter (extrude depth/startOffset, revolve angle, fillet radius,
chamfer distance) takes either a number or an EXPRESSION STRING, so "width * 2" follows the
document variable width instead of freezing a number into the feature. Create them with
document_variables first — {"action":"set","variables":[{"name":"width","type":"length","expression":"40"}]}
— then name them in the ops. A variable may reference only the ones declared ABOVE it. This is
what makes the model parametric rather than merely feature-based: when the user changes width,
every feature that names it rebuilds. Reach for a variable when a dimension is one the user is
likely to come back to, and a plain number when it is incidental.

Selecting edges for fillet/chamfer: "edgeIndexes" index the body's current edge list (findSubShapes
order). Get them with a run_program query on the body node first — shape.findSubShapes(target: "b1",
args: { subshapeType: "edge" }) returns refs like e#3, and that number IS the index to pass.
Identify the edges you want by geometry (edge.ends, edge.length) before picking.

Example — a 40x30 plate, 20 tall, then round one top edge R3:
 [ { op: "sketch", id: "s1", plane: "XY", name: "Plate outline", entities: [
       { type: "line", params: [0, 0, 40, 0] },
       { type: "line", params: [40, 0, 40, 30] },
       { type: "line", params: [40, 30, 0, 30] },
       { type: "line", params: [0, 30, 0, 0] } ] },
   { op: "extrude", id: "b1", sketch: "s1", depth: 20, name: "Plate" } ]
Then run a run_program query on "b1" to find which edge index is the top front edge, and:
 [ { op: "fillet", id: "f1", body: "b1", edgeIndexes: [<that index>], radius: 3 } ]

Constraints (optional). A sketch without constraints is a fixed drawing: its coordinates are final
and a later dimension change cannot move anything. Add constraints when the sketch should stay
solvable. "entity" is the 1-based position of the entity in "entities"; "point" follows the entity
type (line: 0=start 1=end; circle: 0=center; arc: 0=center 1=start 2=end).
  { kind: "P2PCoincident", refs: [{entity:1,point:1},{entity:2,point:0}] }   // join two endpoints
  { kind: "Horizontal", refs: [{entity:1,point:0},{entity:1,point:1}] }
  { kind: "P2PDistance", refs: [{entity:1,point:0},{entity:2,point:0}], datum: 40 }
Dimension kinds take a "datum": a number, or an expression naming a document parameter (e.g. "width").
Coincident endpoints, Horizontal/Vertical and a few dimensions are enough for a well-formed rectangle —
an under-constrained sketch still works, it just has free degrees of freedom.

Limits and recovery:
- Only whole sketches are extruded; individual profiles of a sketch cannot be selected (a hole in a
  sketch is a hole, not a separate extrusion). To cut a pocket, extrude a second sketch with
  operation "cut", or cut with a separate body via the boolean op.
- A sketch consumed by extrude/revolve is hidden (visible = false). You can still reference it by id,
  but select_nodes/capture_screenshot will not find it.
- Failures are reported by the op index, e.g. 'op 2 ("fillet") failed: feature "Fillet" (…) failed: …'.
  Read the message, change the value, and re-run the whole program — the failed call rolled back
  completely, so re-running is safe and costs nothing. Do not re-run the identical program.
- A feature failure also raises one app error toast before the rollback; that toast is not a signal
  to retry — the returned error text is the authoritative one.
- After a successful build, verify like any other model: select_nodes the body, fit_content,
  capture_screenshot. Use the "features" op to read back the feature ids you will need for editFeature.`,
};
