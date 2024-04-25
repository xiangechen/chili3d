// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Result } from "..";

export interface FileData {
    fileName: string;
    data: string;
}

export async function readFileAsync(
    accept: string,
    multiple: boolean,
    method: "readAsText" | "readAsDataURL" = "readAsText",
): Promise<Result<FileData[]>> {
    return new Promise((resolve, _reject) => {
        let input = document.createElement("input");
        input.type = "file";
        input.multiple = multiple;
        input.accept = accept;
        input.style.visibility = "hidden";
        input.onchange = async () => {
            document.body.removeChild(input);
            resolve(await readInputedFiles(input, method));
        };
        input.oncancel = () => {
            document.body.removeChild(input);
            resolve(Result.err(`cancel`));
        };
        document.body.appendChild(input);
        input.click();
    });
}

async function readInputedFiles(input: HTMLInputElement, method: "readAsText" | "readAsDataURL") {
    let files = input.files ?? [];
    let result: FileData[] = [];
    for (const file of files) {
        let data = await readFileDataAsync(file, method);
        if (!data) {
            return Result.err(`Error occurred reading file: ${file.name}`);
        }

        result.push({
            fileName: file.name,
            data,
        });
    }
    return Result.ok(result);
}

function readFileDataAsync(file: File, method: any): Promise<string | undefined> {
    return new Promise((resolve) => {
        let reader = new FileReader();
        reader.onload = (e) => {
            resolve(e.target!.result as string);
        };
        reader.onerror = () => {
            resolve(undefined);
        };
        (reader as any)[method](file);
    });
}
