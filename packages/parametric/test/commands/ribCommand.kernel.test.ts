// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    AsyncController,
    CommandStore,
    type IEdge,
    type IFace,
    Matrix4,
    Plane,
    PropertyUtils,
    PubSub,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import { RibFeatureCommand } from "../../src/commands/ribCommand";
import type { RibFeatureData } from "../../src/features/feature";
import { captureProfileRef } from "../../src/features/profileRef";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { SketchNode } from "../../src/sketch/sketchNode";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../wasm/lib/chili-wasm.wasm"),
);

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

/** The L bracket the command's cases are all drawn on — the shape a rib is for. */
const BASE = 40;
const DEPTH = 10;
const WALL = 30;
const CORNER = 10;
const THICKNESS = 4;
const SPAN = 10;
const CHORD = 18;
const BRACKET_VOLUME = (BASE * DEPTH + DEPTH * (WALL - DEPTH)) * SPAN;
const GUSSET_VOLUME = ((CHORD * CHORD) / 2) * THICKNESS;

const bracketSketch = () => ({
    entities: [
        { id: 1, type: "line" as const, params: [0, 0, BASE, 0] },
        { id: 2, type: "line" as const, params: [BASE, 0, BASE, DEPTH] },
        { id: 3, type: "line" as const, params: [BASE, DEPTH, CORNER, DEPTH] },
        { id: 4, type: "line" as const, params: [CORNER, DEPTH, CORNER, WALL] },
        { id: 5, type: "line" as const, params: [CORNER, WALL, 0, WALL] },
        { id: 6, type: "line" as const, params: [0, WALL, 0, 0] },
    ],
    constraints: [],
});

/** The chord across the bracket's inside corner, or a stopped-short one at a larger `toX`. */
const chainSketch = (toX = CORNER) => ({
    entities: [
        { id: 7, type: "line" as const, params: [CORNER + CHORD, DEPTH, toX, CORNER + CHORD + DEPTH - toX] },
    ],
    constraints: [],
});

function scene(chain = chainSketch(), bracket = bracketSketch()) {
    const app = createMockApplication();
    const doc = new TestDocument({ application: app });
    (app as any).activeView = { document: doc };
    doc.visual = createMockVisualWithDocument(doc, {
        highlighter: { addState: () => {}, removeState: () => {} } as any,
        context: { displayMesh: () => 1, removeMesh: () => {}, setVisible: () => {} } as any,
    });
    doc.selection = {
        getSelectedShapes: () => [],
        getSelectedNodes: () => [],
        setSelectedShapes: () => {},
        clearSelection: () => {},
        onShapeChanged: { sub: () => {}, remove: () => {} },
    } as any;

    const bracketNode = new SketchNode({ document: doc, plane: Plane.XY, data: bracket });
    const chainNode = new SketchNode({ document: doc, plane: Plane.XY, data: chain });
    doc.modelManager.addNode(bracketNode);
    doc.modelManager.addNode(chainNode);

    const profiles = bracketNode.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: bracketNode.id,
                depth: SPAN,
                // Straddling the sketch plane, which a rib needs: the plane has to CUT the body
                // for the rib to have a corner to fill.
                startOffset: -SPAN / 2,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);

    const cmd = new RibFeatureCommand();
    (cmd as any)._application = app;
    return { app, doc, bracketNode, chainNode, body, cmd };
}

/** The chain's edge as the picker would hand it over: the node's own edge, indexed. */
const chainPick = (chainNode: SketchNode, index = 0) => ({
    shape: chainNode.shape.unchecked()!.findSubShapes(ShapeTypes.edge)[index] as IEdge,
    owner: { node: chainNode },
    transform: Matrix4.identity(),
    indexes: [index],
    point: XYZ.zero,
});

/** Runs `body`, collecting the `showToast` messages it publishes. */
function captureToasts(body: () => void): () => string[] {
    const messages: string[] = [];
    const original = PubSub.default.pub as unknown as (key: string, ...args: unknown[]) => void;
    PubSub.default.pub = ((key: string, ...args: unknown[]) => {
        if (key === "showToast") messages.push(args.join(" "));
        else original.call(PubSub.default, key, ...args);
    }) as never;
    try {
        body();
    } finally {
        PubSub.default.pub = original as never;
    }
    return () => messages;
}

describe("RibFeatureCommand registration", () => {
    test("the key the ribbon names resolves to the command", () => {
        // A ribbon item whose key is not registered renders no button at all — silently.
        expect(CommandStore.getCommand("feature.rib")).toBe(RibFeatureCommand);
    });

    test("the rows are the ones the dialog is meant to show", () => {
        const names = PropertyUtils.getProperties(new RibFeatureCommand()).map((x) => x.name);

        expect(names).toEqual(expect.arrayContaining(["operation", "thickness", "targets", "extend"]));
    });

    test("every run starts joining", () => {
        const cmd = new RibFeatureCommand();

        expect(cmd.operation).toBe("option.command.operation.join");
        expect(cmd.extend).toBe(false);
    });
});

describe("RibFeatureCommand pick", () => {
    test("asks for sketch edges, several at a time", async () => {
        const { doc, chainNode } = scene();
        const pickShape = rs.fn((_prompt: string, _controller: unknown, _options?: unknown) =>
            Promise.resolve([chainPick(chainNode)]),
        );
        doc.picker = { pickShape } as any;

        await (new RibFeatureCommand() as any).getSteps()[0].execute(doc, new AsyncController());

        const options = pickShape.mock.calls[0][2] as any;
        expect(options.shapeType).toBe(ShapeTypes.edge);
        expect(options.multi).toBe(true);
        // A body edge is not something the sketch's own entity ids could ever name.
        expect(options.nodeFilter.allow(chainNode)).toBe(true);
        expect(options.nodeFilter.allow({})).toBe(false);
    });
});

describe("RibFeatureCommand commit", () => {
    test("appends the rib to the body whose corner it fills, and only to that one", () => {
        const { body, cmd, chainNode } = scene();
        cmd.thickness = THICKNESS;
        (cmd as any).stepDatas = [{ shapes: [chainPick(chainNode)], nodes: [chainNode], type: "shape" }];

        (cmd as any).executeMainTask();

        expect(body.features).toHaveLength(2);
        const feature = body.features[1] as RibFeatureData;
        expect(feature.type).toBe("rib");
        expect(feature.thickness).toBe(THICKNESS);
        expect(feature.entityIds).toEqual([7]);
        expect(feature.operation).toBe("fuse");
        // The defaults stay off the payload: an absent flag IS the default, and recording them
        // would freeze today's default into every document saved with it.
        expect(feature.extend).toBeUndefined();

        // The bracket, plus the corner triangle given the thickness along the sketch normal.
        body.shape.unchecked();
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
        expect(body.shape.unchecked()!.volume()).toBeCloseTo(BRACKET_VOLUME + GUSSET_VOLUME, 3);
    });

    test("the preview publishes what it detected, so the Parts row can show it", () => {
        const { body, cmd, chainNode } = scene();
        cmd.thickness = THICKNESS;
        (cmd as any).stepDatas = [{ shapes: [chainPick(chainNode)], nodes: [chainNode], type: "shape" }];
        const seen: string[] = [];
        cmd.onPropertyChanged((property: string) => seen.push(property));

        (cmd as any).updatePreview();

        // The row is drawn once, when the command starts, and knows nothing about the bodies the
        // pick turns out to cross: it reads the set back off this property and redraws on its
        // event. Without the write the row reads "0" while the commit quietly goes through.
        expect(cmd.targets.auto).toBe(true);
        expect(cmd.targets.ids).toEqual([body.id]);
        expect(seen).toContain("targets");
    });

    test("a chord that reaches no body is refused — it would reinforce nothing", () => {
        // Clear of every bracket, so nothing intersects the chain's box.
        const { body, cmd, chainNode } = scene({
            entities: [{ id: 7, type: "line", params: [500, 500, 520, 500] }],
            constraints: [],
        });
        cmd.thickness = THICKNESS;
        (cmd as any).stepDatas = [{ shapes: [chainPick(chainNode)], nodes: [chainNode], type: "shape" }];

        (cmd as any).executeMainTask();

        expect(body.features).toHaveLength(1);
    });

    test("a chord drawn short of the wall is refused — the corner never closes", () => {
        const { body, cmd, chainNode } = scene(chainSketch(16));
        cmd.thickness = THICKNESS;
        (cmd as any).stepDatas = [{ shapes: [chainPick(chainNode)], nodes: [chainNode], type: "shape" }];

        const said = captureToasts(() => (cmd as any).executeMainTask());

        expect(body.features).toHaveLength(1);
        expect(said()[0]).toContain("The rib does not reach the body");
    });

    test("a thickness that does not resolve refuses the commit instead of raising a zero wall", () => {
        const { body, cmd, chainNode } = scene();
        cmd.thickness = "missingVariable";
        (cmd as any).stepDatas = [{ shapes: [chainPick(chainNode)], nodes: [chainNode], type: "shape" }];

        (cmd as any).executeMainTask();

        expect(body.features).toHaveLength(1);
    });

    test("a pick with no chain at all refuses the commit", () => {
        const { body, cmd } = scene();
        (cmd as any).stepDatas = [{ shapes: [], nodes: [], type: "shape" }];

        (cmd as any).executeMainTask();

        expect(body.features).toHaveLength(1);
    });
});

describe("RibFeatureCommand extend to part", () => {
    const shortChain = () => chainSketch(16);

    test("extends a short chord to the named body and records the flag", () => {
        const { body, cmd, chainNode } = scene(shortChain());
        cmd.thickness = THICKNESS;
        cmd.extend = true;
        // The Parts row: the body the extension aims at, which is also the one it joins.
        cmd.targets = { auto: false, ids: [body.id] };
        (cmd as any).stepDatas = [{ shapes: [chainPick(chainNode)], nodes: [chainNode], type: "shape" }];

        (cmd as any).executeMainTask();

        expect(body.features).toHaveLength(2);
        expect((body.features[1] as RibFeatureData).extend).toBe(true);
        // The chord reached the wall, so the corner closes at its full size.
        expect(body.shape.unchecked()!.volume()).toBeCloseTo(BRACKET_VOLUME + GUSSET_VOLUME, 3);
    });

    test("with no target at all, extending is refused and says what is missing", () => {
        // Clear of every body, so nothing auto-detects and no part was named. Committing the
        // unextended rib would look like the extension had worked.
        const { body, cmd, chainNode } = scene({
            entities: [{ id: 7, type: "line", params: [-200, -200, -180, -200] }],
            constraints: [],
        });
        cmd.thickness = THICKNESS;
        cmd.extend = true;
        (cmd as any).stepDatas = [{ shapes: [chainPick(chainNode)], nodes: [chainNode], type: "shape" }];

        const said = captureToasts(() => (cmd as any).executeMainTask());

        expect(body.features).toHaveLength(1);
        // Exactly one refusal, and it names the missing part rather than the generic
        // "does not reach a body" — the two mean different things to the user.
        expect(said()).toHaveLength(1);
        expect(said()[0]).toContain("Select the body to extend the profile to");
    });
});
