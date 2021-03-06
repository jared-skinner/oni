/**
 * Selectors.ts
 *
 * Selectors are basically helper methods for operating on the State
 * See Redux documents here fore more info:
 * http://redux.js.org/docs/recipes/ComputingDerivedData.html
 */

import * as flatten from "lodash/flatten"
import { createSelector } from "reselect"

import * as Utility from "./../Utility"

import * as State from "./State"

export const EmptyArray: any[] = []

export const areCompletionsVisible = (state: State.IState) => {
    const autoCompletion = state.autoCompletion
    const entryCount = (autoCompletion && autoCompletion.entries) ? autoCompletion.entries.length : 0

    if (entryCount === 0) {
        return false
    }

    if (entryCount > 1) {
        return true
    }

    // In the case of a single entry, should not be visible if the base is equal to the selected item
    return autoCompletion != null && autoCompletion.base !== getSelectedCompletion(state)
}

export const getSelectedCompletion = (state: State.IState) => {
    const autoCompletion = state.autoCompletion
    if (!autoCompletion) {
        return null
    }

    const completion = autoCompletion.entries[autoCompletion.selectedIndex]
    return completion.insertText ? completion.insertText : completion.label
}

export const getAllBuffers = (buffers: State.IBufferState): State.IBuffer[] => {
    return buffers.allIds.map((id) => buffers.byId[id]).filter((buf) => !buf.hidden && buf.listed)
}

export const getBufferByFilename = (fileName: string, buffers: State.IBufferState): State.IBuffer => {
    const allBuffers = getAllBuffers(buffers)
    const matchingBuffers = allBuffers.filter((buf) => buf.file === fileName)

    if (matchingBuffers.length > 0) {
        return matchingBuffers[0]
    } else {
        return null
    }
}

export const getErrors = (state: State.IState) => state.errors

const getAllErrorsForFile = (fileName: string, errors: State.Errors) => {
    if (!fileName || !errors) {
        return EmptyArray
    }

    const allErrorsByKey = errors[fileName]

    if (!allErrorsByKey) {
        return EmptyArray
    }

    const arrayOfErrorsArray = Object.values(allErrorsByKey)
    return flatten(arrayOfErrorsArray)
}

export const getActiveWindow = (state: State.IState): State.IWindow => {
    if (state.windowState.activeWindow === null) {
        return null
    }

    const activeWindow = state.windowState.activeWindow
    return state.windowState.windows[activeWindow]
}

export const getQuickInfo = (state: State.IState): Oni.Plugin.QuickInfo => {
    const win = getActiveWindow(state)

    if (!win) {
        return null
    }

    const { file, line, column } = win

    const quickInfo = state.quickInfo

    if (!quickInfo) {
        return null
    }

    if (quickInfo.filePath !== file
        || quickInfo.line !== line
        || quickInfo.column !== column) {
            return null
        }

    return quickInfo.data
}

const emptyRectangle = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
}

export const getFontPixelWidthHeight = (state: State.IState) => ({
    fontPixelWidth: state.fontPixelWidth,
    fontPixelHeight: state.fontPixelHeight,
})

export const getActiveWindowScreenDimensions = createSelector(
    [getActiveWindow],
    (win) => {
        if (!win || !win.dimensions) {
            return emptyRectangle
        }

        return win.dimensions
    })

export const getActiveWindowPixelDimensions = createSelector(
    [getActiveWindowScreenDimensions, getFontPixelWidthHeight],
    (dimensions, fontSize) => {
        const pixelDimensions = {
            x: dimensions.x * fontSize.fontPixelWidth,
            y: dimensions.y * fontSize.fontPixelHeight,
            width: dimensions.width * fontSize.fontPixelWidth,
            height: dimensions.height * fontSize.fontPixelHeight,
        }

        return pixelDimensions
    })

export const getErrorsForActiveFile = createSelector(
    [getActiveWindow, getErrors],
    (win, errors) => {
        const errorsForFile = (win && win.file) ? getAllErrorsForFile(win.file, errors) : EmptyArray
        return errorsForFile
    })

export const getErrorsForPosition = createSelector(
    [getActiveWindow, getErrorsForActiveFile],
    (win, errors) => {
        if (!win) {
            return EmptyArray
        }

        const { line, column } = win
        return errors.filter((diag) => Utility.isInRange(line - 1, column - 1, diag.range))
    })

export const getForegroundBackgroundColor = (state: State.IState) => ({
    foregroundColor: state.foregroundColor,
    backgroundColor: state.backgroundColor,
})
