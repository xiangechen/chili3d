// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    IDocument,
    IShape,
    IShapeFilter,
    IView,
    Observable,
    Plane,
    PubSub,
    Ray,
    ShapeMeshGroup,
    ShapeType,
    VisualShapeData,
    XY,
    XYZ,
    debounce,
} from "chili-core";
import {
    DirectionalLight,
    Intersection,
    Mesh,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Raycaster,
    Scene,
    Vector2,
    Vector3,
    WebGLRenderer,
} from "three";
import { SelectionBox } from "three/examples/jsm/interactive/SelectionBox";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2";
import { CameraController } from "./cameraController";
import { Constants } from "./constants";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeHelper } from "./threeHelper";
import { ThreeHighlighter } from "./threeHighlighter";
import { ThreeVisualContext } from "./threeVisualContext";
import { ViewGizmo } from "./viewGizmo";

export class ThreeView extends Observable implements IView {
    private _dom?: HTMLElement;
    private _resizeObserver: ResizeObserver;

    private _scene: Scene;
    private _renderer: WebGLRenderer;
    private _workplane: Plane;
    private _needsUpdate: boolean = false;
    private readonly _gizmo: ViewGizmo;
    readonly cameraController: CameraController;
    readonly dynamicLight = new DirectionalLight(0xffffff, 2);

    private _name: string;
    get name(): string {
        return this._name;
    }
    set name(value: string) {
        this.setProperty("name", value);
    }

    private _isClosed: boolean = false;
    get isClosed(): boolean {
        return this._isClosed;
    }

    get camera(): PerspectiveCamera | OrthographicCamera {
        return this.cameraController.camera;
    }

    constructor(
        readonly document: IDocument,
        name: string,
        workplane: Plane,
        readonly highlighter: ThreeHighlighter,
        readonly content: ThreeVisualContext,
    ) {
        super();
        this._name = name;
        this._scene = content.scene;
        this._workplane = workplane;
        let resizerObserverCallback = debounce(this._resizerObserverCallback, 100);
        this._resizeObserver = new ResizeObserver(resizerObserverCallback);
        this.cameraController = new CameraController(this);
        this._renderer = this.initRenderer();
        this._scene.add(this.dynamicLight);
        this._gizmo = new ViewGizmo(this);
        this.animate();
        this.document.application.views.push(this);
    }

    override dispose(): void {
        super.dispose();
        this._resizeObserver.disconnect();
    }

    close(): void {
        if (this._isClosed) return;
        this._isClosed = true;
        this.document.application.views.remove(this);
        let otherView = this.document.application.views.find((x) => x.document === this.document);
        if (!otherView) {
            this.document.close();
        } else if (this.document.application.activeView === this) {
            this.document.application.activeView = otherView;
        }
        this.dispose();
        PubSub.default.pub("viewClosed", this);
    }

    private _resizerObserverCallback = (entries: ResizeObserverEntry[]) => {
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
        let renderer = new WebGLRenderer({
            antialias: false,
            alpha: true,
        });
        renderer.setPixelRatio(window.devicePixelRatio);

        return renderer;
    }

    setDom(element: HTMLElement) {
        if (this._dom) {
            this._resizeObserver.unobserve(this._dom);
        }
        this._dom = element;
        this._gizmo?.remove();
        element.appendChild(this._gizmo);
        this._renderer.domElement.remove();
        element.appendChild(this._renderer.domElement);
        this.resize(element.clientWidth, element.clientHeight);
        this._resizeObserver.observe(element);
        setTimeout(() => {
            this.cameraController.update();
        }, 50);
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
        requestAnimationFrame(() => {
            this.animate();
        });
        if (!this._needsUpdate) return;

        let dir = this.camera.position.clone().sub(this.cameraController.target);
        this.dynamicLight.position.copy(dir);
        this._renderer.render(this._scene, this.camera);
        this._gizmo?.update();

        this._needsUpdate = false;
    }

    resize(width: number, heigth: number) {
        if (this.camera instanceof PerspectiveCamera) {
            this.camera.aspect = width / heigth;
            this.camera.updateProjectionMatrix();
        } else if (this.camera instanceof OrthographicCamera) {
            this.camera.updateProjectionMatrix();
        }
        this._renderer.setSize(width, heigth);
        this.update();
    }

    get width() {
        return this._dom?.clientWidth;
    }

    get height() {
        return this._dom?.clientHeight;
    }

    screenToCameraRect(mx: number, my: number) {
        return {
            x: (mx / this.width!) * 2 - 1,
            y: -(my / this.height!) * 2 + 1,
        };
    }

    rayAt(mx: number, my: number): Ray {
        let { position, direction } = this.directionAt(mx, my);
        return new Ray(ThreeHelper.toXYZ(position), ThreeHelper.toXYZ(direction));
    }

    private directionAt(mx: number, my: number) {
        let position = this.mouseToWorld(mx, my);
        let direction = new Vector3();
        if (this.camera instanceof PerspectiveCamera) {
            direction = position.clone().sub(this.camera.position).normalize();
        } else if (this.camera instanceof OrthographicCamera) {
            this.camera.getWorldDirection(direction);
        }
        return { position, direction };
    }

    screenToWorld(mx: number, my: number): XYZ {
        let vec = this.mouseToWorld(mx, my);
        return ThreeHelper.toXYZ(vec);
    }

    worldToScreen(point: XYZ): XY {
        let cx = this.width! / 2;
        let cy = this.height! / 2;
        let vec = new Vector3(point.x, point.y, point.z).project(this.camera);
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
        let { x, y } = this.screenToCameraRect(mx, my);
        return new Vector3(x, y, z).unproject(this.camera);
    }

    rectDetected(
        shapeType: ShapeType,
        mx1: number,
        my1: number,
        mx2: number,
        my2: number,
        shapeFilter?: IShapeFilter,
    ) {
        const selectionBox = new SelectionBox(this.camera, this._scene);
        const start = this.screenToCameraRect(mx1, my1);
        const end = this.screenToCameraRect(mx2, my2);
        selectionBox.startPoint.set(start.x, start.y, 0.5);
        selectionBox.endPoint.set(end.x, end.y, 0.5);
        let detecteds: VisualShapeData[] = [];
        let containsCache = new Set<IShape>();
        for (const obj of selectionBox.select()) {
            this.addDetectedShape(detecteds, containsCache, shapeType, obj, shapeFilter);
        }
        return detecteds;
    }

    private addDetectedShape(
        detecteds: VisualShapeData[],
        cache: Set<IShape>,
        shapeType: ShapeType,
        obj: Mesh | LineSegments2,
        shapeFilter?: IShapeFilter,
    ) {
        if (!(obj.parent instanceof ThreeGeometry) || !obj.parent.visible) return;
        let shape = obj.parent.geometryEngity.shape.value!;
        if (cache.has(shape)) return;

        const addShape = (indexes: number[]) => {
            detecteds.push({
                shape,
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
        if (shapeFilter && !shapeFilter.allow(shape)) return;

        let groups = obj instanceof LineSegments2 ? shape.mesh.edges?.groups : shape.mesh.faces?.groups;
        addShape([...Array(groups?.length).keys()]);
    }

    detected(shapeType: ShapeType, mx: number, my: number, shapeFilter?: IShapeFilter): VisualShapeData[] {
        let intersections = this.findIntersections(shapeType, mx, my);
        return ShapeType.isWhole(shapeType)
            ? this.detectThreeShapes(intersections, shapeFilter)
            : this.detectSubShapes(shapeType, intersections, shapeFilter);
    }

    private detectThreeShapes(intersections: Intersection[], shapeFilter?: IShapeFilter): VisualShapeData[] {
        for (const element of intersections) {
            const parent = element.object.parent;
            if (!(parent instanceof ThreeGeometry)) continue;

            if (shapeFilter && !shapeFilter.allow(parent.geometryEngity.shape.value!)) {
                continue;
            }
            return [
                {
                    owner: parent,
                    shape: parent.geometryEngity.shape.value!,
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
    ) {
        let result: VisualShapeData[] = [];
        for (const intersected of intersections) {
            const visualShape = intersected.object.parent;
            if (!(visualShape instanceof ThreeGeometry)) continue;
            let { shape, directShape, indexes } = this.getShape(shapeType, visualShape, intersected);
            if (!shape || (shapeFilter && !shapeFilter.allow(shape))) {
                continue;
            }
            result.push({
                owner: visualShape,
                shape: shape,
                directShape,
                point: ThreeHelper.toXYZ(intersected.pointOnLine ?? intersected.point),
                indexes,
            });
        }
        return result;
    }

    private getShape(
        shapeType: ShapeType,
        parent: ThreeGeometry,
        element: Intersection,
    ): {
        shape: IShape | undefined;
        directShape: IShape | undefined;
        indexes: number[];
    } {
        let { shape, index, groups } = this.findShapeAndIndex(parent, element);
        if (!shape) return { shape: undefined, directShape: undefined, indexes: [] };
        if (ShapeType.hasShell(shapeType) && shape.shapeType === ShapeType.Face) {
            let shell = this.getAncestor(ShapeType.Shell, shape, groups!, parent);
            if (shell.shape) return shell;
        }
        if (ShapeType.hasWire(shapeType) && shape.shapeType === ShapeType.Edge) {
            let wire = this.getAncestor(ShapeType.Wire, shape, groups!, parent);
            if (wire.shape) return wire;
        }
        if (!ShapeType.hasFace(shapeType) && shape.shapeType === ShapeType.Face) {
            return { shape: undefined, directShape: undefined, indexes: [index!] };
        }
        if (!ShapeType.hasEdge(shapeType) && shape.shapeType === ShapeType.Edge) {
            return { shape: undefined, directShape: undefined, indexes: [index!] };
        }

        return { shape, directShape: shape, indexes: [index!] };
    }

    private getAncestor(
        type: ShapeType,
        directShape: IShape,
        groups: ShapeMeshGroup[],
        parent: ThreeGeometry,
    ) {
        let ancestor = directShape.findAncestor(type, parent.geometryEngity.shape.value!).at(0);
        if (!ancestor) return { shape: undefined, indexes: [] };

        let indexes: number[] = [];
        for (const subShape of ancestor.findSubShapes(directShape.shapeType)) {
            this.findIndex(groups, subShape, indexes);
        }
        return { shape: ancestor, indexes, directShape };
    }

    private findIndex(groups: ShapeMeshGroup[], shape: IShape, indexes: number[]) {
        for (let i = 0; i < groups.length; i++) {
            if (shape.isEqual(groups[i].shape)) {
                indexes.push(i);
            }
        }
    }

    private findShapeAndIndex(parent: ThreeGeometry, element: Intersection) {
        let shape: IShape | undefined = undefined;
        let index: number | undefined = undefined;
        let groups: ShapeMeshGroup[] | undefined = undefined;
        if (element.pointOnLine !== undefined) {
            groups = parent.geometryEngity.shape.value?.mesh.edges?.groups;
            if (groups) {
                index = ThreeHelper.findGroupIndex(groups, element.faceIndex! * 2)!;
                shape = groups[index].shape;
            }
        } else {
            groups = parent.geometryEngity.shape.value?.mesh.faces?.groups;
            if (groups) {
                index = ThreeHelper.findGroupIndex(groups, element.faceIndex! * 3)!;
                shape = groups[index].shape;
            }
        }
        return { shape, index, groups };
    }

    private findIntersections(shapeType: ShapeType, mx: number, my: number) {
        let raycaster = this.initRaycaster(mx, my);
        let shapes = this.initIntersectableObjects(shapeType);
        return raycaster.intersectObjects(shapes, false);
    }

    private initIntersectableObjects(shapeType: ShapeType) {
        let shapes = new Array<Object3D>();
        const addObject = (obj: Object3D | undefined) => {
            if (obj !== undefined) shapes.push(obj);
        };
        this.document.visual.context.shapes().forEach((x) => {
            if (!(x instanceof ThreeGeometry) || !x.visible) return;
            if (
                shapeType === ShapeType.Shape ||
                ShapeType.hasCompound(shapeType) ||
                ShapeType.hasCompoundSolid(shapeType) ||
                ShapeType.hasSolid(shapeType)
            ) {
                addObject(x.edges());
                addObject(x.faces());
                return;
            }
            if (ShapeType.hasEdge(shapeType) || ShapeType.hasWire(shapeType)) {
                addObject(x.edges());
            }
            if (ShapeType.hasFace(shapeType) || ShapeType.hasShell(shapeType)) {
                addObject(x.faces());
            }
            // TODO: vertex
        });
        return shapes;
    }

    private initRaycaster(mx: number, my: number) {
        let raycaster = new Raycaster();
        let scale = this.cameraController.target.distanceTo(this.camera.position) / 1000.0;
        let threshold = Constants.RaycasterThreshold * scale;
        let { x, y } = this.screenToCameraRect(mx, my);
        let mousePos = new Vector2(x, y);
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
