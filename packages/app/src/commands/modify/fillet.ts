// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, type IEdge, type IFace, type IShape, property, type Result } from "@chili3d/core";
import { EdgeCornerCommand } from "./edgeCornerCommand";

@command({
    key: "modify.fillet",
    icon: "icon-fillet",
})
export class FilletCommand extends EdgeCornerCommand {
    @property("circle.radius")
    get radius() {
        return this.getPrivateValue("radius", 10);
    }

    set radius(value: number) {
        this.setProperty("radius", value, () => this.refreshCornerPreview());
    }

    protected override get cornerValue() {
        return this.radius;
    }
    protected override set cornerValue(value: number) {
        this.radius = value;
    }

    protected override applyToBody(shape: IShape, edgeIndexes: number[]): Result<IShape> {
        return shapeFactory.fillet(shape, edgeIndexes, this.radius);
    }

    protected override applyToFace(face: IFace, edge1: IEdge, edge2: IEdge): Result<IShape> {
        return shapeFactory.fillet2d(face, edge1, edge2, this.radius);
    }

    protected override applyToEdgePair(edge1: IEdge, edge2: IEdge): Result<IEdge[]> {
        return shapeFactory.filletEdge2d(edge1, edge2, this.radius);
    }
}
