// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDisposable } from "../foundation";
import type { IView } from "./view";

export interface IEventHandler extends IDisposable {
    isEnabled: boolean;
    pointerMove(view: IView, event: PointerEvent): void;
    pointerDown(view: IView, event: PointerEvent): void;
    pointerUp(view: IView, event: PointerEvent): void;
    pointerOut?(view: IView, event: PointerEvent): void;
    mouseWheel?(view: IView, event: WheelEvent): void;
    keyDown(view: IView, event: KeyboardEvent): void;
    /**
     * A double-click on the viewport, for a handler a session installed: the sketch uses it to
     * open an array's tool from one of that array's copies, since a copy is the only thing on
     * canvas that *is* the pattern.
     *
     * A handler that implements this takes the event, and the viewport's own node-level
     * double-click stands down for it: while a session holds the viewport, the pointer is the
     * session's. None of the pointer events work that way — they are forwarded unconditionally
     * — because none of them has a second meaning outside the session.
     */
    doubleClick?(view: IView, event: MouseEvent): void;
}
