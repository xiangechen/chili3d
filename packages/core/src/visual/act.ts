// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Observable } from "../foundation";
import type { XYZ } from "../math";
import { serializable, serialze } from "../serialize";
import type { IView } from "./view";

@serializable(["name", "cameraPosition", "cameraTarget", "cameraUp"])
export class Act extends Observable {
    @serialze()
    public get name() {
        return this.getPrivateValue("name");
    }
    public set name(value: string) {
        this.setProperty("name", value);
    }

    @serialze()
    public get cameraPosition() {
        return this.getPrivateValue("cameraPosition");
    }
    public set cameraPosition(value: XYZ) {
        this.setProperty("cameraPosition", value);
    }

    @serialze()
    public get cameraTarget() {
        return this.getPrivateValue("cameraTarget");
    }
    public set cameraTarget(value: XYZ) {
        this.setProperty("cameraTarget", value);
    }

    @serialze()
    public get cameraUp() {
        return this.getPrivateValue("cameraUp");
    }
    public set cameraUp(value: XYZ) {
        this.setProperty("cameraUp", value);
    }

    static fromView(view: IView, name: string) {
        return new Act(
            name,
            view.cameraController.cameraPosition,
            view.cameraController.cameraTarget,
            view.cameraController.cameraUp,
        );
    }

    constructor(name: string, cameraPosition: XYZ, cameraTarget: XYZ, cameraUp: XYZ) {
        super();
        this.setPrivateValue("name", name);
        this.setPrivateValue("cameraPosition", cameraPosition);
        this.setPrivateValue("cameraTarget", cameraTarget);
        this.setPrivateValue("cameraUp", cameraUp);
    }
}
