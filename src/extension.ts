/**
 * Copyright (c) 2018-2019 Michael Potthoff
 *
 * This file is part of vscode-android-webview-debug.
 *
 * vscode-android-webview-debug is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * vscode-android-webview-debug is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with vscode-android-webview-debug. If not, see <http://www.gnu.org/licenses/>.
 */

import * as vscode from "vscode";

import * as bridge from "./bridge";
import { DebugConfigurationProvider } from "./debugConfigurationProvider";

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("android-webview", new DebugConfigurationProvider()));
    context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(bridge.unforwardDebuggers));
}

export async function deactivate() {
    await bridge.unforwardDebuggers();
}
