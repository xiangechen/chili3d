import { ItemsElement, ItemsProps } from "../components/items";
import {
    AProps,
    CheckboxProps,
    ChildDom,
    ColorProps,
    ImgProps,
    OptionProps,
    Props,
    RadioProps,
    SelectProps,
    setProps,
} from "./props";

export const div = createFunction("div");
export const span = createFunction("span");
export const button = createFunction("button");
export const input = createFunction<"input", CheckboxProps | ColorProps | RadioProps>("input");
export const textarea = createFunction("textarea");
export const select = createFunction<"select", SelectProps>("select");
export const option = createFunction<"option", OptionProps>("option");
export const label = createFunction("label");
export const img = createFunction<"img", ImgProps>("img");
export const a = createFunction<"a", AProps>("a");
export const br = createFunction("br");
export const hr = createFunction("hr");
export const pre = createFunction("pre");
export const code = createFunction("code");
export const h1 = createFunction("h1");
export const h2 = createFunction("h2");
export const h3 = createFunction("h3");
export const h4 = createFunction("h4");
export const h5 = createFunction("h5");
export const h6 = createFunction("h6");
export const p = createFunction("p");
export const ul = createFunction("ul");
export const li = createFunction("li");
export const items = (options: ItemsProps) => new ItemsElement(options);

function createFunction<K extends keyof HTMLElementTagNameMap, O extends Props = Props>(tag: K) {
    return function (options?: O | ChildDom, ...children: readonly ChildDom[]) {
        let dom: HTMLElementTagNameMap[K] = document.createElement(tag);
        if (options) {
            if (typeof options === "string" || options instanceof Node) {
                dom.append(options);
            } else if (typeof options === "object") {
                setProps(options, dom);
            } else {
                throw new Error("Invalid options");
            }
        }
        dom.append(...children);

        return dom;
    };
}
