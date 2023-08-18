// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Language } from "chili-core";
import { Props, option, select } from "../controls";

export const LanguageSelector = (props: Props) =>
    select(
        {
            onchange: (e) => Language.set((e.target as HTMLSelectElement).selectedIndex),
            ...props,
        },
        ...Language.Languages.map((lng) => option(lng))
    );
