import { IShape, IView, XYZ } from "chili-core";

export interface ShapeFromPoint {
    (view: IView, point: XYZ): IShape | undefined;
}

export interface ShapeFromLength {
    (view: IView, length: number): IShape | undefined;
}
