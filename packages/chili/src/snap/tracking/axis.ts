// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18n, Plane, Ray, XYZ } from "chili-core";

export class Axis extends Ray {
    constructor(
        location: XYZ,
        direction: XYZ,
        readonly name: string,
    ) {
        super(location, direction);
    }

    static getAxiesAtPlane(location: XYZ, plane: Plane, containsZ: boolean) {
        let axies = [
            new Axis(location, plane.xvec, I18n.translate("axis.x")),
            new Axis(location, plane.xvec.reverse(), I18n.translate("axis.x")),
            new Axis(location, plane.yvec, I18n.translate("axis.y")),
            new Axis(location, plane.yvec.reverse(), I18n.translate("axis.y")),
        ];
        if (containsZ) {
            axies.push(
                new Axis(location, plane.normal, I18n.translate("axis.z")),
                new Axis(location, plane.normal.reverse(), I18n.translate("axis.z")),
            );
        }

        return axies;
    }
}
