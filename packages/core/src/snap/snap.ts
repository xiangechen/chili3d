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
    /**
     * Handed the function that draws the preview again, for a caller whose own state decides
     * what the preview is made of — the parameters of the command that wrote `preview`.
     *
     * A preview is otherwise drawn on pointer movement alone, which leaves an edit to what it
     * is made of showing nothing until the pointer happens to move: a line of text, a height.
     * What the caller does with the function is its own business — wire it to an observable,
     * to one property of its own, to a keystroke — which is why it is handed out rather than
     * the caller named: only the caller knows what the preview is made of.
     *
     * Let go of what was handed here from `afterExecute`, which runs once the step's handler
     * is done with — `ExtrudeDragStepData.onReady` is the same hook for a step of its own,
     * without a lifecycle of its own to hang the other half on.
     */
    onPreviewReady?: (redraw: () => void) => void;
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
    onKeyDown?: (key: KeyboardEvent) => void;
}

export type SnapType =
    | "node"
    | "shape"
    | "vertex"
    | "center"
    | "end"
    | "perpendicular"
    | "intersection"
    | "tangent"
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
