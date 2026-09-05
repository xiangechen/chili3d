// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IView,
    type MessageType,
    PointSnapEventHandler,
    type ShapeType,
    type SnapResult,
} from "@chili3d/core";
import { type DragSnap, snapPosition } from "../autoConstraints";
import { applyConstraintIcon, badgeSymbol } from "../editor/sketchAnnotations";
import style from "../editor/sketchAnnotations.module.css";
import { SketchEditor } from "../editor/sketchEditor";
import { ConstraintKind, toUV, toWorld } from "../sketchModel";

/**
 * Point-snap handler for sketch drawing: snaps the cursor onto sketch targets
 * (origin, existing points, lines, axes) before the core object snap, and shows
 * the constraint icon it would add as the float tip instead of a text prompt.
 */
export class SketchPointSnapEventHandler extends PointSnapEventHandler {
    private sketchSnap?: DragSnap;

    protected override findSnapPoint(shapeType: ShapeType, view: IView, event: PointerEvent): void {
        const editor = SketchEditor.getActive();
        const hit = editor?.node.plane.intersectRay(view.rayAt(event.offsetX, event.offsetY));
        if (editor === undefined || hit === undefined) {
            this.sketchSnap = undefined;
            super.findSnapPoint(shapeType, view, event);
            return;
        }

        const probe = toUV(editor.node.plane, hit);
        const tolerance = editor.screenTolerance();
        const { position, snap } = snapPosition(editor.solver, probe, {
            pointTolerance: tolerance,
            lineTolerance: tolerance,
        });
        if (snap === undefined) {
            this.sketchSnap = undefined;
            super.findSnapPoint(shapeType, view, event);
            return;
        }

        const point = toWorld(editor.node.plane, position[0], position[1]);
        // honour the step's validator (e.g. a circle radius point must not land on its center)
        if (this.data.validator !== undefined && !this.data.validator(point)) {
            this.sketchSnap = undefined;
            super.findSnapPoint(shapeType, view, event);
            return;
        }

        this.sketchSnap = snap;
        this._snaped = { view, point, info: "", shapes: [], type: "feature" };
    }

    protected override formatSnapPrompt(
        snaped: SnapResult,
    ): HTMLElement | { level: MessageType; msg: string } | undefined {
        const icon = this.sketchSnapIcon();
        return icon ?? super.formatSnapPrompt(snaped);
    }

    private sketchSnapIcon(): HTMLElement | undefined {
        const snap = this.sketchSnap;
        if (snap === undefined) return undefined;
        const kind = snap.kind === "point" ? ConstraintKind.P2PCoincident : ConstraintKind.PointOnLine;
        const symbol = badgeSymbol(kind);
        if (symbol === undefined) return undefined;

        const element = document.createElement("div");
        element.className = style.badge;
        applyConstraintIcon(element, symbol);
        return element;
    }
}
