// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IDocument,
    type IView,
    type MessageType,
    PointSnapEventHandler,
    type ShapeType,
    type SnapResult,
} from "@chili3d/core";
import { type DragSnap, snapConstraintKind, snapPosition } from "../autoConstraints";
import { applyConstraintIcon, badgeSymbol } from "../editor/sketchAnnotations";
import style from "../editor/sketchAnnotations.module.css";
import { SketchEditor } from "../editor/sketchEditor";
import { type ConstraintKind, toUV, toWorld } from "../sketchModel";
import type { SketchPointSnapData } from "./sketchPointStep";

/**
 * Point-snap handler for sketch drawing: snaps the cursor onto sketch targets
 * (origin, existing points, lines, axes, circles, arcs) before the core object
 * snap, and shows the constraint icon it would add as the float tip instead of a
 * text prompt. When the entity the probe would complete is about to come out
 * tangent, the hint shows that instead — the tangency is the constraint that
 * shapes the entity, the incidence it rides on is already implied by the snap.
 */
export class SketchPointSnapEventHandler extends PointSnapEventHandler {
    private sketchSnap?: DragSnap;
    /** Tangency the probe's entity would get: shown in place of the snap's own icon. */
    private sketchTangentKind?: ConstraintKind;

    constructor(
        document: IDocument,
        controller: AsyncController,
        private readonly sketchData: SketchPointSnapData,
    ) {
        super(document, controller, sketchData);
    }

    protected override findSnapPoint(shapeType: ShapeType, view: IView, event: PointerEvent): void {
        const editor = SketchEditor.getActive();
        const hit = editor?.node.plane.intersectRay(view.rayAt(event.offsetX, event.offsetY));
        if (editor === undefined || hit === undefined) {
            this.sketchTangentKind = undefined;
            this.fallbackToCoreSnap(shapeType, view, event);
            return;
        }

        const probe = toUV(editor.node.plane, hit);
        const tolerance = editor.screenTolerance();
        const { position, snap, tangentKind } = snapPosition(
            editor.solver,
            probe,
            { pointTolerance: tolerance, lineTolerance: tolerance },
            (snapped) => this.sketchData.tentative?.(snapped),
        );
        // no snap under the cursor is still worth a tangency hint: the core snap
        // carries the prompt, and the entity comes out tangent all the same
        if (snap === undefined) {
            this.sketchTangentKind = tangentKind;
            this.fallbackToCoreSnap(shapeType, view, event);
            return;
        }

        const point = toWorld(editor.node.plane, position[0], position[1]);
        // honour the step's validator (e.g. a circle radius point must not land on its center)
        if (this.data.validator !== undefined && !this.data.validator(point)) {
            this.sketchTangentKind = undefined;
            this.fallbackToCoreSnap(shapeType, view, event);
            return;
        }

        this.sketchSnap = snap;
        this.sketchTangentKind = tangentKind;
        this._snaped = { view, point, info: "", shapes: [], type: "feature" };
    }

    private fallbackToCoreSnap(shapeType: ShapeType, view: IView, event: PointerEvent): void {
        this.sketchSnap = undefined;
        super.findSnapPoint(shapeType, view, event);
    }

    protected override formatSnapPrompt(
        snaped: SnapResult,
    ): HTMLElement | { level: MessageType; msg: string } | undefined {
        const icon = this.sketchSnapIcon();
        return icon ?? super.formatSnapPrompt(snaped);
    }

    private sketchSnapIcon(): HTMLElement | undefined {
        const snap = this.sketchSnap;
        const kind = this.sketchTangentKind ?? (snap === undefined ? undefined : snapConstraintKind(snap));
        if (kind === undefined) return undefined;
        const symbol = badgeSymbol(kind);
        if (symbol === undefined) return undefined;

        const element = document.createElement("div");
        element.className = style.badge;
        applyConstraintIcon(element, symbol);
        return element;
    }
}
