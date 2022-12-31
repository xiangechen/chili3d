// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IModule, Token, IRegister } from "chili-shared";
import { ThreeVisulizationFactory } from "./threeVisulizationFactory";

export class ThreeModule implements IModule {
    type(): string {
        return "three module";
    }

    init(container: IRegister): void | Promise<void> {
        container.registerSingleton(Token.VisulizationFactory, ThreeVisulizationFactory);
    }
}
