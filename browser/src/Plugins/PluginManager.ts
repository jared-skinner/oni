import { EventEmitter } from "events"
import * as fs from "fs"
import * as path from "path"
import { INeovimInstance } from "./../neovim"
import { configuration } from "./../Services/Configuration"
import * as UI from "./../UI/index"

import { AnonymousPlugin } from "./AnonymousPlugin"
import * as Capabilities from "./Api/Capabilities"
import * as Channel from "./Api/Channel"
import { Plugin } from "./Plugin"

const corePluginsRoot = path.join(__dirname, "vim", "core")
const defaultPluginsRoot = path.join(__dirname, "vim", "default")

export interface IEventContext {
    bufferFullPath: string
    line: number
    column: number
    byte: number
    filetype: string
}

export class PluginManager extends EventEmitter {
    private _config = configuration
    private _rootPluginPaths: string[] = []
    private _plugins: Plugin[] = []
    private _neovimInstance: INeovimInstance
    private _lastEventContext: any
    private _anonymousPlugin: AnonymousPlugin

    private _channel: Channel.IChannel = new Channel.InProcessChannel()

    constructor() {
        super()

        this._rootPluginPaths.push(corePluginsRoot)

        if (this._config.getValue("oni.useDefaultConfig")) {
            this._rootPluginPaths.push(defaultPluginsRoot)
            this._rootPluginPaths.push(path.join(defaultPluginsRoot, "bundle"))
        }

        this._rootPluginPaths.push(path.join(this._config.getUserFolder(), "plugins"))

        this._channel.host.onResponse((arg: any) => this._handlePluginResponse(arg))
    }

    // TODO: Deprecate this once the Language functionality has been migrated out
    // Also deprecate the `Oni.EventContext`, as once that surface area is removed,
    // it can be purely internal
    public checkHover(eventContext: Oni.EventContext): void {
        this._sendLanguageServiceRequest("quick-info", eventContext)
    }

    public checkSignatureHelp(eventContext: Oni.EventContext): void {
        this._sendLanguageServiceRequest("signature-help", eventContext)
    }

    public gotoDefinition(): void {
        this._sendLanguageServiceRequest("goto-definition", this._lastEventContext)
    }

    public findAllReferences(): void {
        this._sendLanguageServiceRequest("find-all-references", this._lastEventContext)
    }

    public requestFormat(): void {
        this._sendLanguageServiceRequest("format", this._lastEventContext, "formatting")
    }

    public notifyCompletionItemSelected(completionItem: any): void {
        this._sendLanguageServiceRequest("completion-provider-item-selected", this._lastEventContext, "completion-provider", { item: completionItem })
    }

    public startPlugins(neovimInstance: INeovimInstance): Oni.Plugin.Api {
        this._neovimInstance = neovimInstance

        this._neovimInstance.on("event", (eventName: string, context: Oni.EventContext) => {
            this._onEvent(eventName, context)
        })

        const allPlugins = this._getAllPluginPaths()
        this._plugins = allPlugins.map((pluginRootDirectory) => this._createPlugin(pluginRootDirectory))

        this._anonymousPlugin = new AnonymousPlugin(this._channel)

        return this._anonymousPlugin.oni
    }

    public getAllRuntimePaths(): string[] {
        const pluginPaths = this._getAllPluginPaths()

        return pluginPaths.concat(this._rootPluginPaths)
    }

    public notifyBufferUpdate(eventContext: Oni.EventContext, bufferLines: string[]): void {
        this._channel.host.send({
            type: "buffer-update",
            payload: {
                eventContext,
                bufferLines,
            },
        }, Capabilities.createPluginFilter(eventContext.filetype))
    }

    public notifyBufferUpdateIncremental(eventContext: Oni.EventContext, lineNumber: number, bufferLine: string): void {
        this._channel.host.send({
            type: "buffer-update-incremental",
            payload: {
                eventContext,
                lineNumber,
                bufferLine,
            },
        }, Capabilities.createPluginFilter(eventContext.filetype))

        if (this._config.getValue("editor.completions.enabled")) {
            this._sendLanguageServiceRequest("completion-provider", eventContext)
        }
    }

    private _createPlugin(pluginRootDirectory: string): Plugin {
        return new Plugin(pluginRootDirectory, this._channel)
    }

    private _getAllPluginPaths(): string[] {
        const paths: string[] = []
        this._rootPluginPaths.forEach((rp) => {
            const subPaths = getDirectories(rp)
            paths.push(...subPaths)
        })

        return paths
    }

    private _handlePluginResponse(pluginResponse: any): void {

        // TODO: Refactor these handlers to separate classes
        // - pluginManager.registerResponseHandler("show-quick-info", new QuickInfoHandler())
        switch (pluginResponse.type) {
            case "show-quick-info":
                if (!pluginResponse.error) {
                    setTimeout(() => {
                        const originEvent = pluginResponse.meta.originEvent

                        UI.Actions.showQuickInfo(originEvent.bufferFullPath, originEvent.line, originEvent.column, pluginResponse.payload.info, pluginResponse.payload.documentation)
                    }, this._config.getValue("editor.quickInfo.delay"))
                }
                break
            case "goto-definition":
                if (!this._validateOriginEventMatchesCurrentEvent(pluginResponse)) {
                    return
                }

                // TODO: Refactor to 'Service', break remaining NeoVim dependencies
                const { filePath, line, column } = pluginResponse.payload
                this._neovimInstance.command("e! " + filePath)
                this._neovimInstance.command(`cal cursor(${line}, ${column})`)
                this._neovimInstance.command("norm zz")
                break
            case "completion-provider":
                if (!this._validateOriginEventMatchesCurrentEvent(pluginResponse)) {
                    return
                }

                if (!pluginResponse.payload) {
                    return
                }

                setTimeout(() => UI.Actions.showCompletions(pluginResponse.payload))
                break
            case "completion-provider-item-selected":
                setTimeout(() => UI.Actions.setDetailedCompletionEntry(pluginResponse.payload.details))
                break
            case "set-errors":
                this.emit("set-errors", pluginResponse.payload.key, pluginResponse.payload.fileName, pluginResponse.payload.errors)
                break
            case "find-all-references":
                this.emit("find-all-references", pluginResponse.payload.references)
                break
            case "format":
                this.emit("format", pluginResponse.payload)
                break
            case "set-syntax-highlights":
                this.emit("set-syntax-highlights", pluginResponse.payload)
                break
            case "clear-syntax-highlights":
                this.emit("clear-syntax-highlights", pluginResponse.payload)
                break
            default:
                this.emit("logWarning", "Unexpected plugin type: " + pluginResponse.type)
        }
    }

    private _onEvent(eventName: string, eventContext: Oni.EventContext): void {
        this._lastEventContext = eventContext

        this._channel.host.send({
            type: "event",
            payload: {
                name: eventName,
                context: eventContext,
            },
        }, Capabilities.createPluginFilter(this._lastEventContext.filetype))
    }

    private _sendLanguageServiceRequest(requestName: string, eventContext: any, languageServiceCapability?: any, additionalArgs?: any): void {
        languageServiceCapability = languageServiceCapability || requestName
        additionalArgs = additionalArgs || {}

        const payload = {
            name: requestName,
            context: eventContext,
            ...additionalArgs,
        }

        this._channel.host.send({
            type: "request",
            payload,
        }, Capabilities.createPluginFilter(eventContext.filetype))
    }

    /**
     * Validate that the originating event matched the initating event
     */
    private _validateOriginEventMatchesCurrentEvent(pluginResponse: any): boolean {
        const currentEvent = this._lastEventContext
        const originEvent = pluginResponse.meta.originEvent

        if (originEvent.bufferFullPath === currentEvent.bufferFullPath
            && originEvent.line === currentEvent.line
            && originEvent.column === currentEvent.column) {
            return true
        } else {
            console.log("Plugin response aborted as it didn't match current even (buffer/line/col)") // tslint:disable-line no-console
            return false
        }
    }
}

function getDirectories(rootPath: string): string[] {
    if (!fs.existsSync(rootPath)) {
        return []
    }

    return fs.readdirSync(rootPath)
        .map((f) => path.join(rootPath.toString(), f))
        .filter((f) => fs.statSync(f).isDirectory())
}
