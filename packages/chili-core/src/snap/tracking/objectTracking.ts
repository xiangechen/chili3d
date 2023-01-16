// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IView } from "chili-vis";
import { SnapInfo } from "../";
import { Axis } from "./axis";
import { VertexRenderData } from "chili-geo";

export interface ObjectTrackingAxis {
    axes: Axis[];
    objectName: string | undefined;
}

export class ObjectTracking {
    private timer?: any;
    private isCleared: boolean = false;
    private snapping?: SnapInfo;
    private trackings: Map<IView, { snap: SnapInfo; shapeId: number; axies: Axis[] }[]>;

    constructor(readonly trackingZ: boolean) {
        this.trackings = new Map();
    }

    getTrackingRays(view: IView) {
        let result: ObjectTrackingAxis[] = [];
        this.trackings.get(view)?.forEach((x) => result.push({ axes: x.axies, objectName: x.snap.info }));
        return result;
    }

    handleSnapForTracking(view: IView, snap?: SnapInfo) {
        if (snap !== undefined && this.snapping === snap) return;
        this.snapping = snap;
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }

        if (snap === undefined) return;
        this.timer = setTimeout(() => {
            if (this.isCleared) return;
            if (!this.trackings.has(view)) {
                this.trackings.set(view, []);
            }
            let snaps = this.trackings.get(view)!;
            let s = snaps.find((x) => x.snap.point.isEqualTo(snap.point));
            if (s !== undefined) {
                view.document.visualization.context.temporaryRemove(s.shapeId);
                this.trackings.set(
                    view,
                    snaps.filter((x) => x !== s)
                );
            } else {
                let data = VertexRenderData.from(snap.point, 0xf00, 5);
                let pointId = view.document.visualization.context.temporaryDisplay(data);
                let axies = Axis.getAxiesAtPlane(snap.point, view.workplane, this.trackingZ);
                snaps.push({ shapeId: pointId, snap, axies });
            }
            view.document.viewer.redraw();
        }, 600);
    }

    clear(): void {
        this.isCleared = true;
        this.trackings.forEach((v, k) => {
            v.forEach((s) => {
                k.document.visualization.context.temporaryRemove(s.shapeId);
            });
        });
        this.trackings.clear();
    }
}
