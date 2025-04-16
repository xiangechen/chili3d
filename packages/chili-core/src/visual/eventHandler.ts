// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDisposable } from "../foundation";
import { IView } from "./view";

export interface IEventHandler extends IDisposable {
    pointerMove(view: IView, event: PointerEvent): void;
    pointerDown(view: IView, event: PointerEvent): void;
    pointerUp(view: IView, event: PointerEvent): void;
    pointerOut?(view: IView, event: PointerEvent): void;
    mouseWheel?(view: IView, event: WheelEvent): void;
    keyDown(view: IView, event: KeyboardEvent): void;
}
