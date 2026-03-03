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
import { MeshNode } from "../src/model/meshNode";
import { TestDocument } from "./testDocument";

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
    let doc: TestDocument;
    let mockNodes: any[];

    beforeEach(() => {
        doc = new TestDocument();
        mockNodes = [];
    });

    test("constructor should initialize with provided values", () => {
        const name = "TestComponent";
        const origin = new XYZ(1, 2, 3);
        const id = "test-id";

        const component = new Component(name, mockNodes, origin, id);

        expect(component.name).toBe(name);
        expect(component.nodes).toBe(mockNodes);
        expect(component.origin).toEqual(origin);
        expect(component.id).toBe(id);
        expect(component.instances).toEqual([]);
    });

    test("constructor should generate id when not provided", () => {
        const component = new Component("Test", mockNodes);

        expect(component.id).toBeDefined();
        expect(typeof component.id).toBe("string");
    });

    test("constructor should use default origin when not provided", () => {
        const component = new Component("Test", mockNodes);

        expect(component.origin).toBeDefined();
    });

    test("toString should return component name", () => {
        const component = new Component("TestComponent", mockNodes);

        expect(component.toString()).toBe("TestComponent");
    });

    test("origin setter should update origin", () => {
        const component = new Component("Test", mockNodes);
        const newOrigin = new XYZ(5, 6, 7);

        component.origin = newOrigin;

        expect(component.origin).toEqual(newOrigin);
    });

    test("boundingBox should compute from nodes", () => {
        const mockNode1 = {
            boundingBox: () => new BoundingBox(new XYZ(0, 0, 0), new XYZ(1, 1, 1)),
        };
        const mockNode2 = {
            boundingBox: () => new BoundingBox(new XYZ(1, 1, 1), new XYZ(2, 2, 2)),
        };

        const component = new Component("Test", [mockNode1, mockNode2] as any);

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
        const component = new Component("Test", []);

        expect(component.boundingBox).toBeUndefined();
    });

    test("boundingBox should be cached", () => {
        let callCount = 0;
        const mockNode = {
            boundingBox: () => {
                callCount++;
                return new BoundingBox(new XYZ(0, 0, 0), new XYZ(1, 1, 1));
            },
        };

        const component = new Component("Test", [mockNode] as any);

        const box1 = component.boundingBox;
        const box2 = component.boundingBox;

        expect(callCount).toBe(1);
        expect(box1).toBe(box2);
    });

    test("mesh should be cached", () => {
        const component = new Component("Test", mockNodes);

        const mesh1 = component.mesh;
        const mesh2 = component.mesh;

        expect(mesh1).toBe(mesh2);
    });

    test("mesh should be created with correct structure for nodes", () => {
        // Test that the mesh creation process works by checking the resulting mesh structure
        const component = new Component("Test", []);
        const mesh = component.mesh;

        expect(mesh).toBeDefined();
        expect(mesh.faceMaterials).toEqual([]);
        expect(mesh.edge.lineType).toBe("solid");
        expect(mesh.face.index).toBeInstanceOf(Uint32Array);
        expect(mesh.face.position).toBeInstanceOf(Float32Array);
        expect(mesh.face.normal).toBeInstanceOf(Float32Array);
        expect(mesh.face.uv).toBeInstanceOf(Float32Array);
        expect(mesh.linesegments).toBeDefined();
        expect(mesh.surface).toBeDefined();
    });

    test("getSize should accumulate sizes from MeshNode", () => {
        const mesh = {
            meshType: "surface",
            position: new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]), // 3 vertices
            index: new Uint32Array([0, 1, 2, 1, 2, 3]), // 2 triangles
        } as any;

        const meshNode = new MeshNode(doc, mesh, "TestMesh");

        const component = new Component("Test", [meshNode]);
        const size = createComponentSize();

        component["getSize"]([meshNode], size);

        expect(size.meshPosition).toBe(3);
        expect(size.meshIndex).toBe(6);
    });
});

describe("ComponentNode", () => {
    let doc: TestDocument;
    let mockComponent: Component;

    beforeEach(() => {
        doc = new TestDocument();
        mockComponent = new Component("TestComponent", []);
        doc.modelManager.components.push(mockComponent);
    });

    test("constructor should initialize with provided values", () => {
        const name = "TestComponentNode";
        const componentId = mockComponent.id;
        const insert = new XYZ(1, 2, 3);
        const id = "test-node-id";

        const node = new ComponentNode(doc, name, componentId, insert, id);

        expect(node.name).toBe(name);
        expect(node.componentId).toBe(componentId);
        expect(node.insert).toEqual(insert);
        expect(node.id).toBe(id);
    });

    test("constructor should generate id when not provided", () => {
        const node = new ComponentNode(doc, "Test", mockComponent.id, new XYZ(0, 0, 0));

        expect(node.id).toBeDefined();
        expect(typeof node.id).toBe("string");
    });

    test("component should retrieve component from model manager", () => {
        const node = new ComponentNode(doc, "Test", mockComponent.id, new XYZ(0, 0, 0));

        expect(node.component).toBe(mockComponent);
        expect(mockComponent.instances).toContain(node);
    });

    test("component should throw error when component not found", () => {
        const node = new ComponentNode(doc, "Test", "non-existent-id", new XYZ(0, 0, 0));

        expect(() => node.component).toThrow("Component non-existent-id not found");
    });

    test("boundingBox should return transformed component bounding box", () => {
        const mockBoundingBox = new BoundingBox(new XYZ(0, 0, 0), new XYZ(1, 1, 1));
        Object.defineProperty(mockComponent, "boundingBox", {
            get: () => mockBoundingBox,
        });

        const node = new ComponentNode(doc, "Test", mockComponent.id, new XYZ(0, 0, 0));
        // Set the transform to move the component by 1 unit in X direction
        node.transform = Matrix4.fromTranslation(1, 0, 0);

        const boundingBox = node.boundingBox();
        expect(boundingBox).toBeDefined();
        expect(boundingBox!.min.x).toBe(1);
    });

    test("boundingBox should return undefined when component has no bounding box", () => {
        Object.defineProperty(mockComponent, "boundingBox", {
            get: () => undefined,
        });

        const node = new ComponentNode(doc, "Test", mockComponent.id, new XYZ(0, 0, 0));

        expect(node.boundingBox()).toBeUndefined();
    });

    test("display should return correct i18n key", () => {
        const node = new ComponentNode(doc, "Test", mockComponent.id, new XYZ(0, 0, 0));

        expect(node.display()).toBe("body.group");
    });

    test("component should retrieve component from model manager", () => {
        const node = new ComponentNode(doc, "Test", mockComponent.id, new XYZ(0, 0, 0));

        expect(node.component).toBe(mockComponent);
        expect(mockComponent.instances).toContain(node);
    });

    test("component should throw error when component not found", () => {
        const node = new ComponentNode(doc, "Test", "non-existent-id", new XYZ(0, 0, 0));

        expect(() => node.component).toThrow("Component non-existent-id not found");
    });

    test("boundingBox should return transformed component bounding box", () => {
        const mockBoundingBox = new BoundingBox(new XYZ(0, 0, 0), new XYZ(1, 1, 1));
        Object.defineProperty(mockComponent, "boundingBox", {
            get: () => mockBoundingBox,
        });

        const node = new ComponentNode(doc, "Test", mockComponent.id, new XYZ(0, 0, 0));
        // Set the transform to move the component by 1 unit in X direction
        node.transform = Matrix4.fromTranslation(1, 0, 0);

        const boundingBox = node.boundingBox();
        expect(boundingBox).toBeDefined();
        expect(boundingBox!.min.x).toBe(1);
    });

    test("boundingBox should return undefined when component has no bounding box", () => {
        Object.defineProperty(mockComponent, "boundingBox", {
            get: () => undefined,
        });

        const node = new ComponentNode(doc, "Test", mockComponent.id, new XYZ(0, 0, 0));

        expect(node.boundingBox()).toBeUndefined();
    });

    test("display should return correct i18n key", () => {
        const node = new ComponentNode(doc, "Test", mockComponent.id, new XYZ(0, 0, 0));

        expect(node.display()).toBe("body.group");
    });
});
