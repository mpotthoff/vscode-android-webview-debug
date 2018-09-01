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

import * as portfinder from "portfinder";
import * as vscode from "vscode";

import * as adb from "./adb";

export type Device = adb.Device;

export type WebViewType = "chrome" | "webview" | "crosswalk" | "unknown";

export interface WebView {
    device: Device;
    socket: string;
    type: WebViewType;
    packageName?: string;
    versionName?: string;
}

function getAdbExecutable(): string {
    return vscode.workspace.getConfiguration("android-webview-debug").get("adbPath") || "adb";
}

export async function test(): Promise<void> {
    try {
        await adb.version({
            executable: getAdbExecutable()
        });
    } catch (err) {
        if (err.code === "ENOENT") {
            throw new Error("Failed to locate ADB executable.");
        }

        throw err;
    }
}

export async function findDevices(): Promise<Device[]> {
    return await adb.devices({
        executable: getAdbExecutable()
    });
}

async function getPackageName(serial: string, pid: number): Promise<string | undefined> {
    const result = await adb.shell({
        executable: getAdbExecutable(),
        serial: serial,
        command: `ps -p ${pid}`
    });
    if (!result) {
        return undefined;
    }

    for (const line of result.split(/[\r\n]+/g)) {
        const columns = line.split(/\s/g);
        if (columns.length < 2) {
            continue;
        }

        if (columns.find((el) => el.trim() === pid.toString())) {
            return columns[columns.length - 1].trim() || undefined;
        }
    }

    return undefined;
}

async function getVersionName(serial: string, packageName: string): Promise<string | undefined> {
    const result = await adb.shell({
        executable: getAdbExecutable(),
        serial: serial,
        command: `dumpsys package ${packageName} | grep versionName`
    });
    if (!result) {
        return undefined;
    }

    const matches = result.match(/versionName=(.+)/gi);
    if (!matches || matches.length < 1) {
        return undefined;
    }

    return matches[0].substring(12).trim() || undefined;
}

export async function findWebViews(device: Device): Promise<WebView[]> {
    const result = await adb.shell({
        executable: getAdbExecutable(),
        serial: device.serial,
        command: "cat /proc/net/unix | grep -a _devtools_remote"
    });
    if (!result) {
        return [];
    }

    const matches = result.match(/@(.+)/gi);
    if (!matches || matches.length < 1) {
        return [];
    }

    const promises = matches.map(async (rawSocket): Promise<WebView> => {
        let socket: string;
        let type: WebViewType;
        let packageName: string | undefined;
        let versionName: string | undefined;

        if (rawSocket === "@chrome_devtools_remote") {
            socket = rawSocket.substring(1);
            type = "chrome";
            packageName = "com.android.chrome";
        } else if (rawSocket.startsWith("@webview_devtools_remote_")) {
            socket = rawSocket.substring(1);
            type = "webview";
            packageName = await getPackageName(device.serial, parseInt(rawSocket.substring(25), 10));
        } else if (rawSocket.startsWith("@") && rawSocket.endsWith("_devtools_remote")) {
            socket = rawSocket.substring(1);
            type = "crosswalk";
            packageName = rawSocket.substring(1, rawSocket.length - 16) || undefined;
        } else {
            socket = rawSocket;
            type = "unknown";
        }

        if (packageName) {
            versionName = await getVersionName(device.serial, packageName);
        }

        return {
            device: device,
            socket: socket,
            type: type,
            packageName: packageName,
            versionName: versionName
        };
    });

    return Promise.all(promises);
}

const forwardedPorts: number[] = [];

export async function forwardDebugger(application: WebView, port?: number): Promise<number> {
    if (!port) {
        port = await portfinder.getPortPromise();
    }

    const idx = forwardedPorts.indexOf(port);
    if (idx >= 0) {
        forwardedPorts.splice(idx, 1);

        try {
            await adb.removeForward({
                executable: getAdbExecutable(),
                local: `tcp:${port}`
            });
        } catch {
            // Ignore
        }
    }

    await adb.forward({
        executable: getAdbExecutable(),
        serial: application.device.serial,
        local: `tcp:${port}`,
        remote: `localabstract:${application.socket}`
    });

    forwardedPorts.push(port);

    return port;
}

export async function unforwardDebuggers(): Promise<void> {
    const promises: Promise<any>[] = [];

    for (const port of forwardedPorts) {
        const promise = adb.removeForward({
            executable: getAdbExecutable(),
            local: `tcp:${port}`
        });
        promises.push(promise.catch(() => { /* Ignore */ }));
    }

    await Promise.all(promises);

    forwardedPorts.splice(0);
}
