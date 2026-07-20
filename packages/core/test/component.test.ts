// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Component,
    ComponentNode,
    type ComponentSize,
    createComponentMesh,
    createComponentSize,
} from "../src";
import { BoundingBox, Matrix4 } from "../src/math";
import { XYZ } from "../src/math/xyz";
import type { VisualNode } from "../src/model";
import { MeshNode } from "../src/model/meshNode";
import { TestDocument } from "./mocks";

describe("ComponentSize", () => {
    test("createComponentSize should return zeroed size", () => {
        const size = createComponentSize();

        expect(size.facePosition).toBe(0);
        expect(size.faceIndex).toBe(0);
        expect(size.edge).toBe(0);
        expect(size.lineSegment).toBe(0);
        expect(size.meshPosition).toBe(0);
        expect(size.meshIndex).toBe(0);
    });
});

describe("ComponentMesh", () => {
    test("createComponentMesh should create mesh with correct structure", () => {
        const size: ComponentSize = {
            facePosition: 10,
            faceIndex: 6,
            edge: 8,
            lineSegment: 5,
            meshPosition: 12,
            meshIndex: 8,
        };

        const mesh = createComponentMesh(size);

        expect(mesh.faceMaterials).toEqual([]);
        expect(mesh.edge.lineType).toBe("solid");
        expect(mesh.edge.position).toBeInstanceOf(Float32Array);
        expect(mesh.edge.position.length).toBe(size.edge * 3);
        expect(mesh.edge.range).toEqual([]);

        expect(mesh.face.index).toBeInstanceOf(Uint32Array);
        expect(mesh.face.index.length).toBe(size.faceIndex);
        expect(mesh.face.normal).toBeInstanceOf(Float32Array);
        expect(mesh.face.normal.length).toBe(size.facePosition * 3);
        expect(mesh.face.position).toBeInstanceOf(Float32Array);
        expect(mesh.face.position.length).toBe(size.facePosition * 3);
        expect(mesh.face.uv).toBeInstanceOf(Float32Array);
        expect(mesh.face.uv.length).toBe(size.facePosition * 2);
        expect(mesh.face.range).toEqual([]);
        expect(mesh.face.groups).toEqual([]);

        expect(mesh.linesegments).toBeDefined();
        expect(mesh.surfaceMaterials).toEqual([]);
        expect(mesh.surface).toBeDefined();
    });

    test("createComponentMesh should handle zero meshIndex", () => {
        const size: ComponentSize = {
            facePosition: 0,
            faceIndex: 0,
            edge: 0,
            lineSegment: 0,
            meshPosition: 10,
            meshIndex: 0,
        };

        const mesh = createComponentMesh(size);

        expect(mesh.surface).toBeDefined();
    });
});

describe("Component", () => {
    let mockNodes: VisualNode[];

    beforeEach(() => {
        mockNodes = [];
    });

    test("constructor should initialize with provided values", () => {
        const name = "TestComponent";
        const origin = new XYZ({ x: 1, y: 2, z: 3 });
        const id = "test-id";

        const component = new Component({ name, nodes: mockNodes, origin, id });

        expect(component.name).toBe(name);
        expect(component.nodes).toBe(mockNodes);
        expect(component.origin).toEqual(origin);
        expect(component.id).toBe(id);
        expect(component.instances).toEqual([]);
    });

    test("constructor should generate id when not provided", () => {
        const component = new Component({ name: "Test", nodes: mockNodes });

        expect(component.id).toBeDefined();
        expect(typeof component.id).toBe("string");
    });

    test("constructor should use default origin when not provided", () => {
        const component = new Component({ name: "Test", nodes: mockNodes });

        expect(component.origin).toBeDefined();
    });

    test("toString should return component name", () => {
        const component = new Component({ name: "TestComponent", nodes: mockNodes });

        expect(component.toString()).toBe("TestComponent");
    });

    test("origin setter should update origin", () => {
        const component = new Component({ name: "Test", nodes: mockNodes });
        const newOrigin = new XYZ({ x: 5, y: 6, z: 7 });

        component.origin = newOrigin;

        expect(component.origin).toEqual(newOrigin);
    });

    test("boundingBox should compute from nodes", () => {
        const mockNode1 = {
            boundingBox: () => new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 1, z: 1 })),
        };
        const mockNode2 = {
            boundingBox: () => new BoundingBox(new XYZ({ x: 1, y: 1, z: 1 }), new XYZ({ x: 2, y: 2, z: 2 })),
        };

        const component = new Component({ name: "Test", nodes: [mockNode1, mockNode2] as any });

        const boundingBox = component.boundingBox;
        expect(boundingBox).toBeDefined();
        expect(boundingBox!.min.x).toBe(0);
        expect(boundingBox!.min.y).toBe(0);
        expect(boundingBox!.min.z).toBe(0);
        expect(boundingBox!.max.x).toBe(2);
        expect(boundingBox!.max.y).toBe(2);
        expect(boundingBox!.max.z).toBe(2);
    });

    test("boundingBox should return undefined for empty nodes", () => {
        const component = new Component({ name: "Test", nodes: [] });

        expect(component.boundingBox).toBeUndefined();
    });

    test("boundingBox should be cached", () => {
        let callCount = 0;
        const mockNode = {
            boundingBox: () => {
                callCount++;
                return new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 1, z: 1 }));
            },
        };

        const component = new Component({ name: "Test", nodes: [mockNode] as any });

        // Access twice, should only compute once
        component.boundingBox;
        component.boundingBox;

        expect(callCount).toBe(1);
    });

    test("mesh should be cached", () => {
        const component = new Component({ name: "Test", nodes: mockNodes });

        const mesh1 = component.mesh;
        const mesh2 = component.mesh;

        expect(mesh1).toBe(mesh2);
    });

    test("mesh should be created with correct structure for empty nodes", () => {
        const component = new Component({ name: "Test", nodes: [] });
        const mesh = component.mesh;

        expect(mesh).toBeDefined();
        expect(mesh.faceMaterials).toEqual([]);
        expect(mesh.edge.lineType).toBe("solid");
        expect(mesh.face.index).toBeInstanceOf(Uint32Array);
        expect(mesh.face.position).toBeInstanceOf(Float32Array);
        expect(mesh.linesegments).toBeDefined();
        expect(mesh.surface).toBeDefined();
    });

    test("constructor with empty nodes should set default origin to XYZ.zero", () => {
        const component = new Component({ name: "Test", nodes: [] });
        const origin = component.origin;
        expect(origin.x).toBe(0);
        expect(origin.y).toBe(0);
        expect(origin.z).toBe(0);
    });
});

describe("ComponentNode", () => {
    let doc: TestDocument;
    let mockComponent: Component;

    beforeEach(() => {
        doc = new TestDocument();
        mockComponent = new Component({ name: "TestComponent", nodes: [] });
        doc.modelManager.components.push(mockComponent);
    });

    test("constructor should initialize with provided values", () => {
        const name = "TestComponentNode";
        const componentId = mockComponent.id;
        const insert = new XYZ({ x: 1, y: 2, z: 3 });
        const id = "test-node-id";

        const node = new ComponentNode({ document: doc, name, componentId, insert, id });

        expect(node.name).toBe(name);
        expect(node.componentId).toBe(componentId);
        expect(node.insert).toEqual(insert);
        expect(node.id).toBe(id);
    });

    test("constructor should generate id when not provided", () => {
        const node = new ComponentNode({
            document: doc,
            name: "Test",
            componentId: mockComponent.id,
            insert: new XYZ({ x: 0, y: 0, z: 0 }),
        });

        expect(node.id).toBeDefined();
        expect(typeof node.id).toBe("string");
    });

    test("component should retrieve component from model manager", () => {
        const node = new ComponentNode({
            document: doc,
            name: "Test",
            componentId: mockComponent.id,
            insert: new XYZ({ x: 0, y: 0, z: 0 }),
        });

        expect(node.component).toBe(mockComponent);
    });

    test("component should add this instance to component.instances", () => {
        const node = new ComponentNode({
            document: doc,
            name: "Test",
            componentId: mockComponent.id,
            insert: new XYZ({ x: 0, y: 0, z: 0 }),
        });

        // The component getter is lazy — trigger it to register the instance
        expect(node.component).toBe(mockComponent);
        expect(mockComponent.instances).toContain(node);
    });

    test("component should throw error when component not found", () => {
        const node = new ComponentNode({
            document: doc,
            name: "Test",
            componentId: "non-existent-id",
            insert: new XYZ({ x: 0, y: 0, z: 0 }),
        });

        expect(() => node.component).toThrow("Component non-existent-id not found");
    });

    test("boundingBox should return transformed component bounding box", () => {
        const mockBoundingBox = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 1, z: 1 }));
        Object.defineProperty(mockComponent, "boundingBox", {
            get: () => mockBoundingBox,
        });

        const node = new ComponentNode({
            document: doc,
            name: "Test",
            componentId: mockComponent.id,
            insert: new XYZ({ x: 0, y: 0, z: 0 }),
        });
        node.transform = Matrix4.fromTranslation(1, 0, 0);

        const boundingBox = node.boundingBox();
        expect(boundingBox).toBeDefined();
        expect(boundingBox!.min.x).toBe(1);
    });

    test("boundingBox should return undefined when component has no bounding box", () => {
        Object.defineProperty(mockComponent, "boundingBox", {
            get: () => undefined,
        });

        const node = new ComponentNode({
            document: doc,
            name: "Test",
            componentId: mockComponent.id,
            insert: new XYZ({ x: 0, y: 0, z: 0 }),
        });

        expect(node.boundingBox()).toBeUndefined();
    });

    test("display should return correct i18n key", () => {
        const node = new ComponentNode({
            document: doc,
            name: "Test",
            componentId: mockComponent.id,
            insert: new XYZ({ x: 0, y: 0, z: 0 }),
        });

        expect(node.display()).toBe("body.group");
    });

    test("component is retrieved lazily and cached", () => {
        const node = new ComponentNode({
            document: doc,
            name: "Test",
            componentId: mockComponent.id,
            insert: new XYZ({ x: 0, y: 0, z: 0 }),
        });

        const c1 = node.component;
        const c2 = node.component;
        expect(c1).toBe(c2);
    });

    test("multiple ComponentNodes can reference same component from document", () => {
        const node1 = new ComponentNode({
            document: doc,
            name: "Node1",
            componentId: mockComponent.id,
            insert: new XYZ({ x: 0, y: 0, z: 0 }),
        });
        const node2 = new ComponentNode({
            document: doc,
            name: "Node2",
            componentId: mockComponent.id,
            insert: new XYZ({ x: 1, y: 0, z: 0 }),
        });

        // Trigger lazy component getter to register instances
        expect(node1.component).toBe(mockComponent);
        expect(node2.component).toBe(mockComponent);

        const instanceIds = mockComponent.instances.map((n) => (n as ComponentNode).id);
        expect(instanceIds).toContain(node1.id);
        expect(instanceIds).toContain(node2.id);
    });
});

describe("Component private methods", () => {
    let doc: TestDocument;

    beforeEach(() => {
        doc = new TestDocument();
    });

    describe("mapOldNewMaterialIndex", () => {
        test("should map single material id to existing material", () => {
            const component = new Component({ name: "Test", nodes: [] });
            const materialIds = ["mat-A", "mat-B", "mat-C"];
            const result: Map<number, number> = (component as any).mapOldNewMaterialIndex(
                "mat-B",
                materialIds,
            );

            expect(result.get(0)).toBe(1);
        });

        test("should add new material id to list", () => {
            const component = new Component({ name: "Test", nodes: [] });
            const materialIds = ["mat-A"];
            (component as any).mapOldNewMaterialIndex("mat-B", materialIds);

            expect(materialIds).toEqual(["mat-A", "mat-B"]);
        });

        test("should handle array of material ids", () => {
            const component = new Component({ name: "Test", nodes: [] });
            const materialIds = ["mat-A", "mat-B", "mat-C"];
            const result: Map<number, number> = (component as any).mapOldNewMaterialIndex(
                ["mat-B", "mat-C"],
                materialIds,
            );

            expect(result.get(0)).toBe(1);
            expect(result.get(1)).toBe(2);
        });

        test("should handle mixed existing and new materials", () => {
            const component = new Component({ name: "Test", nodes: [] });
            const materialIds = ["mat-A"];
            const result: Map<number, number> = (component as any).mapOldNewMaterialIndex(
                ["mat-A", "mat-B"],
                materialIds,
            );

            expect(result.get(0)).toBe(0);
            expect(result.get(1)).toBe(1);
            expect(materialIds).toEqual(["mat-A", "mat-B"]);
        });

        test("should not add duplicate materials", () => {
            const component = new Component({ name: "Test", nodes: [] });
            const materialIds = ["mat-A", "mat-B"];
            (component as any).mapOldNewMaterialIndex("mat-A", materialIds);

            expect(materialIds).toEqual(["mat-A", "mat-B"]);
        });
    });

    describe("getSize with MeshNode", () => {
        test("should accumulate size from MeshNode with surface type", () => {
            const component = new Component({ name: "Test", nodes: [] });
            const mesh = {
                meshType: "surface",
                position: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]),
                index: new Uint32Array([0, 1, 2, 1, 2, 3]),
            } as any;
            const meshNode = new MeshNode({ document: doc, mesh, name: "TestMesh" });

            const size = createComponentSize();
            (component as any).getSize([meshNode], size);

            expect(size.meshPosition).toBe(3);
            expect(size.meshIndex).toBe(6);
        });

        test("should accumulate size from MeshNode with surface type and no index", () => {
            const component = new Component({ name: "Test", nodes: [] });
            const mesh = {
                meshType: "surface",
                position: new Float32Array([0, 0, 0, 1, 0, 0]),
                index: undefined,
            } as any;
            const meshNode = new MeshNode({ document: doc, mesh, name: "test" });

            const size = createComponentSize();
            (component as any).getSize([meshNode], size);

            expect(size.meshPosition).toBe(2);
            expect(size.meshIndex).toBe(0);
        });

        test("should accumulate size from MeshNode with linesegments type", () => {
            const component = new Component({ name: "Test", nodes: [] });
            const mesh = {
                meshType: "linesegments",
                position: new Float32Array([0, 0, 0, 1, 1, 1]),
            } as any;
            const meshNode = new MeshNode({ document: doc, mesh, name: "test" });

            const size = createComponentSize();
            (component as any).getSize([meshNode], size);

            expect(size.meshPosition).toBe(2);
            expect(size.meshIndex).toBe(0);
        });
    });

    describe("mergeNodesMesh with empty nodes", () => {
        test("should not throw with empty node list", () => {
            const component = new Component({ name: "Test", nodes: [] });
            const size = createComponentSize();
            const visual = createComponentMesh(size);
            const faceMaterialPair: [number, number][] = [];

            expect(() => {
                (component as any).mergeNodesMesh(
                    visual,
                    faceMaterialPair,
                    [],
                    Matrix4.identity(),
                    createComponentSize(),
                );
            }).not.toThrow();

            // faceMaterialPair should remain empty since no nodes
            expect(faceMaterialPair.length).toBe(0);
        });
    });
});
