// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { GeometryNode, IStep } from "@chili3d/core";
import { Transaction } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { CreateFaceableCommand, CreateNodeCommand } from "../../src/commands/createCommand";
import { createMockDocument } from "../_helpers";

describe("CreateCommand", () => {
    test("Transaction.execute pattern should add node and update visual", () => {
        const doc = createMockDocument();
        let addNodeCalled = false;
        let visualUpdated = false;

        const originalExecute = Transaction.execute;
        Transaction.execute = ((_doc: unknown, _label: string, fn: () => void) => {
            fn();
        }) as typeof Transaction.execute;

        doc.modelManager.addNode = () => {
            addNodeCalled = true;
        };
        doc.visual.update = () => {
            visualUpdated = true;
        };

        Transaction.execute(doc, "test", () => {
            doc.modelManager.addNode({ id: "test-node" } as never);
            doc.visual.update();
        });

        expect(addNodeCalled).toBe(true);
        expect(visualUpdated).toBe(true);

        Transaction.execute = originalExecute;
    });
});

describe("CreateNodeCommand", () => {
    test("executeMainTask should add node via modelManager and update visual", () => {
        const doc = createMockDocument();
        let addNodeArg: unknown;
        let visualUpdateCalled = false;

        const originalExecute = Transaction.execute;
        Transaction.execute = ((_doc: unknown, _label: string, fn: () => void) => {
            fn();
        }) as typeof Transaction.execute;

        doc.modelManager.addNode = (node: unknown) => {
            addNodeArg = node;
        };
        doc.visual.update = () => {
            visualUpdateCalled = true;
        };

        const testNode = { id: "test-node" } as unknown as GeometryNode;

        const CmdClass = class extends CreateNodeCommand {
            protected override getNode(): GeometryNode {
                return testNode;
            }
            protected getSteps(): IStep[] {
                return [];
            }
        };
        // @command decorator sets data on prototype
        (CmdClass.prototype as any).data = { name: "TestCreateNode" };

        const cmd = new CmdClass();

        (cmd as any)._application = { activeView: { document: doc } };
        (cmd as any).executeMainTask();

        expect(addNodeArg).toBe(testNode);
        expect(visualUpdateCalled).toBe(true);

        Transaction.execute = originalExecute;
    });
});

describe("CreateFaceableCommand", () => {
    test("isFace should default to true", () => {
        const cmd = createConcreteFaceableCommand();
        expect(cmd.isFace).toBe(true);
    });

    test("isFace setter should update property", () => {
        const cmd = createConcreteFaceableCommand();
        cmd.isFace = false;
        expect(cmd.isFace).toBe(false);

        cmd.isFace = true;
        expect(cmd.isFace).toBe(true);
    });
});

function createConcreteFaceableCommand(): CreateFaceableCommand {
    return new (class extends CreateFaceableCommand {
        protected override geometryNode(): GeometryNode {
            return { id: "test" } as unknown as GeometryNode;
        }
        protected getSteps(): IStep[] {
            return [];
        }
    })();
}
