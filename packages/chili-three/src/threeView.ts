// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import CameraControls from "camera-controls";
import {
    CameraType,
    IDocument,
    INodeFilter,
    IShape,
    IShapeFilter,
    IView,
    IVisualObject,
    MultiShapeNode,
    Observable,
    Plane,
    PubSub,
    Ray,
    ShapeMeshGroup,
    ShapeNode,
    ShapeType,
    VisualNode,
    VisualShapeData,
    XY,
    XYZ,
    XYZLike,
    debounce,
} from "chili-core";
import {
    Box3,
    Clock,
    DirectionalLight,
    Intersection,
    Mesh,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Raycaster,
    Scene,
    Sphere,
    Spherical,
    Matrix4 as ThreeMatrix4,
    Quaternion as ThreeQuaternion,
    Vector2,
    Vector3,
    Vector4,
    WebGLRenderer,
} from "three";
import { SelectionBox } from "three/examples/jsm/interactive/SelectionBox";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2";
import { Constants } from "./constants";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeHelper } from "./threeHelper";
import { ThreeHighlighter } from "./threeHighlighter";
import { ThreeVisualContext } from "./threeVisualContext";
import { ThreeMeshObject, ThreeVisualObject } from "./threeVisualObject";
import { ViewGizmo } from "./viewGizmo";

CameraControls.install({
    THREE: {
        Vector2: Vector2,
        Vector3: Vector3,
        Vector4: Vector4,
        Quaternion: ThreeQuaternion,
        Matrix4: ThreeMatrix4,
        Spherical: Spherical,
        Box3: Box3,
        Sphere: Sphere,
        Raycaster: Raycaster,
    },
});

export class ThreeView extends Observable implements IView {
    private _dom?: HTMLElement;
    private _needsUpdate: boolean = false;
    private _controls?: CameraControls;
    private readonly _resizeObserver: ResizeObserver;
    private readonly _scene: Scene;
    private readonly _renderer: WebGLRenderer;
    private readonly _workplane: Plane;
    private readonly _gizmo: ViewGizmo;
    readonly dynamicLight = new DirectionalLight(0xffffff, 2);

    get name(): string {
        return this.getPrivateValue("name");
    }
    set name(value: string) {
        this.setProperty("name", value);
    }

    private _isClosed: boolean = false;
    get isClosed(): boolean {
        return this._isClosed;
    }

    get cameraType(): CameraType {
        return this.getPrivateValue("cameraType", CameraType.perspective);
    }
    set cameraType(value: CameraType) {
        if (this.setProperty("cameraType", value)) {
            this._camera = this.createCamera();
            if (this._controls) {
                let target = this.cameraTarget;
                let position = this.cameraPosition;
                this.initCameraControls();
                this._controls.setTarget(target.x, target.y, target.z);
                this._controls.setPosition(position.x, position.y, position.z);
            }
        }
    }

    private _camera?: OrthographicCamera | PerspectiveCamera;
    get camera() {
        if (!this._camera) {
            this._camera = this.createCamera();
        }
        return this._camera;
    }

    get cameraTarget(): XYZ {
        let position = new Vector3();
        this._controls?.getTarget(position);
        return ThreeHelper.toXYZ(position);
    }
    set cameraTarget(value: XYZLike) {
        if (this._controls) {
            this._controls.setTarget(value.x, value.y, value.z);
        }
    }

    get cameraPosition(): XYZ {
        let position = new Vector3();
        this._controls?.getPosition(position);
        return ThreeHelper.toXYZ(position);
    }
    set cameraPosition(value: XYZLike) {
        if (this._controls) {
            this._controls.setPosition(value.x, value.y, value.z);
        }
    }

    private readonly clock = new Clock();

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
        let resizerObserverCallback = debounce(this._resizerObserverCallback, 100);
        this._resizeObserver = new ResizeObserver(resizerObserverCallback);
        this._renderer = this.initRenderer();
        this._scene.add(this.dynamicLight);
        this._gizmo = new ViewGizmo(this);
        this.document.application.views.push(this);
        this.animate();
    }

    override dispose(): void {
        super.dispose();
        this._resizeObserver.disconnect();
    }

    private createCamera() {
        let camera: PerspectiveCamera | OrthographicCamera;
        let aspect = this.width! / this.height!;
        if (Number.isNaN(aspect)) {
            aspect = 1;
        }
        if (this.cameraType === CameraType.perspective) {
            camera = new PerspectiveCamera(45, aspect, 1, 1e6);
        } else {
            let length = this.cameraPosition.distanceTo(this.cameraTarget);
            let frustumHalfHeight = length * Math.tan((45 * Math.PI) / 180 / 2);
            camera = new OrthographicCamera(
                -frustumHalfHeight * aspect,
                frustumHalfHeight * aspect,
                frustumHalfHeight,
                -frustumHalfHeight,
                1,
                1e6,
            );
        }
        camera.position.set(1000, 1000, 1000);
        return camera;
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

        this.initCameraControls();
    }

    private initCameraControls() {
        if (this._controls) {
            this._controls.dispose();
        }
        this._controls = new CameraControls(this.camera, this.renderer.domElement);
        this._controls.draggingSmoothTime = 0.06;
        this._controls.smoothTime = 0.1;
        this._controls.dollyToCursor = true;
        this._controls.polarRotateSpeed = 0.8;
        this._controls.azimuthRotateSpeed = 0.8;
        this._controls.mouseButtons.left = CameraControls.ACTION.NONE;
        this._controls.mouseButtons.middle = CameraControls.ACTION.TRUCK;
        this._controls.mouseButtons.right = CameraControls.ACTION.NONE;
    }

    onKeyDown(e: KeyboardEvent) {
        if (e.shiftKey && this._controls) {
            this._controls.mouseButtons.middle = CameraControls.ACTION.ROTATE;

            let shapes = this.document.selection.getSelectedNodes().filter((x) => x instanceof VisualNode);
            let point = new Vector3();
            let box = new Box3();
            for (let shape of shapes) {
                let threeGeometry = this.content.getVisual(shape) as ThreeGeometry;
                box.union(new Box3().setFromObject(threeGeometry));
            }
            box.getCenter(point);
            this._controls?.setOrbitPoint(point.x, point.y, point.z);
        }
    }

    onKeyUp(e: KeyboardEvent) {
        if (!e.shiftKey && this._controls) {
            this._controls.mouseButtons.middle = CameraControls.ACTION.TRUCK;
            this._controls.setOrbitPoint(0, 0, 0);
        }
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

        if (!this._camera) {
            return;
        }

        let needsUpdate = this._controls?.update(this.clock.getDelta());
        if (!this._needsUpdate && !needsUpdate) return;

        let dir = this.cameraPosition.sub(this.cameraTarget);
        this.dynamicLight.position.copy(dir);
        this._renderer.render(this._scene, this._camera);
        this._gizmo?.update();

        this._needsUpdate = false;
    }

    resize(width: number, height: number) {
        if (height < 0.00001) {
            return;
        }
        this._renderer.setSize(width, height);
        this._camera = this.createCamera();
        if (this._controls) {
            this._controls.camera = this._camera;
        }
        if (this._camera instanceof PerspectiveCamera) {
            this._camera.aspect = width / height;
            this._camera.updateProjectionMatrix();
        } else if (this._camera instanceof OrthographicCamera) {
            this._camera.updateProjectionMatrix();
        }
        this.update();
    }

    async fitContent() {
        let box = new Box3();
        let shapes = this.document.selection.getSelectedNodes().filter((x) => x instanceof VisualNode);
        if (shapes.length === 0) {
            box.setFromObject(this.content.visualShapes);
        } else {
            for (let shape of shapes) {
                let threeGeometry = this.content.getVisual(shape) as ThreeVisualObject;
                box.union(new Box3().setFromObject(threeGeometry));
            }
        }
        let sphere = new Sphere();
        box.getBoundingSphere(sphere);
        if (sphere.radius < 1) {
            sphere.radius = 1;
        }
        await this._controls?.fitToSphere(sphere, true);
    }

    get width() {
        return this._dom?.clientWidth;
    }

    get height() {
        return this._dom?.clientHeight;
    }

    async rotate(dx: number, dy: number) {
        await this._controls?.rotate(dx, dy);
    }

    async zoomIn() {
        if (this.cameraType === CameraType.orthographic) {
            await this._controls?.zoom(this.camera.zoom * 0.3);
        } else {
            await this._controls?.dolly(this.cameraPosition.distanceTo(this.cameraTarget) * 0.2);
        }
    }

    async zoomOut() {
        if (this.cameraType === CameraType.orthographic) {
            await this._controls?.zoom(-this.camera.zoom * 0.3);
        } else {
            await this._controls?.dolly(this.cameraPosition.distanceTo(this.cameraTarget) * -0.2);
        }
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
        if (this._camera instanceof PerspectiveCamera) {
            direction = position.clone().sub(this._camera.position).normalize();
        } else if (this._camera instanceof OrthographicCamera) {
            this._camera.getWorldDirection(direction);
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
        if (!this._camera) {
            return XYZ.unitX;
        }
        this._camera.getWorldDirection(vec);
        return ThreeHelper.toXYZ(vec);
    }

    up(): XYZ {
        return ThreeHelper.toXYZ(this.camera.up);
    }

    private mouseToWorld(mx: number, my: number, z: number = 0.5) {
        let { x, y } = this.screenToCameraRect(mx, my);
        return new Vector3(x, y, z).unproject(this.camera);
    }

    detectVisual(x: number, y: number, nodeFilter?: INodeFilter): IVisualObject[] {
        let visual: IVisualObject[] = [];
        let detecteds = this.findIntersectedNodes(x, y);
        for (const detected of detecteds) {
            let threeObject = detected.object.parent as ThreeVisualObject;
            if (!threeObject) continue;

            let node = this.getNodeFromObject(threeObject);
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
        let visual = new Set<IVisualObject>();
        for (const obj of selectionBox.select()) {
            let threeObject = obj.parent as ThreeVisualObject;
            if (!threeObject?.visible) continue;

            let node = this.getNodeFromObject(threeObject);
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
    ) {
        const selectionBox = this.initSelectionBox(mx1, my1, mx2, my2);
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
        let shape = this.getParentShape(obj);
        if (shape === undefined || cache.has(shape)) return;

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

    private getParentShape(obj: Object3D): IShape | undefined {
        if (!obj.parent?.visible || !(obj.parent instanceof ThreeGeometry)) return undefined;

        return (obj.parent.geometryNode as ShapeNode).shape.unchecked();
    }

    detectShapes(
        shapeType: ShapeType,
        mx: number,
        my: number,
        shapeFilter?: IShapeFilter,
    ): VisualShapeData[] {
        let intersections = this.findIntersectedShapes(shapeType, mx, my);
        return ShapeType.isWhole(shapeType)
            ? this.detectThreeShapes(intersections, shapeFilter)
            : this.detectSubShapes(shapeType, intersections, shapeFilter);
    }

    private detectThreeShapes(intersections: Intersection[], shapeFilter?: IShapeFilter): VisualShapeData[] {
        for (const element of intersections) {
            const parent = element.object.parent;
            if (!(parent instanceof ThreeGeometry)) continue;

            let shape: IShape | undefined;
            if (parent.geometryNode instanceof ShapeNode) {
                shape = parent.geometryNode.shape.unchecked();
            } else if (parent.geometryNode instanceof MultiShapeNode) {
                shape = this.findShapeAndIndex(parent, element).shape;
            }
            if (!shape) continue;

            if (shapeFilter && !shapeFilter.allow(shape)) {
                continue;
            }

            return [
                {
                    owner: parent,
                    shape,
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
        if (parent.geometryNode instanceof MultiShapeNode) {
            return { shape, directShape: shape, indexes: [index!] };
        }
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
        let ancestor = directShape.findAncestor(type, (parent.geometryNode as ShapeNode).shape.value).at(0);
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
            groups = parent.geometryNode.mesh.edges?.groups;
            if (groups) {
                index = ThreeHelper.findGroupIndex(groups, element.faceIndex! * 2)!;
                shape = groups[index].shape;
            }
        } else {
            groups = parent.geometryNode.mesh.faces?.groups;
            if (groups) {
                index = ThreeHelper.findGroupIndex(groups, element.faceIndex! * 3)!;
                shape = groups[index].shape;
            }
        }
        return { shape, index, groups };
    }

    private findIntersectedNodes(mx: number, my: number) {
        let visuals: Object3D[] = [];
        const addObject = (obj: Object3D | undefined) => {
            if (obj !== undefined) visuals.push(obj);
        };
        this.document.visual.context.visuals().forEach((x) => {
            if (!x.visible) return;

            if (x instanceof ThreeGeometry) {
                addObject(x.edges());
                addObject(x.faces());
            }

            if (x instanceof ThreeMeshObject) {
                addObject(x.mesh);
            }
        });

        return this.initRaycaster(mx, my).intersectObjects(visuals, false);
    }

    private findIntersectedShapes(shapeType: ShapeType, mx: number, my: number) {
        let raycaster = this.initRaycaster(mx, my);
        let shapes = this.initIntersectableShapes(shapeType);
        return raycaster.intersectObjects(shapes, false);
    }

    private initIntersectableShapes(shapeType: ShapeType) {
        let shapes = new Array<Object3D>();
        const addObject = (obj: Object3D | undefined) => {
            if (obj !== undefined) shapes.push(obj);
        };
        this.document.visual.context.visuals().forEach((x) => {
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
        let threshold = Constants.RaycasterThreshold;
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
