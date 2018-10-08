/**
 * Copyright (c) 2018 Michael Potthoff
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
import * as ui from "./ui";

export class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    public async resolveDebugConfiguration?(folder: vscode.WorkspaceFolder | undefined, debugConfiguration: vscode.DebugConfiguration, token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration | null | undefined> {
        if (!debugConfiguration.type || !debugConfiguration.request) {
            // Empty configurations are unsupported
            return null;
        }

        if (debugConfiguration.request !== "attach") {
            // Only attach is supported right now
            return null;
        }

        // Rewrite type to chrome
        debugConfiguration.type = "chrome";

        // Test the bridge to ensure that the required executables exist
        await bridge.test();

        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification
        }, async (progress) => {
            let device: bridge.Device | undefined;
            let webView: bridge.WebView | undefined;

            progress.report({ message: "Loading devices..." });

            // Find the connected devices
            const devices = await bridge.findDevices();
            if (devices.length < 1) {
                vscode.window.showErrorMessage(`No devices found`);
                return undefined;
            }

            if (debugConfiguration.device) {
                // Try to find the configured device
                const found = devices.find((el) => el.serial === debugConfiguration.device);
                if (!found) {
                    vscode.window.showErrorMessage(`Device '${debugConfiguration.device}' not found`);
                    return undefined;
                }

                device = found;
            }

            if (!device) {
                if (debugConfiguration.application) {
                    progress.report({ message: "Loading WebViews..." });

                    // Find all devices that have the application running
                    const promises = devices.map(async (dev) => {
                        const webViews = await bridge.findWebViews(dev).catch((err): bridge.WebView[] => {
                            vscode.window.showWarningMessage(err.message);
                            return [];
                        });
                        return webViews.find((el) => el.packageName === debugConfiguration.application);
                    });
                    const result = await Promise.all(promises);

                    const filtered = result.filter((el) => el ? true : false) as bridge.WebView[];
                    if (filtered.length < 1) {
                        vscode.window.showErrorMessage(`No WebViews of '${debugConfiguration.application}' found on any device`);
                        return undefined;
                    } else if (filtered.length === 1) {
                        device = filtered[0].device;
                        webView = filtered[0];
                    } else {
                        // Ask the user to select a device
                        const filteredDevices = filtered.map((el) => el.device);
                        const pickedDevice = await ui.pickDevice(filteredDevices);
                        if (!pickedDevice) {
                            return undefined;
                        }

                        const pickedWebView = filtered.find((el) => el.device === pickedDevice);
                        if (!pickedWebView) {
                            return undefined;
                        }

                        device = pickedWebView.device;
                        webView = pickedWebView;
                    }
                } else {
                    // Ask the user to select a connected device
                    const picked = await ui.pickDevice(devices);
                    if (!picked) {
                        return undefined;
                    }

                    device = picked;
                }
            }

            if (!webView) {
                progress.report({ message: "Loading WebViews..." });

                // Find the running applications
                const webViews = await bridge.findWebViews(device);
                if (webViews.length < 1) {
                    vscode.window.showErrorMessage(`No WebViews found`);
                    return undefined;
                }

                if (debugConfiguration.application) {
                    // Try to find the configured application
                    const found = webViews.find((el) => el.packageName === debugConfiguration.application);
                    if (!found) {
                        vscode.window.showErrorMessage(`No WebViews of '${debugConfiguration.application}' found`);
                        return undefined;
                    }

                    webView = found;
                } else {
                    // Ask the user to select a webview
                    const picked = await ui.pickWebView(webViews);
                    if (!picked) {
                        return undefined;
                    }

                    webView = picked;
                }
            }

            progress.report({ message: "Forwarding debugger..." });

            // Forward the debugger to the local port
            debugConfiguration.port = await bridge.forwardDebugger(webView, debugConfiguration.port);

            vscode.window.showInformationMessage(`Connected to ${webView.packageName} on ${webView.device.serial}`);

            return debugConfiguration;
        });
    }
}
