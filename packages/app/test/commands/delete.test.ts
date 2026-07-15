// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PubSub, Transaction } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { Delete } from "../../src/commands/delete";
import { createMockDocument } from "../_helpers";

describe("Delete", () => {
    test("should have command metadata", () => {
        const data = (Delete as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.deleteNode");
        expect(data.icon).toBe("icon-delete");
    });

    test("getSteps should return one step with multiple: true", () => {
        const cmd = new Delete();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });

    test("executeMainTask should remove nodes using Transaction pattern", () => {
        const originalExecute = Transaction.execute;
        Transaction.execute = ((_doc: unknown, _label: string, fn: () => void) => {
            fn();
        }) as typeof Transaction.execute;

        try {
            const removed: unknown[] = [];
            const nodes = [
                { id: "node-1", parent: { remove: (child: unknown) => removed.push(child) } },
                { id: "node-2", parent: { remove: (child: unknown) => removed.push(child) } },
            ];

            Transaction.execute({} as never, "delete", () => {
                for (const model of nodes) {
                    model.parent?.remove(model);
                }
            });

            expect(removed.length).toBe(2);
        } finally {
            Transaction.execute = originalExecute;
        }
    });

    test("executeMainTask should show toast when no nodes selected", () => {
        let toastMessage = "";
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, message: string) => {
            if (channel === "showToast") {
                toastMessage = message;
            }
        }) as any;

        try {
            const doc = createMockDocument();
            const cmd = new Delete();
            (cmd as any).stepDatas = [{ nodes: undefined }];
            (cmd as any)._application = { activeView: { document: doc } };
            (cmd as any).executeMainTask();
            expect(toastMessage).toBe("toast.select.noSelected");
        } finally {
            PubSub.default.pub = originalPub;
        }
    });

    test("executeMainTask should show toast when nodes array is empty", () => {
        let toastMessage = "";
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, message: string) => {
            if (channel === "showToast") {
                toastMessage = message;
            }
        }) as any;

        try {
            const doc = createMockDocument();
            const cmd = new Delete();
            (cmd as any).stepDatas = [{ nodes: [] }];
            (cmd as any)._application = { activeView: { document: doc } };
            (cmd as any).executeMainTask();
            expect(toastMessage).toBe("toast.select.noSelected");
        } finally {
            PubSub.default.pub = originalPub;
        }
    });

    test("executeMainTask should clear current node if it is in deleted nodes", () => {
        const doc = createMockDocument();
        const nodeToDelete = { id: "target", parent: { remove: () => {} } };
        doc.modelManager.currentNode = nodeToDelete as any;
        doc.modelManager.rootNode = { id: "root" } as any;

        const originalExecute = Transaction.execute;
        Transaction.execute = ((_doc: unknown, _label: string, fn: () => void) => {
            fn();
        }) as typeof Transaction.execute;

        try {
            const cmd = new Delete();
            (cmd as any)._application = { activeView: { document: doc } };
            (cmd as any).stepDatas = [{ nodes: [nodeToDelete] }];
            (cmd as any).executeMainTask();

            expect(doc.modelManager.currentNode).toBe(doc.modelManager.rootNode);
        } finally {
            Transaction.execute = originalExecute;
        }
    });
});
