/**
 * Copyright (c) 2018-2020 Michael Potthoff
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

interface DeviceQuickPickItem extends vscode.QuickPickItem {
    device: bridge.Device;
}

interface WebViewQuickPickItem extends vscode.QuickPickItem {
    webView: bridge.WebView;
}

export async function pickDevice(devices: bridge.Device[]): Promise<bridge.Device | undefined> {
    const items = devices.map((device): DeviceQuickPickItem => {
        return {
            label: device.model || device.state,
            description: device.serial,
            device: device
        };
    });

    const item = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a device"
    });

    if (!item) {
        return undefined;
    }

    return item.device;
}

export async function pickWebView(webViews: bridge.WebView[]): Promise<bridge.WebView | undefined> {
    const items = webViews.map((application): WebViewQuickPickItem => {
        let label: string;
        if (application.type === "chrome") {
            label = "Chrome";
        } else {
            if (application.type === "webview") {
                label = "WebView ";
            } else if (application.type === "crosswalk") {
                label = "Crosswalk ";
            } else {
                label = "";
            }

            if (application.packageName) {
                label += application.packageName;
            } else {
                label += application.socket;
            }
        }

        return {
            label: label,
            description: application.versionName,
            webView: application
        };
    });

    const item = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a WebView"
    });

    if (!item) {
        return undefined;
    }

    return item.webView;
}
