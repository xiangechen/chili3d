import { IShape, IView, XYZ } from "chili-core";

export interface PreviewFromPoint {
    (view: IView, point: XYZ): IShape | undefined;
}
