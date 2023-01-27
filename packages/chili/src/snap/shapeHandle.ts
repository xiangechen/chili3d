import { IShape, IView, XYZ } from "chili-core";

export interface ShapeCreator {
    (view: IView, point: XYZ): IShape | undefined;
}
