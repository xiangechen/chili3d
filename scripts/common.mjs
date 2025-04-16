// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { exec } from "child_process";

/**
 *
 * @param {string} cmd
 */
export async function execAsync(cmd) {
    console.log(`> ${cmd}`);
    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (err) {
                reject(err);
                process.exit(1);
            }
            console.error("error: ", stderr);

            console.log("stdout: ", stdout);
            resolve(stdout);
        });
    });
}
