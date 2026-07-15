// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IVisual, VisualNode } from "@chili3d/core";
import { Group, type Mesh, MeshBasicMaterial, Scene } from "three";
import type { ThreeVisualContext } from "../src/threeVisualContext";

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
