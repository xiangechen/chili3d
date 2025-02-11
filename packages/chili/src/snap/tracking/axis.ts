// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18n, I18nKeys, Plane, Ray, XYZ } from "chili-core";

export class Axis extends Ray {
    constructor(
        location: XYZ,
        direction: XYZ,
        readonly name: string,
    ) {
        super(location, direction);
    }

    static getAxiesAtPlane(location: XYZ, plane: Plane, containsZ: boolean) {
        const createAxis = (direction: XYZ, name: I18nKeys) =>
            new Axis(location, direction, I18n.translate(name));

        const axies = [
            createAxis(plane.xvec, "axis.x"),
            createAxis(plane.xvec.reverse(), "axis.x"),
            createAxis(plane.yvec, "axis.y"),
            createAxis(plane.yvec.reverse(), "axis.y"),
        ];

        if (containsZ) {
            axies.push(createAxis(plane.normal, "axis.z"), createAxis(plane.normal.reverse(), "axis.z"));
        }

        return axies;
    }
}
