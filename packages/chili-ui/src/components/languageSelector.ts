// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { I18n } from "chili-core";
import { HTMLProps, option, select } from ".";

export const LanguageSelector = (props: HTMLProps<HTMLElement>) => {
    let languages: HTMLOptionElement[] = [];
    I18n.languages.forEach((language, index) =>
        languages.push(
            option({
                selected: index === I18n.currentLanguage(),
                textContent: language.display,
            }),
        ),
    );
    return select(
        {
            onchange: (e) => {
                let language = (e.target as HTMLSelectElement).selectedIndex;
                I18n.changeLanguage(language);
            },
            ...props,
        },
        ...languages,
    );
};
