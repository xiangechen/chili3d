// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { I18nKeys } from "../i18n";
import type { Plane, XYZ } from "../math";
import type { VisualNode } from "../model";
import type { IShapeFilter } from "../selectionFilter";
import type { ShapeMeshData } from "../shape";
import type { IView, VisualShapeData } from "../visual";

export interface SnapData {
    preview?: (point: XYZ | undefined) => ShapeMeshData[];
    prompt?: (point: SnapResult) => string;
    filter?: IShapeFilter;
    validator?: (point: XYZ) => boolean;
    featurePoints?: {
        point: XYZ;
        prompt: string;
        when?: () => boolean;
    }[];
    beforeExecute?: () => void;
    afterExecute?: () => void;
    onKeyDown?: (key: KeyboardEvent, update: () => void) => void;
}

export type SnapType =
    | "node"
    | "shape"
    | "vertex"
    | "center"
    | "end"
    | "perpendicular"
    | "intersection"
    | "nearCurve"
    | "trace"
    | "traceIntersect"
    | "onSurface"
    | "middle"
    | "axis"
    | "feature"
    | "input"
    | "angle";

export interface SnapResult {
    view: IView;
    type: SnapType;
    point?: XYZ;
    info?: string;
    distance?: number;
    refPoint?: XYZ;
    shapes: VisualShapeData[];
    nodes?: VisualNode[];
    plane?: Plane;
}

export interface MouseAndDetected {
    view: IView;
    mx: number;
    my: number;
    shapes: VisualShapeData[];
}

export interface ISnap {
    snap(data: MouseAndDetected): SnapResult | undefined;
    readonly handleSnaped?: (document: IDocument, snaped?: SnapResult) => void;
    removeDynamicObject(): void;
    clear(): void;
}
