// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Observable } from "../foundation";
import type { XYZ } from "../math";
import { serializable, serialize } from "../serialize";
import type { IView } from "./view";

export interface ActOptions {
    name: string;
    cameraPosition: XYZ;
    cameraTarget: XYZ;
    cameraUp: XYZ;
}

@serializable()
export class Act extends Observable {
    @serialize()
    public get name() {
        return this.getPrivateValue("name");
    }
    public set name(value: string) {
        this.setProperty("name", value);
    }

    @serialize()
    public get cameraPosition() {
        return this.getPrivateValue("cameraPosition");
    }
    public set cameraPosition(value: XYZ) {
        this.setProperty("cameraPosition", value);
    }

    @serialize()
    public get cameraTarget() {
        return this.getPrivateValue("cameraTarget");
    }
    public set cameraTarget(value: XYZ) {
        this.setProperty("cameraTarget", value);
    }

    @serialize()
    public get cameraUp() {
        return this.getPrivateValue("cameraUp");
    }
    public set cameraUp(value: XYZ) {
        this.setProperty("cameraUp", value);
    }

    static fromView(view: IView, name: string) {
        return new Act({
            name,
            cameraPosition: view.cameraController.cameraPosition,
            cameraTarget: view.cameraController.cameraTarget,
            cameraUp: view.cameraController.cameraUp,
        });
    }

    constructor(options: ActOptions) {
        super();
        this.setPrivateValue("name", options.name);
        this.setPrivateValue("cameraPosition", options.cameraPosition);
        this.setPrivateValue("cameraTarget", options.cameraTarget);
        this.setPrivateValue("cameraUp", options.cameraUp);
    }
}
