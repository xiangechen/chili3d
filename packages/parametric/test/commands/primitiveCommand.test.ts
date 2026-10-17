// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, PubSub, XYZ } from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import {
    PrimitiveBoxCommand,
    PrimitiveConeCommand,
    PrimitiveCylinderCommand,
    PrimitiveSphereCommand,
} from "../../src/commands/primitiveCommand";
import type { PrimitiveFeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";

function setup() {
    const app = createMockApplication();
    const doc = new TestDocument({ application: app });
    (app as any).activeView = { document: doc };
    return { app, doc };
}

const at = (x: number, y: number, z: number) => new XYZ(x, y, z);
const pick = (point: XYZ, plane?: Plane) => ({ point, plane, shapes: [], type: "pick" }) as any;

/** A box drag: corner at the origin, opposite corner (30, −20), height 15 up. */
function boxCmd(step2 = at(30, -20, 15), plane: Plane = Plane.XY) {
    const cmd = new PrimitiveBoxCommand() as any;
    cmd.stepDatas = [pick(at(0, 0, 0)), pick(at(30, -20, 0), plane), pick(step2)];
    return cmd as PrimitiveBoxCommand;
}

/** A round-primitive drag: centre (5, 5, 0), radius point (8, 9) — a 3-4-5 — height 12 up. */
function roundCmd<T>(ctor: new () => T, step2 = at(5, 5, 12)): T {
    const cmd = new ctor() as any;
    cmd.stepDatas = [pick(at(5, 5, 0)), pick(at(8, 9, 0), Plane.XY), pick(step2)];
    return cmd as T;
}

describe("primitive command option-panel sizes", () => {
    test("the size properties default to the feature data's defaults", () => {
        const box = new PrimitiveBoxCommand();
        expect([box.dx, box.dy, box.dz]).toEqual([10, 10, 10]);
        const cylinder = new PrimitiveCylinderCommand();
        expect([cylinder.radius, cylinder.height]).toEqual([5, 10]);
        const cone = new PrimitiveConeCommand();
        expect([cone.radius, cone.height, cone.radius2]).toEqual([5, 10, 0]);
        const sphere = new PrimitiveSphereCommand();
        expect(sphere.radius).toBe(5);
    });

    test("box: the committed rectangle writes its spans to the panel at the height step", () => {
        const cmd = boxCmd();
        (cmd as any).getHeightStepData();

        // The dy span is absolute — the sign folds into the origin, not the size.
        expect([cmd.dx, cmd.dy]).toEqual([30, 20]);
    });

    test("box: a panel edit during the height step wins; the pick keeps pose and dz", () => {
        const cmd = boxCmd();
        (cmd as any).getHeightStepData();
        cmd.dx = 50;

        const feature = (cmd as any).buildFeature() as PrimitiveFeatureData;
        expect(feature).toMatchObject({
            type: "primitive",
            primitive: "box",
            dx: 50, // the panel's
            dy: 20, // the drag's
            dz: 15, // the height pick's — written at commit, no edit window
            origin: { x: 0, y: -20, z: 0 }, // the fold of the dragged rectangle
            axis: { x: 0, y: 0, z: 1 },
        });
        // An edited dx/dy does not move the picked corner; the panel shows the placed dz.
        expect(cmd.dz).toBe(15);
    });

    test("box: an untouched panel stores exactly the dragged spans", () => {
        const cmd = boxCmd();
        (cmd as any).getHeightStepData();

        const feature = (cmd as any).buildFeature() as PrimitiveFeatureData;
        expect([feature.dx, feature.dy, feature.dz]).toEqual([30, 20, 15]);
    });

    test("box: a downward drag stores the axis reversed and the height positive", () => {
        const cmd = boxCmd(at(30, -20, -5));
        (cmd as any).getHeightStepData();

        const feature = (cmd as any).buildFeature() as PrimitiveFeatureData;
        expect(feature.axis).toEqual({ x: 0, y: 0, z: -1 });
        expect(feature.dz).toBe(5);
    });

    test("cylinder: the committed radius writes to the panel; a later panel edit wins", () => {
        const cmd = roundCmd(PrimitiveCylinderCommand);
        (cmd as any).getHeightStepData();
        expect(cmd.radius).toBe(5);

        cmd.radius = 7;
        const feature = (cmd as any).buildFeature() as PrimitiveFeatureData;
        expect(feature).toMatchObject({
            primitive: "cylinder",
            radius: 7,
            height: 12,
            origin: { x: 5, y: 5, z: 0 },
            axis: { x: 0, y: 0, z: 1 },
        });
        expect(feature.radius2).toBeUndefined();
    });

    test("cone: radius2 defaults to the pointed cone and takes a panel value", () => {
        const pointed = roundCmd(PrimitiveConeCommand);
        (pointed as any).getHeightStepData();
        const feature = (pointed as any).buildFeature() as PrimitiveFeatureData;
        expect(feature.radius2).toBe(0);

        const frustum = roundCmd(PrimitiveConeCommand);
        (frustum as any).getHeightStepData();
        frustum.radius2 = 3;
        expect(((frustum as any).buildFeature() as PrimitiveFeatureData).radius2).toBe(3);
    });

    test("cone: a negative radius2 is a toast, not a feature", () => {
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const cmd = roundCmd(PrimitiveConeCommand);
            cmd.radius2 = -1;
            expect((cmd as any).buildFeature()).toBeUndefined();
            expect(pub).toHaveBeenCalledWith(
                "showToast",
                "error.default:{0}",
                "Cone top radius must be non-negative",
            );
        } finally {
            pub.mockRestore();
        }
    });

    test("sphere: the picked radius wins over a stale panel value", () => {
        const cmd = new PrimitiveSphereCommand() as any;
        cmd.stepDatas = [pick(at(1, 2, 3)), pick(at(1, 2, 16))];
        cmd.radius = 99; // left over from an earlier run's panel

        const feature = cmd.buildFeature() as PrimitiveFeatureData;
        expect(feature.radius).toBe(13);
        expect(cmd.radius).toBe(13);
        expect(feature.axis).toBeUndefined();
    });

    test("a non-positive panel size is a toast and no feature", () => {
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const cmd = boxCmd();
            (cmd as any).getHeightStepData();
            cmd.dy = 0;
            expect((cmd as any).buildFeature()).toBeUndefined();
            expect(pub).toHaveBeenCalledWith(
                "showToast",
                "error.default:{0}",
                "Primitive sizes must be positive",
            );
        } finally {
            pub.mockRestore();
        }
    });

    test("executeMainTask commits the picked box as a standalone body", () => {
        const { doc } = setup();
        const cmd = boxCmd();
        (cmd as any)._application = doc.application;
        // The step flow's write point: the height step's snap data is produced when the
        // rectangle step commits (the real runner calls it; the injected stepDatas skip it).
        (cmd as any).getHeightStepData();

        (cmd as any).executeMainTask();

        const body = doc.modelManager.findNode(
            (node) => node instanceof ParametricBodyNode,
        ) as ParametricBodyNode;
        expect(body).toBeInstanceOf(ParametricBodyNode);
        expect(body.features[0]).toMatchObject({
            type: "primitive",
            primitive: "box",
            dx: 30,
            dy: 20,
            dz: 15,
            origin: { x: 0, y: -20, z: 0 },
            axis: { x: 0, y: 0, z: 1 },
        });
    });
});
