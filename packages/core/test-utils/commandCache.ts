// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ICommand } from "../src";

/**
 * The key `CancelableCommand`'s static option cache uses for one of a command's
 * properties. Calls the command's own (protected) computation so a test that primes or
 * clears the cache always addresses the entry the run will read.
 */
export function cachedOptionKey(command: ICommand, name: string): string {
    return (command as any).cacheKeyOfProperty({ name, display: "common.name" });
}
