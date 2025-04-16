// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const COPYRIGHT = `// Part of the Chili3d Project, under the AGPL-3.0 License.\n`;

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const TARGET_PATHS = [
    {
        dir: path.join(ROOT_DIR, "packages"),
        extensions: [".ts"],
    },
    {
        dir: path.join(ROOT_DIR, "cpp", "src"),
        extensions: [".hpp", ".cpp"],
    },
];

function addCopyrightToFile(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");

    const hasExistingCopyright = lines[0].startsWith("// Part");

    if (hasExistingCopyright) {
        const newContent = COPYRIGHT + lines.slice(1).join("\n");
        fs.writeFileSync(filePath, newContent);
    } else if (!content.startsWith(COPYRIGHT)) {
        fs.writeFileSync(filePath, COPYRIGHT + content);
    }
}

function processDirectory(dirPath, extensions) {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            processDirectory(fullPath, extensions);
        } else if (extensions.includes(path.extname(file))) {
            addCopyrightToFile(fullPath);
        }
    }
}

function main() {
    for (const target of TARGET_PATHS) {
        if (fs.existsSync(target.dir)) {
            processDirectory(target.dir, target.extensions);
        } else {
            console.warn(`Directory not found: ${target.dir}`);
        }
    }
}

main();
