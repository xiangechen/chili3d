import { XYZ } from "chili-core";
import { IShape, IView } from "chili-core";

export interface ShapeCreator {
    (view: IView, point: XYZ): IShape | undefined;
}
