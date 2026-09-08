// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4 } from "@chili3d/core";
import { createMockApplication, createMockDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { buildNodeTools } from "../src/tools/nodeTools";

describe("nodeTools", () => {
    test("delete_node removes a node by id", async () => {
        const removed: string[] = [];
        const node = { id: "n1", name: "box", visible: true, parent: { remove: () => removed.push("n1") } };
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn(() => [node]);
        (doc.visual as any).update = rs.fn(() => {});

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);

        try {
            const tool = buildNodeTools().find((t) => t.name === "delete_node")!;
            const result = JSON.parse((await tool.handler({ id: "n1" })) as string);
            expect(result.deleted).toBe("n1");
            expect(removed).toEqual(["n1"]);
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("set_node_visible toggles node visibility", async () => {
        const node = { id: "n1", name: "box", visible: true };
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn(() => [node]);
        (doc.visual as any).update = rs.fn(() => {});

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);

        try {
            const tool = buildNodeTools().find((t) => t.name === "set_node_visible")!;
            const result = JSON.parse((await tool.handler({ id: "n1", visible: false })) as string);
            expect(node.visible).toBe(false);
            expect(result.visible).toBe(false);
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("transform_node translates a node", async () => {
        const node = { id: "n1", name: "box", transform: Matrix4.identity() };
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn(() => [node]);
        (doc.visual as any).update = rs.fn(() => {});

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);

        try {
            const tool = buildNodeTools().find((t) => t.name === "transform_node")!;
            const result = JSON.parse(
                (await tool.handler({ id: "n1", translate: { x: 10, y: 20, z: 30 } })) as string,
            );
            expect(node.transform.toArray().slice(12, 15)).toEqual([10, 20, 30]);
            expect(result.id).toBe("n1");
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("transform_node composes scale, rotation and translation in order", async () => {
        const node = { id: "n1", name: "box", transform: Matrix4.identity() };
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn(() => [node]);
        (doc.visual as any).update = rs.fn(() => {});

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);

        try {
            const tool = buildNodeTools().find((t) => t.name === "transform_node")!;
            await tool.handler({
                id: "n1",
                scale: 2,
                rotate: { axis: { x: 0, y: 0, z: 1 }, angle: 90 },
                translate: { x: 5, y: 0, z: 0 },
            });
            const expected = Matrix4.fromScale(2, 2, 2)
                .multiply(Matrix4.fromAxisRad({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, Math.PI / 2))
                .multiply(Matrix4.fromTranslation(5, 0, 0));
            expect(node.transform.equals(expected)).toBe(true);
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test.each([
        { id: "n1" },
        { id: "n1", rotate: { axis: { x: 0, y: 0, z: 0 }, angle: 90 } },
        { id: "n1", scale: 0 },
        { id: "n1", mirror: { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 } } },
    ])("transform_node rejects invalid args %j", async (args) => {
        const node = { id: "n1", name: "box", transform: Matrix4.identity() };
        const doc = createMockDocument();
        (doc.modelManager as any).findNodes = rs.fn(() => [node]);
        (doc.visual as any).update = rs.fn(() => {});

        const app = createMockApplication();
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);

        try {
            const tool = buildNodeTools().find((t) => t.name === "transform_node")!;
            const result = JSON.parse((await tool.handler(args)) as string);
            expect(result.error).toBeDefined();
            expect(node.transform.equals(Matrix4.identity())).toBe(true);
        } finally {
            rs.unstubAllGlobals();
        }
    });
});
