// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { serializable, serialze } from "../serialize";
import { Line } from "./line";
import { XYZ } from "./xyz";

export interface RayOptions {
    point: XYZ;
    direction: XYZ;
}

@serializable(["point", "direction"])
export class Ray {
    @serialze()
    readonly point: XYZ;
    /**
     * unit vector
     */
    @serialze()
    readonly direction: XYZ;

    constructor(options: RayOptions) {
        this.point = options.point;
        const n = options.direction.normalize();
        if (n === undefined || n.isEqualTo(XYZ.zero)) {
            throw new Error("direction can not be zero");
        }
        this.direction = n;
    }

    toLine(): Line {
        return new Line({ point: this.point, direction: this.direction });
    }
}
