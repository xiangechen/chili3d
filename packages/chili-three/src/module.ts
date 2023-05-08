// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IModule, IRegister, Token } from "chili-core";

import { ThreeVisulFactory } from "./threeVisulFactory";

export class ThreeModule implements IModule {
    type(): string {
        return "three module";
    }

    init(container: IRegister): void | Promise<void> {
        container.registerSingleton(Token.VisulizationFactory, ThreeVisulFactory);
    }
}
