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
    LineSegments,
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
import { CameraController } from "./cameraController";
import { Constants } from "./constants";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeHelper } from "./threeHelper";
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
        readonly content: ThreeVisualContext,
    ) {
        super();
        this._name = name;
        this._scene = content.scene;
        this._workplane = workplane;
        this._renderer = this.initRender();
        let resizerObserverCallback = debounce(this._resizerObserverCallback, 100);
        this._resizeObserver = new ResizeObserver(resizerObserverCallback);
        this.cameraController = new CameraController(this);
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

    protected initRender(): WebGLRenderer {
        let renderer = new WebGLRenderer({
            antialias: true,
            alpha: true,
            logarithmicDepthBuffer: true,
        });
        renderer.setPixelRatio(window.devicePixelRatio);
        return renderer;
    }

    setDom(element: HTMLElement) {
        if (this._dom) {
            this._resizeObserver.unobserve(this._dom);
        }
        this._dom = element;
        this._gizmo.remove();
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
        const oldAutoClear = this._renderer.autoClear;
        try {
            this._renderer.clearDepth();
            this._renderer.autoClear = false;
            this._renderer.render(this._scene, this.camera);
            this.dynamicLight.position.copy(this.camera.position);
            this._gizmo.update();
        } finally {
            this._renderer.autoClear = oldAutoClear;
            this._needsUpdate = false;
        }
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
        let containsCache = new Map<string, boolean>();
        for (const shape of selectionBox.select()) {
            this.addDetectedShape(detecteds, containsCache, shapeType, shape, shapeFilter);
        }
        return detecteds;
    }

    private addDetectedShape(
        detecteds: VisualShapeData[],
        cache: Map<string, boolean>,
        shapeType: ShapeType,
        shape: Mesh | LineSegments,
        shapeFilter?: IShapeFilter,
    ) {
        if (!(shape.parent instanceof ThreeGeometry) || !shape.parent.visible) return;

        if (shape instanceof LineSegments) {
            if (shapeFilter && !shapeFilter.allow(shape.parent.geometryEngity.shape.value!)) return;
            detecteds.push({
                shape: shape.parent.geometryEngity.shape.value!,
                owner: shape.parent,
                indexes: [],
            });
        }
    }

    detected(shapeType: ShapeType, mx: number, my: number, shapeFilter?: IShapeFilter): VisualShapeData[] {
        let intersections = this.findIntersections(shapeType, mx, my);
        return shapeType === ShapeType.Shape
            ? this.detectThreeShapes(intersections, shapeFilter)
            : this.detectSubShapes(shapeType, intersections, shapeFilter);
    }

    private detectThreeShapes(intersections: Intersection<Object3D>[], shapeFilter?: IShapeFilter) {
        let result: VisualShapeData[] = [];
        for (const element of intersections) {
            const parent = element.object.parent;
            if (
                !(parent instanceof ThreeGeometry) ||
                (shapeFilter && !shapeFilter.allow(parent.geometryEngity.shape.value!))
            ) {
                continue;
            }
            result.push({
                owner: parent,
                shape: parent.geometryEngity.shape.value!,
                point: ThreeHelper.toXYZ(element.point),
                indexes: [],
            });
        }
        return result;
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
                point: ThreeHelper.toXYZ(intersected.point),
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
        if (ShapeType.hasWire(shapeType)) {
            let wire = this.getWireAndIndexes(shape, groups!, parent);
            if (wire.shape) return wire;
        }
        // TODO: other type

        return { shape, directShape: shape, indexes: [index!] };
    }

    private getWireAndIndexes(shape: IShape, groups: ShapeMeshGroup[], parent: ThreeGeometry) {
        let wire = shape.findAncestor(ShapeType.Wire, parent.geometryEngity.shape.value!).at(0);
        if (!wire) return { shape: undefined, indexes: [] };

        let indexes: number[] = [];
        for (const edge of wire.findSubShapes(ShapeType.Edge)) {
            this.findIndex(groups, edge, indexes);
        }
        return { shape: wire, indexes, directShape: shape };
    }

    private findIndex(groups: ShapeMeshGroup[], edge: IShape, indexes: number[]) {
        for (let i = 0; i < groups.length; i++) {
            if (edge.isEqual(groups[i].shape)) {
                indexes.push(i);
            }
        }
    }

    private findShapeAndIndex(parent: ThreeGeometry, element: Intersection) {
        let shape: IShape | undefined = undefined;
        let index: number | undefined = undefined;
        let groups: ShapeMeshGroup[] | undefined = undefined;
        if (element.index !== undefined) {
            groups = parent.geometryEngity.shape.value?.mesh.edges?.groups;
            if (groups) {
                index = ThreeHelper.findGroupIndex(groups, element.index)!;
                shape = groups[index].shape;
            }
        } else if (element.faceIndex !== undefined) {
            groups = parent.geometryEngity.shape.value?.mesh.faces?.groups;
            if (groups) {
                index = ThreeHelper.findGroupIndex(groups, element.faceIndex * 3)!;
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
        raycaster.params = { ...raycaster.params, Line: { threshold }, Points: { threshold } };
        return raycaster;
    }
}
