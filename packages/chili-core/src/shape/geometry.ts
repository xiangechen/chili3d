// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDisposable } from "../foundation";
import { Matrix4 } from "../math";

export enum GeometryType {
    Curve,
    Surface,
}

export interface IGeometry extends IDisposable {
    get geometryType(): GeometryType;
    transform(matrix: Matrix4): void;
    transformed(matrix: Matrix4): IGeometry;
    copy(): IGeometry;
}
