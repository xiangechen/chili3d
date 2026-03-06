// Macro Command - Entry point that opens the macro manager

import { command, type IApplication, type ICommand } from "@chili3d/core";
import { MacroManager } from "../macro/macroManager";

@command({
    key: "macro.open" as any,
    icon: {
        type: "path",
        value: "icons/macro.svg",
    },
    helpText: "macro.description" as any,
})
export class MacroCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const manager = new MacroManager(application);
        await manager.initialize();
        await manager.show();
    }
}
