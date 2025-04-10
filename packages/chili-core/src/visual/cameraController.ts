// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { IDisposable, IPropertyChanged } from "../foundation";
import { XYZ, XYZLike } from "../math";

export type CameraType = "perspective" | "orthographic";

export interface ICameraController extends IPropertyChanged, IDisposable {
    readonly cameraPosition: XYZ;
    cameraType: CameraType;
    fitContent(): void;
    lookAt(eye: XYZLike, target: XYZLike, up: XYZLike): void;
    pan(dx: number, dy: number): void;
    startRotate(x: number, y: number): void;
    rotate(dx: number, dy: number): void;
    zoom(x: number, y: number, delta: number): void;
    updateCameraPosionTarget(): void;
}
