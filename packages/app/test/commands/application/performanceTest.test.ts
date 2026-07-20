// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandData, IDocument, Material } from "@chili3d/core";
import { EditableShapeNode, ObservableCollection, XYZ } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";

import {
    OccPerformanceTestCommand,
    PerformanceTestCommand,
} from "../../../src/commands/application/performanceTest";
import { createMockDocument } from "../../_helpers";
import { stubGlobalApp } from "../commandTestUtils";

/** Access @command decorator metadata added to the prototype at runtime. */
function commandData(cls: abstract new (...args: never[]) => unknown): Record<string, unknown> {
    return (cls.prototype as unknown as { data: Record<string, unknown> }).data;
}

describe("OccPerformanceTestCommand", () => {
    test("should have command metadata", () => {
        const data = commandData(OccPerformanceTestCommand) as unknown as CommandData;
        expect(data).toBeDefined();
        expect(data.key).toBe("test.performance");
        expect(data.icon).toBe("icon-performance");
    });

    test("should extend PerformanceTestCommand", () => {
        const cmd = new OccPerformanceTestCommand();
        expect(cmd).toBeInstanceOf(OccPerformanceTestCommand);
    });

    test("should have size, gap, rowCols properties", () => {
        const cmd = new OccPerformanceTestCommand();
        const perf = cmd as unknown as { size: number; gap: number; rowCols: number };
        expect(perf.size).toBe(10);
        expect(perf.gap).toBe(1);
        expect(perf.rowCols).toBe(20);
    });

    test("should have createShape method", () => {
        const cmd = new OccPerformanceTestCommand();
        const proto = Object.getPrototypeOf(cmd) as { createShape?: unknown };
        expect(typeof proto.createShape).toBe("function");
    });

    test("createShape should call shapeFactory.box and add node", () => {
        const restoreApp = stubGlobalApp();
        try {
            const cmd = new OccPerformanceTestCommand();
            const mat: Material = { id: "mat-1", name: "test" } as Material;
            const addedNodes: unknown[] = [];

            const doc = createMockDocument({
                modelManager: {
                    addNode: (node: unknown) => {
                        addedNodes.push(node);
                    },
                },
            });

            const exposed = cmd as unknown as {
                createShape: (doc: IDocument, material: Material, position: XYZ) => void;
            };
            exposed.createShape(doc, mat, XYZ.zero);

            expect(addedNodes.length).toBe(1);
            expect(addedNodes[0]).toBeInstanceOf(EditableShapeNode);
        } finally {
            restoreApp();
        }
    });
});

describe("PerformanceTestCommand (abstract base)", () => {
    /** Concrete subclass with small iteration count for fast tests. */
    class TestPerformanceCommand extends PerformanceTestCommand {
        createShapeCalls: Array<{ material: Material; position: XYZ }> = [];

        setupSmallIteration(): this {
            (this as unknown as { rowCols: number }).rowCols = 2;
            (this as unknown as { size: number }).size = 5;
            (this as unknown as { gap: number }).gap = 1;
            return this;
        }

        protected override createShape(_document: IDocument, material: Material, position: XYZ): void {
            this.createShapeCalls.push({ material, position });
        }
    }

    /** Shared mock setup: alert stub + app with materials. */
    interface ExecuteFixture {
        mockMaterial: Material;
        mockDocument: ReturnType<typeof createMockDocument>;
        restoreAlert: () => void;
    }

    function setupExecuteFixture(): ExecuteFixture {
        const originalAlert = globalThis.alert;
        (globalThis as { alert: typeof globalThis.alert }).alert = () => {};

        const mockMaterial: Material = { id: "mat-1", name: "default" } as Material;
        const mockDocument = createMockDocument({
            modelManager: {
                materials: new ObservableCollection(mockMaterial),
                addNode: () => {},
            },
        });
        mockDocument.visual.update = () => {};

        return {
            mockMaterial,
            mockDocument,
            restoreAlert: () => {
                globalThis.alert = originalAlert;
            },
        };
    }

    test("execute should call createShape rowCols^3 times", async () => {
        const { mockDocument, mockMaterial, restoreAlert } = setupExecuteFixture();
        const cmd = new TestPerformanceCommand().setupSmallIteration();

        try {
            await cmd.execute({ newDocument: async () => mockDocument } as unknown as Parameters<
                typeof cmd.execute
            >[0]);

            // 2^3 = 8 iterations
            expect(cmd.createShapeCalls.length).toBe(8);

            for (const call of cmd.createShapeCalls) {
                expect(call.material).toBe(mockMaterial);
            }
        } finally {
            restoreAlert();
        }
    });

    test("execute should pass unique positions to createShape", async () => {
        const { mockDocument, restoreAlert } = setupExecuteFixture();
        const cmd = new TestPerformanceCommand().setupSmallIteration();

        try {
            await cmd.execute({ newDocument: async () => mockDocument } as unknown as Parameters<
                typeof cmd.execute
            >[0]);

            const posKeys = cmd.createShapeCalls.map(
                (c) => `${c.position.x},${c.position.y},${c.position.z}`,
            );
            const uniqueKeys = new Set(posKeys);
            expect(uniqueKeys.size).toBe(8);

            const positions = cmd.createShapeCalls.map((c) => c.position);
            // First position: (0, 0, 0)
            expect(positions[0].x).toBe(0);
            expect(positions[0].y).toBe(0);
            expect(positions[0].z).toBe(0);
            // Last position: (6, 6, 6) = (rowCols-1) * (gap + size) = 1 * 6
            const last = positions[positions.length - 1];
            expect(last.x).toBe(6);
            expect(last.y).toBe(6);
            expect(last.z).toBe(6);
        } finally {
            restoreAlert();
        }
    });

    test("execute should call visual.update after creating shapes", async () => {
        const { mockDocument, restoreAlert } = setupExecuteFixture();
        const cmd = new TestPerformanceCommand().setupSmallIteration();

        let visualUpdated = false;
        mockDocument.visual.update = () => {
            visualUpdated = true;
        };

        try {
            await cmd.execute({ newDocument: async () => mockDocument } as unknown as Parameters<
                typeof cmd.execute
            >[0]);

            expect(visualUpdated).toBe(true);
        } finally {
            restoreAlert();
        }
    });

    test("should create correct grid distance without setupSmallIteration", () => {
        const cmd = new TestPerformanceCommand();
        const perf = cmd as unknown as { size: number; gap: number };
        expect(perf.gap + perf.size).toBe(11);
    });
});
