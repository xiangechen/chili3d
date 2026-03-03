// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FolderNode, Id, type INode, type ModelManager, type OnNodeChanged } from "../src";
import { TestDocument } from "./testDocument";

function newNode(name: string, id?: string): INode {
    return {
        id: id ?? Id.generate(),
        name,
        visible: true,
        parentVisible: true,
        parent: undefined,
        previousSibling: undefined,
        nextSibling: undefined,
        onPropertyChanged: () => {},
        clearPropertyChanged() {},
        removePropertyChanged: () => {},
        clone: () => ({}) as any,
        dispose() {},
    };
}

function getChildren(node: INode): INode[] {
    const result: INode[] = [];
    let child = (node as any).firstChild;
    while (child) {
        result.push(child);
        child = child.nextSibling;
    }
    return result;
}

describe("ModelManager", () => {
    let doc: TestDocument;
    let modelManager: ModelManager;

    beforeEach(() => {
        doc = new TestDocument();
        modelManager = doc.modelManager;
    });

    describe("constructor", () => {
        test("should initialize with empty components", () => {
            expect(modelManager.components).toHaveLength(0);
        });

        test("should initialize with empty materials collection", () => {
            expect(modelManager.materials).toBeDefined();
            expect(modelManager.materials).toHaveLength(0);
        });

        test("should initialize with empty node changed observers", () => {
            expect(modelManager["_nodeChangedObservers"].size).toBe(0);
        });
    });

    describe("rootNode", () => {
        test("should return FolderNode when accessed first time", () => {
            const rootNode = modelManager.rootNode;
            expect(rootNode).toBeInstanceOf(FolderNode);
            expect(rootNode.name).toBe(doc.name);
        });

        test("should return same instance on subsequent accesses", () => {
            const rootNode1 = modelManager.rootNode;
            const rootNode2 = modelManager.rootNode;
            expect(rootNode1).toBe(rootNode2);
        });

        test("should set new rootNode", () => {
            const newRoot = new FolderNode(doc, "newRoot");
            modelManager.rootNode = newRoot;
            expect(modelManager.rootNode).toBe(newRoot);
        });

        test("should update document name when rootNode name changes", () => {
            const newRoot = new FolderNode(doc, "newRoot");
            modelManager.rootNode = newRoot;
            newRoot.name = "updatedName";
            expect(doc.name).toBe("updatedName");
        });

        test("should not update if setting same rootNode", () => {
            const rootNode = modelManager.rootNode;
            const initialName = doc.name;
            modelManager.rootNode = rootNode;
            expect(doc.name).toBe(initialName);
        });

        test("should set undefined rootNode to new FolderNode", () => {
            modelManager.rootNode = undefined as any;
            const rootNode = modelManager.rootNode;
            expect(rootNode).toBeInstanceOf(FolderNode);
            expect(rootNode.name).toBe(doc.name);
        });
    });

    describe("currentNode", () => {
        test("should return undefined by default", () => {
            expect(modelManager.currentNode).toBeUndefined();
        });

        test("should set currentNode", () => {
            const node = new FolderNode(doc, "current");
            modelManager.currentNode = node;
            expect(modelManager.currentNode).toBe(node);
        });

        test("should set currentNode to undefined", () => {
            const node = new FolderNode(doc, "current");
            modelManager.currentNode = node;
            modelManager.currentNode = undefined;
            expect(modelManager.currentNode).toBeUndefined();
        });
    });

    describe("node observers", () => {
        test("should add and remove node observer", () => {
            const observer: OnNodeChanged = () => {};
            modelManager.addNodeObserver(observer);
            expect(modelManager["_nodeChangedObservers"].has(observer)).toBe(true);

            modelManager.removeNodeObserver(observer);
            expect(modelManager["_nodeChangedObservers"].has(observer)).toBe(false);
        });

        test("should notify node observer when notifyNodeChanged is called", () => {
            let called = false;
            let receivedRecords: any[] = [];
            const observer: OnNodeChanged = (records) => {
                called = true;
                receivedRecords = records;
            };
            modelManager.addNodeObserver(observer);

            const records = [{ node: {} as INode, action: 0 as any }];
            modelManager.notifyNodeChanged(records);

            expect(called).toBe(true);
            expect(receivedRecords).toBe(records);
        });

        test("should notify multiple observers", () => {
            let callCount1 = 0;
            let callCount2 = 0;
            const observer1: OnNodeChanged = () => {
                callCount1++;
            };
            const observer2: OnNodeChanged = () => {
                callCount2++;
            };
            modelManager.addNodeObserver(observer1);
            modelManager.addNodeObserver(observer2);

            const records = [{ node: {} as INode, action: 0 as any }];
            modelManager.notifyNodeChanged(records);

            expect(callCount1).toBe(1);
            expect(callCount2).toBe(1);
        });
    });

    describe("addNode", () => {
        test("should add node to currentNode if set", () => {
            const currentNode = new FolderNode(doc, "current");
            modelManager.currentNode = currentNode;

            const childNode = newNode("child");
            modelManager.addNode(childNode);

            const children = getChildren(currentNode);
            expect(children).toContain(childNode);
        });

        test("should add node to rootNode if currentNode is not set", () => {
            const childNode = newNode("child");
            modelManager.addNode(childNode);

            const children = getChildren(modelManager.rootNode);
            expect(children).toContain(childNode);
        });

        test("should add multiple nodes", () => {
            const child1 = newNode("child1");
            const child2 = newNode("child2");
            modelManager.addNode(child1, child2);

            const children = getChildren(modelManager.rootNode);
            expect(children).toContain(child1);
            expect(children).toContain(child2);
        });
    });

    describe("findNode", () => {
        test("should return undefined when rootNode is not initialized", () => {
            modelManager["_rootNode"] = undefined;
            const result = modelManager.findNode(() => true);
            expect(result).toBeUndefined();
        });

        test("should find node by predicate", () => {
            const parent = new FolderNode(doc, "parent");
            const targetNode = newNode("target");
            parent.add(targetNode);
            modelManager.rootNode = parent;

            const found = modelManager.findNode((node) => node.name === "target");
            expect(found).toBe(targetNode);
        });

        test("should return undefined when node not found", () => {
            const parent = new FolderNode(doc, "parent");
            modelManager.rootNode = parent;

            const found = modelManager.findNode((node) => node.name === "nonexistent");
            expect(found).toBeUndefined();
        });

        test("should search in nested children", () => {
            const parent = new FolderNode(doc, "parent");
            const child = new FolderNode(doc, "child");
            const targetNode = newNode("target");
            child.add(targetNode);
            parent.add(child);
            modelManager.rootNode = parent;

            const found = modelManager.findNode((node) => node.name === "target");
            expect(found).toBe(targetNode);
        });
    });

    describe("findNodes", () => {
        test("should return empty array when rootNode is not initialized", () => {
            modelManager["_rootNode"] = undefined;
            const result = modelManager.findNodes();
            expect(result).toEqual([]);
        });

        test("should return all nodes when no predicate", () => {
            const parent = new FolderNode(doc, "parent");
            const child1 = newNode("child1");
            const child2 = newNode("child2");
            parent.add(child1, child2);
            modelManager.rootNode = parent;

            const nodes = modelManager.findNodes();
            expect(nodes).toHaveLength(2);
        });

        test("should filter nodes by predicate", () => {
            const parent = new FolderNode(doc, "parent");
            const special1 = newNode("special1");
            const special2 = newNode("special2");
            const normal = newNode("normal");
            parent.add(special1, special2, normal);
            modelManager.rootNode = parent;

            const specialNodes = modelManager.findNodes((node) => node.name.includes("special"));
            expect(specialNodes).toHaveLength(2);
            expect(specialNodes).toContain(special1);
            expect(specialNodes).toContain(special2);
        });

        test("should search in nested children", () => {
            const parent = new FolderNode(doc, "parent");
            const child = new FolderNode(doc, "child");
            const nestedNode = newNode("nested");
            child.add(nestedNode);
            parent.add(child);
            modelManager.rootNode = parent;

            const nodes = modelManager.findNodes();
            expect(nodes).toHaveLength(2);
        });
    });

    describe("serialize", () => {
        test("should serialize components, nodes, and materials", () => {
            const childNode = new FolderNode(doc, "child");
            modelManager.addNode(childNode);

            const serialized = modelManager.serialize();

            expect(serialized.components).toBeDefined();
            expect(serialized.nodes).toBeDefined();
            expect(serialized.materials).toBeDefined();
        });

        test("should serialize rootNode", () => {
            const serialized = modelManager.serialize();
            expect(serialized.nodes).toBeDefined();
        });
    });

    describe("deserialize", () => {
        test("should deserialize components, materials, and nodes", async () => {
            const data = {
                components: [],
                nodes: [{ classKey: "FolderNode", properties: { name: "root", id: Id.generate() } }],
                materials: [],
            };

            await modelManager.deserialize(data);

            expect(modelManager.components).toHaveLength(0);
            expect(modelManager.materials).toHaveLength(0);
            expect(modelManager.rootNode).toBeDefined();
        });
    });

    describe("dispose", () => {
        test("should clear node changed observers", () => {
            const observer: OnNodeChanged = () => {};
            modelManager.addNodeObserver(observer);
            modelManager.dispose();
            expect(modelManager["_nodeChangedObservers"].size).toBe(0);
        });

        test("should remove material collection changed handler", () => {
            modelManager.materials.push({ dispose: () => {} } as any);
            expect(modelManager.materials).toHaveLength(1);
            modelManager.dispose();
            expect(modelManager.materials).toHaveLength(0);
        });

        test("should set rootNode to undefined", () => {
            modelManager.dispose();
            expect(modelManager["_rootNode"]).toBeUndefined();
        });

        test("should set currentNode to undefined", () => {
            modelManager.currentNode = new FolderNode(doc, "current");
            modelManager.dispose();
            expect(modelManager.currentNode).toBeUndefined();
        });
    });
});
