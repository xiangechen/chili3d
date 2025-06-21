// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDisposable, IPropertyChanged } from "../foundation";
import { XYZ, XYZLike } from "../math";

export type CameraType = "perspective" | "orthographic";

export interface ICameraController extends IPropertyChanged, IDisposable {
    readonly cameraPosition: XYZ;
    readonly cameraTarget: XYZ;
    readonly cameraUp: XYZ;

    cameraType: CameraType;
    fitContent(): void;
    lookAt(eye: XYZLike, target: XYZLike, up: XYZLike): void;
    pan(dx: number, dy: number): void;
    startRotate(x: number, y: number): void;
    rotate(dx: number, dy: number): void;
    zoom(x: number, y: number, delta: number): void;
    updateCameraPosionTarget(): void;
}
