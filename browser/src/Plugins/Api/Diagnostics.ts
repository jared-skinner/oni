/**
 * Diagnostics.ts
 *
 * API surface exposed for interacting with error management in plugins
 */

import { IPluginChannel } from "./Channel"

import * as types from "vscode-languageserver-types"

/**
 * API instance for interacting with Oni (and vim)
 */
export class Diagnostics implements Oni.Plugin.Diagnostics.Api {
    private _filesThatHaveErrors: { [fileName: string]: boolean } = {}

    constructor(private _channel: IPluginChannel) {
    }

    public setErrors(key: string, fileName: string, errors: types.Diagnostic[]): void {
        if (!errors) {
            return
        }

        if (errors.length === 0 && !this._filesThatHaveErrors[fileName]) {
            return
        }

        this._filesThatHaveErrors[fileName] = errors.length > 0

        this._channel.send("set-errors", null, {
            key,
            fileName,
            errors,
        })
    }
}
