// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IApplication, ICommand, Material, command } from "chili-core";

let count = 1;

@command({
    name: "doc.new",
    display: "command.document.new",
    icon: "icon-new",
})
export class NewDocument implements ICommand {
    async execute(app: IApplication): Promise<void> {
        let document = await app.newDocument(`undefined ${count++}`);
        let lightGray = new Material(document, "LightGray", 0xdedede);
        let deepGray = new Material(document, "DeepGray", 0x898989);
        document.materials.push(lightGray, deepGray);
    }
}
