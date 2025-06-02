import { Observable } from "../foundation";
import { XYZ } from "../math";
import { Serializer } from "../serialize";
import { IView } from "./view";

@Serializer.register(["name", "cameraPosition", "cameraTarget", "cameraUp"])
export class Act extends Observable {
    @Serializer.serialze()
    public get name() {
        return this.getPrivateValue("name");
    }
    public set name(value: string) {
        this.setProperty("name", value);
    }

    @Serializer.serialze()
    public get cameraPosition() {
        return this.getPrivateValue("cameraPosition");
    }
    public set cameraPosition(value: XYZ) {
        this.setProperty("cameraPosition", value);
    }

    @Serializer.serialze()
    public get cameraTarget() {
        return this.getPrivateValue("cameraTarget");
    }
    public set cameraTarget(value: XYZ) {
        this.setProperty("cameraTarget", value);
    }

    @Serializer.serialze()
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
