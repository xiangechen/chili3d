// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type HTMLProps, option, select } from "chili-controls";
import { Config, I18n } from "chili-core";

export const LanguageSelector = (props: HTMLProps<HTMLElement>) => {
    const languages: HTMLOptionElement[] = [];
    I18n.languages.forEach((language) =>
        languages.push(
            option({
                selected: language.code === I18n.currentLanguage(),
                textContent: language.display,
            }),
        ),
    );
    return select(
        {
            onchange: (e) => {
                const language = (e.target as HTMLSelectElement).selectedIndex;
                Config.instance.language = Array.from(I18n.languages.keys())[language];
            },
            ...props,
        },
        ...languages,
    );
};
