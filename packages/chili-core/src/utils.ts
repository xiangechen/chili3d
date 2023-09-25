// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Result } from "./base";

export interface FileData {
    fileName: string;
    data: string;
}

export async function readFileAsync(accept: string, multiple: boolean): Promise<Result<FileData[]>> {
    return new Promise((resolve, _reject) => {
        let result: FileData[] = [];
        let input = document.createElement("input");
        input.type = "file";
        input.multiple = multiple;
        input.style.visibility = "hidden";
        input.accept = accept;
        input.onchange = async () => {
            document.body.removeChild(input);
            await resolveFiles(input, result, resolve);
        };
        input.oncancel = () => {
            document.body.removeChild(input);
            resolve(Result.error(`cancel`));
        };
        document.body.appendChild(input);
        input.click();
    });
}

async function resolveFiles(
    input: HTMLInputElement,
    result: FileData[],
    resolve: (value: Result<FileData[]> | PromiseLike<Result<FileData[]>>) => void,
) {
    if (!input.files) {
        resolve(Result.error(`no files`));
        return;
    }
    for (let i = 0; i < input.files.length; i++) {
        let file = input.files.item(i);
        if (!file) continue;
        let data = await asyncFileReader(file);
        if (data.success) {
            result.push({
                fileName: file.name,
                data: data.value,
            });
        } else {
            resolve(Result.error(data.error));
        }
    }
    resolve(Result.success(result));
}

export function asyncFileReader(file: File): Promise<Result<string>> {
    return new Promise((resolve, reject) => {
        let reader = new FileReader();
        reader.onload = (e) => {
            resolve(Result.success(e.target!.result as string));
        };
        reader.onerror = (e) => {
            resolve(Result.error(`Error occurred reading file: ${file.name}`));
        };
        reader.readAsText(file);
    });
}
