// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { IDisposable } from "../foundation";

export enum GeometryType {
    Curve,
    Surface,
}

export interface IGeometry extends IDisposable {
    get geometryType(): GeometryType;
    copy(): IGeometry;
}
