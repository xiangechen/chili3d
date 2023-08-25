// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { GeometryModel, command } from "chili-core";
import { IStep } from "../../step";
import { CreateCommand } from "./createCommand";

@command({
    name: "create.polygon",
    display: "command.polygon",
    icon: "icon-polygon",
})
export class Polygon extends CreateCommand {
    protected override create(): GeometryModel {
        throw new Error("Method not implemented.");
    }
    protected override getSteps(): IStep[] {
        throw new Error("Method not implemented.");
    }
}
