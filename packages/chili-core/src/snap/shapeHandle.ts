import { IShape } from "chili-geo";
import { XYZ } from "chili-shared";
import { IView } from "chili-vis";

export interface HandleTempShape {
    (view: IView, point: XYZ): IShape | undefined;
}
