// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IModule, IRegister, Token } from "chili-core";

export class OccModule implements IModule {
    type(): string {
        return "occ module";
    }

    async init(container: IRegister): Promise<void> {
        const m = await import("./occ");
        await m.initMyOcc();

        let factorys: any = await import("./shapeFactory");
        let keys = Object.keys(factorys);
        keys.forEach((key) => {
            let factory = factorys[key];
            let token = Token.get(factory);
            if (token !== undefined) {
                container.registerSingleton(token, factory);
            }
        });
    }
}
