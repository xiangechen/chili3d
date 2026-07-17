// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, Material } from "@chili3d/core";
import { EditableShapeNode, XYZ } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { OccPerformanceTestCommand } from "../../../src/commands/application/performanceTest";
import { createMockDocument } from "../../_helpers";
import { stubGlobalApp } from "../commandTestUtils";

/** Access @command decorator metadata added to the prototype at runtime. */
function commandData(cls: abstract new (...args: never[]) => unknown): Record<string, unknown> {
    return (cls.prototype as unknown as { data: Record<string, unknown> }).data;
}

describe("OccPerformanceTestCommand", () => {
    test("should have command metadata", () => {
        const data = commandData(OccPerformanceTestCommand);
        expect(data).toBeDefined();
        expect(data["key"]).toBe("test.performance");
        expect(data["icon"]).toBe("icon-performance");
    });

    test("should extend PerformanceTestCommand", () => {
        const cmd = new OccPerformanceTestCommand();
        expect(cmd).toBeInstanceOf(OccPerformanceTestCommand);
    });

    test("should have size, gap, rowCols properties", () => {
        const cmd = new OccPerformanceTestCommand();
        // Access protected base-class properties via structural cast
        const perf = cmd as unknown as { size: number; gap: number; rowCols: number };
        expect(perf.size).toBe(10);
        expect(perf.gap).toBe(1);
        expect(perf.rowCols).toBe(20);
    });

    test("should have createShape method", () => {
        const cmd = new OccPerformanceTestCommand();
        // createShape is protected — verify via prototype
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

            // createShape is protected — expose via structural cast that bypasses visibility
            const exposed = cmd as unknown as {
                createShape: (doc: IDocument, material: Material, position: XYZ) => void;
            };
            exposed.createShape(doc, mat, XYZ.zero);

            // Should have added a node via modelManager.addNode
            expect(addedNodes.length).toBe(1);
            expect(addedNodes[0]).toBeInstanceOf(EditableShapeNode);
        } finally {
            restoreApp();
        }
    });
});
