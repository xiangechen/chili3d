// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDocument, VertexMeshData } from "chili-core";
import { SnapResult } from "..";

export abstract class TrackingBase {
    protected readonly tempMeshes: Map<IDocument, number[]> = new Map();
    protected isCleared: boolean = false;

    constructor(readonly trackingZ: boolean) {}

    clear(): void {
        this.clearTempMeshes();
        this.isCleared = true;
    }

    protected clearTempMeshes(): void {
        this.tempMeshes.forEach((ids, document) => {
            ids.forEach((id) => document.visual.context.removeMesh(id));
        });
        this.tempMeshes.clear();
    }

    protected addTempMesh(document: IDocument, meshId: number): void {
        let ids = this.tempMeshes.get(document);
        if (!ids) {
            ids = [];
            this.tempMeshes.set(document, ids);
        }
        ids.push(meshId);
    }

    protected displayPoint(document: IDocument, point: SnapResult, size: number, color: number): number {
        const data = VertexMeshData.from(point.point!, size, color);
        const id = document.visual.context.displayMesh([data]);
        this.addTempMesh(document, id);
        return id;
    }
}
