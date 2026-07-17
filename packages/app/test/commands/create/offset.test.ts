// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, Result, ShapeTypes, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { OffsetCommand } from "../../../src/commands/create/offset";
import {
    ensureGlobalStubApp,
    seedStepDatas,
    shapeData,
    shapeStepResult,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("OffsetCommand", () => {
    test("should have command metadata", () => {
        const data = (OffsetCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.offset");
        expect(data.icon).toBe("icon-offset");
    });

    test("joinType should default to 'option.command.joinType.arc'", () => {
        const cmd = new OffsetCommand();
        expect(cmd.joinType).toBe("option.command.joinType.arc");
    });

    test("joinType setter should update property", () => {
        const cmd = new OffsetCommand();
        cmd.joinType = "option.command.joinType.tangent";
        expect(cmd.joinType).toBe("option.command.joinType.tangent");
    });

    test("getSteps should return two steps", () => {
        const cmd = new OffsetCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("mapJoinType", () => {
        test("should map the arc option to 'arc'", () => {
            const cmd = new OffsetCommand();
            cmd.joinType = "option.command.joinType.arc";
            expect((cmd as any).mapJoinType()).toBe("arc");
        });

        test("should map the intersection option to 'intersection'", () => {
            const cmd = new OffsetCommand();
            cmd.joinType = "option.command.joinType.intersection";
            expect((cmd as any).mapJoinType()).toBe("intersection");
        });

        test("should map the tangent option to 'tangent'", () => {
            const cmd = new OffsetCommand();
            cmd.joinType = "option.command.joinType.tangent";
            expect((cmd as any).mapJoinType()).toBe("tangent");
        });

        test("should throw on an unknown joinType", () => {
            const cmd = new OffsetCommand() as any;
            // force an invalid stored value to reach the default branch.
            cmd.setPrivateValue("joinType", "nonsense");
            expect(() => cmd.mapJoinType()).toThrow();
        });
    });

    /**
     * Helper: an edge shape whose curve normal resolves to +Z (direction vector
     * parallel to +X, so curveNormal returns cross(vec, unitX)... we instead
     * return +Z directly via a conic basisCurve.axis). curve.parameter() and
     * curve.dn() feed the tangent/direction used by getEdgeAxis.
     */
    function makeEdgeShape(offsetReturn: unknown) {
        return {
            shapeType: ShapeTypes.edge,
            curve: {
                // isLine checks `.direction`; here undefined so it's treated as
                // a trimmed conic for normal purposes.
                parameter: () => 0,
                length: () => 10,
                dn: () => XYZ.unitX,
                // curveNormal: isTrimmed reads basisCurve, isConic reads axis.
                basisCurve: { axis: XYZ.unitZ, dn: () => XYZ.unitX },
            },
            offset: () => offsetReturn,
        };
    }

    describe("executeMainTask (edge path)", () => {
        test("should add an EditableShapeNode carrying the offset shape to the root", () => {
            const cmd = new OffsetCommand();
            const { doc } = wireCommand(cmd);

            const offsetShape = { shapeType: ShapeTypes.wire };
            const edgeShape = makeEdgeShape(Result.ok(offsetShape as any));

            seedStepDatas(cmd, [
                shapeStepResult([{ shape: edgeShape, point: XYZ.zero }]),
                { type: "input" as const, distance: 5 } as any,
            ]);

            (cmd as any).executeMainTask();

            const root = doc.modelManager.rootNode as any;
            expect(root.added).toHaveLength(1);
            const node = root.added[0];
            expect(node).toBeInstanceOf(EditableShapeNode);
            expect((node as any).shape.value).toBe(offsetShape);
        });

        test("should pass the picked distance into shape.offset()", () => {
            const cmd = new OffsetCommand();
            wireCommand(cmd);

            const received: number[] = [];
            const edgeShape: any = makeEdgeShape(undefined);
            edgeShape.offset = (distance: number) => {
                received.push(distance);
                return Result.ok({ shapeType: ShapeTypes.wire });
            };

            seedStepDatas(cmd, [
                shapeStepResult([{ shape: edgeShape, point: XYZ.zero }]),
                { type: "input" as const, distance: 12 } as any,
            ]);

            (cmd as any).executeMainTask();

            expect(received).toEqual([12]);
        });

        test("should refresh the visual after adding the node", () => {
            const cmd = new OffsetCommand();
            const { doc } = wireCommand(cmd);
            const edgeShape = makeEdgeShape(Result.ok({ shapeType: ShapeTypes.wire } as any));
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: edgeShape, point: XYZ.zero }]),
                { type: "input" as const, distance: 3 } as any,
            ]);

            (cmd as any).executeMainTask();

            expect((doc.visual.update as any).mock.calls.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe("createOffsetShape", () => {
        test("should call shape.offset(distance, normal) for an edge and return its Result", () => {
            const cmd = new OffsetCommand();
            wireCommand(cmd);
            const received: any[] = [];
            const edgeShape: any = makeEdgeShape(undefined);
            edgeShape.offset = (distance: number, normal: unknown) => {
                received.push({ distance, normal });
                return Result.ok({ shapeType: ShapeTypes.wire });
            };
            seedStepDatas(cmd, [shapeStepResult([{ shape: edgeShape, point: XYZ.zero }])]);

            const res = (cmd as any).createOffsetShape(XYZ.unitZ, 8);
            expect(res.isOk).toBe(true);
            expect(received).toEqual([{ distance: 8, normal: XYZ.unitZ }]);
        });

        test("should call wire.offset(distance, mapJoinType()) for a wire", () => {
            const cmd = new OffsetCommand();
            cmd.joinType = "option.command.joinType.intersection";
            wireCommand(cmd);
            const received: any[] = [];
            const wireShape = {
                shapeType: ShapeTypes.wire,
                offset: (distance: number, joinType: string) => {
                    received.push({ distance, joinType });
                    return Result.ok({ shapeType: ShapeTypes.wire });
                },
            };
            seedStepDatas(cmd, [shapeStepResult([{ shape: wireShape, point: XYZ.zero }])]);

            const res = (cmd as any).createOffsetShape(XYZ.unitZ, 4);
            expect(res.isOk).toBe(true);
            expect(received).toEqual([{ distance: 4, joinType: "intersection" }]);
        });

        test("should extract the outer wire before offsetting a face", () => {
            const cmd = new OffsetCommand();
            wireCommand(cmd);
            const outerWire = {
                shapeType: ShapeTypes.wire,
                offset: () => Result.ok({ shapeType: ShapeTypes.wire }),
            };
            const faceShape = {
                shapeType: ShapeTypes.face,
                outerWire: () => outerWire,
            };
            seedStepDatas(cmd, [shapeStepResult([{ shape: faceShape, point: XYZ.zero }])]);

            const res = (cmd as any).createOffsetShape(XYZ.unitZ, 2);
            expect(res.isOk).toBe(true);
        });
    });

    describe("getAxis", () => {
        test("should route edges through getEdgeAxis (point === start)", () => {
            const cmd = new OffsetCommand();
            wireCommand(cmd);
            const edgeShape = makeEdgeShape(Result.ok({ shapeType: ShapeTypes.wire } as any));
            const start = new XYZ({ x: 1, y: 2, z: 3 });
            seedStepDatas(cmd, [shapeStepResult([{ shape: edgeShape, point: start }])]);

            const axis = (cmd as any).getAxis();
            // getEdgeAxis uses the start point directly as `point`.
            expect(axis.point).toBe(start);
            expect(axis.normal).toBeDefined();
            expect(axis.direction).toBeDefined();
        });

        test("should route wires through getFaceOrWireAxis", () => {
            const cmd = new OffsetCommand();
            wireCommand(cmd);

            // A single-edge wire. toFace() yields a face whose normal is +Z.
            // The edge curve exposes the methods GeometryUtils touches.
            const edgeCurve = {
                nearestFromPoint: () => ({ distance: 0.5, point: XYZ.zero, parameter: 0 }),
                dn: () => XYZ.unitX,
                value: () => XYZ.zero,
                firstParameter: () => 0,
                lastParameter: () => 1,
                length: () => 1,
            };
            const theEdge = {
                shapeType: ShapeTypes.edge,
                curve: edgeCurve,
                orientation: () => "forward" as const,
                isEqual: (other: unknown) => other === theEdge,
            };
            const wireShape: any = {
                shapeType: ShapeTypes.wire,
                toFace: () => Result.ok({ normal: () => [XYZ.zero, XYZ.unitZ] } as any),
                findSubShapes: () => [theEdge],
                offset: () => Result.ok({ shapeType: ShapeTypes.wire }),
            };

            seedStepDatas(cmd, [shapeStepResult([{ shape: wireShape, point: XYZ.zero }])]);

            const axis = (cmd as any).getAxis();
            expect(axis.normal.isEqualTo(XYZ.unitZ)).toBe(true);
            expect(axis.direction).toBeDefined();
            // nearest point came from the mock → origin.
            expect(axis.point.isEqualTo(XYZ.zero)).toBe(true);
        });
    });

    describe("getSteps second step data", () => {
        test("should expose a validator that rejects zero distance along the axis", () => {
            const cmd = new OffsetCommand();
            wireCommand(cmd);
            const edgeShape = makeEdgeShape(Result.ok({ shapeType: ShapeTypes.wire } as any));
            seedStepDatas(cmd, [shapeStepResult([{ shape: edgeShape, point: XYZ.zero }])]);

            const steps = (cmd as any).getSteps();
            // The second step's data is a lazy factory; invoke it to read validator.
            const data = steps[1].handleStepData();
            expect(typeof data.validator).toBe("function");
            expect(data.validator(XYZ.zero)).toBe(false);
        });

        test("the validator should accept a non-zero distance along the axis", () => {
            const cmd = new OffsetCommand();
            wireCommand(cmd);
            const edgeShape = makeEdgeShape(Result.ok({ shapeType: ShapeTypes.wire } as any));
            seedStepDatas(cmd, [shapeStepResult([{ shape: edgeShape, point: XYZ.zero }])]);

            const steps = (cmd as any).getSteps();
            const data = steps[1].handleStepData();
            // The edge axis direction is derived from the curve tangent (unitX) crossed
            // with the normal (unitZ) → unitY. A point at +Y has a non-zero dot product.
            expect(data.validator(new XYZ({ x: 0, y: 5, z: 0 }))).toBe(true);
        });

        test("the preview callback should render a vertex mesh plus a line and offset mesh", () => {
            const cmd = new OffsetCommand();
            wireCommand(cmd);
            const edgeShape = makeEdgeShape(
                Result.ok({
                    shapeType: ShapeTypes.wire,
                    edgesMeshPosition: () => ({ type: "edges" }),
                } as any),
            );
            seedStepDatas(cmd, [shapeStepResult([{ shape: edgeShape, point: XYZ.zero }])]);

            const steps = (cmd as any).getSteps();
            const data = steps[1].handleStepData();
            const preview = data.preview(new XYZ({ x: 0, y: 4, z: 0 }));
            expect(Array.isArray(preview)).toBe(true);
            // [meshPoint, meshLine, offsetEdgeMesh]
            expect(preview.length).toBe(3);
        });

        test("the preview callback should render only the vertex mesh when point is undefined", () => {
            const cmd = new OffsetCommand();
            wireCommand(cmd);
            const edgeShape = makeEdgeShape(Result.ok({ shapeType: ShapeTypes.wire } as any));
            seedStepDatas(cmd, [shapeStepResult([{ shape: edgeShape, point: XYZ.zero }])]);

            const steps = (cmd as any).getSteps();
            const data = steps[1].handleStepData();
            const preview = data.preview(undefined);
            expect(preview.length).toBe(1);
        });

        test("the preview callback should omit the offset mesh when createOffsetShape fails", () => {
            const cmd = new OffsetCommand();
            wireCommand(cmd);
            const edgeShape: any = makeEdgeShape(undefined);
            edgeShape.offset = () => Result.err("offset failed");
            seedStepDatas(cmd, [shapeStepResult([{ shape: edgeShape, point: XYZ.zero }])]);

            const steps = (cmd as any).getSteps();
            const data = steps[1].handleStepData();
            const preview = data.preview(new XYZ({ x: 0, y: 4, z: 0 }));
            // [meshPoint, meshLine] — no offset mesh since createOffsetShape errored.
            expect(preview.length).toBe(2);
        });
    });
});
