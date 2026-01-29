// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { div, span, svg } from "chili-controls";
import {
    debounce,
    type HtmlTextOptions,
    type IDisposable,
    type IDocument,
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
    ShapeType,
    ShapeTypeUtils,
    type ViewMode,
    type VisualNode,
    type VisualShapeData,
    XY,
    type XYZ,
    type XYZLike,
} from "chili-core";
import {
    DirectionalLight,
    type Intersection,
    type Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Raycaster,
    type Scene,
    Vector2,
    Vector3,
    WebGLRenderer,
} from "three";
import { SelectionBox } from "three/examples/jsm/interactive/SelectionBox.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { CameraController } from "./cameraController";
import { Constants } from "./constants";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeHelper } from "./threeHelper";
import type { ThreeHighlighter } from "./threeHighlighter";
import style from "./threeView.module.css";
import type { ThreeVisualContext } from "./threeVisualContext";
import { ThreeComponentObject, ThreeMeshObject, ThreeVisualObject } from "./threeVisualObject";
import { ViewGizmo } from "./viewGizmo";

export class ThreeView extends Observable implements IView {
    private _dom?: HTMLElement;
    private _needsUpdate: boolean = false;

    private readonly _scene: Scene;
    private readonly _renderer: WebGLRenderer;
    private readonly _cssRenderer: CSS2DRenderer;
    private readonly _workplane: Plane;
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
        this._scene = content.scene;
        this._workplane = workplane;
        const resizerObserverCallback = debounce(this._resizerObserverCallback, 100);
        this._resizeObserver = new ResizeObserver(resizerObserverCallback);
        this.cameraController = new CameraController(this);
        this._renderer = this.initRenderer();
        this._cssRenderer = this.initCssRenderer();
        this._scene.add(this.dynamicLight);
        this._gizmo = this.initGizmo();
        this.setPrivateValue("mode", "solidAndWireframe");
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

    private readonly _resizerObserverCallback = (entries: ResizeObserverEntry[]) => {
        for (const entry of entries) {
            if (entry.target === this._dom) {
                this.resize(entry.contentRect.width, entry.contentRect.height);
                return;
            }
        }
    };

    get renderer(): WebGLRenderer {
        return this._renderer;
    }

    protected initRenderer() {
        const renderer = new WebGLRenderer({
            antialias: false,
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
        return div(
            {
                className: options?.hideDelete ? `${className} ${style.noEvent}` : className,
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
        if (this._isClosed) {
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
            console.error("Unsupported camera type: " + this.camera);
        }

        return new Ray(ThreeHelper.toXYZ(origin), ThreeHelper.toXYZ(direction));
    }

    screenToWorld(mx: number, my: number): XYZ {
        const vec = this.mouseToWorld(mx, my);
        return ThreeHelper.toXYZ(vec);
    }

    worldToScreen(point: XYZ): XY {
        const cx = this.width / 2;
        const cy = this.height / 2;
        const vec = new Vector3(point.x, point.y, point.z).project(this.camera);
        return new XY(Math.round(cx * vec.x + cx), Math.round(-cy * vec.y + cy));
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
    ) {
        const selectionBox = this.initSelectionBox(mx1, my1, mx2, my2);
        const detecteds: VisualShapeData[] = [];
        const containsCache = new Set<IShape>();
        for (const obj of selectionBox.select()) {
            this.addDetectedShape(detecteds, containsCache, shapeType, obj, shapeFilter, nodeFilter);
        }
        return detecteds;
    }

    private addDetectedShape(
        detecteds: VisualShapeData[],
        cache: Set<IShape>,
        shapeType: ShapeType,
        obj: Object3D,
        shapeFilter?: IShapeFilter,
        nodeFilter?: INodeFilter,
    ) {
        const node = this.getParentNode(obj);
        const shape = node?.shape.unchecked();
        if (shape === undefined || cache.has(shape)) return;

        const addShape = (indexes: number[]) => {
            detecteds.push({
                shape,
                transform: ThreeHelper.toMatrix(obj.parent!.matrixWorld),
                owner: obj.parent as any,
                indexes,
            });
            cache.add(shape);
        };

        if (shapeType === ShapeType.Shape) {
            addShape([]);
            return;
        }
        if ((shape.shapeType & shapeType) === 0) return;
        if ((shapeFilter && !shapeFilter.allow(shape)) || (nodeFilter && !nodeFilter.allow(node!))) return;

        const groups = obj instanceof LineSegments2 ? shape.mesh.edges?.range : shape.mesh.faces?.range;
        addShape([...Array(groups?.length).keys()]);
    }

    private getParentNode(obj: Object3D) {
        if (!obj.parent?.visible || !(obj.parent instanceof ThreeGeometry)) return undefined;

        return obj.parent.geometryNode as ShapeNode;
    }

    detectShapes(
        shapeType: ShapeType,
        mx: number,
        my: number,
        shapeFilter?: IShapeFilter,
        nodeFilter?: INodeFilter,
    ): VisualShapeData[] {
        const intersections = this.findIntersectedShapes(shapeType, mx, my);
        return ShapeTypeUtils.isWhole(shapeType)
            ? this.detectThreeShapes(intersections, shapeFilter, nodeFilter)
            : this.detectSubShapes(shapeType, intersections, shapeFilter, nodeFilter);
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
                (shapeFilter && !shapeFilter.allow(shape)) ||
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
                if (
                    !shape ||
                    (shapeFilter && !shapeFilter.allow(shape)) ||
                    (nodeFilter && !nodeFilter.allow(visualShape.node))
                ) {
                    continue;
                }
                const nodeWorldTransform = visualShape.worldTransform();
                result.push({
                    owner: visualShape,
                    shape,
                    transform: transform ? nodeWorldTransform.multiply(transform) : nodeWorldTransform,
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

        if (ShapeTypeUtils.hasSolid(shapeType) && subShape.shapeType === ShapeType.Face) {
            const solid = this.getAncestorAndIndex(ShapeType.Solid, subShape, shape, groups);
            if (solid.shape) return solid;
        }
        if (ShapeTypeUtils.hasShell(shapeType) && subShape.shapeType === ShapeType.Face) {
            const shell = this.getAncestorAndIndex(ShapeType.Shell, subShape, shape, groups);
            if (shell.shape) return shell;
        }
        if (ShapeTypeUtils.hasWire(shapeType) && subShape.shapeType === ShapeType.Edge) {
            const wire = this.getAncestorAndIndex(ShapeType.Wire, subShape, shape, groups);
            if (wire.shape) return wire;
        }
        if (!ShapeTypeUtils.hasFace(shapeType) && subShape.shapeType === ShapeType.Face) {
            return { shape: undefined, indexes: [index] };
        }
        if (!ShapeTypeUtils.hasEdge(shapeType) && subShape.shapeType === ShapeType.Edge) {
            return { shape: undefined, indexes: [index] };
        }

        return { shape: subShape, indexes: [index], transform };
    }

    private getAncestorAndIndex(
        type: ShapeType,
        subShape: ISubShape,
        shape: IShape,
        groups: ShapeMeshRange[],
    ) {
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
        const visuals: Object3D[] = [];
        this.document.visual.context.visuals().forEach((x) => {
            if (!x.visible) return;

            if (x instanceof ThreeVisualObject) {
                visuals.push(...x.wholeVisual());
            }
        });

        return this.initRaycaster(mx, my).intersectObjects(visuals, false);
    }

    private findIntersectedShapes(shapeType: ShapeType, mx: number, my: number) {
        const raycaster = this.initRaycaster(mx, my);
        const shapes = this.initIntersectableShapes(shapeType);
        return raycaster.intersectObjects(shapes, false);
    }

    private initIntersectableShapes(shapeType: ShapeType) {
        const shapes: Object3D[] = [];
        this.document.visual.context.visuals().forEach((x) => {
            if (!x.visible) return;
            if (x instanceof ThreeVisualObject) shapes.push(...x.subShapeVisual(shapeType));
        });
        return shapes;
    }

    private initRaycaster(mx: number, my: number) {
        const threshold = Constants.RaycasterThreshold;
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
