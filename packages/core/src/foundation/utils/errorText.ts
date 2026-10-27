// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * The message to show a user for a thrown value.
 *
 * Failures reach the UI in several shapes: an `Error`, a DOMException (not an `Error` in
 * every browser), a refused string — or the raw event an IndexedDB request rejects with,
 * whose own error sits on `target.error` and whose `String()` is just "[object Event]".
 */
export function errorText(error: unknown): string {
    const value = (error as { target?: { error?: unknown } } | undefined)?.target?.error ?? error;
    if (typeof value === "string") return value;

    const message = (value as { message?: unknown } | undefined)?.message;
    if (typeof message === "string" && message.length > 0) return message;

    const name = (value as { name?: unknown } | undefined)?.name;
    if (typeof name === "string" && name.length > 0) return name;

    return String(value);
}
