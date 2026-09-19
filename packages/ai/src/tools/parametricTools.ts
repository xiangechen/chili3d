// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Transaction } from "@chili3d/core";
import type { ParametricOp, ProgramResult } from "@chili3d/parametric";
import type { Tool } from "../llm/types";
import { requireDocument } from "./documentContext";

/**
 * Loads the parametric module on first use. It must not be imported at module scope:
 * `buildTools()` is called by `buildSystemPrompt()` on every request, so a static import
 * would pull the whole parametric chunk — and with it the wasm-backed constraint solver —
 * into the resident prompt path.
 */
let parametricModule: Promise<typeof import("@chili3d/parametric")> | undefined;

function loadParametric(): Promise<typeof import("@chili3d/parametric")> {
    parametricModule ??= import("@chili3d/parametric");
    return parametricModule;
}

const OPS_SCHEMA = {
    type: "object",
    properties: {
        op: {
            type: "string",
            enum: ["sketch", "extrude", "revolve", "fillet", "chamfer", "boolean", "editFeature", "features"],
            description: "Which operation to run",
        },
        id: {
            type: "string",
            description:
                "Name for this op's result; later ops reference it. Required for sketch/extrude/revolve.",
        },
        name: { type: "string", description: "Optional display name for the resulting node" },
        plane: {
            description:
                'Sketch plane: "XY" (default), "YZ", "ZX", or { nodeId, faceIndex } to sketch on a planar face of an existing node',
        },
        entities: {
            type: "array",
            description:
                "Sketch geometry in sketch (u, v) coordinates: line params [x1,y1,x2,y2]; circle params [cx,cy,r]; arc params [cx,cy,sx,sy,ex,ey] (center, start, end; counter-clockwise). A closed profile needs its points in perimeter order, first point repeated as the last.",
            items: {
                type: "object",
                properties: {
                    type: { type: "string", enum: ["line", "circle", "arc"] },
                    params: { type: "array", items: { type: "number" } },
                },
                required: ["type", "params"],
            },
        },
        constraints: {
            type: "array",
            description:
                "Optional sketch constraints. Omit entirely for a plain sketch of fixed coordinates — constraints are what makes the sketch re-solvable when a dimension changes. Entity ids are the 1-based index of the entity in `entities`; point indexes follow the entity type (line: 0=start 1=end; circle: 0=center; arc: 0=center 1=start 2=end).",
            items: {
                type: "object",
                properties: {
                    kind: {
                        type: "string",
                        description:
                            "P2PCoincident, Horizontal, Vertical, Parallel, Perpendicular, EqualLength, PointOnLine, Midpoint, Symmetric, TangentLineCircle, P2PDistance, P2LDistance, Angle, Radius, HorizontalDistance, VerticalDistance, Fix, ...",
                    },
                    refs: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                entity: { type: "number", description: "1-based entity index" },
                                point: { type: "number", description: "Point index within the entity" },
                            },
                            required: ["entity", "point"],
                        },
                    },
                    datum: {
                        description:
                            "Value for dimension constraints (a number, or an expression naming a document parameter)",
                    },
                    datums: { description: "Multi-value datum, e.g. Fix = [x, y]" },
                },
                required: ["kind", "refs"],
            },
        },
        sketch: { type: "string", description: "The sketch op id (or an existing sketch's node id)" },
        depth: { description: "Extrude distance in mm (a number or an expression)" },
        symmetric: { type: "boolean", description: "Extrude by `depth` in both directions" },
        startOffset: { description: "Distance the extrusion starts away from the profile plane" },
        axis: {
            type: "object",
            description: "Revolve axis in world coordinates",
            properties: {
                point: { type: "object", properties: { x: {}, y: {}, z: {} }, required: ["x", "y", "z"] },
                direction: { type: "object", properties: { x: {}, y: {}, z: {} }, required: ["x", "y", "z"] },
            },
            required: ["point", "direction"],
        },
        angle: { description: "Revolve angle in degrees (default 360)" },
        body: { type: "string", description: "The body op id (or an existing body's node id)" },
        operation: {
            type: "string",
            enum: ["fuse", "cut", "common"],
            description:
                "Extrude only: how the new geometry combines with the target body's shape. Omit to start a new body. (Revolve has no join/cut form.)",
        },
        edgeIndexes: {
            type: "array",
            items: { type: "number" },
            description:
                "Indexes into the body's current edge list (findSubShapes order). Query them with run_program first: shape.findSubShapes on the body gives refs like e#3, whose number is the index.",
        },
        radius: { description: "Fillet radius in mm" },
        distance: { description: "Chamfer distance in mm" },
        tools: {
            type: "array",
            items: { type: "string" },
            description:
                "Boolean tool nodes (op ids or node ids). They are hidden under the body, not deleted.",
        },
        consumeTools: { type: "boolean", description: "Defaults to true" },
        action: {
            type: "string",
            enum: ["setParameter", "rename", "suppress", "moveTo", "remove"],
            description: "editFeature: what to do with the feature",
        },
        featureId: { type: "string", description: "The feature's id, as reported by the `features` op" },
        key: { type: "string", description: 'setParameter: the parameter name, e.g. "depth"' },
        value: { description: "setParameter: the new value; suppress: true/false; rename: the new name" },
        index: { type: "number", description: "moveTo: the feature's absolute index in the list" },
    },
    required: ["op"],
};

const RUN_PARAMETRIC_PARAMETERS = {
    type: "object",
    properties: {
        ops: { type: "array", items: OPS_SCHEMA, description: "Operations, run in order" },
    },
    required: ["ops"],
};

export function buildParametricTools(): Tool[] {
    return [
        {
            name: "run_parametric",
            description:
                "Build a parametric body — a sketch plus an ordered feature list the user can re-edit later. Same calling shape as run_program: { ops: [...] }, ops run in order, later ops reference earlier ids, and one call is one undo step. The difference: run_program produces throwaway geometry, run_parametric produces a feature tree the user can change a dimension in afterwards, so use it whenever the model should stay editable and run_program for one-off shapes. Ops: sketch, extrude, revolve, fillet, chamfer, boolean, editFeature, features — load_skill parametric-modeling for the full catalog. Nothing is ever deleted: a boolean's tool nodes become hidden children of the body.",
            parameters: RUN_PARAMETRIC_PARAMETERS,
            handler: runParametric,
        },
    ];
}

async function runParametric(args: Record<string, unknown>): Promise<string> {
    const document = requireDocument();
    if (typeof document === "string") return document;

    const ops = (args as { ops?: unknown }).ops;
    if (!Array.isArray(ops) || ops.length === 0) {
        throw new Error('run_parametric requires a non-empty "ops" array');
    }

    const parametric = await loadParametric();
    // Only a sketch carrying constraints needs the solver; a plain sketch of fixed
    // coordinates never touches garlic, so those programs pay nothing for it.
    const needsSolver = ops.some(
        (op) =>
            Array.isArray((op as { constraints?: unknown }).constraints) &&
            (op as { constraints: unknown[] }).constraints.length > 0,
    );
    if (needsSolver) await parametric.initGarlic();

    let result: ProgramResult | undefined;
    // Synchronous by construction: the solver is initialized above, and a throw here
    // rolls the whole program back, so a half-built body never survives.
    Transaction.execute(document, "run_parametric", () => {
        result = parametric.runParametricProgram(document, ops as ParametricOp[]);
        document.selection.clearSelection();
        document.visual.update();
    });
    // Serialized outside the transaction on purpose: a fault here is a reporting fault,
    // and it must not discard a build that has already committed to history.
    return JSON.stringify(result);
}
