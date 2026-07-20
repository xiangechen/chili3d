// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type {
    ComponentNode,
    GeometryNode,
    GroupNode,
    IVisual,
    Matrix4,
    MeshNode,
    VisualNode,
} from "@chili3d/core";
import { Matrix4 as CoreMatrix4, Mesh as CoreMesh } from "@chili3d/core";
import { Group, type Mesh, MeshBasicMaterial, Scene } from "three";
import { ThreeVisualContext } from "../src/threeVisualContext";

// ============================================================================
// createMockVisualContext — lightweight duck-typed context
// ============================================================================

/**
 * Creates a minimal mock ThreeVisualContext for testing.
 * When visualMap is provided, getVisual looks up meshes by VisualNode and
 * the meshes are added to the visualShapes group.
 */
export function createMockVisualContext(visualMap?: Map<VisualNode, Mesh>): ThreeVisualContext {
    const scene = new Scene();
    const visualShapes = new Group();
    scene.add(visualShapes);

    if (visualMap) {
        for (const [, mesh] of visualMap) {
            visualShapes.add(mesh);
        }
    }

    return {
        visual: null as unknown as IVisual,
        scene,
        visualShapes,
        tempShapes: new Group(),
        cssObjects: new Group(),
        materialMap: new Map(),
        getVisual(node: VisualNode) {
            return visualMap?.get(node) as any;
        },
        getMaterial() {
            return new MeshBasicMaterial();
        },
        addNode() {},
        removeNode() {},
        dispose() {},
        getNode() {
            return undefined;
        },
        redrawNode() {},
        visuals() {
            return [];
        },
        boundingBoxIntersectFilter() {
            return [];
        },
        displayMesh() {
            return 0;
        },
        setMeshColor() {},
        displayInstancedMesh() {
            return 0;
        },
        displayLineSegments() {
            return 0;
        },
        setPosition() {},
        setInstanceMatrix() {},
        removeMesh() {},
        setVisible() {},
        moveNode() {},
        addVisualObject() {},
        removeVisualObject() {},
        findShapes() {
            return [];
        },
        handleNodeChanged() {},
        shapeCount: 0,
    } as unknown as ThreeVisualContext;
}

// ============================================================================
// Node factories — produce realistic ducks for visual object construction
// ============================================================================

/** Shared listener-management helper attached as _notify on test nodes. */
export interface Notifiable {
    _notify(prop: string): void;
}

/**
 * Creates a minimal VisualNode for testing ThreeVisualObject base class.
 */
export function createTestVisualNode(overrides: Record<string, unknown> = {}): VisualNode & Notifiable {
    const listeners: Array<(prop: string) => void> = [];
    let transform: Matrix4 = CoreMatrix4.identity();

    return {
        id: "fake-node",
        display() {
            return "body.line";
        },
        get transform(): Matrix4 {
            return transform;
        },
        set transform(v: Matrix4) {
            transform = v;
        },
        visible: true,
        parentVisible: true,
        parent: null,
        onPropertyChanged(cb: unknown) {
            listeners.push(cb as (prop: string) => void);
        },
        removePropertyChanged(cb: unknown) {
            const idx = listeners.indexOf(cb as (prop: string) => void);
            if (idx >= 0) listeners.splice(idx, 1);
        },
        _notify(prop: string) {
            for (const cb of listeners) cb(prop);
        },
        ...overrides,
    } as unknown as VisualNode & Notifiable;
}

/**
 * Creates a fake GeometryNode with configurable mesh data for ThreeGeometry tests.
 */
export function createTestGeometryNode(
    overrides: {
        visible?: boolean;
        parentVisible?: boolean;
        materialId?: string | string[];
        hasFaces?: boolean;
        hasEdges?: boolean;
        hasVertexs?: boolean;
    } = {},
): GeometryNode & Notifiable {
    const listeners: Array<(prop: string) => void> = [];
    const hasFaces = overrides.hasFaces ?? true;
    const hasEdges = overrides.hasEdges ?? true;
    const hasVertexs = overrides.hasVertexs ?? true;

    const vertexShape = {
        id: "v1",
        shapeType: 3,
        isEqual: () => false,
        findAncestor: () => [],
        findSubShapes: () => [],
    };
    const edgeShape = {
        id: "e1",
        shapeType: 1,
        isEqual: () => false,
        findAncestor: () => [],
        findSubShapes: () => [],
    };
    const faceShape = {
        id: "f1",
        shapeType: 2,
        isEqual: () => false,
        findAncestor: () => [],
        findSubShapes: () => [],
    };

    return {
        id: "fake-geo-node",
        display: () => "body.shape",
        transform: CoreMatrix4.identity(),
        visible: overrides.visible ?? true,
        parentVisible: overrides.parentVisible ?? true,
        parent: null,
        document: {} as never,
        onPropertyChanged(cb: unknown) {
            listeners.push(cb as (prop: string) => void);
        },
        removePropertyChanged(cb: unknown) {
            const idx = listeners.indexOf(cb as (prop: string) => void);
            if (idx >= 0) listeners.splice(idx, 1);
        },
        _notify(prop: string) {
            for (const cb of listeners) cb(prop);
        },
        materialId: overrides.materialId ?? "mat-1",
        name: "test-geo",
        mesh: {
            edges: hasEdges
                ? ({
                      position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0]),
                      color: 0xff0000,
                      lineType: "solid" as const,
                      range: [{ start: 0, count: 6, shape: edgeShape }],
                  } as any)
                : null,
            faces: hasFaces
                ? ({
                      position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                      normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                      uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                      index: new Uint32Array([0, 1, 2]),
                      groups: [],
                      color: 0x00ff00,
                      range: [{ start: 0, count: 3, shape: faceShape }],
                  } as any)
                : null,
            vertexs: hasVertexs
                ? ({
                      position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                      size: 3,
                      color: 0x0000ff,
                      range: [{ start: 0, count: 3, shape: vertexShape }],
                  } as any)
                : null,
        },
    } as unknown as GeometryNode & Notifiable;
}

/**
 * Creates a fake MeshNode with configurable mesh type.
 */
export function createTestMeshNode(
    overrides: {
        meshType?: "surface" | "linesegments";
        visible?: boolean;
        parentVisible?: boolean;
        materialId?: string | string[];
    } = {},
): MeshNode & Notifiable {
    const meshType = overrides.meshType ?? "surface";
    const listeners: Array<(prop: string) => void> = [];

    const mesh =
        meshType === "surface"
            ? new CoreMesh({
                  meshType: "surface",
                  position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                  normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                  uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                  index: new Uint32Array([0, 1, 2]),
                  color: 0xff0000,
              })
            : new CoreMesh({
                  meshType: "linesegments",
                  position: new Float32Array([0, 0, 0, 1, 0, 0]),
                  color: 0x0000ff,
              });

    return {
        id: "fake-mesh-node",
        display: () => "body.meshNode",
        transform: CoreMatrix4.identity(),
        visible: overrides.visible ?? true,
        parentVisible: overrides.parentVisible ?? true,
        parent: null,
        document: {} as never,
        onPropertyChanged(cb: unknown) {
            listeners.push(cb as (prop: string) => void);
        },
        removePropertyChanged(cb: unknown) {
            const idx = listeners.indexOf(cb as (prop: string) => void);
            if (idx >= 0) listeners.splice(idx, 1);
        },
        _notify(prop: string) {
            for (const cb of listeners) cb(prop);
        },
        mesh,
        materialId: overrides.materialId ?? "mat-1",
        boundingBox: () => undefined,
        name: "test-mesh",
    } as unknown as MeshNode & Notifiable;
}

/**
 * Creates a fake ComponentNode with edge/face/linesegments/surface mesh data.
 */
export function createTestComponentNode(
    overrides: { visible?: boolean; parentVisible?: boolean } = {},
): ComponentNode & Notifiable {
    const listeners: Array<(prop: string) => void> = [];
    const component = {
        boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
        id: "comp-1",
        nodes: [] as unknown[],
        mesh: {
            faceMaterials: ["mat-1"],
            edge: {
                lineType: "solid" as const,
                position: new Float32Array([0, 0, 0, 1, 0, 0]),
                range: [{ start: 0, count: 2, shape: { id: "e1", shapeType: 1 } }],
            },
            face: {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 1, 1]),
                index: new Uint32Array([0, 1, 2]),
                range: [{ start: 0, count: 3, shape: { id: "f1", shapeType: 2 } }],
                groups: [],
                color: 0xff0000,
            },
            linesegments: new CoreMesh({
                meshType: "linesegments",
                position: new Float32Array([0, 0, 0, 1, 0, 0]),
                color: 0x0000ff,
            }),
            surfaceMaterials: [],
            surface: new CoreMesh({
                meshType: "surface",
                position: new Float32Array([0, 0, 0]),
                normal: new Float32Array([0, 0, 1]),
                uv: new Float32Array([0, 0]),
                index: new Uint32Array([]),
            }),
        },
    };

    return {
        id: "fake-component-node",
        display: () => "body.group",
        transform: CoreMatrix4.identity(),
        visible: overrides.visible ?? true,
        parentVisible: overrides.parentVisible ?? true,
        parent: null,
        document: {} as never,
        onPropertyChanged(cb: unknown) {
            listeners.push(cb as (prop: string) => void);
        },
        removePropertyChanged(cb: unknown) {
            const idx = listeners.indexOf(cb as (prop: string) => void);
            if (idx >= 0) listeners.splice(idx, 1);
        },
        _notify(prop: string) {
            for (const cb of listeners) cb(prop);
        },
        component,
        componentId: "comp-1",
        insert: { x: 0, y: 0, z: 0 },
        name: "test-component",
        boundingBox: () => component.boundingBox,
    } as unknown as ComponentNode & Notifiable;
}

/**
 * Creates a fake GroupNode.
 */
export function createTestGroupNode(overrides: Record<string, unknown> = {}): GroupNode & Notifiable {
    return createTestVisualNode(overrides) as unknown as GroupNode & Notifiable;
}

// ============================================================================
// Real ThreeVisualContext factory — for tests needing real scene/data operations
// ============================================================================

/**
 * Creates a minimal IVisual mock sufficient for ThreeVisualContext constructor.
 * The context constructor calls:
 *   visual.document.modelManager.addNodeObserver(handler)
 *   visual.document.modelManager.materials.onCollectionChanged(handler)
 */
export function createMockIVisualForContext(overrides?: {
    document?: Record<string, unknown>;
    scene?: Scene;
}): IVisual {
    return {
        document: (overrides?.document ?? {
            modelManager: {
                addNodeObserver: () => {},
                removeNodeObserver: () => {},
                materials: {
                    onCollectionChanged: () => {},
                    removeCollectionChanged: () => {},
                    forEach: () => {},
                },
            },
            selection: {
                onNodeChanged: { sub: () => {}, remove: () => {} },
            },
        }) as unknown as IVisual["document"],
        context: null as any,
        highlighter: {} as any,
        meshExporter: {} as any,
        update: () => {},
        viewHandler: {} as any,
        defaultEventHandler: {} as any,
        eventHandler: {} as any,
        createView: () => ({}) as any,
        dispose: () => {},
    } as unknown as IVisual;
}

/**
 * Creates a real ThreeVisualContext with a real Scene.
 * Returns the context, scene, and visual for full control in tests.
 */
export function createTestContext(overrides?: { document?: Record<string, unknown> }): {
    context: ThreeVisualContext;
    scene: Scene;
    visual: IVisual;
} {
    const scene = new Scene();
    const visual = createMockIVisualForContext({ document: overrides?.document });
    const context = new ThreeVisualContext(visual, scene);
    return { context, scene, visual };
}

export function disposeMeshes(meshes: Mesh[]): void {
    for (const mesh of meshes) {
        if (Array.isArray(mesh.material)) {
            for (const m of mesh.material) m.dispose();
        } else {
            mesh.material?.dispose();
        }
        mesh.geometry?.dispose();
    }
}
