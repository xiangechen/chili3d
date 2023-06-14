// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Application } from "./application";

export interface ICommand {
    excute(application: Application): Promise<void>;
}
