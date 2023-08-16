// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ICommand, Serialized, command } from "chili-core";
import { Document } from "../../document";
import { Application } from "../../application";

@command({
    name: "OpenDocument",
    display: "command.document.open",
    icon: "icon-open",
})
export class OpenDocument implements ICommand {
    async execute(app: Application): Promise<void> {
        let input = document.createElement("input");
        input.setAttribute("type", "file");
        input.setAttribute("style", "visibility:hidden");
        input.setAttribute("accept", ".cd");
        input.onchange = () => {
            let file = input.files?.item(0);
            if (file) {
                let reader = new FileReader();
                reader.onload = async (e) => {
                    let data = e.target?.result as string;
                    let json: Serialized = JSON.parse(data);
                    if (app.activeDocument) {
                        await app.activeDocument.close();
                    }
                    app.activeDocument = Document.load(json);
                };
                reader.readAsText(file);
            }
        };
        document.body.appendChild(input);
        input.click();
    }
}
