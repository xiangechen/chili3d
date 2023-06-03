// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    CursorType,
    DetectedData,
    IDisposable,
    IDocument,
    ISelection,
    IShape,
    IView,
    IViewer,
    IVisual,
    IVisualShape,
    MeshGroup,
    Observable,
    Plane,
    Ray,
    ShapeType,
    XY,
    XYZ,
} from "chili-core";
import {
    Camera,
    Intersection,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Raycaster,
    Renderer,
    Scene,
    Spherical,
    Vector3,
    WebGLRenderer,
} from "three";
import { SelectionBox } from "three/examples/jsm/interactive/SelectionBox";
import { SelectionHelper } from "three/examples/jsm/interactive/SelectionHelper";

import { ThreeHelper } from "./threeHelper";
import { ThreeShape } from "./threeShape";
import { ThreeVisual } from "./threeVisual";
import { Constants } from "./constants";

export class ThreeView extends Observable implements IView, IDisposable {
    private _name: string;
    private _scene: Scene;
    private _renderer: Renderer;
    private _workplane: Plane;
    private _camera: Camera;
    private _lastRedrawTime: number;
    private _target: Vector3;
    private _scale: number = 1;
    private _startRotate?: XY;
    private _needRedraw: boolean = false;

    panSpeed: number = 0.3;
    zoomSpeed: number = 1.3;
    rotateSpeed: number = 1.0;

    constructor(
        readonly viewer: IViewer,
        name: string,
        workplane: Plane,
        readonly container: HTMLElement,
        scene: Scene
    ) {
        super();
        this._name = name;
        this._scene = scene;
        this._target = new Vector3();
        this._workplane = workplane;
        this._camera = this.initCamera(container);
        this._lastRedrawTime = this.getTime();
        this._renderer = this.initRender(container);
        this.animate();
    }

    get renderer(): Renderer {
        return this._renderer;
    }

    private initCamera(container: HTMLElement) {
        //let camera = new PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.001, 4000);
        let camera = new OrthographicCamera(
            -this.container.clientWidth / 2,
            this.container.clientWidth / 2,
            this.container.clientHeight / 2,
            -this.container.clientHeight / 2,
            0.01,
            3000
        );
        camera.position.set(1000, 1000, 1000);
        camera.lookAt(this._target);
        camera.updateMatrixWorld(true);
        return camera;
    }

    protected initRender(container: HTMLElement): Renderer {
        let renderer = new WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(container.clientWidth, container.clientHeight);
        container.append(renderer.domElement);
        renderer.autoClear = false;
        return renderer;
    }

    lookAt(eye: XYZ, target: XYZ): void {
        this._target.set(target.x, target.y, target.z);
        this._camera.position.set(eye.x, eye.y, eye.z);
        this._camera.lookAt(this._target);
        this._camera.updateMatrixWorld(true);
        this.redraw();
    }

    pan(dx: number, dy: number) {
        let { x, y } = this.convert(dx, dy);
        this.translate(x, y);
    }

    get eye(): XYZ {
        return new XYZ(this._camera.position.x, this._camera.position.y, this._camera.position.z);
    }

    set eye(value: XYZ) {
        this._camera.position.set(value.x, value.y, value.z);
        this.redraw();
    }

    private translate(dvx: number, dvy: number) {
        let vx = new Vector3().setFromMatrixColumn(this.camera.matrix, 0).multiplyScalar(dvx);
        let vy = new Vector3().setFromMatrixColumn(this.camera.matrix, 1).multiplyScalar(dvy);
        let vector = new Vector3().add(vx).add(vy);
        this._target.add(vector);
        this.camera.position.add(vector);
        this.camera.lookAt(this._target);
    }

    private convert(dx: number, dy: number) {
        let x = 0,
            y = 0;
        if (ThreeHelper.isPerspectiveCamera(this._camera)) {
            let distance = this._camera.position.distanceTo(this._target);
            // half of the fov is center to top of screen
            distance *= this.fovTan(this._camera.fov);
            x = (2 * dx * distance) / this.container.clientHeight;
            y = (2 * dy * distance) / this.container.clientHeight;
        } else if (ThreeHelper.isOrthographicCamera(this._camera)) {
            x =
                (dx * (this._camera.right - this._camera.left)) /
                this._camera.zoom /
                this.container.clientWidth;
            y =
                (dy * (this._camera.top - this._camera.bottom)) /
                this._camera.zoom /
                this.container.clientHeight;
        }
        return { x, y };
    }

    rotation(dx: number, dy: number): void {
        console.log("rotate");

        let spherical = new Spherical().setFromVector3(this._camera.position.sub(this._target));
        console.log(spherical);
        spherical.phi -= (dx * Math.PI) / this.container.clientHeight;
        spherical.theta -= (dy * Math.PI) / this.container.clientHeight;

        let vector = new Vector3().setFromSpherical(spherical);
        this._camera.position.copy(this._target.clone().add(vector));
        this._camera.lookAt(this._target);
        this._camera.updateMatrixWorld(true);
    }

    startRotation(dx: number, dy: number): void {}

    get scale(): number {
        return this._scale;
    }

    private fovTan(fov: number) {
        return Math.tan((fov * 0.5 * Math.PI) / 180.0);
    }

    zoom(mx: number, my: number, delta: number): void {
        let scale = delta > 0 ? 0.9 : 1 / 0.9;
        this._scale *= scale;
        let point = this.mouseToWorld(mx, my);
        if (ThreeHelper.isOrthographicCamera(this._camera)) {
            this._camera.zoom /= scale;
            let vec = point.clone().sub(this._target);
            let xvec = new Vector3().setFromMatrixColumn(this._camera.matrix, 0);
            let yvec = new Vector3().setFromMatrixColumn(this._camera.matrix, 1);
            let x = vec.clone().dot(xvec);
            let y = vec.clone().dot(yvec);
            let aDxv = x / scale;
            let aDyv = y / scale;
            this.translate(aDxv - x, aDyv - y);
            this._camera.updateProjectionMatrix();
        } else if (ThreeHelper.isPerspectiveCamera(this._camera)) {
            let direction = this._camera.position.clone().sub(this._target);
            let vector = this._camera.position.clone().sub(point).normalize();
            let angle = vector.angleTo(direction);
            let length = direction.length() * (scale - 1);
            let moveVector = vector.clone().multiplyScalar(length / Math.cos(angle));
            this._camera.position.add(moveVector);
            this._target.add(moveVector.sub(direction.clone().setLength(length)));
            this._camera.lookAt(this._target);
        }
    }

    get workplane(): Plane {
        return this._workplane;
    }

    set workplane(value: Plane) {
        this.setProperty("workplane", value);
    }

    setCursor(cursorType: CursorType): void {
        if (cursorType === CursorType.Default) {
            let classes = new Array<string>();
            this.container.classList.forEach((x) => {
                if (x.includes("Cursor")) {
                    classes.push(x);
                }
            });
            this.container.classList.remove(...classes);
        }
        if (CursorType.Drawing === cursorType) this.container.classList.add("drawingCursor");
    }

    private animate() {
        requestAnimationFrame(() => {
            this.animate();
        });
        if (this._needRedraw) {
            this._renderer.render(this._scene, this._camera);
            this._needRedraw = false;
        }
    }

    redraw() {
        this._needRedraw = true;
    }

    get camera(): Camera {
        return this._camera;
    }

    set camera(camera: Camera) {
        this._camera = camera;
    }

    resize(width: number, heigth: number) {
        if (this._camera instanceof PerspectiveCamera) {
            this._camera.aspect = width / heigth;
            this._camera.updateProjectionMatrix();
        } else if (this._camera instanceof OrthographicCamera) {
            this._camera.updateProjectionMatrix();
        }
        this._renderer.setSize(width, heigth);
        this.redraw();
    }

    get name(): string {
        return this._name;
    }

    set name(name: string) {
        this._name = name;
    }

    get width(): number {
        return this.container.clientWidth;
    }

    get heigth(): number {
        return this.container.clientHeight;
    }

    screenToCameraRect(x: number, y: number): XY {
        return new XY((x / this.width) * 2 - 1, -(y / this.heigth) * 2 + 1);
    }

    rayAt(mx: number, my: number): Ray {
        let position = this.mouseToWorld(mx, my);
        let vec = new Vector3();
        if (this._camera instanceof PerspectiveCamera) {
            vec = position.clone().sub(this._camera.position).normalize();
        } else if (this._camera instanceof OrthographicCamera) {
            this._camera.getWorldDirection(vec);
        }
        let offset = position.clone().sub(this._camera.position).dot(vec);
        position = position.clone().sub(vec.clone().multiplyScalar(offset));
        return new Ray(ThreeHelper.toXYZ(position), ThreeHelper.toXYZ(vec));
    }

    screenToWorld(mx: number, my: number): XYZ {
        let vec = this.mouseToWorld(mx, my);
        return ThreeHelper.toXYZ(vec);
    }

    worldToScreen(point: XYZ): XY {
        let cx = this.width / 2;
        let cy = this.heigth / 2;
        let vec = new Vector3(point.x, point.y, point.z).project(this._camera);
        return new XY(Math.round(cx * vec.x + cx), Math.round(-cy * vec.y + cy));
    }

    direction(): XYZ {
        var vec = new Vector3();
        this._camera.getWorldDirection(vec);
        return ThreeHelper.toXYZ(vec);
    }

    up(): XYZ {
        return ThreeHelper.toXYZ(this._camera.up);
    }

    private mouseToWorld(mx: number, my: number) {
        let { x, y } = this.screenToCameraRect(mx, my);
        var vec = new Vector3(x, y, 0).unproject(this._camera);
        return vec;
    }

    private getTime() {
        return new Date().getTime();
    }

    rectDetected(mx1: number, mx2: number, my1: number, my2: number) {
        const selectionBox = new SelectionBox(this._camera, this._scene);
        const start = this.screenToCameraRect(mx1, my1);
        const end = this.screenToCameraRect(mx2, my2);
        selectionBox.startPoint.set(start.x, start.y, 0.5);
        selectionBox.endPoint.set(end.x, end.y, 0.5);
        let shapes = selectionBox.select();
        return shapes;
    }

    detected(shapeType: ShapeType, mx: number, my: number, firstHitOnly: boolean): DetectedData[] {
        let intersections = this.findIntersections(shapeType, mx, my, firstHitOnly);
        return shapeType === ShapeType.Shape
            ? this.detectThreeShapes(intersections)
            : this.detectSubShapes(shapeType, intersections);
    }

    private detectThreeShapes(intersections: Intersection<Object3D>[]) {
        let result: DetectedData[] = [];
        for (let i = 0; i < intersections.length; i++) {
            const parent = intersections[i].object.parent;
            if (parent instanceof ThreeShape) {
                result.push({
                    owner: parent,
                    shape: parent.shape,
                });
            }
        }
        return result;
    }

    private detectSubShapes(shapeType: ShapeType, intersections: Intersection<Object3D>[]) {
        let result: DetectedData[] = [];
        for (let i = 0; i < intersections.length; i++) {
            let item = intersections[i];
            const parent = intersections[i].object.parent;
            if (!(parent instanceof ThreeShape)) continue;
            let index = this.getIndex(shapeType, item);
            if (index == undefined) continue;
            let groups: MeshGroup[] = item.object.userData[Constants.GeometryGroupsKey];
            let groupIndex = ThreeHelper.findGroupIndex(groups, index);
            result.push({
                owner: parent,
                shape: groupIndex ? groups.at(groupIndex)?.shape : undefined,
                index: groupIndex,
            });
        }
        return result;
    }

    private getIndex(shapeType: ShapeType, item: Intersection<Object3D>) {
        if (shapeType === ShapeType.Face) {
            return item.faceIndex ? item.faceIndex * 3 : undefined;
        } else {
            return item.index;
        }
    }

    private findIntersections(shapeType: ShapeType, mx: number, my: number, firstHitOnly: boolean) {
        let raycaster = this.initRaycaster(mx, my, firstHitOnly);
        let shapes = this.initIntersectableObjects(shapeType);
        return raycaster.intersectObjects(shapes, false);
    }

    private initIntersectableObjects(shapeType: ShapeType) {
        let shapes = new Array<Object3D>();
        const addObject = (obj: Object3D | undefined) => {
            if (obj !== undefined) shapes.push(obj);
        };
        this.viewer.visual.context.shapes().forEach((x) => {
            if (!(x instanceof ThreeShape)) return;
            if (shapeType === ShapeType.Face || shapeType === ShapeType.Shape) {
                addObject(x.faces());
            }
            if (shapeType !== ShapeType.Face) {
                addObject(x.edges());
            }
        });
        return shapes;
    }

    private initRaycaster(mx: number, my: number, firstHitOnly: boolean) {
        let threshold = Constants.RaycasterThreshold * this.scale;
        let raycaster = new Raycaster();
        raycaster.params = { Line: { threshold }, Points: { threshold } };
        let ray = this.rayAt(mx, my);
        raycaster.set(ThreeHelper.fromXYZ(ray.location), ThreeHelper.fromXYZ(ray.direction));
        raycaster.firstHitOnly = firstHitOnly;
        return raycaster;
    }
}
