// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Config,
    defaultTextFont,
    type FontOutline,
    type IDocument,
    type IShape,
    Plane,
    rememberOutline,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { TextNode } from "../../../src/bodys/text";
import { TextCommand } from "../../../src/commands/create/text";
import {
    ensureGlobalStubApp,
    pointStepResult,
    seedStepDatas,
    shapeData,
    wireCommand,
} from "../commandTestUtils";

/**
 * A face in the plane x = 1, facing +x. `planar` false makes it a curved one,
 * which is what a picked point cannot stand text on.
 */
function flatFace(planar = true) {
    const face = {
        shapeType: ShapeTypes.face,
        transformedMul: () => face,
        surface: () => ({ isPlanar: () => planar }),
        normal: () => [new XYZ({ x: 1, y: 0, z: 0 }), XYZ.unitX],
    };
    return face as unknown as IShape;
}

/** A font with one square glyph and one more, so a two-character line has outlines. */
function fontOf(): FontOutline {
    const square = (advance: number) => ({
        advance,
        contours: [
            {
                start: { x: 0, y: 0 },
                segments: [
                    { kind: "line" as const, to: { x: 500, y: 0 } },
                    { kind: "line" as const, to: { x: 500, y: 700 } },
                    { kind: "line" as const, to: { x: 0, y: 700 } },
                    { kind: "line" as const, to: { x: 0, y: 0 } },
                ],
            },
        ],
    });

    return {
        familyName: "fake",
        unitsPerEm: 1000,
        missingAdvance: 500,
        glyph: (codePoint) => (codePoint === 0x41 || codePoint === 0x42 ? square(600) : undefined),
    };
}

/** The text the preview would build toward a point, before it is meshed for display. */
function previewShapeAt(cmd: TextCommand, towards: XYZ) {
    return (cmd as unknown as { previewShape: (t: XYZ) => { isOk: boolean; error: string } }).previewShape(
        towards,
    );
}

/** What the direction step would draw at `point`. */
function previewAt(cmd: TextCommand, point: XYZ | undefined) {
    return (cmd as unknown as { textPreview: (p: XYZ | undefined) => unknown[] }).textPreview(point);
}

/** A command with a font already in hand, so it never reaches for the picker. */
function commandWithFont(): { cmd: TextCommand; doc: IDocument } {
    const cmd = new TextCommand();
    const { doc } = wireCommand(cmd);
    (cmd as unknown as { font: FontOutline }).font = fontOf();
    return { cmd, doc };
}

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

let dynamicWorkplane: boolean;
beforeEach(() => {
    // A dynamic workplane would raycast the pointer; the working plane is the same
    // answer whenever the pointer has not moved, which is all this test needs.
    dynamicWorkplane = Config.instance.dynamicWorkplane;
    Config.instance.dynamicWorkplane = false;
});
afterEach(() => {
    Config.instance.dynamicWorkplane = dynamicWorkplane;
});

describe("TextCommand", () => {
    test("should have command metadata", () => {
        const data = (TextCommand as any).prototype.data;

        expect(data.key).toBe("create.text");
        // The named glyph the icon font carries, rather than an inline svg of its own.
        expect(data.icon).toBe("icon-text");
    });

    test("starts with text that is not empty, so the preview shows something", () => {
        const { cmd } = commandWithFont();

        expect(cmd.text.length).toBeGreaterThan(0);
        expect(cmd.size).toBe(10);
    });

    test("asks for three points by default: where the text starts, which way it runs, and how deep", () => {
        const { cmd } = commandWithFont();

        const steps = (cmd as any).getSteps();

        // Three, as a box is placed: the corner, the direction, and the extrusion along the
        // plane's normal.
        expect(steps.length).toBe(3);
        expect((cmd as any).placement).toBe("option.text.placement.point");
    });

    test("takes the depth from the third point", () => {
        const { cmd } = commandWithFont();
        cmd.text = "AB";
        seedStepDatas(cmd, [
            pointStepResult({ point: XYZ.zero, type: "input" }),
            pointStepResult({ point: new XYZ({ x: 10, y: 0, z: 0 }), type: "input" }),
            // 30 out of the plane the text lies in, along its normal.
            pointStepResult({ point: new XYZ({ x: 4, y: 0, z: 30 }), type: "input" }),
        ]);

        const node = (cmd as any).geometryNode() as TextNode;

        expect(node.depth).toBeCloseTo(30, 6);
        // The height is the panel's, as it was before the third point was asked for.
        expect(node.size).toBe(10);
    });

    test("measures the depth along the plane's normal rather than to the corner", () => {
        const { cmd } = commandWithFont();
        seedStepDatas(cmd, [
            pointStepResult({ point: XYZ.zero, type: "input" }),
            pointStepResult({ point: new XYZ({ x: 10, y: 0, z: 0 }), type: "input" }),
        ]);

        // 30 out of the plane from a point 4 along it: a depth of 30, though 30.26 from the
        // corner the text starts at.
        expect((cmd as any).depthOf(new XYZ({ x: 4, y: 0, z: 30 }))).toBeCloseTo(30, 6);
    });

    test("reads a point on the plane as a sliver, which is what the extrude can take", () => {
        const { cmd } = commandWithFont();
        seedStepDatas(cmd, [
            pointStepResult({ point: XYZ.zero, type: "input" }),
            pointStepResult({ point: new XYZ({ x: 10, y: 0, z: 0 }), type: "input" }),
        ]);

        // The pointer crosses the plane on its way past it, and an extrude of nothing is what
        // the kernel refuses.
        const sliver = (cmd as any).depthOf(new XYZ({ x: 4, y: 5, z: 0 }));

        expect(sliver).not.toBe(0);
        expect(Math.abs(sliver)).toBeLessThan(0.001);
    });

    test("asks for a curve when the text follows a path", () => {
        const { cmd } = commandWithFont();
        cmd.placement = "option.text.placement.path";

        // The curve, then how deep to push the line out along its plane's normal: a path has
        // no third point of its own to say.
        expect((cmd as any).getSteps().length).toBe(2);
    });

    test("needs no font from the picker once it has one", async () => {
        const { cmd } = commandWithFont();

        await expect((cmd as any).canExcute()).resolves.toBe(true);
    });

    test("takes the default font without asking", async () => {
        // The picker is not involved: the default is fetched, not chosen. Seeding
        // the session's parse cache stands in for the fetch, so no network here.
        const cmd = new TextCommand();
        wireCommand(cmd);
        const picked = defaultTextFont();
        rememberOutline(picked.name, picked.url ?? "", fontOf());

        await expect((cmd as any).canExcute()).resolves.toBe(true);

        expect(cmd.fontName).toBe("Noto Sans SC");
        expect(cmd.text.length).toBeGreaterThan(0);

        seedStepDatas(cmd, [
            pointStepResult({ point: XYZ.zero, type: "input" }),
            pointStepResult({ point: new XYZ({ x: 10, y: 0, z: 0 }), type: "input" }),
            pointStepResult({ point: new XYZ({ x: 0, y: 0, z: 5 }), type: "input" }),
        ]);
        const node = (cmd as any).geometryNode() as TextNode;
        expect(node.fontName).toBe("Noto Sans SC");
        expect(node.fontUrl).toBe(picked.url);
    });

    test("makes a text node at the picked point", () => {
        const { cmd, doc } = commandWithFont();
        cmd.text = "AB";
        seedStepDatas(cmd, [
            pointStepResult({ point: new XYZ({ x: 3, y: 4, z: 0 }), type: "input" }),
            pointStepResult({ point: new XYZ({ x: 13, y: 4, z: 0 }), type: "input" }),
            pointStepResult({ point: new XYZ({ x: 3, y: 4, z: 4 }), type: "input" }),
        ]);

        const node = (cmd as any).geometryNode() as TextNode;

        expect(node).toBeInstanceOf(TextNode);
        expect(node.document).toBe(doc);
        expect(node.text).toBe("AB");
        expect(node.size).toBe(10);
        expect(node.depth).toBe(4);
        expect(node.plane.origin).toEqual(new XYZ({ x: 3, y: 4, z: 0 }));
        // The second point turned the line's own x axis to run along it.
        expect(node.plane.xvec).toEqual(XYZ.unitX);
        expect(node.path).toBeUndefined();
        // Both characters are in the outlines, so nothing has to be looked up later.
        expect(node.outlines).toContain("65");
        expect(node.outlines).toContain("66");
    });

    test("stands the text in the plane of the flat face the point landed on", () => {
        const { cmd } = commandWithFont();
        // A face lying in the plane x = 1, facing +x: the text must lie in it.
        seedStepDatas(cmd, [
            pointStepResult({
                point: new XYZ({ x: 1, y: 5, z: 6 }),
                type: "onSurface",
                shapes: [shapeData({ shape: flatFace() })],
            }),
            pointStepResult({ point: new XYZ({ x: 1, y: 15, z: 6 }), type: "input" }),
            pointStepResult({ point: new XYZ({ x: 1, y: 15, z: 6 }), type: "input" }),
        ]);

        const node = (cmd as any).geometryNode() as TextNode;

        expect(node.plane.origin).toEqual(new XYZ({ x: 1, y: 5, z: 6 }));
        expect(node.plane.normal).toEqual(XYZ.unitX);
        // The line runs along the face, so neither of its axes leaves that plane.
        expect(node.plane.xvec.dot(XYZ.unitX)).toBeCloseTo(0, 6);
        expect(node.plane.yvec.dot(XYZ.unitX)).toBeCloseTo(0, 6);
    });

    test("keeps to the working plane when the point landed on a curved face", () => {
        const { cmd } = commandWithFont();
        // A cylinder's side has no plane of its own to draw a line of text in.
        seedStepDatas(cmd, [
            pointStepResult({
                point: new XYZ({ x: 5, y: 0, z: 3 }),
                type: "onSurface",
                shapes: [shapeData({ shape: flatFace(false) })],
            }),
            pointStepResult({ point: new XYZ({ x: 5, y: 10, z: 3 }), type: "input" }),
            pointStepResult({ point: new XYZ({ x: 5, y: 10, z: 8 }), type: "input" }),
        ]);

        const node = (cmd as any).geometryNode() as TextNode;

        expect(node.plane.origin).toEqual(new XYZ({ x: 5, y: 0, z: 3 }));
        expect(node.plane.normal).toEqual(Plane.XY.normal);
    });

    test("sets the text at an angle when the second point points that way", () => {
        const { cmd } = commandWithFont();
        seedStepDatas(cmd, [
            pointStepResult({ point: XYZ.zero, type: "input" }),
            pointStepResult({ point: new XYZ({ x: 1, y: 1, z: 0 }), type: "input" }),
            pointStepResult({ point: new XYZ({ x: 0, y: 0, z: 3 }), type: "input" }),
        ]);

        const node = (cmd as any).geometryNode() as TextNode;

        // The baseline runs toward the second point, so the plane's x axis does too.
        expect(node.plane.xvec.x).toBeCloseTo(Math.SQRT1_2, 6);
        expect(node.plane.xvec.y).toBeCloseTo(Math.SQRT1_2, 6);
        // And it is still the plane it was: the axes stay square to the normal.
        expect(node.plane.xvec.dot(node.plane.normal)).toBeCloseTo(0, 6);
        expect(node.plane.yvec.dot(node.plane.normal)).toBeCloseTo(0, 6);
    });

    test("keeps the plane's own axes when the second point says no direction", () => {
        const { cmd } = commandWithFont();
        // Straight up out of the plane: there is no direction in the plane to read.
        seedStepDatas(cmd, [
            pointStepResult({ point: XYZ.zero, type: "input" }),
            pointStepResult({ point: new XYZ({ x: 0, y: 0, z: 5 }), type: "input" }),
            pointStepResult({ point: new XYZ({ x: 0, y: 0, z: 9 }), type: "input" }),
        ]);

        const node = (cmd as any).geometryNode() as TextNode;

        expect(node.plane.xvec).toEqual(Plane.XY.xvec);
    });

    test("draws the text itself as the second point moves", () => {
        const { cmd } = commandWithFont();
        cmd.text = "AB";
        seedStepDatas(cmd, [pointStepResult({ point: XYZ.zero, type: "input" })]);

        const shape = previewShapeAt(cmd, new XYZ({ x: 5, y: 0, z: 0 }));

        // The glyphs were built and combined, so what the pointer shows is the text
        // rather than a line standing for it. (The stub factory in this fixture
        // answers every call alike, so *that* it was asked is the whole assertion.)
        expect(shape.isOk ? "ok" : shape.error).toBe("ok");
    });

    test("draws the text's outline where the second point is", () => {
        const { cmd } = commandWithFont();
        // A character this fixture font actually has, so the outline is drawn rather
        // than the fallback line.
        cmd.text = "A";
        seedStepDatas(cmd, [pointStepResult({ point: XYZ.zero, type: "input" })]);

        const preview = previewAt(cmd, new XYZ({ x: 5, y: 0, z: 0 })) as { position: Float32Array }[];

        // Two entries: the point already picked and the text's own outline, which is
        // mesh data taken from a shape. Handing anything else to the mesher throws
        // rather than drawing, which is what a wrong argument here looks like.
        expect(preview.length).toBe(2);
        expect(preview[1].position).toBeInstanceOf(Float32Array);
    });

    test("falls back to the baseline when there is no text to draw", () => {
        const { cmd } = commandWithFont();
        cmd.text = "";
        seedStepDatas(cmd, [pointStepResult({ point: XYZ.zero, type: "input" })]);

        const shape = previewShapeAt(cmd, new XYZ({ x: 5, y: 0, z: 0 }));
        const [, fallback] = previewAt(cmd, new XYZ({ x: 5, y: 0, z: 0 }));

        // Nothing to draw is not a reason to leave the user without the direction.
        expect(shape.isOk).toBe(false);
        expect([...(fallback as { position: Float32Array }).position]).toEqual([0, 0, 0, 5, 0, 0]);
    });

    test("shows nothing but the first point before the second has a position", () => {
        const { cmd } = commandWithFont();
        seedStepDatas(cmd, [pointStepResult({ point: XYZ.zero, type: "input" })]);

        expect(previewAt(cmd, undefined).length).toBe(1);
    });

    test("hands the step a way to be told when the preview is stale", () => {
        const { cmd } = commandWithFont();
        const redraw = rs.fn();

        const data = (cmd as any).directionData();

        data.onPreviewReady(redraw);

        // What the preview is made of is this command's own parameters, so changing one of
        // them draws it again — the step draws where the pointer is, which only it knows.
        cmd.text = "AB";
        cmd.size = 25;
        expect(redraw.mock.calls.length).toBe(2);

        // And `afterExecute`, which runs once the step's handler is done with, is what stops
        // the command following it.
        data.afterExecute?.();
        cmd.text = "ABC";
        expect(redraw.mock.calls.length).toBe(2);
    });

    test("hands the curve over to the node rather than taking it away", () => {
        const { cmd } = commandWithFont();
        cmd.placement = "option.text.placement.path";
        const curve = { shapeType: ShapeTypes.edge, transformedMul: () => curve };
        seedStepDatas(cmd, [
            {
                view: { workplane: Plane.XY } as any,
                type: "shape",
                shapes: [{ shape: curve, transform: undefined, point: undefined, owner: {} } as any],
            },
            pointStepResult({ point: new XYZ({ x: 0, y: 0, z: 6 }), type: "input" }),
        ]);

        const node = (cmd as any).geometryNode() as TextNode;

        // The node reads the curve again on every rebuild. A command that disposed it on the
        // way out leaves the node handing the kernel an edge that is no longer there, which is
        // what "Cannot pass deleted object as a pointer of type TopoDS_Edge" is.
        expect((cmd as any).disposeStack.has(node.path)).toBe(false);
    });

    test("takes the depth along the curve's own plane when the text follows a path", () => {
        const { cmd } = commandWithFont();
        cmd.placement = "option.text.placement.path";
        const curve = { shapeType: ShapeTypes.edge, transformedMul: () => curve };
        seedStepDatas(cmd, [
            {
                view: { workplane: Plane.XY } as any,
                type: "shape",
                shapes: [{ shape: curve, transform: undefined, point: undefined, owner: {} } as any],
            },
            // The path lies in the working plane, so the depth runs along its normal: 6 out
            // of the plane from a point 4 along it, not the 7.2 from where the path starts.
            pointStepResult({ point: new XYZ({ x: 4, y: 0, z: 6 }), type: "input" }),
        ]);

        const node = (cmd as any).geometryNode() as TextNode;

        expect(node.depth).toBeCloseTo(6, 6);
    });

    test("carries the curve the text follows onto the node", () => {
        const { cmd } = commandWithFont();
        cmd.placement = "option.text.placement.path";
        const curve = { shapeType: ShapeTypes.edge, transformedMul: () => curve };
        seedStepDatas(cmd, [
            {
                view: { workplane: Plane.XY } as any,
                type: "shape",
                shapes: [{ shape: curve, transform: undefined, point: undefined, owner: {} } as any],
            },
            pointStepResult({ point: new XYZ({ x: 0, y: 0, z: 6 }), type: "input" }),
        ]);

        const node = (cmd as any).geometryNode() as TextNode;

        expect(node.path).toBe(curve);
    });
});
