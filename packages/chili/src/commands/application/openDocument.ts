// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IApplication, ICommand, Serialized, command } from "chili-core";

@command({
    name: "doc.open",
    display: "command.document.open",
    icon: "icon-open",
})
export class OpenDocument implements ICommand {
    async execute(app: IApplication): Promise<void> {
        let input = document.createElement("input");
        input.type = "file";
        input.style.visibility = "hidden";
        input.accept = ".cd";
        input.onchange = () => {
            let file = input.files?.item(0);
            if (!file) return;
            let reader = new FileReader();
            reader.onload = async (e) => {
                let data = e.target?.result as string;
                let json: Serialized = JSON.parse(data);
                await app.loadDocument(json);
            };
            reader.readAsText(file);
        };
        document.body.appendChild(input);
        input.click();
    }
}
