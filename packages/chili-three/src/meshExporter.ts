// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IMeshExporter, Result, VisualNode } from "chili-core";
import { Group, Mesh, Object3D } from "three";
import { PLYExporter } from "three/examples/jsm/exporters/PLYExporter";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter";
import { Line2 } from "three/examples/jsm/lines/Line2";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2";
import { ThreeVisualContext } from "./threeVisualContext";

export class ThreeMeshExporter implements IMeshExporter {
    constructor(readonly content: ThreeVisualContext) {}

    exportToStl(nodes: VisualNode[], asciiMode: boolean): Result<BlobPart> {
        const exporter = new STLExporter();
        const group = this.parseNodeToGroup(nodes);
        return Result.ok(exporter.parse(group, { binary: !asciiMode }));
    }

    exportToPly(nodes: VisualNode[], asciiMode: boolean): Result<BlobPart> {
        const exporter = new PLYExporter();
        const group = this.parseNodeToGroup(nodes);
        const blobPart = exporter.parse(group, () => {}, { binary: !asciiMode });
        if (!blobPart) {
            return Result.err("can not export to ply");
        }
        return Result.ok(blobPart);
    }

    private parseNodeToGroup(nodes: VisualNode[]) {
        const group = new Group();
        nodes.forEach((node) => {
            const visualObject = this.content.getVisual(node);
            if (visualObject instanceof Object3D) {
                visualObject.traverse((child) => {
                    if (child instanceof LineSegments2 || child instanceof Line2) {
                        return;
                    }
                    if (child instanceof Mesh) {
                        group.add(child.clone(false));
                    }
                });
            }
        });

        return group;
    }
}
