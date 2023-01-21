import { IShape } from "chili-geo";
import { XYZ } from "chili-shared";
import { IView } from "chili-core";

export interface ShapeCreator {
    (view: IView, point: XYZ): IShape | undefined;
}
