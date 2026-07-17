// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Component,
    type ComponentNode,
    type IApplication,
    type IStep,
    type IView,
    Matrix4,
    Plane,
    PubSub,
    Transaction,
    type VisualNode,
    XYZ,
} from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";
import { GroupCommand } from "../../../src/commands/create/group";
import { TestNode } from "../../_helpers";
import {
    makeParent,
    nodeStepResult,
    seedStepDatas,
    stubTransactionRun,
    wireCommand,
} from "../../commands/commandTestUtils";

describe("GroupCommand", () => {
    test("should have command metadata", () => {
        const data = (GroupCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.group");
        expect(data.icon).toBe("icon-group");
    });

    test("getSteps should return one step", () => {
        const cmd = new GroupCommand();
        const steps = (cmd as any).getSteps() as IStep[];
        expect(steps.length).toBe(1);
    });

    describe("executeMainTask", () => {
        test("should publish showToast when no valid nodes selected", () => {
            let toastMsg = "";
            const originalPub = PubSub.default.pub;
            PubSub.default.pub = ((channel: string, ...args: string[]) => {
                if (channel === "showToast") {
                    toastMsg = args[0] ?? "";
                }
            }) as any;

            try {
                const cmd = new GroupCommand();
                wireCommand(cmd);
                // No nodes
                seedStepDatas(cmd, [nodeStepResult([])]);

                (cmd as any).executeMainTask();

                expect(toastMsg).toBe("toast.select.noSelected");
            } finally {
                PubSub.default.pub = originalPub;
            }
        });

        test("should publish showToast when nodes is undefined", () => {
            let toastMsg = "";
            const originalPub = PubSub.default.pub;
            PubSub.default.pub = ((channel: string, ...args: string[]) => {
                if (channel === "showToast") {
                    toastMsg = args[0] ?? "";
                }
            }) as any;

            try {
                const cmd = new GroupCommand();
                wireCommand(cmd);
                // stepDatas with no nodes property
                seedStepDatas(cmd, [
                    {
                        view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                        type: "input",
                        point: undefined,
                        shapes: [],
                    } as any,
                ]);

                (cmd as any).executeMainTask();

                expect(toastMsg).toBe("toast.select.noSelected");
            } finally {
                PubSub.default.pub = originalPub;
            }
        });

        test("should show dialog when valid VisualNodes are selected", () => {
            let dialogShown = false;
            const originalPub = PubSub.default.pub;
            PubSub.default.pub = ((channel: string, ..._args: unknown[]) => {
                if (channel === "showDialog") {
                    dialogShown = true;
                }
            }) as any;

            try {
                const cmd = new GroupCommand();
                wireCommand(cmd);

                const testNode = new TestNode("test-node", "node-1");
                seedStepDatas(cmd, [nodeStepResult([testNode as unknown as VisualNode])]);

                (cmd as any).executeMainTask();

                expect(dialogShown).toBe(true);
            } finally {
                PubSub.default.pub = originalPub;
            }
        });

        test("should filter out non-VisualNode instances", () => {
            let toastMsg = "";
            const originalPub = PubSub.default.pub;
            PubSub.default.pub = ((channel: string, ...args: string[]) => {
                if (channel === "showToast") {
                    toastMsg = args[0] ?? "";
                }
            }) as any;

            try {
                const cmd = new GroupCommand();
                wireCommand(cmd);

                // A non-VisualNode object
                const nonVisualNode = { name: "not-a-visual" };
                seedStepDatas(cmd, [nodeStepResult([nonVisualNode as any])]);

                (cmd as any).executeMainTask();

                // filter((node) => node instanceof VisualNode) removes non-VisualNode
                expect(toastMsg).toBe("toast.select.noSelected");
            } finally {
                PubSub.default.pub = originalPub;
            }
        });

        test("createGroup should transfer nodes and create component", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new GroupCommand();
                const { doc } = wireCommand(cmd);
                // Add components array (GroupCommand pushes to it)
                const components: Component[] = [];
                (doc.modelManager as any).components = components;
                const rootNode = makeParent({ id: "root" });
                (doc.modelManager as any).rootNode = rootNode;

                const parent = makeParent({ id: "parent" });
                const testNode = {
                    parent,
                    worldTransform: () => Matrix4.identity(),
                };

                const nodeList = [testNode as unknown as VisualNode];

                // Seed stepDatas so this.stepDatas[0].nodes is populated
                seedStepDatas(cmd, [nodeStepResult(nodeList)]);

                const definition = {
                    name: "MyGroup",
                    insert: XYZ.zero,
                    convertInstance: true,
                };

                (cmd as any).createGroup(definition, nodeList);

                // Component should be pushed to components
                expect(components.length).toBe(1);
                expect(components[0].name).toBe("MyGroup");

                // A ComponentNode should be added to root when convertInstance=true
                expect(rootNode.added.length).toBe(1);
            } finally {
                restoreTx();
            }
        });

        test("createGroup should not add ComponentNode when convertInstance is false", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new GroupCommand();
                const { doc } = wireCommand(cmd);
                const components: Component[] = [];
                (doc.modelManager as any).components = components;
                const rootNode = makeParent({ id: "root" });
                (doc.modelManager as any).rootNode = rootNode;

                const testNode = {
                    parent: makeParent({ id: "parent" }),
                    worldTransform: () => Matrix4.identity(),
                };

                const nodeList = [testNode as unknown as VisualNode];
                seedStepDatas(cmd, [nodeStepResult(nodeList)]);

                const definition = {
                    name: "MyGroup",
                    insert: XYZ.zero,
                    convertInstance: false,
                };

                (cmd as any).createGroup(definition, [testNode as unknown as VisualNode]);

                // Component should still be created
                expect(components.length).toBe(1);
                // But no ComponentNode should be added to root
                expect(rootNode.added.length).toBe(0);
            } finally {
                restoreTx();
            }
        });
    });

    describe("findDialog", () => {
        test("should return the element when it is an HTMLDialogElement", () => {
            const cmd = new GroupCommand();
            const dialog = document.createElement("dialog");
            const result = (cmd as any).findDialog(dialog);
            expect(result).toBe(dialog);
        });

        test("should traverse up to find dialog parent", () => {
            const cmd = new GroupCommand();
            const dialog = document.createElement("dialog");
            const child = document.createElement("div");
            const grandchild = document.createElement("span");
            dialog.appendChild(child);
            child.appendChild(grandchild);

            const result = (cmd as any).findDialog(grandchild);
            expect(result).toBe(dialog);
        });

        test("should return undefined when no dialog ancestor exists", () => {
            const cmd = new GroupCommand();
            const div = document.createElement("div");
            const result = (cmd as any).findDialog(div);
            expect(result).toBeUndefined();
        });
    });
});
