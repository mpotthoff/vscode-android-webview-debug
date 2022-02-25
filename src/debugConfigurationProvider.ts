/**
 * Copyright (c) 2018-2022 Michael Potthoff
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
import * as tasks from "./tasks";
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

        if (debugConfiguration.preLaunchTask) {
            // Workaround for a configured preLaunchTask.
            // The debug configuration is resolved before the preLaunchTask gets executed.
            // This means the debugging connection would be established before the task gets executed,
            // which would prevent the task from deploying the application.

            const task = await tasks.findTask(debugConfiguration.preLaunchTask);
            if (!task) {
                let item;
                if (typeof debugConfiguration.preLaunchTask === "string") {
                    item = await vscode.window.showErrorMessage(`Could not find the task '${debugConfiguration.preLaunchTask}'.`, {
                        modal: true
                    }, "Debug Anyway", "Configure Task", "Open launch.json");
                } else {
                    item = await vscode.window.showErrorMessage("Could not find the specified task.", {
                        modal: true
                    }, "Debug Anyway", "Configure Task", "Open launch.json");
                }

                if (item === "Debug Anyway") {
                    // Continue
                } else if (item === "Configure Task") {
                    vscode.commands.executeCommand("workbench.action.tasks.configureTaskRunner");
                    return undefined;
                } else if (item === "Open launch.json") {
                    return null;
                } else {
                    return undefined;
                }
            } else {
                const result = await tasks.executeTask(task);
                if (!result) {
                    return undefined;
                }
            }

            delete debugConfiguration.preLaunchTask;
        }

        const useNewDebugger = vscode.workspace.getConfiguration("debug.javascript").get<boolean>("usePreview") ?? true;

        // Rewrite type to chrome
        debugConfiguration.type = useNewDebugger ? "pwa-chrome" : "chrome";

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
                    vscode.window.showErrorMessage(`Device '${debugConfiguration.device as string}' not found`);
                    return undefined;
                }

                device = found;
            }

            if (!device) {
                if (debugConfiguration.application) {
                    progress.report({ message: "Loading WebViews..." });

                    const webViews = await withTimeoutRetries(debugConfiguration.connectTimeout ?? 0, 500, async () => {
                        // Find all devices that have the application running
                        const promises = devices.map(async (dev) => {
                            const webViews = await bridge.findWebViews(dev).catch((err: Error): bridge.WebView[] => {
                                vscode.window.showWarningMessage(err.message);
                                return [];
                            });
                            return webViews.find((el) => el.packageName === debugConfiguration.application);
                        });
                        const result = await Promise.all(promises);

                        const filtered = result.filter((el) => el ? true : false) as bridge.WebView[];
                        if (filtered.length < 1) {
                            return undefined;
                        }

                        return filtered;
                    });

                    if (!webViews || webViews.length < 1) {
                        vscode.window.showErrorMessage(`No matching WebViews found on any device`);
                        return undefined;
                    }

                    if (webViews.length === 1) {
                        device = webViews[0].device;
                        webView = webViews[0];
                    } else {
                        // Ask the user to select a device
                        const filteredDevices = Array.from(new Set(webViews.map((el) => el.device)));
                        const pickedDevice = await ui.pickDevice(filteredDevices);
                        if (!pickedDevice) {
                            return undefined;
                        }

                        device = pickedDevice;

                        const filtered = webViews.filter((el) => el.device === pickedDevice);
                        if (filtered.length < 1) {
                            return undefined;
                        }

                        if (filtered.length > 1) {
                            // Ask the user to select a webview
                            const pickedWebView = await ui.pickWebView(webViews);
                            if (!pickedWebView) {
                                return undefined;
                            }

                            webView = pickedWebView;
                        } else {
                            webView = filtered[0];
                        }
                    }
                } else {
                    // Ask the user to select a connected device
                    const pickedDevice = await ui.pickDevice(devices);
                    if (!pickedDevice) {
                        return undefined;
                    }

                    device = pickedDevice;
                }
            }

            if (!webView) {
                progress.report({ message: "Loading WebViews..." });

                const webViews = await withTimeoutRetries(debugConfiguration.connectTimeout ?? 0, 500, async () => {
                    // Find the running applications
                    const webViews = await bridge.findWebViews(device!);
                    if (webViews.length < 1) {
                        return undefined;
                    }

                    if (debugConfiguration.application) {
                        // Try to find the configured application
                        const filtered = webViews.filter((el) => el.packageName === debugConfiguration.application);
                        if (filtered.length < 1) {
                            return undefined;
                        }

                        return filtered;
                    } else {
                        return webViews;
                    }
                });

                if (!webViews || webViews.length < 1) {
                    vscode.window.showErrorMessage(`No matching WebViews found`);
                    return undefined;
                }

                // Ask the user to select a webview
                const pickedWebView = await ui.pickWebView(webViews);
                if (!pickedWebView) {
                    return undefined;
                }

                webView = pickedWebView;
            }

            progress.report({ message: "Forwarding debugger..." });

            // Forward the debugger to the local port
            debugConfiguration.port = await bridge.forwardDebugger(webView, debugConfiguration.port);
            debugConfiguration.browserAttachLocation = "workspace";

            // In case the old debugger is used and neither url and urlFilter are configured we are going to try and
            // retrieve the list of available pages. If more than one is available we will allow the user to choose one to debug.
            if (!useNewDebugger && !debugConfiguration.url && !debugConfiguration.urlFilter) {
                try {
                    const pages = await bridge.getWebViewPages(debugConfiguration.port);
                    if (pages.length > 1) {
                        const picked = await ui.pickWebViewPage(pages);
                        if (!picked) {
                            return undefined;
                        }

                        debugConfiguration.websocketUrl = picked.webSocketDebuggerUrl;
                    }
                } catch (err) {
                    console.error(err);
                }
            }

            vscode.window.showInformationMessage(`Connected to ${webView.packageName ?? "unknown"} on ${webView.device.serial}`);

            return debugConfiguration;
        });
    }
}

function withTimeoutRetries<T>(timeout: number, interval: number, func: () => Promise<T>): Promise<T> {
    const startTime = new Date().valueOf();

    const run = async (): Promise<T> => {
        const result = await func();
        if (result || startTime + timeout <= new Date().valueOf()) {
            return result;
        }

        await new Promise((resolve) => setTimeout(resolve, interval));

        return run();
    };

    return run();
}
