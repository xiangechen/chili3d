// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PubSub } from "../foundation/pubsub";
import { Result } from "../foundation/result";
import { readFileAsync } from "../foundation/utils/readFileAsync";
import { I18n } from "../i18n";
import { DefaultFont, FontCatalog } from "./fontCatalog";
import { hasLocalFontAccess, type LocalFontEntry, listLocalFonts } from "./localFonts";

/** A font the user chose: either its bytes, or where to find it. */
export interface PickedFont {
    name: string;
    /** The font file itself, as a data URL, for one read off a disk. */
    data?: string;
    /** Where the font lives, for one the catalogue fetches. */
    url?: string;
}

const FONT_FILES = ".ttf, .otf, .woff";

/**
 * The font to draw in without asking. Nothing here reads the disk or the web —
 * the caller decides when to pay for the download.
 */
export function defaultTextFont(): PickedFont {
    return { name: DefaultFont.family, url: DefaultFont.url };
}

/**
 * Ask the user for a font.
 *
 * Three sources, in one dialog: the fonts installed on this machine, the ones the
 * catalogue can fetch, and a file to read. Only the catalogue is always there —
 * listing installed fonts takes a browser that can enumerate them, and a
 * permission the user may refuse; reading a file is the one source that works
 * when there is nothing to list at all.
 *
 * Every way out of that dialog — including the file one, which has a dialog of
 * its own — answers with the font itself, so there is nothing here to decide.
 */
export async function pickTextFont(): Promise<Result<PickedFont>> {
    return chooseInDialog(await installedFonts());
}

/** The fonts installed on this machine, or none when the browser cannot say. */
async function installedFonts(): Promise<readonly LocalFontEntry[]> {
    if (!hasLocalFontAccess()) return [];
    return (await listLocalFonts()).unchecked() ?? [];
}

/** How many rows the list shows before it starts to scroll. */
const LIST_ROWS = 12;

/**
 * The filter box and the list under it, narrowed as a name is typed. A machine can carry
 * hundreds of fonts, and each row of the device's own is drawn in the font it names — which is
 * what a name cannot say: whether a family has the characters wanted, and whether the weight
 * and the slant are the ones meant.
 */
function fontChooser(installed: readonly LocalFontEntry[]): { content: HTMLElement; selected: () => string } {
    const filter = document.createElement("input");
    filter.type = "search";
    filter.placeholder = I18n.translate("font.filter") ?? "Filter";
    filter.style.cssText = "width: 100%; box-sizing: border-box; margin-bottom: 8px;";

    const select = document.createElement("select");
    select.size = LIST_ROWS;
    select.style.width = "100%";

    const render = (query: string) => {
        select.replaceChildren();
        appendGroup(select, "font.groupInstalled", installedOptions(installed, query));
        appendGroup(select, "font.groupCatalog", catalogOptions(query));
    };
    render("");
    filter.oninput = () => render(filter.value);

    const content = document.createElement("div");
    content.style.minWidth = "320px";
    content.append(filter, select);

    return { content, selected: () => select.value };
}

/** The rows of the device's own fonts, each drawn in the font it names. */
function installedOptions(installed: readonly LocalFontEntry[], query: string): FontRow[] {
    return installed
        .filter((entry) => matches(`${entry.family} ${entry.style} ${entry.postscriptName}`, query))
        .map((entry) => [
            entry.postscriptName,
            `${entry.family} — ${entry.style}`,
            {
                family: entry.family,
                bold: /bold/i.test(entry.style),
                italic: /italic|oblique/i.test(entry.style),
            },
        ]);
}

/** The rows of the catalogue, each with what fetching it costs. */
function catalogOptions(query: string): FontRow[] {
    return FontCatalog.filter((font) => matches(font.family, query)).map((font) => [
        font.url,
        `${font.family} (${megabytes(font.size)})`,
    ]);
}

async function chooseInDialog(installed: readonly LocalFontEntry[]): Promise<Result<PickedFont>> {
    const { content, selected } = fontChooser(installed);

    return new Promise((resolve) => {
        PubSub.default.pub("showDialog", "dialog.title.selectFont", content, [
            {
                content: "common.confirm",
                onclick: async () => resolve(await chosen(installed, selected())),
            },
            { content: "font.readFile", onclick: async () => resolve(await readFromFile()) },
            { content: "common.cancel", onclick: () => resolve(Result.err("cancel")) },
        ]);
    });
}

/** What the dialog's selection stands for. */
async function chosen(installed: readonly LocalFontEntry[], value: string): Promise<Result<PickedFont>> {
    const entry = installed.find((candidate) => candidate.postscriptName === value);
    if (entry !== undefined) return readInstalled(entry);

    const font = FontCatalog.find((candidate) => candidate.url === value);
    return font === undefined
        ? Result.err(`Unknown font: ${value}`)
        : Result.ok({ name: font.family, url: font.url });
}

async function readFromFile(): Promise<Result<PickedFont>> {
    const files = await readFileAsync(FONT_FILES, false, "readAsDataURL");
    if (!files.isOk) return Result.err(files.error);

    const [file] = files.value;
    return Result.ok({ name: file.fileName, data: file.data });
}

async function readInstalled(entry: LocalFontEntry): Promise<Result<PickedFont>> {
    try {
        const bytes = await entry.read();
        return Result.ok({ name: `${entry.family} ${entry.style}`, data: dataUrlOf(bytes) });
    } catch (error) {
        return Result.err(`Could not read ${entry.family}: ${error}`);
    }
}

/** One row of the list: the value it stands for, the words it shows, and how to draw it. */
type FontRow = readonly [value: string, label: string, font?: RowFont];

/** What a row is drawn in, for a font already on this machine — the ones that can be drawn. */
interface RowFont {
    family?: string;
    bold?: boolean;
    italic?: boolean;
}

/** Whether a name carries what was typed into the filter; nothing typed matches everything. */
function matches(name: string, query: string): boolean {
    const wanted = query.trim().toLowerCase();
    return wanted === "" || name.toLowerCase().includes(wanted);
}

function appendGroup(
    select: HTMLSelectElement,
    label: "font.groupInstalled" | "font.groupCatalog",
    options: readonly FontRow[],
) {
    if (options.length === 0) return;

    const group = document.createElement("optgroup");
    group.label = I18n.translate(label) ?? label;
    for (const [value, text, font] of options) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        if (font?.family !== undefined) option.style.fontFamily = font.family;
        if (font?.bold === true) option.style.fontWeight = "bold";
        if (font?.italic === true) option.style.fontStyle = "italic";
        group.append(option);
    }
    select.append(group);
}

/** The font file's bytes as a data URL, which is what a font is carried as. */
function dataUrlOf(bytes: ArrayBuffer): string {
    let binary = "";
    const view = new Uint8Array(bytes);
    for (let index = 0; index < view.length; index++) {
        binary += String.fromCharCode(view[index]);
    }
    return `data:font/ttf;base64,${btoa(binary)}`;
}

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
