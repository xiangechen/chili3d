// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDocument, IView, VisualConfig } from "chili-core";
import { ViewUtils } from "chili-vis";
import { SnapResult } from "..";
import { Axis } from "./axis";
import { TrackingBase } from "./trackingBase";

export interface ObjectTrackingAxis {
    axes: Axis[];
    objectName: string | undefined;
}

interface SnapeInfo {
    snap: SnapResult;
    shapeId: number;
}

export class ObjectTracking extends TrackingBase {
    private timer?: number;
    private snapping?: SnapResult;
    private readonly trackings: Map<IDocument, SnapeInfo[]> = new Map();

    constructor(trackingZ: boolean) {
        super(trackingZ);
    }

    override clear(): void {
        this.clearTimer();
        super.clear();
        this.trackings.clear();
    }

    getTrackingRays(view: IView) {
        const result: ObjectTrackingAxis[] = [];
        this.trackings.get(view.document)?.map((x) => {
            let plane = ViewUtils.ensurePlane(view, view.workplane);
            let axes = Axis.getAxiesAtPlane(x.snap.point!, plane, this.trackingZ);
            result.push({ axes, objectName: x.snap.info });
        });
        return result;
    }

    showTrackingAtTimeout(document: IDocument, snap?: SnapResult) {
        if (snap !== undefined && this.snapping === snap) return;
        this.snapping = snap;
        this.clearTimer();
        if (!snap) return;
        this.timer = window.setTimeout(() => this.switchTrackingPoint(document, snap), 600);
    }

    private clearTimer() {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    private switchTrackingPoint(document: IDocument, snap: SnapResult) {
        if (this.isCleared || snap.shapes.length === 0) return;
        if (!this.trackings.has(document)) {
            this.trackings.set(document, []);
        }
        const currentTrackings = this.trackings.get(document)!;
        const existingTracking = currentTrackings.find((x) => x.snap.point!.isEqualTo(snap.point!));
        existingTracking
            ? this.removeTrackingPoint(document, existingTracking, currentTrackings)
            : this.addTrackingPoint(snap, document, currentTrackings);
        document.visual.update();
    }

    private removeTrackingPoint(document: IDocument, s: SnapeInfo, snaps: SnapeInfo[]) {
        document.visual.context.removeMesh(s.shapeId);
        this.trackings.set(
            document,
            snaps.filter((x) => x !== s),
        );
    }

    private addTrackingPoint(snap: SnapResult, document: IDocument, snaps: SnapeInfo[]) {
        const pointId = this.displayPoint(
            document,
            snap,
            VisualConfig.trackingVertexSize,
            VisualConfig.trackingVertexColor,
        );
        snaps.push({ shapeId: pointId, snap });
    }
}
