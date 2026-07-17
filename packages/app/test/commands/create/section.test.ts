// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, ShapeTypes } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { Section } from "../../../src/commands/create/section";
import { ensureGlobalStubApp, seedStepDatas, shapeStepResult, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("Section", () => {
    test("should have command metadata", () => {
        const data = (Section as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.section");
        expect(data.icon).toBe("icon-section");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Section();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("executeMainTask", () => {
        test("should compute shape.section(path) and add an EditableShapeNode to the root", () => {
            const cmd = new Section();
            const { doc } = wireCommand(cmd);
            const sectionResult = { shapeType: ShapeTypes.wire, isSectionResult: true } as unknown as IShape;
            seedStepDatas(cmd, [
                shapeStepResult([
                    {
                        shape: {
                            shapeType: ShapeTypes.solid,
                            section: () => sectionResult,
                        } as Partial<IShape>,
                    },
                ]),
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire } }]),
            ]);

            (cmd as any).executeMainTask();

            const root = doc.modelManager.rootNode as any;
            expect(root.added).toHaveLength(1);
            const node = root.added[0];
            expect(node).toBeInstanceOf(EditableShapeNode);
            // The node's shape should be the value returned by shape.section().
            expect((node as any).shape.value).toBe(sectionResult);
        });

        test("should pass the transformed path into shape.section()", () => {
            const cmd = new Section();
            wireCommand(cmd);
            const sectionCalls: unknown[] = [];
            const sectionShape = {
                shapeType: ShapeTypes.solid,
                section: (path: unknown) => {
                    sectionCalls.push(path);
                    return { shapeType: ShapeTypes.wire };
                },
            } as Partial<IShape>;
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: sectionShape }]),
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire } }]),
            ]);

            (cmd as any).executeMainTask();

            expect(sectionCalls).toHaveLength(1);
            // transformedMul returns the shape itself in the mock.
            expect((sectionCalls[0] as any).shapeType).toBe(ShapeTypes.wire);
        });

        test("should refresh the visual after adding the node", () => {
            const cmd = new Section();
            const { doc } = wireCommand(cmd);
            seedStepDatas(cmd, [
                shapeStepResult([
                    {
                        shape: {
                            shapeType: ShapeTypes.solid,
                            section: () => ({ shapeType: ShapeTypes.wire }),
                        } as unknown as Partial<IShape>,
                    },
                ]),
                shapeStepResult([{ shape: { shapeType: ShapeTypes.wire } }]),
            ]);

            (cmd as any).executeMainTask();

            expect((doc.visual.update as any).mock.calls.length).toBeGreaterThanOrEqual(1);
        });
    });
});
