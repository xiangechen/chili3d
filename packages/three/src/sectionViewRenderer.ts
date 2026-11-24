// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Plane as CorePlane,
    type IShape,
    isReferenceGeometryNode,
    MultiShapeNode,
    type ShapeMeshRange,
    ShapeNode,
    ShapeTypes,
} from "@chili3d/core";
import {
    AlwaysStencilFunc,
    BackSide,
    Box3,
    BufferGeometry,
    type Camera,
    DataTexture,
    DecrementWrapStencilOp,
    DoubleSide,
    Float32BufferAttribute,
    FrontSide,
    IncrementWrapStencilOp,
    KeepStencilOp,
    LinearFilter,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    NotEqualStencilFunc,
    type Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    PlaneGeometry,
    Points,
    PointsMaterial,
    RepeatWrapping,
    ReplaceStencilOp,
    RGBAFormat,
    Scene,
    SRGBColorSpace,
    type StencilOp,
    type Plane as ThreePlane,
    Vector2,
    Vector3,
    type WebGLRenderer,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { AnnotationBatch } from "./annotationBatch";
import { Constants } from "./constants";
import { coplanarFacePositions, sectionEdgePositions } from "./sectionEdges";
import { ThreeGeometry } from "./threeGeometry";
import { TopRenderOrder } from "./threeGeometryFactory";
import { ThreeHelper } from "./threeHelper";
import { type SectionFrameLayout, ThreeSectionPlaneObject } from "./threeSectionPlaneObject";
import type { ThreeVisualContext } from "./threeVisualContext";
import { ThreeComponentObject, ThreeMeshObject, ThreeVisualObject } from "./threeVisualObject";

const HATCH_TILE_SIZE = 64;
const HATCH_SCREEN_TILE_SIZE = 16;
const HATCH_WORLD_SIZE = 8;

export interface SectionRenderItem {
    plane: CorePlane;
    clippingPlane: ThreePlane;
    visual?: ThreeSectionPlaneObject;
}

interface SectionRenderState {
    readonly stencilBack: Scene;
    readonly stencilFront: Scene;
    readonly coplanarMask: Scene;
    readonly capScene: Scene;
    readonly capMesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
    readonly cutEdges: LineSegments2;
    readonly ownedGeometries: Set<BufferGeometry>;
    meshSignature: string;
    planeSignature: string;
    sectionMeshes: Mesh[];
}

function createHatchTexture(): DataTexture {
    const data = new Uint8Array(HATCH_TILE_SIZE * HATCH_TILE_SIZE * 4);
    for (let y = 0; y < HATCH_TILE_SIZE; y++) {
        for (let x = 0; x < HATCH_TILE_SIZE; x++) {
            const index = (y * HATCH_TILE_SIZE + x) * 4;
            const hatch = (x + y) % HATCH_TILE_SIZE < 3;
            data[index] = hatch ? 48 : 156;
            data[index + 1] = hatch ? 82 : 184;
            data[index + 2] = hatch ? 108 : 201;
            data[index + 3] = 255;
        }
    }
    const texture = new DataTexture(data, HATCH_TILE_SIZE, HATCH_TILE_SIZE, RGBAFormat);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.magFilter = LinearFilter;
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
}

function hatchWorldSize(renderer: WebGLRenderer, camera: Camera, center: Vector3): number {
    const viewportHeight = Math.max(renderer.getSize(new Vector2()).y, 1);
    if (camera instanceof OrthographicCamera) {
        const worldHeight = (camera.top - camera.bottom) / camera.zoom;
        return (worldHeight * HATCH_SCREEN_TILE_SIZE) / viewportHeight;
    }
    if (camera instanceof PerspectiveCamera) {
        const toPlane = center.clone().sub(camera.getWorldPosition(new Vector3()));
        const depth = Math.max(toPlane.dot(camera.getWorldDirection(new Vector3())), 1e-6);
        const worldHeight = (2 * depth * Math.tan((camera.fov * Math.PI) / 360)) / camera.zoom;
        return (worldHeight * HATCH_SCREEN_TILE_SIZE) / viewportHeight;
    }
    return HATCH_WORLD_SIZE;
}

function stencilMaterial(side: typeof FrontSide | typeof BackSide, operation: StencilOp) {
    return new MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        side,
        stencilWrite: true,
        stencilFunc: AlwaysStencilFunc,
        stencilFail: operation,
        stencilZFail: operation,
        stencilZPass: operation,
    });
}

function isUnlitOverlay(object: Object3D): boolean {
    if (object.renderOrder < TopRenderOrder) return false;
    if (object instanceof LineSegments2) return object.material instanceof LineMaterial;
    if (object instanceof Points) return object.material instanceof PointsMaterial;
    if (object instanceof Mesh) return object.material instanceof MeshBasicMaterial;
    return false;
}

function isVisibleInHierarchy(object: Object3D): boolean {
    for (let current: Object3D | null = object; current; current = current.parent) {
        if (!current.visible) return false;
    }
    return true;
}

function intersectsPlane(box: Box3, plane: ThreePlane): boolean {
    const { min, max } = box;
    const { normal, constant } = plane;
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 8; i++) {
        const distance =
            normal.x * (i & 1 ? max.x : min.x) +
            normal.y * (i & 2 ? max.y : min.y) +
            normal.z * (i & 4 ? max.z : min.z) +
            constant;
        minimum = Math.min(minimum, distance);
        maximum = Math.max(maximum, distance);
    }
    return minimum <= 1e-6 && maximum >= -1e-6;
}

function rootShape(shape: IShape): IShape {
    let current = shape;
    let parent = (current as IShape & { parent?: IShape }).parent;
    while (parent) {
        current = parent;
        parent = (current as IShape & { parent?: IShape }).parent;
    }
    return current;
}

function computeIndexedBoundingBox(geometry: BufferGeometry): void {
    const position = geometry.attributes["position"];
    const index = geometry.index;
    const bounds = new Box3();
    if (position && index) {
        const point = new Vector3();
        for (let i = 0; i < index.count; i++) {
            bounds.expandByPoint(point.fromBufferAttribute(position, index.getX(i)));
        }
    }
    geometry.boundingBox = bounds;
    geometry.boundingSphere = null;
}

export class SectionViewRenderer {
    private readonly coplanarMaskMaterial = new MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        side: DoubleSide,
        stencilWrite: true,
        stencilFunc: AlwaysStencilFunc,
        stencilRef: 0,
        stencilFail: ReplaceStencilOp,
        stencilZFail: ReplaceStencilOp,
        stencilZPass: ReplaceStencilOp,
    });
    private readonly backMaterial = stencilMaterial(BackSide, IncrementWrapStencilOp);
    private readonly frontMaterial = stencilMaterial(FrontSide, DecrementWrapStencilOp);
    private readonly hatchTexture = createHatchTexture();
    private readonly capMaterial: MeshBasicMaterial;
    private readonly edgeMaterial = new LineMaterial({ color: 0x263238, linewidth: 2 });
    private readonly states = new Map<object, SectionRenderState>();
    private readonly capSources = new WeakMap<Mesh, boolean>();
    private readonly shapeClosure = new WeakMap<IShape, boolean>();

    constructor(private readonly context: ThreeVisualContext) {
        this.capMaterial = new MeshBasicMaterial({
            map: this.hatchTexture,
            side: DoubleSide,
            depthWrite: true,
            stencilWrite: true,
            stencilFunc: NotEqualStencilFunc,
            stencilRef: 0,
            stencilFail: KeepStencilOp,
            stencilZFail: KeepStencilOp,
            stencilZPass: KeepStencilOp,
        });
    }

    private sectionKey(section: SectionRenderItem): object {
        return section.visual ?? section.clippingPlane;
    }

    private stateFor(section: SectionRenderItem): SectionRenderState {
        const key = this.sectionKey(section);
        const existing = this.states.get(key);
        if (existing) return existing;

        const capMesh = new Mesh(new PlaneGeometry(1, 1), this.capMaterial);
        const cutEdges = new LineSegments2(new LineSegmentsGeometry(), this.edgeMaterial);
        cutEdges.renderOrder = 1;
        const capScene = new Scene();
        capScene.add(capMesh, cutEdges);
        const state: SectionRenderState = {
            stencilBack: new Scene(),
            stencilFront: new Scene(),
            coplanarMask: new Scene(),
            capScene,
            capMesh,
            cutEdges,
            ownedGeometries: new Set<BufferGeometry>(),
            meshSignature: "",
            planeSignature: "",
            sectionMeshes: [],
        };
        this.states.set(key, state);
        return state;
    }

    private disposeState(state: SectionRenderState): void {
        for (const child of state.coplanarMask.children) {
            if (child instanceof Mesh) child.geometry.dispose();
        }
        for (const geometry of state.ownedGeometries) geometry.dispose();
        state.capMesh.geometry.dispose();
        state.cutEdges.geometry.dispose();
        state.stencilBack.clear();
        state.stencilFront.clear();
        state.coplanarMask.clear();
        state.capScene.clear();
    }

    private pruneStates(activeKeys: Set<object>): void {
        for (const [key, state] of this.states) {
            if (activeKeys.has(key)) continue;
            this.disposeState(state);
            this.states.delete(key);
        }
    }

    render(renderer: WebGLRenderer, scene: Scene, camera: Camera, sections: SectionRenderItem[]): void {
        if (sections.length === 0) {
            this.pruneStates(new Set());
            renderer.render(scene, camera);
            return;
        }

        this.pruneStates(new Set(sections.map((section) => this.sectionKey(section))));
        const overlays = this.unlitOnTopOverlays();
        const overlayVisibility = overlays.map((overlay) => overlay.visible);
        for (const overlay of overlays) overlay.visible = false;
        const autoClear = renderer.autoClear;
        const clippingPlanes = renderer.clippingPlanes;
        try {
            renderer.autoClear = false;
            renderer.clear();
            for (const section of sections) {
                const state = this.stateFor(section);
                this.sync(state, section, camera);
                if (state.stencilBack.children.length === 0) continue;
                this.updateHatch(renderer, camera, state);
                renderer.clearStencil();
                this.backMaterial.clippingPlanes = [section.clippingPlane];
                this.frontMaterial.clippingPlanes = [section.clippingPlane];
                renderer.clippingPlanes = [];
                renderer.render(state.stencilBack, camera);
                renderer.render(state.stencilFront, camera);
                renderer.clippingPlanes = sections
                    .filter((candidate) => candidate !== section)
                    .map((candidate) => candidate.clippingPlane);
                if (state.coplanarMask.children.length > 0) renderer.render(state.coplanarMask, camera);
                renderer.render(state.capScene, camera);
            }
            renderer.clippingPlanes = clippingPlanes;
            renderer.render(scene, camera);
            overlays.forEach((overlay, index) => {
                if (overlayVisibility[index]) overlay.visible = true;
            });
            renderer.clippingPlanes = [];
            for (const overlay of overlays) {
                if (isVisibleInHierarchy(overlay)) renderer.render(overlay, camera);
            }
        } finally {
            overlays.forEach((overlay, index) => {
                if (overlayVisibility[index]) overlay.visible = true;
            });
            renderer.clippingPlanes = clippingPlanes;
            renderer.autoClear = autoClear;
        }
    }

    private unlitOnTopOverlays(): Object3D[] {
        const overlays: Object3D[] = [];
        for (const group of [...this.context.tempShapes.children, ...this.context.visualShapes.children]) {
            if (!group.visible) continue;
            group.traverse((object) => {
                if (isUnlitOverlay(object)) overlays.push(object);
            });
        }
        return overlays;
    }

    private sync(state: SectionRenderState, section: SectionRenderItem, camera: Camera): void {
        this.context.visualShapes.updateWorldMatrix(true, true);
        const meshes = this.solidMeshes(camera, section.clippingPlane);
        const meshSignature = this.meshSignatureOf(meshes);
        const meshesChanged = meshSignature !== state.meshSignature;
        if (meshesChanged) {
            state.meshSignature = meshSignature;
            this.rebuildStencilMeshes(state, meshes);
        }

        const sceneBounds = this.sceneBounds(camera);
        const planeSignature = this.planeSignatureOf(section.plane, camera, sceneBounds);
        if (meshesChanged || planeSignature !== state.planeSignature) {
            state.planeSignature = planeSignature;
            this.updateCap(state, section, camera, sceneBounds);
        }
    }

    private solidMeshes(camera: Camera, plane: ThreePlane): Mesh[] {
        const meshes: Mesh[] = [];
        this.context.visualShapes.traverseVisible((object) => {
            if (!(object instanceof Mesh) || !camera.layers.test(object.layers)) return;
            if (
                !object.layers.isEnabled(Constants.Layers.Solid) &&
                !object.layers.isEnabled(Constants.Layers.Isolation)
            ) {
                return;
            }
            for (let parent = object.parent; parent; parent = parent.parent) {
                if (parent instanceof AnnotationBatch) return;
            }
            if (!this.isCapSource(object)) return;
            if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
            const worldBox = object.geometry.boundingBox?.clone().applyMatrix4(object.matrixWorld);
            if (worldBox && !intersectsPlane(worldBox, plane)) return;
            meshes.push(object);
        });
        return meshes;
    }

    private sceneBounds(camera: Camera): Box3 {
        const bounds = new Box3();
        this.context.visualShapes.traverseVisible((object) => {
            if (
                !(object instanceof Mesh) &&
                !(object instanceof LineSegments2) &&
                !(object instanceof Points)
            ) {
                return;
            }
            if (!camera.layers.test(object.layers)) return;
            for (let parent = object.parent; parent; parent = parent.parent) {
                if (parent instanceof AnnotationBatch || parent instanceof ThreeSectionPlaneObject) return;
                if (parent instanceof ThreeVisualObject && isReferenceGeometryNode(parent.node)) return;
            }
            if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
            if (object.geometry.boundingBox) {
                bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
            }
        });
        return bounds;
    }

    private isCapSource(mesh: Mesh): boolean {
        const cached = this.capSources.get(mesh);
        if (cached !== undefined) return cached;

        const parent = mesh.parent;
        let result = true;
        if (parent instanceof ThreeMeshObject) {
            result = false;
        } else if (parent instanceof ThreeComponentObject) {
            const ranges = mesh === parent.faces ? this.capRanges(mesh) : undefined;
            result =
                mesh === parent.faces &&
                (!ranges?.length || ranges.some((range) => this.isClosedRange(range)));
        } else if (parent instanceof ThreeGeometry) {
            const node = parent.geometryNode;
            if (node instanceof ShapeNode) {
                result = node.shape.isOk && this.isClosed(node.shape.value);
            } else if (node instanceof MultiShapeNode) {
                result = node.shapes.some((shape) => this.isClosed(shape));
            }
        }
        this.capSources.set(mesh, result);
        return result;
    }

    private isClosed(shape: IShape): boolean {
        const cached = this.shapeClosure.get(shape);
        if (cached !== undefined) return cached;
        const root = rootShape(shape);
        let result = root.shapeType === ShapeTypes.solid || root.shapeType === ShapeTypes.compoundSolid;
        if (root.shapeType === ShapeTypes.compound) {
            result = this.hasSolidAncestor(shape, root);
        }
        this.shapeClosure.set(shape, result);
        return result;
    }

    private hasSolidAncestor(shape: IShape, root: IShape): boolean {
        if (shape === root) return root.findSubShapes(ShapeTypes.solid).length > 0;
        return shape.findAncestor(ShapeTypes.solid, root).length > 0;
    }

    private isClosedRange(range: ShapeMeshRange): boolean {
        return this.isClosed(range.shape);
    }

    private capRanges(mesh: Mesh): ShapeMeshRange[] | undefined {
        const parent = mesh.parent;
        if (parent instanceof ThreeComponentObject && mesh === parent.faces) {
            return parent.componentNode.component.mesh.face.range;
        }
        if (parent instanceof ThreeGeometry) {
            const node = parent.geometryNode;
            if (node instanceof MultiShapeNode) return node.mesh.faces?.range;
            if (
                node instanceof ShapeNode &&
                node.shape.isOk &&
                node.shape.value.shapeType === ShapeTypes.compound
            ) {
                return node.mesh.faces?.range;
            }
        }
        return undefined;
    }

    private capGeometry(source: Mesh): BufferGeometry {
        const ranges = this.capRanges(source);
        if (!ranges?.length || ranges.every((range) => this.isClosedRange(range))) return source.geometry;
        const indexes: number[] = [];
        for (const range of ranges.filter((range) => this.isClosedRange(range))) {
            for (let i = range.start; i < range.start + range.count; i++) {
                indexes.push(source.geometry.index?.getX(i) ?? i);
            }
        }
        const geometry = source.geometry.clone();
        geometry.setIndex(indexes);
        computeIndexedBoundingBox(geometry);
        return geometry;
    }

    private meshSignatureOf(meshes: Mesh[]): string {
        const meshKeys = meshes.map((mesh) => {
            const position = mesh.geometry.attributes["position"];
            const positionVersion =
                position && "data" in position ? position.data.version : position?.version;
            const index = mesh.geometry.index;
            return `${mesh.uuid}:${mesh.geometry.uuid}:${positionVersion}:${index?.version}:${mesh.matrixWorld.elements.join(",")}`;
        });
        return meshKeys.join("|");
    }

    private planeSignatureOf(plane: CorePlane, camera: Camera, sceneBounds: Box3): string {
        const values = [
            ...plane.origin.toArray(),
            ...plane.normal.toArray(),
            ...plane.xvec.toArray(),
            ...plane.yvec.toArray(),
            ...sceneBounds.min.toArray(),
            ...sceneBounds.max.toArray(),
            this.offsetDirection(plane, camera),
        ];
        return values.join(",");
    }

    private offsetDirection(plane: CorePlane, camera: Camera): number {
        const toCamera = camera.getWorldPosition(new Vector3()).sub(ThreeHelper.fromXYZ(plane.origin));
        return toCamera.dot(ThreeHelper.fromXYZ(plane.normal)) < 0 ? -1 : 1;
    }

    private rebuildStencilMeshes(state: SectionRenderState, meshes: Mesh[]): void {
        state.stencilBack.clear();
        state.stencilFront.clear();
        for (const geometry of state.ownedGeometries) geometry.dispose();
        state.ownedGeometries.clear();
        state.sectionMeshes = [];
        for (const source of meshes) {
            const geometry = this.capGeometry(source);
            if (geometry !== source.geometry) state.ownedGeometries.add(geometry);
            const back = new Mesh(geometry, this.backMaterial);
            const front = new Mesh(geometry, this.frontMaterial);
            for (const target of [back, front]) {
                target.matrixAutoUpdate = false;
                target.matrix.copy(source.matrixWorld);
                target.matrixWorld.copy(source.matrixWorld);
                target.matrixWorldNeedsUpdate = true;
            }
            state.sectionMeshes.push(back);
            state.stencilBack.add(back);
            state.stencilFront.add(front);
        }
    }

    private updateCap(
        state: SectionRenderState,
        section: SectionRenderItem,
        camera: Camera,
        sceneBounds: Box3,
    ): void {
        const { plane, clippingPlane } = section;
        const { center, size, frame } = this.capLayout(state.sectionMeshes, plane, sceneBounds);
        section.visual?.updateFrame(plane, frame, camera);
        const normal = ThreeHelper.fromXYZ(plane.normal);
        const basis = new Matrix4().makeBasis(
            ThreeHelper.fromXYZ(plane.xvec),
            ThreeHelper.fromXYZ(plane.yvec),
            normal,
        );
        state.capMesh.position.copy(ThreeHelper.fromXYZ(center));
        state.capMesh.quaternion.setFromRotationMatrix(basis);
        state.capMesh.scale.set(size, size, 1);
        this.updateCoplanarMask(state, clippingPlane);

        const normalOffset = Math.max(size * 1e-6, 1e-4) * this.offsetDirection(plane, camera);
        const positions = sectionEdgePositions(state.sectionMeshes, clippingPlane, normalOffset);
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(positions);
        if (positions.length > 0) geometry.computeBoundingBox();
        state.cutEdges.geometry.dispose();
        state.cutEdges.geometry = geometry;
        state.cutEdges.visible = positions.length > 0;
    }

    private updateCoplanarMask(state: SectionRenderState, plane: ThreePlane): void {
        for (const child of state.coplanarMask.children) {
            if (child instanceof Mesh) child.geometry.dispose();
        }
        state.coplanarMask.clear();
        const positions = coplanarFacePositions(state.sectionMeshes, plane);
        if (positions.length === 0) return;
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
        geometry.computeBoundingSphere();
        state.coplanarMask.add(new Mesh(geometry, this.coplanarMaskMaterial));
    }

    private updateHatch(renderer: WebGLRenderer, camera: Camera, state: SectionRenderState): void {
        const worldSize = Math.max(hatchWorldSize(renderer, camera, state.capMesh.position), 1e-6);
        const repeat = state.capMesh.scale.x / worldSize;
        this.hatchTexture.repeat.set(repeat, repeat);
    }

    private capLayout(
        meshes: Mesh[],
        plane: CorePlane,
        sceneBounds: Box3,
    ): { center: CorePlane["origin"]; size: number; frame: SectionFrameLayout } {
        const bounds = new Box3();
        for (const mesh of meshes) {
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            if (mesh.geometry.boundingBox) {
                bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
            }
        }
        const frameBounds = sceneBounds.isEmpty() ? bounds : sceneBounds;
        if (bounds.isEmpty()) {
            return {
                center: plane.origin,
                size: 1000,
                frame: this.frameLayout(frameBounds, plane),
            };
        }

        const center = plane.project(ThreeHelper.toXYZ(bounds.getCenter(new Vector3())));
        return {
            center,
            size: Math.max(bounds.getSize(new Vector3()).length() * 4, 10),
            frame: this.frameLayout(frameBounds, plane),
        };
    }

    private frameLayout(bounds: Box3, plane: CorePlane): SectionFrameLayout {
        if (bounds.isEmpty()) return { center: plane.origin, width: 100, height: 100 };
        const center = plane.project(ThreeHelper.toXYZ(bounds.getCenter(new Vector3())));
        const origin = ThreeHelper.fromXYZ(plane.origin);
        const xvec = ThreeHelper.fromXYZ(plane.xvec);
        const yvec = ThreeHelper.fromXYZ(plane.yvec);
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < 8; i++) {
            const point = new Vector3(
                i & 1 ? bounds.max.x : bounds.min.x,
                i & 2 ? bounds.max.y : bounds.min.y,
                i & 4 ? bounds.max.z : bounds.min.z,
            ).sub(origin);
            const x = point.dot(xvec);
            const y = point.dot(yvec);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
        const padding = Math.max(Math.max(maxX - minX, maxY - minY) * 0.02, 0.1);
        return {
            center,
            width: Math.max(maxX - minX + padding * 2, 0.2),
            height: Math.max(maxY - minY + padding * 2, 0.2),
        };
    }

    dispose(): void {
        for (const state of this.states.values()) this.disposeState(state);
        this.states.clear();
        this.backMaterial.dispose();
        this.frontMaterial.dispose();
        this.coplanarMaskMaterial.dispose();
        this.capMaterial.dispose();
        this.hatchTexture.dispose();
        this.edgeMaterial.dispose();
    }
}
