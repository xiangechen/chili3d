// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IView,
    LengthAtAxisStep,
    LengthAtPlaneStep,
    Plane,
    PointStep,
    PubSub,
    Result,
    XYZ,
} from "@chili3d/core";
import {
    createHandlerMockView,
    createMockApplication,
    createMockShape,
    createMockVisualWithDocument,
    setupShapeFactoryMock,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import "../../src/features"; // registers all feature handlers
import { HelixFeatureCommand } from "../../src/commands/helixCommand";
import type { HelixFeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";

const at = (x: number, y: number, z: number) => new XYZ(x, y, z);
const pick = (point: XYZ, plane?: Plane, view?: IView) =>
    ({ point, plane, view, shapes: [], type: "pick" }) as any;
const xyzOf = (v: XYZ) => [v.x, v.y, v.z];

/** A helix drag: centre (5, 5, 0), radius point (8, 9) — a 3-4-5 — height 12 up. */
function helixCmd(step2 = at(5, 5, 12)) {
    // The camera feeds `findPlane`'s closest-plane raycast; from straight above, the radius
    // plane resolves to XY.
    const view = createHandlerMockView({
        cameraController: { cameraPosition: at(0, 0, 100), cameraType: "perspective" } as any,
    });
    const cmd = new HelixFeatureCommand() as any;
    cmd.stepDatas = [pick(at(5, 5, 0), undefined, view), pick(at(8, 9, 0), Plane.XY), pick(step2)];
    return cmd as HelixFeatureCommand;
}

/** Records the factory calls the previews and rebuilds make. */
function factoryCalls() {
    const calls: { helix: unknown[][]; circle: unknown[][] } = { helix: [], circle: [] };
    setupShapeFactoryMock({
        helix: (...args: unknown[]) => {
            calls.helix.push(args);
            return Result.ok(createMockShape());
        },
        circle: (...args: unknown[]) => {
            calls.circle.push(args);
            return Result.ok(createMockShape());
        },
    });
    return calls;
}

describe("helix command", () => {
    test("the option-panel sizes default to radius 5, length 20, pitch 2", () => {
        const cmd = new HelixFeatureCommand();
        expect([cmd.radius, cmd.length, cmd.pitch]).toEqual([5, 20, 2]);
    });

    test("three steps: centre, radius on a plane, height along its normal", () => {
        const steps = (new HelixFeatureCommand() as any).getSteps();
        expect(steps).toHaveLength(3);
        expect(steps[0]).toBeInstanceOf(PointStep);
        expect(steps[1]).toBeInstanceOf(LengthAtPlaneStep);
        expect(steps[2]).toBeInstanceOf(LengthAtAxisStep);
        expect(steps[0].tip).toBe("prompt.pickCircleCenter");
        expect(steps[1].tip).toBe("prompt.pickRadius");
        expect(steps[2].tip).toBe("prompt.pickNextPoint");
    });

    test("the radius step refuses a zero radius and a pick along the plane normal", () => {
        const cmd = helixCmd();
        const data = (cmd as any).getRadiusData();
        expect(data.point()).toEqual(at(5, 5, 0));
        expect(data.validator(at(5, 5, 0))).toBe(false);
        // Straight above the centre: on the resolved (XY) plane's normal.
        expect(data.validator(at(5, 5, 5))).toBe(false);
        expect(data.validator(at(8, 9, 0))).toBe(true);
    });

    test("the height step runs along the committed radius plane's normal", () => {
        const cmd = helixCmd();
        const data = (cmd as any).getHeightStepData();
        expect(data.point).toEqual(at(5, 5, 0));
        expect(xyzOf(data.direction)).toEqual([0, 0, 1]);
        expect(data.validator(at(5, 5, 0))).toBe(false);
        expect(data.validator(at(5, 5, 3))).toBe(true);
    });

    test("the committed radius writes to the panel at the height step; a panel edit wins", () => {
        const cmd = helixCmd();
        (cmd as any).getHeightStepData();
        expect(cmd.radius).toBe(5);

        cmd.radius = 7;
        const feature = (cmd as any).buildFeature() as HelixFeatureData;
        expect(feature.radius).toBe(7);
    });

    test("the length pick always wins — written at the commit, with no edit window", () => {
        const cmd = helixCmd();
        (cmd as any).getHeightStepData();
        cmd.length = 99; // a panel edit during the height drag

        const feature = (cmd as any).buildFeature() as HelixFeatureData;
        expect(feature.length).toBe(12);
        expect(cmd.length).toBe(12); // the panel shows what was placed
    });

    test("the picks land in the feature payload; pitch is the panel's, turns stays derivable", () => {
        const cmd = helixCmd();
        (cmd as any).getHeightStepData();

        const feature = (cmd as any).buildFeature() as HelixFeatureData;
        expect(feature).toMatchObject({
            type: "helix",
            origin: { x: 5, y: 5, z: 0 },
            radius: 5,
            length: 12,
            pitch: 2,
            axis: { x: 0, y: 0, z: 1 },
        });
        expect(feature.turns).toBeUndefined();
    });

    test("a downward drag stores the axis reversed and the length positive", () => {
        const cmd = helixCmd(at(5, 5, -12));
        (cmd as any).getHeightStepData();

        const feature = (cmd as any).buildFeature() as HelixFeatureData;
        expect(feature.axis).toEqual({ x: 0, y: 0, z: -1 });
        expect(feature.length).toBe(12);
    });

    test("a zero pitch is a toast and no feature; a negative one passes for the rebuild to report", () => {
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const cmd = helixCmd();
            (cmd as any).getHeightStepData();
            cmd.pitch = 0;
            expect((cmd as any).buildFeature()).toBeUndefined();
            expect(pub).toHaveBeenCalledWith(
                "showToast",
                "error.default:{0}",
                "Helix radius and length must be positive, and the pitch non-zero",
            );
        } finally {
            pub.mockRestore();
        }

        const ok = helixCmd();
        (ok as any).getHeightStepData();
        ok.pitch = -2;
        expect(((ok as any).buildFeature() as HelixFeatureData).pitch).toBe(-2);
    });

    test("a non-positive panel radius is a toast and no feature", () => {
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const cmd = helixCmd();
            (cmd as any).getHeightStepData();
            cmd.radius = 0;
            expect((cmd as any).buildFeature()).toBeUndefined();
            expect(pub).toHaveBeenCalledWith(
                "showToast",
                "error.default:{0}",
                "Helix radius and length must be positive, and the pitch non-zero",
            );
        } finally {
            pub.mockRestore();
        }
    });

    test("an expression the command cannot resolve passes the commit check", () => {
        const cmd = helixCmd();
        (cmd as any).getHeightStepData();
        cmd.pitch = "no_such_var";

        const feature = (cmd as any).buildFeature() as HelixFeatureData;
        expect(feature.pitch).toBe("no_such_var");
    });

    test("the height preview meshes the coil the feature will build", () => {
        const calls = factoryCalls();
        const cmd = helixCmd();
        const data = (cmd as any).getHeightStepData();
        const feature = (cmd as any).buildFeature() as HelixFeatureData;
        data.preview(at(5, 5, 12));
        expect(calls.helix).toHaveLength(1);

        // The feature rebuilds through the same factory with the same arguments: origin,
        // axis, the deterministic frame xvec, radius, pitch and the swept angle.
        const doc = new TestDocument({ application: createMockApplication() });
        const body = new ParametricBodyNode({ document: doc, features: [feature] });
        doc.modelManager.addNode(body);
        expect(body.shape.isOk).toBe(true);
        expect(calls.helix).toHaveLength(2);

        const [preview, rebuilt] = calls.helix.map((args) => [
            xyzOf(args[0] as XYZ),
            xyzOf(args[1] as XYZ),
            xyzOf(args[2] as XYZ),
            ...args.slice(3),
        ]);
        expect(preview).toEqual([[5, 5, 0], [0, 0, 1], [1, 0, 0], 5, 2, 2160]);
        expect(rebuilt).toEqual(preview);
    });

    test("the preview reads the panel's radius and pitch while the height drags", () => {
        const calls = factoryCalls();
        const cmd = helixCmd();
        const data = (cmd as any).getHeightStepData();
        cmd.radius = 7;
        cmd.pitch = 4;
        data.preview(at(5, 5, 12));

        const [, , , radius, pitch, angle] = calls.helix[0] as [XYZ, XYZ, XYZ, number, number, number];
        expect([radius, pitch, angle]).toEqual([7, 4, 1080]); // angle = 12 / 4 · 360
    });

    test("a downward drag previews the coil with the axis reversed", () => {
        const calls = factoryCalls();
        const cmd = helixCmd();
        const data = (cmd as any).getHeightStepData();
        data.preview(at(5, 5, -12));

        const [, normal, xDir, , , angle] = calls.helix[0] as [XYZ, XYZ, XYZ, number, number, number];
        expect(xyzOf(normal)).toEqual([0, 0, -1]);
        expect(xyzOf(xDir)).toEqual([1, 0, 0]);
        expect(angle).toBe(2160);
    });

    test("without a height point — or with a coil that cannot sweep — the committed circle stands in", () => {
        const calls = factoryCalls();
        const cmd = helixCmd();
        const data = (cmd as any).getHeightStepData();

        data.preview(undefined);
        expect(calls.helix).toHaveLength(0);
        expect(calls.circle).toHaveLength(1);
        expect(xyzOf(calls.circle[0][0] as XYZ)).toEqual([0, 0, 1]);
        expect(calls.circle[0][2]).toBe(5);

        cmd.pitch = 0;
        data.preview(at(5, 5, 12));
        expect(calls.helix).toHaveLength(0);
        expect(calls.circle).toHaveLength(2);
    });

    test("executeMainTask commits the picked helix as a standalone body", () => {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        doc.visual = createMockVisualWithDocument(doc) as any;
        const cmd = helixCmd();
        (cmd as any)._application = app;
        // The step flow's write point: the height step's snap data is produced when the
        // radius step commits (the real runner calls it; the injected stepDatas skip it).
        (cmd as any).getHeightStepData();

        (cmd as any).executeMainTask();

        const body = doc.modelManager.findNode(
            (node) => node instanceof ParametricBodyNode,
        ) as ParametricBodyNode;
        expect(body).toBeInstanceOf(ParametricBodyNode);
        expect(body.features[0]).toMatchObject({
            type: "helix",
            origin: { x: 5, y: 5, z: 0 },
            radius: 5,
            length: 12,
            pitch: 2,
            axis: { x: 0, y: 0, z: 1 },
        });
    });
});
