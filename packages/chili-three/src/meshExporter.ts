// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IMeshExporter, Result, VisualNode } from "chili-core";
import { Group, Mesh, Object3D } from "three";
import { PLYExporter } from "three/examples/jsm/exporters/PLYExporter";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter";
import { Line2 } from "three/examples/jsm/lines/Line2";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2";
import { ThreeVisualContext } from "./threeVisualContext";

export class ThreeMeshExporter implements IMeshExporter {
    constructor(readonly content: ThreeVisualContext) {}

    exportToStl(nodes: VisualNode[], asciiMode: boolean): Result<BlobPart> {
        const exporter = new STLExporter();
        const group = this.parseNodeToGroup(nodes);
        const blob = exporter.parse(group, { binary: !asciiMode });
        this.disposeObject(group);
        return Result.ok(blob);
    }

    exportToPly(nodes: VisualNode[], asciiMode: boolean): Result<BlobPart> {
        const exporter = new PLYExporter();
        const group = this.parseNodeToGroup(nodes);
        const blobPart = exporter.parse(group, () => {}, { binary: !asciiMode });
        this.disposeObject(group);
        if (!blobPart) {
            return Result.err("can not export to ply");
        }
        return Result.ok(blobPart);
    }

    exportToObj(nodes: VisualNode[]): Result<BlobPart> {
        const exporter = new OBJExporter();
        const group = this.parseNodeToGroup(nodes);
        const blobPart = exporter.parse(group);
        this.disposeObject(group);
        return Result.ok(blobPart);
    }

    private disposeObject(object: Object3D) {
        object.traverse((child) => {
            if (child instanceof Mesh) {
                child.geometry.dispose();
            }
        });
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
