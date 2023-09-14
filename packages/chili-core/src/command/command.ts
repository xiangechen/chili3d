// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IApplication } from "../application";

export interface ICommand {
    execute(application: IApplication): Promise<void>;
}
