import { IShape, IView, XYZ } from "chili-core";

export interface PointToShape {
    (view: IView, point: XYZ): IShape | undefined;
}
