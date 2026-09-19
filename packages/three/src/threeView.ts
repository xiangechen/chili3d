// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    Config,
    debounce,
    type HtmlTextOptions,
    type IDisposable,
    type IDocument,
    type IFace,
    type INode,
    type INodeFilter,
    type IShape,
    type IShapeFilter,
    type ISubShape,
    type IView,
    type IViewGizmo,
    type IVisualObject,
    type Matrix4,
    MultiShapeNode,
    Observable,
    type Plane,
    PubSub,
    Ray,
    type ShapeMeshRange,
    ShapeNode,
    type ShapeType,
    ShapeTypes,
    ShapeTypeUtils,
    type ViewMode,
    type VisualNode,
    type VisualShapeData,
    XY,
    type XYZ,
    type XYZLike,
} from "@chili3d/core";
import { div, span, svg } from "@chili3d/element";
import {
    DirectionalLight,
    type Intersection,
    Line,
    LineSegments,
    Mesh,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Raycaster,
    type Scene,
    Vector2,
    Vector3,
    WebGLRenderer,
} from "three";
import { SelectionBox } from "three/examples/jsm/interactive/SelectionBox.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { CameraController } from "./cameraController";
import { Constants } from "./constants";
import { ThreeRefSegmentAnnotation } from "./threeAnnotation";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeHelper } from "./threeHelper";
import type { ThreeHighlighter } from "./threeHighlighter";
import style from "./threeView.module.css";
import type { ThreeVisualContext } from "./threeVisualContext";
import { ThreeComponentObject, ThreeMeshObject, ThreeVisualObject } from "./threeVisualObject";
import { ViewGizmo } from "./viewGizmo";

/** One sub-shape a hit resolved to, and the indexes it occupies in its own node's shape list. */
interface SubShapeEntry {
    shape: IShape;
    transform?: Matrix4;
    indexes: number[];
}

/**
 * The containers a pick replaces a face/edge with, in the order the bitmask asks for them:
 * `solid` before `shell` for a face, `wire` for an edge. A pick may want several at once —
 * `ShapeType` is a bitmask — which is why this is a list and not a single type.
 */
function wantedContainers(shapeType: ShapeType, subType: ShapeType): ShapeType[] {
    const wanted: ShapeType[] = [];
    if (subType === ShapeTypes.face) {
        if (ShapeTypeUtils.hasSolid(shapeType)) wanted.push(ShapeTypes.solid);
        if (ShapeTypeUtils.hasShell(shapeType)) wanted.push(ShapeTypes.shell);
    } else if (subType === ShapeTypes.edge && ShapeTypeUtils.hasWire(shapeType)) {
        wanted.push(ShapeTypes.wire);
    }
    return wanted;
}

/** Whether the sub-shape itself is what a pick with no applicable container asked for. */
function keepsSubShape(shapeType: ShapeType, subType: ShapeType): boolean {
    if (subType === ShapeTypes.face) return ShapeTypeUtils.hasFace(shapeType);
    if (subType === ShapeTypes.edge) return ShapeTypeUtils.hasEdge(shapeType);
    // A range group that is neither a face nor an edge (a solid, a vertex) passes through.
    return true;
}

export class ThreeView extends Observable implements IView {
    private _dom?: HTMLElement;
    private _needsUpdate: boolean = false;
    private _workplane: Plane;
    private _isolatedNodes?: INode[];

    private readonly _scene: Scene;
    private readonly _renderer: WebGLRenderer;
    private readonly _cssRenderer: CSS2DRenderer;
    private readonly _gizmo: IViewGizmo;
    private readonly _resizeObserver: ResizeObserver;

    readonly cameraController: CameraController;
    readonly dynamicLight = new DirectionalLight(0xffffff, 2);

    get name(): string {
        return this.getPrivateValue("name");
    }
    set name(value: string) {
        this.setProperty("name", value);
    }

    get dom() {
        return this._dom;
    }

    private _isClosed: boolean = false;
    get isClosed(): boolean {
        return this._isClosed;
    }

    get camera(): PerspectiveCamera | OrthographicCamera {
        return this.cameraController.camera;
    }

    get mode(): ViewMode {
        return this.getPrivateValue("mode");
    }
    set mode(value: ViewMode) {
        this.setProperty("mode", value, () => {
            this.cameraController.setCameraLayer(this.camera, this.mode);
        });
    }

    constructor(
        readonly document: IDocument,
        name: string,
        workplane: Plane,
        readonly highlighter: ThreeHighlighter,
        readonly content: ThreeVisualContext,
    ) {
        super();
        this.setPrivateValue("name", name);
        this.setPrivateValue("mode", "solidAndWireframe");
        this._scene = content.scene;
        this._workplane = workplane;
        this._resizeObserver = new ResizeObserver(this._resizerObserverCallback);
        this.cameraController = new CameraController(this);
        this._renderer = this.initRenderer();
        this._cssRenderer = this.initCssRenderer();
        this._scene.add(this.dynamicLight);
        this._gizmo = this.initGizmo();
        this.camera.layers.enableAll();
        this.document.application.views.push(this);
        this.animate();
    }

    override disposeInternal(): void {
        super.disposeInternal();
        this._gizmo.dispose();
        this._resizeObserver.disconnect();
    }

    close(): void {
        if (this._isClosed) return;
        this._isClosed = true;
        this.document.application.views.remove(this);
        const otherView = this.document.application.views.find((x) => x.document === this.document);
        if (!otherView) {
            this.document.close();
        } else if (this.document.application.activeView === this) {
            this.document.application.activeView = otherView;
        }
        this.dispose();
        PubSub.default.pub("viewClosed", this);
    }

    private readonly _resizerObserverCallback = debounce((entries: ResizeObserverEntry[]) => {
        for (const entry of entries) {
            if (entry.target === this._dom) {
                this.resize(entry.contentRect.width, entry.contentRect.height);
                return;
            }
        }
    }, 100);

    get renderer(): WebGLRenderer {
        return this._renderer;
    }

    protected initRenderer() {
        const renderer = new WebGLRenderer({
            antialias: true,
            alpha: true,
        });
        renderer.setPixelRatio(window.devicePixelRatio);

        return renderer;
    }

    protected initCssRenderer() {
        const renderer = new CSS2DRenderer();
        return renderer;
    }

    protected initGizmo(): IViewGizmo {
        return new ViewGizmo(this);
    }

    setDom(element: HTMLElement) {
        if (this._dom) {
            this._resizeObserver.unobserve(this._dom);
        }
        this._dom = element;
        this._gizmo.setDom(element);

        this._renderer.domElement.remove();
        this._renderer.domElement.style.userSelect = "none";
        this._renderer.domElement.style.webkitUserSelect = "none";
        element.appendChild(this._renderer.domElement);

        this._cssRenderer.domElement.remove();
        this._cssRenderer.domElement.style.position = "absolute";
        this._cssRenderer.domElement.style.top = "0px";
        this._cssRenderer.domElement.style.userSelect = "none";
        this._cssRenderer.domElement.style.webkitUserSelect = "none";
        element.appendChild(this._cssRenderer.domElement);

        this.resize(element.clientWidth, element.clientHeight);
        this._resizeObserver.observe(element);
        this.cameraController.updateCameraPosionTarget();
    }

    htmlText(text: string, point: XYZLike, options?: HtmlTextOptions): IDisposable {
        const dispose = () => {
            options?.onDispose?.();
            this.content.cssObjects.remove(cssObject);
            cssObject.element.remove();
        };
        const cssObject = new CSS2DObject(this.htmlElement(text, dispose, options));
        cssObject.position.set(point.x, point.y, point.z);
        if (options?.center) cssObject.center.set(options.center.x, options.center.y);
        this.content.cssObjects.add(cssObject);
        return { dispose };
    }

    private htmlElement(text: string, dispose: () => void, options?: HtmlTextOptions): HTMLElement {
        const className = options?.className || style.htmlText;
        const noEvent = options?.hideDelete === true && options?.interactive !== true;
        const element = div(
            {
                className: noEvent ? `${className} ${style.noEvent}` : className,
            },
            span({ textContent: text, style: { color: "inherit" } }),
            options?.hideDelete === true
                ? ""
                : svg({
                      className: style.delete,
                      icon: "icon-times",
                      onclick: (e) => {
                          e.stopPropagation();
                          dispose();
                      },
                  }),
        );
        if (options?.interactive === true) {
            // keep viewport pointer handlers (drag/select) from seeing badge interactions
            element.addEventListener("pointerdown", (e) => e.stopPropagation());
            element.addEventListener("pointerup", (e) => e.stopPropagation());
            if (options.onClick) element.addEventListener("click", options.onClick);
            if (options.onDoubleClick) element.addEventListener("dblclick", options.onDoubleClick);
            if (options.onMouseEnter) element.addEventListener("mouseenter", options.onMouseEnter);
            if (options.onMouseLeave) element.addEventListener("mouseleave", options.onMouseLeave);
        }
        options?.onCreated?.(element);
        return element;
    }

    toImage(): string {
        this._renderer.render(this._scene, this.camera);
        return this.renderer.domElement.toDataURL();
    }

    get workplane(): Plane {
        return this._workplane;
    }

    set workplane(value: Plane) {
        this.setProperty("workplane", value);
    }

    update() {
        this._needsUpdate = true;
    }

    private animate() {
        // stop the loop when the view is closed — or disposed directly, so a
        // dispose() that bypasses close() cannot leave the rAF loop running
        if (this._isClosed || this._isDisposed) {
            return;
        }
        requestAnimationFrame(() => {
            this.animate();
        });
        if (!this._needsUpdate) return;

        const dir = this.camera.position.clone().sub(this.cameraController.target);
        this.dynamicLight.position.copy(dir);
        this._renderer.render(this._scene, this.camera);
        this._cssRenderer.render(this._scene, this.camera);
        this._gizmo?.update();

        this._needsUpdate = false;
    }

    resize(width: number, height: number) {
        if (height < 0.00001) {
            return;
        }
        if (this.camera instanceof PerspectiveCamera) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        } else if (this.camera instanceof OrthographicCamera) {
            this.camera.updateProjectionMatrix();
        }
        this._renderer.setSize(width, height);
        this._cssRenderer.setSize(width, height);
        this.cameraController.setSize(width, height);
        this.update();
    }

    get width() {
        return this._dom?.clientWidth ?? 1;
    }

    get height() {
        return this._dom?.clientHeight ?? 1;
    }

    screenToCameraRect(mx: number, my: number) {
        return new Vector2((mx / this.width) * 2 - 1, -(my / this.height) * 2 + 1);
    }

    rayAt(mx: number, my: number): Ray {
        const { x, y } = this.screenToCameraRect(mx, my);

        const origin = new Vector3();
        const direction = new Vector3(x, y, 0.5);
        if (this.camera instanceof PerspectiveCamera) {
            origin.setFromMatrixPosition(this.camera.matrixWorld);
            direction.unproject(this.camera).sub(origin).normalize();
        } else if (this.camera instanceof OrthographicCamera) {
            const z = (this.camera.near + this.camera.far) / (this.camera.near - this.camera.far);
            origin.set(x, y, z).unproject(this.camera);
            direction.set(0, 0, -1).transformDirection(this.camera.matrixWorld);
        } else {
            console.error(`Unsupported camera type: ${this.camera}`);
        }

        return new Ray({ point: ThreeHelper.toXYZ(origin), direction: ThreeHelper.toXYZ(direction) });
    }

    screenToWorld(mx: number, my: number): XYZ {
        const vec = this.mouseToWorld(mx, my);
        return ThreeHelper.toXYZ(vec);
    }

    worldToScreen(point: XYZ): XY {
        const cx = this.width / 2;
        const cy = this.height / 2;
        const vec = new Vector3(point.x, point.y, point.z).project(this.camera);
        return new XY({ x: Math.round(cx * vec.x + cx), y: Math.round(-cy * vec.y + cy) });
    }

    direction(): XYZ {
        const vec = new Vector3();
        this.camera.getWorldDirection(vec);
        return ThreeHelper.toXYZ(vec);
    }

    up(): XYZ {
        return ThreeHelper.toXYZ(this.camera.up);
    }

    private mouseToWorld(mx: number, my: number, z: number = 0.5) {
        const { x, y } = this.screenToCameraRect(mx, my);
        return new Vector3(x, y, z).unproject(this.camera);
    }

    isolate(nodes: INode[]) {
        const visuals = nodes
            .map((x) => this.content.getVisual(x))
            .filter((x) => x !== undefined) as IVisualObject[];
        for (const shape of visuals) {
            if (shape instanceof Object3D) {
                shape.layers.set(Constants.Layers.Isolation);
                shape.children.forEach((x) => {
                    x.layers.set(Constants.Layers.Isolation);
                });
            }
        }

        this.cameraController.camera.layers.disableAll();
        this.cameraController.camera.layers.enable(Constants.Layers.Default);
        this.cameraController.camera.layers.enable(Constants.Layers.Isolation);

        if (!this._isolatedNodes) {
            this._isolatedNodes = nodes;
        } else {
            this._isolatedNodes = this._isolatedNodes.concat(nodes);
        }
    }

    unisolate() {
        if (!this._isolatedNodes) return;

        const shapes = this._isolatedNodes
            .map((x) => this.content.getVisual(x))
            .filter((x) => x !== undefined) as IVisualObject[];
        for (const shape of shapes) {
            if (shape instanceof Object3D) {
                shape.layers.set(Constants.Layers.Default);
                shape.children.forEach((x) => {
                    if (
                        x instanceof LineSegments2 ||
                        x instanceof Line2 ||
                        x instanceof Line ||
                        x instanceof LineSegments
                    ) {
                        x.layers.set(Constants.Layers.Wireframe);
                    } else if (x instanceof Mesh) {
                        x.layers.set(Constants.Layers.Solid);
                    } else {
                        console.error(`Unsupported object type: ${x}`);
                    }
                });
            }
        }

        this.cameraController.camera.layers.enableAll();
        this._isolatedNodes = undefined;
    }

    detectVisual(x: number, y: number, nodeFilter?: INodeFilter): IVisualObject[] {
        const visual: IVisualObject[] = [];
        const detecteds = this.findIntersectedNodes(x, y);
        for (const detected of detecteds) {
            const threeObject = detected.object.parent as ThreeVisualObject;
            if (!threeObject) continue;

            const node = this.getNodeFromObject(threeObject);
            if (node === undefined) continue;
            if (nodeFilter !== undefined && !nodeFilter.allow(node)) {
                continue;
            }
            visual.push(threeObject);
        }
        return visual;
    }

    detectVisualRect(
        mx1: number,
        my1: number,
        mx2: number,
        my2: number,
        nodeFilter?: INodeFilter,
    ): IVisualObject[] {
        const selectionBox = this.initSelectionBox(mx1, my1, mx2, my2);
        const visual = new Set<IVisualObject>();
        for (const obj of selectionBox.select()) {
            const threeObject = obj.parent as ThreeVisualObject;
            if (!threeObject?.visible) continue;

            const node = this.getNodeFromObject(threeObject);
            if (node === undefined) continue;
            if (nodeFilter !== undefined && !nodeFilter.allow(node)) {
                continue;
            }
            visual.add(threeObject);
        }
        return Array.from(visual);
    }

    private getNodeFromObject(threeObject: Object3D) {
        let node: VisualNode | undefined;
        if (threeObject instanceof ThreeMeshObject) {
            node = threeObject.meshNode;
        } else if (threeObject instanceof ThreeGeometry) {
            node = threeObject.geometryNode;
        } else if (threeObject instanceof ThreeComponentObject) {
            node = threeObject.componentNode;
        } else if (threeObject instanceof ThreeRefSegmentAnnotation) {
            node = threeObject.annotation;
        }
        return node;
    }

    private initSelectionBox(mx1: number, my1: number, mx2: number, my2: number) {
        const selectionBox = new SelectionBox(this.camera, this._scene);
        const start = this.screenToCameraRect(mx1, my1);
        const end = this.screenToCameraRect(mx2, my2);
        selectionBox.startPoint.set(start.x, start.y, 0.5);
        selectionBox.endPoint.set(end.x, end.y, 0.5);
        return selectionBox;
    }

    detectShapesRect(
        shapeType: ShapeType,
        mx1: number,
        my1: number,
        mx2: number,
        my2: number,
        shapeFilter?: IShapeFilter,
        nodeFilter?: INodeFilter,
    ): VisualShapeData[] {
        const minX = Math.min(mx1, mx2);
        const maxX = Math.max(mx1, mx2);
        const minY = Math.min(my1, my2);
        const maxY = Math.max(my1, my2);

        const visuals = this.detectVisualsInRect(minX, minY, maxX, maxY, nodeFilter);

        if (ShapeTypeUtils.isWhole(shapeType)) {
            return this.detectWholeShapesInRect(visuals, shapeFilter);
        }

        return this.detectSubShapesInRect(shapeType, visuals, minX, minY, maxX, maxY, shapeFilter);
    }

    private detectWholeShapesInRect(
        visuals: ThreeVisualObject[],
        shapeFilter?: IShapeFilter,
    ): VisualShapeData[] {
        const result: VisualShapeData[] = [];
        const addShape = (
            shapes: IShape[] | readonly IShape[],
            worldTransform: Matrix4,
            visual: ThreeVisualObject,
        ) => {
            // Dedupe within a single visual only: cloned nodes share shape ids across
            // visuals, and each visual's shape is a distinct detection result.
            const added = new Set<string>();
            for (const shape of shapes) {
                if (added.has(shape.id)) continue;
                if (shapeFilter && !shapeFilter.allow(shape, worldTransform)) continue;

                added.add(shape.id);
                result.push({
                    owner: visual,
                    shape,
                    transform: worldTransform,
                    indexes: [],
                });
            }
        };

        for (const visual of visuals) {
            const worldTransform = visual.worldTransform();

            if (visual.node instanceof ShapeNode && visual.node.shape.isOk) {
                addShape([visual.node.shape.value], worldTransform, visual);
            } else if (visual.node instanceof MultiShapeNode) {
                addShape(visual.node.shapes, worldTransform, visual);
            }
        }

        return result;
    }

    private detectVisualsInRect(
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
        nodeFilter?: INodeFilter,
    ): ThreeVisualObject[] {
        const result: ThreeVisualObject[] = [];
        this.document.visual.context.visuals().forEach((x) => {
            if (!(x instanceof ThreeVisualObject) || !x.node.visible || !x.node.parentVisible) return;

            const node = this.getNodeFromObject(x);
            if (node === undefined) return;
            if (nodeFilter && !nodeFilter.allow(node)) return;

            const box = x.boundingBox();
            if (!box) return;

            if (this.isBoundingBoxInRect(box, x.worldTransform(), minX, minY, maxX, maxY)) {
                result.push(x);
            }
        });
        return result;
    }

    private detectSubShapesInRect(
        shapeType: ShapeType,
        visuals: ThreeVisualObject[],
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
        shapeFilter?: IShapeFilter,
    ): VisualShapeData[] {
        const result: VisualShapeData[] = [];

        // No cross-visual dedupe here: cloned nodes share shape ids, and each visual's
        // sub-shapes are distinct results. Within-visual duplicates are already removed
        // by collectSubShapeEntries.
        for (const visual of visuals) {
            const worldMatrix = visual.worldTransform();
            const entries = this.collectSubShapeEntries(shapeType, visual);

            for (const entry of entries) {
                if (!this.isShapeInRect(entry.shape, entry.transform, worldMatrix, minX, minY, maxX, maxY)) {
                    continue;
                }

                const shapeTransform = entry.transform ? worldMatrix.multiply(entry.transform) : worldMatrix;

                if (shapeFilter && !shapeFilter.allow(entry.shape, shapeTransform)) {
                    continue;
                }

                result.push({
                    owner: visual,
                    shape: entry.shape,
                    transform: shapeTransform,
                    indexes: entry.indexes,
                });
            }
        }

        return result;
    }

    private collectSubShapeEntries(shapeType: ShapeType, visual: ThreeVisualObject): SubShapeEntry[] {
        const entries: SubShapeEntry[] = [];
        const added = new Set<string>();

        const iterateFaces =
            ShapeTypeUtils.hasFace(shapeType) ||
            ShapeTypeUtils.hasSolid(shapeType) ||
            ShapeTypeUtils.hasShell(shapeType);
        const iterateEdges = ShapeTypeUtils.hasEdge(shapeType) || ShapeTypeUtils.hasWire(shapeType);

        // The ranges to walk and the shape the ancestors are resolved against: a geometry
        // node's own mesh, or a component instance's merged one (no root shape of its own).
        let faceRanges: ShapeMeshRange[] | undefined;
        let edgeRanges: ShapeMeshRange[] | undefined;
        let rootShape: IShape | undefined;
        if (visual instanceof ThreeGeometry) {
            const node = visual.geometryNode;
            rootShape = node instanceof ShapeNode ? node.shape.unchecked() : undefined;
            faceRanges = node.mesh.faces?.range;
            edgeRanges = node.mesh.edges?.range;
        } else if (visual instanceof ThreeComponentObject) {
            const mesh = visual.componentNode.component.mesh;
            faceRanges = mesh.face.range;
            edgeRanges = mesh.edge.range;
        }

        if (iterateFaces && faceRanges?.length) {
            this.resolveRangeGroups(shapeType, faceRanges, rootShape, added, entries);
        }
        if (iterateEdges && edgeRanges?.length) {
            this.resolveRangeGroups(shapeType, edgeRanges, rootShape, added, entries);
        }
        return entries;
    }

    private resolveRangeGroups(
        shapeType: ShapeType,
        groups: ShapeMeshRange[],
        rootShape: IShape | undefined,
        added: Set<string>,
        entries: SubShapeEntry[],
    ) {
        for (let i = 0; i < groups.length; i++) {
            const subShape = groups[i].shape as ISubShape;
            if (!subShape) continue;

            const rShape = rootShape ?? subShape;
            // Only the FIRST wanted container applies: the face is replaced by it whether or
            // not the ancestor resolves, never demoted back to the face itself.
            const container = wantedContainers(shapeType, subShape.shapeType).at(0);
            if (container !== undefined) {
                this.addEntry(added, entries, this.getAncestorAndIndex(container, subShape, rShape, groups));
                continue;
            }
            if (!keepsSubShape(shapeType, subShape.shapeType)) continue;
            this.addEntry(added, entries, { indexes: [i], ...groups[i] });
        }
    }

    /**
     * Adds one resolved sub-shape, once per shape id — the same face may sit in several
     * ranges. An ancestor lookup that found nothing arrives as an entry with no shape.
     */
    private addEntry(
        added: Set<string>,
        entries: SubShapeEntry[],
        entry: { shape: IShape | undefined; transform?: Matrix4; indexes: number[] },
    ): void {
        if (!entry.shape || added.has(entry.shape.id)) return;
        added.add(entry.shape.id);
        entries.push({ shape: entry.shape, transform: entry.transform, indexes: entry.indexes });
    }

    private isBoundingBoxInRect(
        box: BoundingBox,
        worldMatrix: Matrix4,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
    ): boolean {
        if (!BoundingBox.isValid(box)) return false;

        let screenMinX = Number.POSITIVE_INFINITY;
        let screenMinY = Number.POSITIVE_INFINITY;
        let screenMaxX = Number.NEGATIVE_INFINITY;
        let screenMaxY = Number.NEGATIVE_INFINITY;

        const { min, max } = box;
        for (let i = 0; i < 8; i++) {
            const ix = i & 1 ? max.x : min.x;
            const iy = i & 2 ? max.y : min.y;
            const iz = i & 4 ? max.z : min.z;
            const { x, y } = this.worldToScreen(worldMatrix.ofPoint({ x: ix, y: iy, z: iz }));
            if (x < screenMinX) screenMinX = x;
            if (y < screenMinY) screenMinY = y;
            if (x > screenMaxX) screenMaxX = x;
            if (y > screenMaxY) screenMaxY = y;
        }

        return screenMinX <= maxX && screenMaxX >= minX && screenMinY <= maxY && screenMaxY >= minY;
    }

    private isShapeInRect(
        shape: IShape,
        localTransform: Matrix4 | undefined,
        worldMatrix: Matrix4,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
    ): boolean {
        const box = shape.boundingBox();
        if (!box) return false;

        const composed = localTransform ? worldMatrix.multiply(localTransform) : worldMatrix;
        const center = BoundingBox.center(box);
        const { x, y } = this.worldToScreen(composed.ofPoint(center));

        return x <= maxX && x >= minX && y <= maxY && y >= minY;
    }

    detectShapes(
        shapeType: ShapeType,
        mx: number,
        my: number,
        shapeFilter?: IShapeFilter,
        nodeFilter?: INodeFilter,
    ): VisualShapeData[] {
        const intersections = this.findIntersectedShapes(shapeType, mx, my);
        if (ShapeTypeUtils.isWhole(shapeType)) {
            return this.detectThreeShapes(intersections, shapeFilter, nodeFilter);
        }
        const subs = this.detectSubShapes(shapeType, intersections, shapeFilter, nodeFilter);
        // When an edge is on a face, the face will be snapped first,
        // so the nearest edge needs to be placed at the beginning of the array.
        if (subs.length > 1 && subs[0].shape.shapeType === ShapeTypes.face) {
            const i = subs.findIndex((x) => x.shape.shapeType === ShapeTypes.edge);
            if (i < 0) return subs;

            const nearest = (subs[0].shape as IFace).surface().nearestPoint(subs[i].point!) ?? [];
            if (nearest.length > 0 && nearest[0]!.distanceTo(subs[i].point!) < 0.001) {
                const v = subs.splice(i, 1);
                subs.splice(0, 0, ...v);
            }
        }
        return subs;
    }

    private detectThreeShapes(
        intersections: Intersection[],
        shapeFilter?: IShapeFilter,
        nodeFilter?: INodeFilter,
    ): VisualShapeData[] {
        for (const element of intersections) {
            const parent = element.object.parent;
            if (!(parent instanceof ThreeGeometry)) continue;

            let shape: IShape | undefined;
            if (parent.geometryNode instanceof ShapeNode) {
                shape = parent.geometryNode.shape.unchecked();
            } else if (parent.geometryNode instanceof MultiShapeNode) {
                shape = this.findShapeAndIndex(parent, element).shape;
            }

            if (
                !shape ||
                (shapeFilter && !shapeFilter.allow(shape, parent.worldTransform())) ||
                (nodeFilter && !nodeFilter.allow(parent.geometryNode))
            ) {
                continue;
            }

            return [
                {
                    owner: parent,
                    shape,
                    transform: parent.worldTransform(),
                    point: ThreeHelper.toXYZ(element.pointOnLine ?? element.point),
                    indexes: [],
                },
            ];
        }
        return [];
    }

    private detectSubShapes(
        shapeType: ShapeType,
        intersections: Intersection<Object3D>[],
        shapeFilter?: IShapeFilter,
        nodeFilter?: INodeFilter,
    ) {
        const result: VisualShapeData[] = [];
        for (const intersected of intersections) {
            const visualShape = intersected.object.parent;
            if (visualShape instanceof ThreeVisualObject) {
                const { shape, indexes, transform } = this.getSubShapeFromInsection(
                    shapeType,
                    visualShape,
                    intersected,
                );
                const nodeWorldTransform = visualShape.worldTransform();
                const shapeTransform = transform
                    ? nodeWorldTransform.multiply(transform)
                    : nodeWorldTransform;
                if (
                    !shape ||
                    (shapeFilter && !shapeFilter.allow(shape, shapeTransform)) ||
                    (nodeFilter && !nodeFilter.allow(visualShape.node))
                ) {
                    continue;
                }
                result.push({
                    owner: visualShape,
                    shape,
                    transform: shapeTransform,
                    point: ThreeHelper.toXYZ(intersected.pointOnLine ?? intersected.point),
                    indexes,
                });
            }
        }
        return result;
    }

    private getSubShapeFromInsection(
        shapeType: ShapeType,
        parent: ThreeVisualObject,
        intersection: Intersection,
    ): {
        shape: IShape | undefined;
        transform?: Matrix4;
        indexes: number[];
    } {
        const { shape, subShape, index, groups, transform } = this.findShapeAndIndex(parent, intersection);
        if (!subShape || !shape) return { shape: undefined, indexes: [] };

        // Every wanted container is tried in turn — a container whose ancestor cannot be
        // found falls through to the next, and only then to the sub-shape itself. (The
        // rect path stops at the first one; see `resolveRangeGroups`.)
        for (const container of wantedContainers(shapeType, subShape.shapeType)) {
            const ancestor = this.getAncestorAndIndex(container, subShape, shape, groups);
            if (ancestor.shape) return ancestor;
        }
        if (!keepsSubShape(shapeType, subShape.shapeType)) {
            return { shape: undefined, indexes: [index] };
        }
        return { shape: subShape, indexes: [index], transform };
    }

    private getAncestorAndIndex(
        type: ShapeType,
        subShape: ISubShape,
        shape: IShape,
        groups: ShapeMeshRange[],
    ): {
        shape: IShape | undefined;
        indexes: number[];
        subShape?: ISubShape;
        transform?: Matrix4;
    } {
        const ancestor = subShape.findAncestor(type, shape).at(0);
        if (!ancestor) return { shape: undefined, indexes: [] };

        const indexes: number[] = [];
        for (const sub of ancestor.findSubShapes(subShape.shapeType)) {
            this.findIndex(groups, sub, indexes);
        }
        return { shape: ancestor, indexes, subShape, transform: groups.at(0)?.transform };
    }

    private findIndex(groups: ShapeMeshRange[], shape: IShape, indexes: number[]) {
        for (let i = 0; i < groups.length; i++) {
            if (shape.isEqual(groups[i].shape)) {
                indexes.push(i);
            }
        }
    }

    private findShapeAndIndex(parent: ThreeVisualObject, element: Intersection) {
        let type: "edge" | "face" | "vertex" = "edge";
        let subVisualIndex = element.faceIndex! * 2;
        if (!element.pointOnLine && !Number.isInteger(element.faceIndex)) {
            type = "vertex";
            subVisualIndex = element.index!;
        } else if (!element.pointOnLine) {
            type = "face";
            subVisualIndex = element.faceIndex! * 3;
        }

        return parent.getSubShapeAndIndex(type, subVisualIndex);
    }

    private findIntersectedNodes(mx: number, my: number) {
        let visuals: Object3D[] = [];
        this.document.visual.context.visuals().forEach((x) => {
            if (!x.visible) return;
            if (x instanceof ThreeVisualObject && x.node.visible && x.node.parentVisible) {
                visuals.push(...x.wholeVisual());
            } else if (x instanceof ThreeRefSegmentAnnotation) {
                visuals.push(...x.wholeVisual());
            }
        });
        visuals = visuals.filter((x) => x !== undefined && x !== null);
        return this.initRaycaster(mx, my).intersectObjects(visuals, false);
    }

    private findIntersectedShapes(shapeType: ShapeType, mx: number, my: number) {
        const raycaster = this.initRaycaster(mx, my);
        const shapes = this.initIntersectableShapes(shapeType);
        return raycaster.intersectObjects(shapes, false);
    }

    private initIntersectableShapes(shapeType: ShapeType) {
        let shapes: Object3D[] = [];
        this.document.visual.context.visuals().forEach((x) => {
            if (x instanceof ThreeVisualObject && x.node.visible && x.node.parentVisible) {
                shapes.push(...x.subShapeVisual(shapeType));
            }
        });
        shapes = shapes.filter((x) => x !== undefined && x !== null);
        return shapes;
    }

    private initRaycaster(mx: number, my: number) {
        const threshold = Config.instance.SnapDistance;
        const { x, y } = this.screenToCameraRect(mx, my);
        const mousePos = new Vector2(x, y);

        const raycaster = new Raycaster();
        if (this.mode === "wireframe") {
            raycaster.layers.disableAll();
            raycaster.layers.enable(Constants.Layers.Wireframe);
        } else if (this.mode === "solid") {
            raycaster.layers.disableAll();
            raycaster.layers.enable(Constants.Layers.Solid);
        } else {
            raycaster.layers.enableAll();
        }
        raycaster.setFromCamera(mousePos, this.camera);
        raycaster.params = {
            ...raycaster.params,
            Line2: { threshold },
            Line: { threshold },
            Points: { threshold },
        };
        return raycaster;
    }
}
