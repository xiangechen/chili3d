// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IShape,
    ParameterShapeNode,
    type Plane,
    Result,
    serializable,
    serialize,
} from "@chili3d/core";
import { type SketchData, toWorld } from "./sketchModel";

export interface SketchNodeOptions {
    document: IDocument;
    plane: Plane;
    data?: SketchData;
    /** Serialized form produced by the Serializer; takes precedence over `data`. */
    dataJson?: string;
    id?: string;
}

@serializable()
export class SketchNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.sketch";
    }

    @serialize()
    get plane(): Plane {
        return this.getPrivateValue("plane");
    }

    /**
     * SketchData is a plain JSON object graph; the Serializer only round-trips
     * @serializable classes, so it is stored as a JSON string.
     */
    @serialize()
    get dataJson(): string {
        return this.getPrivateValue("dataJson");
    }
    /** Undo/redo assigns through the property (PropertyHistoryRecord), so a setter is required. */
    set dataJson(value: string) {
        this.setPropertyEmitShapeChanged("dataJson", value);
    }

    get data(): SketchData {
        return JSON.parse(this.dataJson) as SketchData;
    }

    constructor(options: SketchNodeOptions) {
        super({ document: options.document, id: options.id });
        this.setPrivateValue("plane", options.plane);
        this.setPrivateValue(
            "dataJson",
            options.dataJson ?? JSON.stringify(options.data ?? { entities: [], constraints: [] }),
        );
    }

    setDataEmitShapeChanged(data: SketchData): void {
        this.setPropertyEmitShapeChanged("dataJson", JSON.stringify(data));
    }

    generateShape(): Result<IShape> {
        const edges: IEdge[] = [];
        for (const entity of this.data.entities) {
            const edge =
                entity.type === "line"
                    ? shapeFactory.line(
                          toWorld(this.plane, entity.params[0], entity.params[1]),
                          toWorld(this.plane, entity.params[2], entity.params[3]),
                      )
                    : shapeFactory.circle(
                          this.plane.normal,
                          toWorld(this.plane, entity.params[0], entity.params[1]),
                          entity.params[2],
                      );
            if (!edge.isOk) return edge;
            edges.push(edge.value);
        }
        // A sketch is a set of possibly disjoint entities; a wire requires connected
        // edges (shapeFactory.wire fails with DisconnectedWire otherwise), so entities
        // are combined into a compound — empty when every entity was deleted, which
        // keeps the visual in sync instead of leaving a stale ghost behind.
        // Use convert.toWire/toFace downstream when a closed profile is needed.
        if (edges.length === 1) {
            return Result.ok(edges[0]);
        }
        return shapeFactory.combine(edges);
    }
}
