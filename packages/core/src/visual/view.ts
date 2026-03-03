// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import type { IDisposable, IPropertyChanged } from "../foundation";
import type { I18nKeys } from "../i18n";
import type { Plane, Ray, XY, XYLike, XYZ, XYZLike } from "../math";
import type { INodeFilter, IShapeFilter } from "../selectionFilter";
import type { ShapeType } from "../shape";
import type { ICameraController } from "./cameraController";
import type { VisualShapeData } from "./detectedData";
import type { IVisualObject } from "./visualObject";

export const ViewModes = ["solid", "wireframe", "solidAndWireframe"] as const;

export type ViewMode = (typeof ViewModes)[number];

export const ViewModeI18nKeys = {
    [ViewModes[0]]: "viewport.mode.solid",
    [ViewModes[1]]: "viewport.mode.wireframe",
    [ViewModes[2]]: "viewport.mode.solidAndWireframe",
} satisfies Record<
    ViewMode,
    Extract<I18nKeys, "viewport.mode.solid" | "viewport.mode.wireframe" | "viewport.mode.solidAndWireframe">
>;

export type HtmlTextOptions = {
    hideDelete?: boolean;
    className?: string;
    center?: XYLike;
    onDispose?: () => void;
};

export interface IView extends IPropertyChanged, IDisposable {
    readonly document: IDocument;
    readonly cameraController: ICameraController;
    get isClosed(): boolean;
    get width(): number;
    get height(): number;
    get dom(): HTMLElement | undefined;
    mode: ViewMode;
    name: string;
    workplane: Plane;
    update(): void;
    up(): XYZ;
    toImage(): string;
    direction(): XYZ;
    rayAt(mx: number, my: number): Ray;
    screenToWorld(mx: number, my: number): XYZ;
    worldToScreen(point: XYZ): XY;
    resize(width: number, heigth: number): void;
    setDom(element: HTMLElement): void;
    htmlText(text: string, point: XYZLike, options?: HtmlTextOptions): IDisposable;
    close(): void;
    detectVisual(x: number, y: number, nodeFilter?: INodeFilter): IVisualObject[];
    detectVisualRect(
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        nodeFilter?: INodeFilter,
    ): IVisualObject[];
    detectShapes(
        shapeType: ShapeType,
        x: number,
        y: number,
        shapeFilter?: IShapeFilter,
        nodeFilter?: INodeFilter,
    ): VisualShapeData[];
    detectShapesRect(
        shapeType: ShapeType,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        shapeFilter?: IShapeFilter,
        nodeFilter?: INodeFilter,
    ): VisualShapeData[];
}

export function screenDistance(view: IView, mx: number, my: number, point: XYZ) {
    const xy = view.worldToScreen(point);
    const dx = xy.x - mx;
    const dy = xy.y - my;
    return Math.sqrt(dx * dx + dy * dy);
}
