// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CursorType, IDisposable, IDocument, IView, Observable, Plane, Ray, XY, XYZ } from "chili-core";
import { Flyout } from "chili-ui";
import {
    Camera,
    OrthographicCamera,
    PerspectiveCamera,
    Scene,
    Spherical,
    Vector3,
    WebGLRenderer,
} from "three";

import { ThreeUtils } from "./threeUtils";

export default class ThreeView extends Observable implements IView, IDisposable {
    private _name: string;
    private _scene: Scene;
    private _renderer: WebGLRenderer;
    private _workplane: Plane;
    private _camera: Camera;
    private _lastRedrawTime: number;
    private _floatTip: Flyout;
    private _target: Vector3;
    private _scale: number = 1;
    private _startRotate?: XY;

    panSpeed: number = 0.3;
    zoomSpeed: number = 1.3;
    rotateSpeed: number = 1.0;

    constructor(
        readonly document: IDocument,
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
        this._floatTip = new Flyout();
        document.viewer.addView(this);

        container.appendChild(this._floatTip);
        container.addEventListener("mousemove", this.onMouseMove);
    }

    private initCamera(container: HTMLElement) {
        let camera = new PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.001, 4000);
        //let camera = new OrthographicCamera(-this._container.offsetWidth / 2, this._container.offsetWidth / 2, this._container.offsetHeight / 2, -this._container.offsetHeight / 2, 0.01, 3000)
        camera.up.set(0, 0, 1);
        camera.position.set(1000, 1000, 1000);
        camera.lookAt(this._target);
        return camera;
    }

    private initRender(container: HTMLElement) {
        let renderer = new WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(container.clientWidth, container.clientHeight);
        container.append(renderer.domElement);
        renderer.autoClear = false;
        return renderer;
    }

    private onMouseMove = (e: MouseEvent) => {
        this._floatTip.style.top = e.clientY + "px";
        this._floatTip.style.left = e.clientX + "px";
    };

    pan(dx: number, dy: number) {
        let { x, y } = this.convert(dx, dy);
        this.translate(x, y);
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
        if (ThreeUtils.isPerspectiveCamera(this._camera)) {
            let distance = this._camera.position.distanceTo(this._target);
            // half of the fov is center to top of screen
            distance *= this.fovTan(this._camera.fov);
            x = (2 * dx * distance) / this.container.clientHeight;
            y = (2 * dy * distance) / this.container.clientHeight;
        } else if (ThreeUtils.isOrthographicCamera(this._camera)) {
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
        if (ThreeUtils.isOrthographicCamera(this._camera)) {
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
        } else if (ThreeUtils.isPerspectiveCamera(this._camera)) {
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

    update() {
        let now = this.getTime();
        if (now - this._lastRedrawTime < 50) return;
        this._lastRedrawTime = now;
        this._renderer.render(this._scene, this._camera);
    }

    redraw() {
        this._renderer.render(this._scene, this._camera);
    }

    get float(): Flyout {
        return this._floatTip;
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
        this.update();
    }

    get name(): string {
        return this._name;
    }

    set name(name: string) {
        this._name = name;
    }

    get width(): number {
        return this.container.offsetWidth;
    }

    get heigth(): number {
        return this.container.offsetHeight;
    }

    screenToCameraRect(x: number, y: number): XY {
        return new XY((x / this.width) * 2 - 1, -(y / this.heigth) * 2 + 1);
    }

    rayAt(mx: number, my: number): Ray {
        let location = this.screenToWorld(mx, my);
        let direction: XYZ;
        if (this._camera instanceof OrthographicCamera) {
            direction = this.direction();
        } else {
            direction = location.sub(ThreeUtils.toXYZ(this._camera.position)).normalize()!;
        }
        return new Ray(location, direction);
    }

    screenToWorld(mx: number, my: number): XYZ {
        let vec = this.mouseToWorld(mx, my);
        return ThreeUtils.toXYZ(vec);
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
        return ThreeUtils.toXYZ(vec);
    }

    up(): XYZ {
        return ThreeUtils.toXYZ(this._camera.up);
    }

    private mouseToWorld(mx: number, my: number) {
        let { x, y } = this.screenToCameraRect(mx, my);
        var vec = new Vector3(x, y, 0).unproject(this._camera);
        return vec;
    }

    private getTime() {
        return new Date().getTime();
    }
}
