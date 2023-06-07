// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Config, IDocument, IView, VertexMeshData } from "chili-core";

import { ISnapper, MouseAndDetected, SnapedData } from "..";
import { Axis } from "./axis";

export interface ObjectTrackingAxis {
    axes: Axis[];
    objectName: string | undefined;
}

interface SnapeInfo {
    snap: SnapedData;
    shapeId: number;
}

export class ObjectTracking {
    private timer?: any;
    private isCleared: boolean = false;
    private snapping?: SnapedData;
    private trackings: Map<IDocument, SnapeInfo[]>;

    constructor(readonly trackingZ: boolean) {
        this.trackings = new Map();
    }

    clear(): void {
        this.isCleared = true;
        this.trackings.forEach((v, k) => {
            v.forEach((s) => {
                k.visual.context.temporaryRemove(s.shapeId);
            });
        });
        this.trackings.clear();
    }

    getTrackingRays(view: IView) {
        let result: ObjectTrackingAxis[] = [];
        this.trackings.get(view.viewer.visual.document)?.map((x) => {
            let axes = Axis.getAxiesAtPlane(x.snap.point, view.workplane, this.trackingZ);
            result.push({ axes, objectName: x.snap.info });
        });
        return result;
    }

    showTrackingAtTimeout(document: IDocument, snap?: SnapedData) {
        if (snap !== undefined && this.snapping === snap) return;
        this.snapping = snap;
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        if (snap === undefined) return;
        this.timer = setTimeout(() => this.switchTrackingPoint(document, snap), 600);
    }

    private switchTrackingPoint(document: IDocument, snap: SnapedData) {
        if (this.isCleared || snap.shapes.length === 0) return;
        if (!this.trackings.has(document)) {
            this.trackings.set(document, []);
        }
        let currentTrackings = this.trackings.get(document)!;
        let s = currentTrackings.find((x) => x.snap.point.isEqualTo(snap.point));
        if (s !== undefined) {
            this.removeTrackingPoint(document, s, currentTrackings);
        } else {
            this.addTrackingPoint(snap, document, currentTrackings);
        }
        document.visual.viewer.redraw();
    }

    private removeTrackingPoint(document: IDocument, s: SnapeInfo, snaps: SnapeInfo[]) {
        document.visual.context.temporaryRemove(s.shapeId);
        this.trackings.set(
            document,
            snaps.filter((x) => x !== s)
        );
    }

    private addTrackingPoint(snap: SnapedData, document: IDocument, snaps: SnapeInfo[]) {
        let data = VertexMeshData.from(
            snap.point,
            Config.instance.visual.trackingVertexSize,
            Config.instance.visual.trackingVertexColor
        );
        let pointId = document.visual.context.temporaryDisplay(data);
        snaps.push({ shapeId: pointId, snap });
    }
}
