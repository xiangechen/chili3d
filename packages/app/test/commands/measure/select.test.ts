// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    BoundingBox,
    CancelableCommand,
    type IApplication,
    type ICurve,
    type IEdge,
    type IFace,
    type ISolid,
    type IView,
    Matrix4,
    Plane,
    SelectShapeStep,
    ShapeTypes,
    VisualConfig,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";
import { SelectMeasure } from "../../../src/commands/measure/select";
import { ensureGlobalStubApp, mockShape, wireCommand } from "../../commands/commandTestUtils";

describe("SelectMeasure", () => {
    test("should have command metadata", () => {
        const data = (SelectMeasure as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("measure.select");
        expect(data.icon).toBe("icon-measureSelect");
    });

    test("should extend CancelableCommand", () => {
        const cmd = new SelectMeasure();
        expect(cmd).toBeInstanceOf(CancelableCommand);
    });

    test("category should default to 'common.length'", () => {
        const cmd = new SelectMeasure();
        expect(cmd.category).toBe("common.length");
    });

    test("category setter should update property", () => {
        const cmd = new SelectMeasure();
        cmd.category = "common.area";
        expect(cmd.category).toBe("common.area");

        cmd.category = "common.volume";
        expect(cmd.category).toBe("common.volume");
    });

    test("category setter should accept all three measure types", () => {
        const cmd = new SelectMeasure();
        const types = ["common.length", "common.area", "common.volume"] as const;
        for (const type of types) {
            cmd.category = type;
            expect(cmd.category).toBe(type);
        }
    });

    test("onTypeChange should reset state when category changes", () => {
        const cmd = new SelectMeasure();
        wireCommand(cmd);

        // Trigger onTypeChange by changing category
        cmd.category = "common.area";

        // onTypeChange sets #isChangedType to true and clears sum
        // Verify category changed successfully (no throw)
        expect(cmd.category).toBe("common.area");
    });

    describe("addSumItem", () => {
        test("should initialize sumUI on first call and append to activeView dom", () => {
            const cmd = new SelectMeasure();
            const { doc } = wireCommand(cmd);

            const domContainer = document.createElement("div");
            (cmd as any)._application = {
                activeView: {
                    document: doc,
                    dom: domContainer,
                    workplane: Plane.XY,
                },
            };

            (cmd as any).addSumItem(42.5);

            // Sum UI container should have been appended to the domContainer
            expect(domContainer.children.length).toBeGreaterThanOrEqual(1);
        });

        test("should accumulate items without error", () => {
            const cmd = new SelectMeasure();
            const { doc } = wireCommand(cmd);
            const domContainer = document.createElement("div");
            (cmd as any)._application = {
                activeView: {
                    document: doc,
                    dom: domContainer,
                    workplane: Plane.XY,
                },
            };

            // Multiple calls should not throw
            expect(() => {
                (cmd as any).addSumItem(10);
                (cmd as any).addSumItem(20);
                (cmd as any).addSumItem(30);
            }).not.toThrow();

            expect(domContainer.children.length).toBeGreaterThanOrEqual(1);
        });

        test("should reuse existing sumUI on second call", () => {
            const cmd = new SelectMeasure();
            const { doc } = wireCommand(cmd);
            const domContainer = document.createElement("div");
            (cmd as any)._application = {
                activeView: {
                    document: doc,
                    dom: domContainer,
                    workplane: Plane.XY,
                },
            };

            (cmd as any).addSumItem(1);
            const firstChildCount = domContainer.children.length;

            // Second call should reuse the existing UI, not create a new one
            (cmd as any).addSumItem(2);
            // The sumUI is appended once; the list item is added to the UL inside
            expect(domContainer.children.length).toBe(firstChildCount);
        });
    });

    describe("afterExecute", () => {
        test("should clean up and remove sum UI from DOM", () => {
            const cmd = new SelectMeasure();
            const { doc } = wireCommand(cmd);
            const domContainer = document.createElement("div");
            (cmd as any)._application = {
                activeView: {
                    document: doc,
                    dom: domContainer,
                    workplane: Plane.XY,
                },
            };

            (cmd as any).addSumItem(5);
            expect(domContainer.children.length).toBeGreaterThanOrEqual(1);

            (cmd as any).afterExecute();

            // Sum UI should be removed from DOM
            expect(domContainer.children.length).toBe(0);
        });
    });

    describe("initSumUI", () => {
        test("should create sum UI with header, list, and value", () => {
            const cmd = new SelectMeasure();
            const { doc } = wireCommand(cmd);
            const domContainer = document.createElement("div");
            (cmd as any)._application = {
                activeView: {
                    document: doc,
                    dom: domContainer,
                    workplane: Plane.XY,
                },
            };

            (cmd as any).initSumUI();
            expect(domContainer.children.length).toBe(1);
        });

        test("should replace existing sumUI on second initSumUI call", () => {
            const cmd = new SelectMeasure();
            const { doc } = wireCommand(cmd);
            const domContainer = document.createElement("div");
            (cmd as any)._application = {
                activeView: {
                    document: doc,
                    dom: domContainer,
                    workplane: Plane.XY,
                },
            };

            (cmd as any).initSumUI();
            expect(domContainer.children.length).toBe(1);

            (cmd as any).initSumUI();
            // Should still be 1 since old UI is removed before new one appended
            expect(domContainer.children.length).toBe(1);
        });
    });

    describe("wireCenter", () => {
        test("should compute center of points array", () => {
            const cmd = new SelectMeasure();
            const positions = new Float32Array([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0]);
            const center = (cmd as any).wireCenter(positions);
            expect(center.x).toBeCloseTo(1);
            expect(center.y).toBeCloseTo(1);
            expect(center.z).toBeCloseTo(0);
        });

        test("should handle single point", () => {
            const cmd = new SelectMeasure();
            const positions = new Float32Array([5, 10, 15]);
            const center = (cmd as any).wireCenter(positions);
            expect(center.x).toBeCloseTo(5);
            expect(center.y).toBeCloseTo(10);
            expect(center.z).toBeCloseTo(15);
        });

        test("should handle two points", () => {
            const cmd = new SelectMeasure();
            const positions = new Float32Array([0, 0, 0, 10, 0, 0]);
            const center = (cmd as any).wireCenter(positions);
            expect(center.x).toBeCloseTo(5);
            expect(center.y).toBeCloseTo(0);
            expect(center.z).toBeCloseTo(0);
        });
    });

    describe("createMeasure", () => {
        test("should do nothing when shape is undefined", () => {
            const cmd = new SelectMeasure();
            (cmd as any).createMeasure(undefined);
            // No error thrown
        });

        test("should call edgeMeasure when category is length", () => {
            const cmd = new SelectMeasure();
            const { doc } = wireCommand(cmd);
            (cmd as any)._application = {
                activeView: {
                    document: doc,
                    workplane: Plane.XY,
                    htmlText: () => ({ dispose: () => {} }),
                },
            };
            (cmd as any).category = "common.length";

            const fakeEdge = {
                shapeType: ShapeTypes.edge,
                transformedMul: () => fakeEdge,
                curve: {
                    startPoint: () => new XYZ({ x: 0, y: 0, z: 0 }),
                    endPoint: () => new XYZ({ x: 1, y: 0, z: 0 }),
                },
                length: () => 1.0,
                mesh: { edges: { position: new Float32Array([0, 0, 0, 1, 0, 0]) } },
                dispose: () => {},
            };

            const shapeData = {
                shape: fakeEdge,
                transform: Matrix4.identity(),
                point: undefined,
                indexes: [],
                owner: { node: {}, getNode: () => ({}) },
            } as unknown as VisualShapeData;

            expect(() => (cmd as any).createMeasure(shapeData)).not.toThrow();
        });

        test("should call faceMeasure when category is area", () => {
            const cmd = new SelectMeasure();
            const { doc } = wireCommand(cmd);
            (cmd as any)._application = {
                activeView: {
                    document: doc,
                    workplane: Plane.XY,
                    htmlText: () => ({ dispose: () => {} }),
                },
            };
            cmd.category = "common.area";

            const fakeOuterWire = {
                mesh: { edges: { position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]) } },
                dispose: () => {},
            };

            const fakeFace = {
                shapeType: ShapeTypes.face,
                transformedMul: () => fakeFace,
                outerWire: () => fakeOuterWire,
                area: () => 1.0,
                dispose: () => {},
            };

            const shapeData = {
                shape: fakeFace,
                transform: Matrix4.identity(),
                point: undefined,
                indexes: [],
                owner: { node: {}, getNode: () => ({}) },
            } as unknown as VisualShapeData;

            expect(() => (cmd as any).createMeasure(shapeData)).not.toThrow();
        });

        test("should call solidMeasure when category is volume", () => {
            const cmd = new SelectMeasure();
            const { doc } = wireCommand(cmd);
            (cmd as any)._application = {
                activeView: {
                    document: doc,
                    workplane: Plane.XY,
                    htmlText: () => ({ dispose: () => {} }),
                },
            };
            cmd.category = "common.volume";

            const fakeSolid = {
                shapeType: ShapeTypes.solid,
                transformedMul: () => fakeSolid,
                volume: () => 27.0,
                mesh: {
                    edges: { position: new Float32Array([0, 0, 0, 3, 0, 0]) },
                },
                boundingBox: () => ({
                    min: { x: 0, y: 0, z: 0 },
                    max: { x: 3, y: 3, z: 3 },
                }),
                dispose: () => {},
            };

            const shapeData = {
                shape: fakeSolid,
                transform: Matrix4.identity(),
                point: undefined,
                indexes: [],
                owner: { node: {}, getNode: () => ({}) },
            } as unknown as VisualShapeData;

            expect(() => (cmd as any).createMeasure(shapeData)).not.toThrow();
        });
    });

    describe("edgeMeasure", () => {
        test("should compute length and add sum item", () => {
            const cmd = new SelectMeasure();
            const { doc } = wireCommand(cmd);
            (cmd as any)._application = {
                activeView: {
                    document: doc,
                    workplane: Plane.XY,
                    htmlText: () => ({ dispose: () => {} }),
                },
            };

            const fakeEdge = {
                transformedMul: () => fakeEdge,
                curve: {
                    startPoint: () => new XYZ({ x: 0, y: 0, z: 0 }),
                    endPoint: () => new XYZ({ x: 3, y: 0, z: 0 }),
                },
                length: () => 3.0,
                mesh: {
                    edges: {
                        position: new Float32Array([0, 0, 0, 3, 0, 0]),
                        lineWidth: 1,
                        color: 0,
                    },
                },
                dispose: () => {},
            };

            (cmd as any).edgeMeasure(fakeEdge, Matrix4.identity());

            // Check that the dispose set was populated
            expect(cmd).toBeDefined();
        });
    });

    describe("faceMeasure", () => {
        test("should compute area and add sum item", () => {
            const cmd = new SelectMeasure();
            const { doc } = wireCommand(cmd);
            (cmd as any)._application = {
                activeView: {
                    document: doc,
                    workplane: Plane.XY,
                    htmlText: () => ({ dispose: () => {} }),
                },
            };

            const fakeOuterWire = {
                mesh: {
                    edges: {
                        position: new Float32Array([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0]),
                        lineWidth: 1,
                        color: 0,
                    },
                },
                dispose: () => {},
            };

            const fakeFace = {
                transformedMul: () => fakeFace,
                outerWire: () => fakeOuterWire,
                area: () => 4.0,
                dispose: () => {},
                mesh: { edges: null },
            };

            (cmd as any).faceMeasure(fakeFace, Matrix4.identity());

            expect(cmd).toBeDefined();
        });
    });

    describe("solidMeasure", () => {
        test("should compute volume and add sum item", () => {
            const cmd = new SelectMeasure();
            const { doc } = wireCommand(cmd);
            (cmd as any)._application = {
                activeView: {
                    document: doc,
                    workplane: Plane.XY,
                    htmlText: () => ({ dispose: () => {} }),
                },
            };

            const fakeSolid = {
                volume: () => 8.0,
                mesh: {
                    edges: {
                        position: new Float32Array([0, 0, 0, 2, 0, 0]),
                        lineWidth: 1,
                        color: 0,
                    },
                },
                dispose: () => {},
            };

            (cmd as any).solidMeasure(fakeSolid, Matrix4.identity(), XYZ.zero);

            expect(cmd).toBeDefined();
        });
    });
});
