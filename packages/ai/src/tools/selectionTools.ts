// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    type IDocument,
    type INode,
    type IShape,
    type ShapeType,
    ShapeTypes,
    type VisualShapeData,
    VisualStates,
} from "@chili3d/core";
import type { Tool } from "../llm/types";

const PICKABLE_SHAPE_TYPES = ["shape", "solid", "shell", "face", "wire", "edge", "vertex"] as const;

function getDocument(): IDocument | undefined {
    return globalThis.app.activeView?.document;
}

function shapeTypeOf(v: unknown): ShapeType {
    const t = ShapeTypes[String(v) as keyof typeof ShapeTypes];
    if (t === undefined) {
        throw new Error(
            `shapeType must be one of ${PICKABLE_SHAPE_TYPES.join("|")}, got ${JSON.stringify(v)}`,
        );
    }
    return t;
}

function shapeTypeName(shape: IShape): string {
    return (
        Object.keys(ShapeTypes).find((k) => ShapeTypes[k as keyof typeof ShapeTypes] === shape.shapeType) ??
        String(shape.shapeType)
    );
}

/**
 * The sub-shape summary both pick_shapes and click_view report. `index` matches the order of
 * shape.findSubShapes on the owning node, so it can be fed to fillet/chamfer "edges" directly.
 */
function summarizeShape(s: VisualShapeData) {
    const node = s.owner.node;
    return {
        nodeId: node.id,
        nodeName: node.name,
        shapeType: shapeTypeName(s.shape),
        index: (s.shape as { index?: number }).index ?? s.indexes[0],
        point: s.point,
    };
}

function summarizeNode(node: INode) {
    return { id: node.id, type: node.constructor.name, name: node.name };
}

function pickShapesTool(): Tool {
    return {
        name: "pick_shapes",
        description:
            "Ask the user to click shapes in the viewport (a picker with confirm/cancel appears). Returns the picked sub-shapes with nodeId, shapeType and index — index matches shape.findSubShapes order on that node and can be used directly as fillet/chamfer 'edges'. Use when the user refers to specific faces/edges ('this edge', 'that hole') that you cannot identify by name or query. Returns { cancelled: true } when the user cancels the picker.",
        parameters: {
            type: "object",
            properties: {
                shapeType: {
                    type: "string",
                    enum: [...PICKABLE_SHAPE_TYPES],
                    description: "What to pick (default face)",
                },
                multi: {
                    type: "boolean",
                    description: "Allow picking multiple shapes (default false)",
                },
            },
        },
        handler: pickShapesHandler,
    };
}

const pickShapesHandler: Tool["handler"] = async (args, signal) => {
    const view = globalThis.app.activeView;
    const doc = view?.document;
    if (!doc || !view.dom) {
        return JSON.stringify({ error: "no active viewport — picking needs a visible view" });
    }
    if (signal?.aborted) {
        return JSON.stringify({ cancelled: true, picked: [] });
    }
    const controller = new AsyncController();
    // Cancelling the chat aborts the signal — end the viewport picker the same way its
    // own cancel button would, so the view never stays stuck in pick mode.
    const onAbort = () => controller.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
        const shapes = await doc.picker.pickShape("prompt.select.shape", controller, {
            shapeType: args["shapeType"] === undefined ? ShapeTypes.face : shapeTypeOf(args["shapeType"]),
            multi: args["multi"] === true,
        });
        if (controller.result?.status === "cancel") {
            return JSON.stringify({ cancelled: true, picked: [] });
        }
        return JSON.stringify({ picked: shapes.map(summarizeShape) });
    } finally {
        signal?.removeEventListener("abort", onAbort);
    }
};

function clickViewTool(): Tool {
    return {
        name: "click_view",
        description:
            "Click a point in the viewport, like a mouse click. Coordinates are normalized [0,1] (x: 0=left/1=right, y: 0=top/1=bottom) and match the latest capture_screenshot image. action 'detect' (default) only reports what is hit; 'select' also selects the first hit (highlighted for follow-up operations like fillet or fit_content). Hits come back as candidates with nodeId, shapeType, index (usable as fillet/chamfer 'edges') and the world point. Faces are easy to hit; edges are a few pixels wide — after a select, verify the highlight with capture_screenshot before operating.",
        parameters: {
            type: "object",
            properties: {
                x: { type: "number", description: "Normalized horizontal position, 0=left, 1=right" },
                y: { type: "number", description: "Normalized vertical position, 0=top, 1=bottom" },
                shapeType: {
                    type: "string",
                    enum: [...PICKABLE_SHAPE_TYPES],
                    description: "What to hit-test (default face)",
                },
                action: {
                    type: "string",
                    enum: ["detect", "select"],
                    description: "detect only reports hits (default); select also selects the first hit",
                },
            },
            required: ["x", "y"],
        },
        handler: clickViewHandler,
    };
}

const clickViewHandler: Tool["handler"] = async (args) => {
    const view = globalThis.app.activeView;
    const doc = view?.document;
    if (!doc || !view.dom) {
        return JSON.stringify({ error: "no active viewport — clicking needs a visible view" });
    }
    const [nx, ny] = [args["x"], args["y"]].map(Number);
    if (![nx, ny].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) {
        return JSON.stringify({
            error: `x and y must be numbers in [0,1], got [${args["x"]}, ${args["y"]}]`,
        });
    }
    const shapeType = args["shapeType"] === undefined ? ShapeTypes.face : shapeTypeOf(args["shapeType"]);
    const px = nx * view.width;
    const py = ny * view.height;
    const hits = view.detectShapes(shapeType, px, py);

    const selected = args["action"] === "select" ? selectHitShape(doc, hits[0], shapeType) : undefined;
    return JSON.stringify({
        pixel: { x: Math.round(px), y: Math.round(py) },
        hits: hits.map(summarizeShape),
        selected,
    });
};

/** Selects the hit shape and returns its summary; undefined when there was nothing to hit. */
function selectHitShape(doc: IDocument, hit: VisualShapeData | undefined, shapeType: ShapeType): unknown {
    if (hit === undefined) return undefined;

    const state = shapeType === ShapeTypes.face ? VisualStates.faceSelected : VisualStates.edgeSelected;
    doc.selection.setSelectedShapes([hit], state, false);
    return summarizeShape(hit);
}

function selectNodesTool(): Tool {
    return {
        name: "select_nodes",
        description:
            "Select nodes in the viewport so the user sees them highlighted — e.g. select the nodes you just created or modified, then call fit_content to focus them. Pass an empty array to clear the selection.",
        parameters: {
            type: "object",
            properties: {
                nodeIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Node ids to select (empty clears the selection)",
                },
            },
            required: ["nodeIds"],
        },
        handler: async (args) => {
            const doc = getDocument();
            if (!doc) return JSON.stringify({ error: "no active document" });
            const ids = Array.isArray(args["nodeIds"]) ? args["nodeIds"].map(String) : [];
            const { nodes, missing } = findNodesByIds(doc, ids);
            doc.selection.setSelectedNodes(nodes, false);
            return JSON.stringify({ selected: nodes.map(summarizeNode), missing });
        },
    };
}

/** Splits `ids` into the nodes that still exist and the ids that no longer resolve. */
function findNodesByIds(doc: IDocument, ids: string[]): { nodes: INode[]; missing: string[] } {
    const nodes: INode[] = [];
    const missing: string[] = [];
    for (const id of ids) {
        const node = doc.modelManager.findNodes((n) => n.id === id)[0];
        if (node) nodes.push(node);
        else missing.push(id);
    }
    return { nodes, missing };
}

export function buildSelectionTools(): Tool[] {
    return [pickShapesTool(), clickViewTool(), selectNodesTool()];
}
