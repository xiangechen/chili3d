// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { Binding, Config, IApplication, ICommand, command } from "chili-core";

@command({
    name: "workingPlane.toggleDynamic",
    display: "workingPlane.dynamic",
    toggle: new Binding(Config.instance, "dynamicWorkplane"),
    icon: "icon-dynamicPlane",
})
export class ToggleDynamicWorkplaneCommand implements ICommand {
    async execute(app: IApplication): Promise<void> {
        Config.instance.dynamicWorkplane = !Config.instance.dynamicWorkplane;
    }
}
