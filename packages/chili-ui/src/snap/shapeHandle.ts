import { IShape } from "chili-geo";
import { XYZ } from "chili-shared";

export interface HandleTempShape {
    (point: XYZ): IShape | undefined;
}
