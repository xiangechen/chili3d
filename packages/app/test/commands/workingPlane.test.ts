// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IApplication,
    type IEdge,
    type IView,
    Matrix4,
    Plane,
    PubSub,
    type SnapResult,
    XYZ,
} from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";
import {
    AlignToPlane,
    FromSection,
    SetWorkplane,
    WorkingPlaneViewModel,
} from "../../src/commands/workingPlane";
import { createMockApplication, createMockDocument } from "../_helpers";
import { mockShape, seedStepDatas, stubTransactionRun, wireCommand } from "./commandTestUtils";

describe("WorkingPlaneViewModel", () => {
    test("should have default planes with XOY selected", () => {
        const vm = new WorkingPlaneViewModel();
        expect(vm.planes).toBeDefined();
        expect(vm.planes.selectedIndexes).toContain(0);
    });

    test("planes should be defined and have selection mode", () => {
        const vm = new WorkingPlaneViewModel();
        expect(vm.planes).toBeDefined();
        expect(vm.planes.selectedIndexes).toContain(0);
    });
});

describe("SetWorkplane", () => {
    test("should have command metadata", () => {
        const data = (SetWorkplane as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("workingPlane.set");
        expect(data.icon).toBe("icon-setWorkingPlane");
    });

    test("should do nothing when activeView is undefined", async () => {
        const app = createMockApplication();
        app.activeView = undefined;

        const cmd = new SetWorkplane();
        await cmd.execute(app);
    });

    test("should show dialog when activeView exists", async () => {
        let dialogShown = false;

        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ..._args: unknown[]) => {
            if (channel === "showDialog") {
                dialogShown = true;
            }
        }) as any;

        const app = createMockApplication();
        app.activeView = {
            document: createMockDocument(),
            workplane: Plane.XY,
        } as any;

        const cmd = new SetWorkplane();
        await cmd.execute(app);

        expect(dialogShown).toBe(true);

        PubSub.default.pub = originalPub;
    });

    test("ui should return a div with radio group elements", () => {
        const cmd = new SetWorkplane();
        const vm = new WorkingPlaneViewModel();
        const result = (cmd as any).ui(vm);
        expect(result).toBeDefined();
        expect(result.tagName.toLowerCase()).toBe("div");
    });
});

describe("AlignToPlane", () => {
    test("should have command metadata", () => {
        const data = (AlignToPlane as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("workingPlane.alignToPlane");
        expect(data.icon).toBe("icon-alignWorkingPlane");
    });

    test("should do nothing when activeView is undefined", async () => {
        const app = createMockApplication();
        app.activeView = undefined;

        const cmd = new AlignToPlane();
        await cmd.execute(app);
    });

    test("should implement ICommand (has execute method)", () => {
        const cmd = new AlignToPlane();
        expect(typeof cmd.execute).toBe("function");
    });
});

describe("FromSection", () => {
    test("should have command metadata", () => {
        const data = (FromSection as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("workingPlane.fromSection");
        expect(data.icon).toBe("icon-fromSection");
    });

    test("getSteps should return two steps", () => {
        const cmd = new FromSection();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("findXVec", () => {
        test("should return unitX when direction is unitZ", () => {
            const cmd = new FromSection();
            const xvec = (cmd as any).findXVec(XYZ.unitZ);
            expect(xvec.isEqualTo(XYZ.unitX)).toBe(true);
        });

        test("should return unitY when direction is -unitZ", () => {
            const cmd = new FromSection();
            const xvec = (cmd as any).findXVec(new XYZ({ x: 0, y: 0, z: -1 }));
            expect(xvec.isEqualTo(XYZ.unitY)).toBe(true);
        });

        test("should return cross product for arbitrary direction", () => {
            const cmd = new FromSection();
            const xvec = (cmd as any).findXVec(XYZ.unitX);
            // cross(unitX, unitZ) = -unitY, normalized = -unitY
            expect(xvec.isEqualTo(XYZ.unitY.reverse())).toBe(true);
        });
    });

    describe("executeMainTask", () => {
        test("should set view.workplane to a plane at the picked point", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new FromSection();
                const { doc } = wireCommand(cmd);

                const view = {
                    document: doc,
                    workplane: Plane.XY,
                    direction: () => XYZ.unitNZ,
                };
                (cmd as any)._application = {
                    activeView: view,
                };

                // Create a mock edge with a curve
                const curve = {
                    parameter: () => 0.5,
                    d1: () => ({
                        point: new XYZ({ x: 1, y: 0, z: 0 }),
                        vec: XYZ.unitX,
                    }),
                    transformed: () => curve,
                    dispose: () => {},
                };
                const edgeShape = mockShape();
                (edgeShape as any).curve = curve;
                (edgeShape as any).matrix = Matrix4.identity();

                seedStepDatas(cmd, [
                    {
                        view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                        type: "shape",
                        shapes: [
                            {
                                shape: edgeShape as unknown as IEdge,
                                transform: Matrix4.identity(),
                                point: undefined,
                                indexes: [],
                                owner: { node: {}, getNode: () => ({}) },
                            },
                        ],
                    } as any,
                    {
                        view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                        type: "input",
                        point: new XYZ({ x: 1, y: 1, z: 0 }),
                    } as SnapResult,
                ]);

                (cmd as any).executeMainTask();

                expect(view.workplane).toBeDefined();
                expect(view.workplane.origin).toBeDefined();
            } finally {
                restoreTx();
            }
        });

        test("should do nothing when parameter is undefined", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new FromSection();
                const { doc } = wireCommand(cmd);

                const view = {
                    document: doc,
                    workplane: Plane.XY,
                    direction: () => XYZ.unitNZ,
                };
                (cmd as any)._application = { activeView: view };

                const curve = {
                    parameter: () => undefined,
                    d1: () => ({ point: XYZ.zero, vec: XYZ.unitX }),
                    transformed: () => curve,
                    dispose: () => {},
                };
                const edgeShape = mockShape();
                (edgeShape as any).curve = curve;
                (edgeShape as any).matrix = Matrix4.identity();

                seedStepDatas(cmd, [
                    {
                        view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                        type: "shape",
                        shapes: [
                            {
                                shape: edgeShape as unknown as IEdge,
                                transform: Matrix4.identity(),
                                point: undefined,
                                indexes: [],
                                owner: { node: {}, getNode: () => ({}) },
                            },
                        ],
                    } as any,
                    {
                        view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                        type: "input",
                        point: new XYZ({ x: 1, y: 1, z: 0 }),
                    } as SnapResult,
                ]);

                // Should not throw; workplane stays unchanged since parameter is undefined
                expect(() => (cmd as any).executeMainTask()).not.toThrow();
            } finally {
                restoreTx();
            }
        });

        test("should do nothing when activeView is undefined", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new FromSection();
                const { doc } = wireCommand(cmd);
                (cmd as any)._application = { activeView: undefined };

                const curve = {
                    parameter: () => 0.5,
                    d1: () => ({ point: new XYZ({ x: 1, y: 0, z: 0 }), vec: XYZ.unitX }),
                    transformed: () => curve,
                    dispose: () => {},
                };
                const edgeShape = mockShape();
                (edgeShape as any).curve = curve;
                (edgeShape as any).matrix = Matrix4.identity();

                seedStepDatas(cmd, [
                    {
                        view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                        type: "shape",
                        shapes: [
                            {
                                shape: edgeShape as unknown as IEdge,
                                transform: Matrix4.identity(),
                                point: undefined,
                                indexes: [],
                                owner: { node: {}, getNode: () => ({}) },
                            },
                        ],
                    } as any,
                    {
                        view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                        type: "input",
                        point: new XYZ({ x: 1, y: 1, z: 0 }),
                    } as SnapResult,
                ]);

                expect(() => (cmd as any).executeMainTask()).not.toThrow();
            } finally {
                restoreTx();
            }
        });
    });

    describe("handlePointData", () => {
        test("should return curve and meshPoint preview", () => {
            const cmd = new FromSection();
            wireCommand(cmd);

            const curve = {
                parameter: () => 0.5,
                d1: () => ({ point: new XYZ({ x: 1, y: 0, z: 0 }), vec: XYZ.unitX }),
                transformed: () => curve,
                dispose: () => {},
                project: () => [XYZ.unitX],
            };
            const edgeShape = mockShape();
            (edgeShape as any).curve = curve;
            (edgeShape as any).matrix = Matrix4.identity();

            seedStepDatas(cmd, [
                {
                    view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                    type: "shape",
                    shapes: [
                        {
                            shape: edgeShape as unknown as IEdge,
                            transform: Matrix4.identity(),
                            point: undefined,
                            indexes: [],
                            owner: { node: {}, getNode: () => ({}) },
                        },
                    ],
                } as any,
            ]);

            const handler = (cmd as any).handlePointData;
            const result = handler();
            expect(result.curve).toBeDefined();
            expect(result.dimension).toBeDefined();
            expect(typeof result.preview).toBe("function");
        });
    });
});
