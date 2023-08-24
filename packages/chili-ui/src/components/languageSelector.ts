// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n } from "chili-core";
import { Props, option, select } from "../controls";

export const LanguageSelector = (props: Props) =>
    select(
        {
            onchange: (e) => I18n.changeLanguage((e.target as HTMLSelectElement).selectedIndex),
            ...props,
        },
        ...I18n.languages.map((lng) => option(lng.language))
    );
