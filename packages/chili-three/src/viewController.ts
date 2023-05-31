import * as THREE from "three";

export class CustomOrbitControls {
    private _camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    private _target: THREE.Vector3;
    private _enableDamping: boolean;
    private _dampingFactor: number;
    private _rotateSpeed: number;
    private _zoomSpeed: number;
    private _panSpeed: number;
    private _minDistance: number;
    private _maxDistance: number;
    private _minPolarAngle: number;
    private _maxPolarAngle: number;
    private _lastPosition: THREE.Vector3;
    private _lastQuaternion: THREE.Quaternion;
    private _target0: THREE.Vector3;
    private _position0: THREE.Vector3;
    private _zoom0: number;
    constructor(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, target: THREE.Vector3) {
        this._camera = camera;
        this._target = target;
        this._enableDamping = false;
        this._dampingFactor = 0.05;
        this._rotateSpeed = 1.0;
        this._zoomSpeed = 1.2;
        this._panSpeed = 0.3;
        this._minDistance = 0;
        this._maxDistance = Infinity;
        this._minPolarAngle = 0;
        this._maxPolarAngle = Math.PI;
        this._lastPosition = new THREE.Vector3();
        this._lastQuaternion = new THREE.Quaternion();
        this._target0 = this._target.clone();
        this._position0 = this._camera.position.clone();
        this._zoom0 = this._camera.zoom;
    }

    public rotate(deltaTheta: number, deltaPhi: number) {
        const offset = this._sphericalOffset;
        const spherical = this._spherical;

        spherical.theta += deltaTheta;
        spherical.phi = Math.max(
            this._minPolarAngle,
            Math.min(this._maxPolarAngle, spherical.phi + deltaPhi)
        );
        spherical.makeSafe();

        offset.setFromSpherical(spherical);
        offset.applyQuaternion(this._rotation);
        offset.multiplyScalar(this._distance);
        this._target.add(offset);
        this._camera.position.copy(this._target).add(this._offset);
        this._camera.lookAt(this._target);
    }

    public rotateLeft(angle: number) {
        const theta = angle * this._rotateSpeed;
        this._target.sub(this._camera.position);
        this._target.applyAxisAngle(new THREE.Vector3(0, 1, 0), theta);
        this._camera.position.sub(this._target);
        this._camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), theta);
        this._target.add(this._camera.position);
        this.update();
    }
    public rotateUp(angle: number) {
        const theta = angle * this._rotateSpeed;
        const axis = new THREE.Vector3()
            .crossVectors(this._camera.up, this._camera.position.clone().sub(this._target))
            .normalize();
        const polar = new THREE.Spherical().setFromVector3(this._camera.position.clone().sub(this._target));
        polar.theta += theta;
        polar.theta = Math.max(this._minPolarAngle, Math.min(this._maxPolarAngle, polar.theta));
        const radius = polar.radius * Math.cos(polar.phi);
        this._camera.position.setFromSphericalCoords(radius, polar.phi, polar.theta).add(this._target);
        this._camera.up.copy(axis).cross(this._camera.position.clone().sub(this._target)).normalize();
        this.update();
    }
    public zoomIn(zoomScale: number) {
        this.zoom(zoomScale);
    }
    public zoomOut(zoomScale: number) {
        this.zoom(1 / zoomScale);
    }
    private zoom(zoomScale: number) {
        if (this._camera instanceof THREE.PerspectiveCamera) {
            this._camera.fov /= zoomScale;
        } else if (this._camera instanceof THREE.OrthographicCamera) {
            this._camera.zoom = Math.max(
                this._minDistance,
                Math.min(this._maxDistance, this._camera.zoom * zoomScale)
            );
            this._camera.updateProjectionMatrix();
        } else {
            console.warn("CustomOrbitControls.js encountered an unknown camera type - zoom disabled.");
        }
        this.update();
    }
    public pan(deltaX: number, deltaY: number) {
        const offset = new THREE.Vector3();
        let targetDistance = this._camera.position.distanceTo(this._target);
        targetDistance *= Math.tan((((this._camera as THREE.PerspectiveCamera).fov / 2) * Math.PI) / 180.0);
        const moveX = deltaX * targetDistance * this._panSpeed;
        const moveY = deltaY * targetDistance * this._panSpeed;
        offset.copy(this._camera.position).sub(this._target);
        const axis = new THREE.Vector3().crossVectors(this._camera.up, offset).normalize();
        axis.multiplyScalar(moveX);
        const pan = new THREE.Vector3();
        if (this._camera instanceof THREE.PerspectiveCamera) {
            const v = offset.clone().crossVectors(this._camera.up, axis);
            pan.addVectors(v, v).multiplyScalar(moveY);
        } else if (this._camera instanceof THREE.OrthographicCamera) {
            axis.multiplyScalar((this._camera.top - this._camera.bottom) / (this._camera.zoom * 2));
            pan.addVectors(axis, new THREE.Vector3().crossVectors(this._camera.up, axis).setLength(moveY));
        } else {
            console.warn("CustomOrbitControls.js encountered an unknown camera type - pan disabled.");
        }
        this._camera.position.add(pan);
        this._target.add(pan);
        this.update();
    }
    public update() {
        const offset = new THREE.Vector3().copy(this._camera.position).sub(this._target);
        if (this._enableDamping) {
            this.damping();
        }
        if (this._camera instanceof THREE.OrthographicCamera) {
            this._camera.zoom = THREE.MathUtils.clamp(
                this._camera.zoom,
                this._minDistance,
                this._maxDistance
            );
            const zoomScale = this._zoom0 / this._camera.zoom;
            this._camera.left = this._zoom0 / zoomScale;
            this._camera.right = this._zoom0 / zoomScale;
            this._camera.top = this._zoom0 / zoomScale;
            this._camera.bottom = -this._zoom0 / zoomScale;
            this._camera.updateProjectionMatrix();
        }
        offset.applyQuaternion(this._lastQuaternion);
        this._camera.position.copy(this._target).add(offset);
        this._camera.lookAt(this._target);
        this._lastPosition.copy(this._camera.position);
    }
    public reset() {
        this._camera.position.copy(this._position0);
        this._camera.zoom = this._zoom0;
        this._target.copy(this._target0);
        this._camera.updateProjectionMatrix();
        this.update();
    }
    public damping() {
        const angularVelocity = new THREE.Quaternion().setFromUnitVectors(
            this._lastPosition.clone().normalize(),
            this._camera.position.clone().normalize()
        );
        this._lastQuaternion.multiplyQuaternions(angularVelocity, this._lastQuaternion);
        this._camera.position.lerp(this._lastPosition, 1 - this._dampingFactor);
    }
    get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
        return this._camera;
    }
    set camera(value: THREE.PerspectiveCamera | THREE.OrthographicCamera) {
        this._camera = value;
        this.reset();
    }
    get target(): THREE.Vector3 {
        return this._target;
    }
    set target(value: THREE.Vector3) {
        this._target.copy(value);
        this.reset();
    }
    get enableDamping(): boolean {
        return this._enableDamping;
    }
    set enableDamping(value: boolean) {
        this._enableDamping = value;
    }
    get dampingFactor(): number {
        return this._dampingFactor;
    }
    set dampingFactor(value: number) {
        this._dampingFactor = value;
    }
    get rotateSpeed(): number {
        return this._rotateSpeed;
    }
    set rotateSpeed(value: number) {
        this._rotateSpeed = value;
    }
    get zoomSpeed(): number {
        return this._zoomSpeed;
    }
    set zoomSpeed(value: number) {
        this._zoomSpeed = value;
    }
    get panSpeed(): number {
        return this._panSpeed;
    }
    set panSpeed(value: number) {
        this._panSpeed = value;
    }
    get minDistance(): number {
        return this._minDistance;
    }
    set minDistance(value: number) {
        this._minDistance = value;
    }
}
