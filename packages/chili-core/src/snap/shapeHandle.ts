import { IShape } from "chili-geo";
import { XYZ } from "chili-shared";
import { IView } from "chili-vis";

export interface ShapeCreator {
    (view: IView, point: XYZ): IShape | undefined;
}
