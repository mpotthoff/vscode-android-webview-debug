/**
 * Copyright (c) 2018-2021 Michael Potthoff
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

import * as os from "os";
import * as path from "path";

import * as vscode from "vscode";

import * as adb from "./adb";
import * as http from "./http";

export type Device = adb.Device;

export type WebViewType = "chrome" | "webview" | "crosswalk" | "unknown";

export interface WebView {
    device: Device;
    socket: string;
    type: WebViewType;
    packageName?: string;
    versionName?: string;
}

export interface WebViewPage {
    url: string;
    title: string;
    webSocketDebuggerUrl: string;
}

interface Process {
    pid: number;
    name: string;
}

interface Package {
    packageName: string;
    versionName: string;
}

function resolvePath(from: string): string {
    const substituted = from.replace(
        /(?:^(~|\.{1,2}))(?=\/)|\$(\w+)/g,
        (_, tilde?: string, env?: string) => {
            // $HOME/adb -> /Users/<user>/adb
            if (env) return process.env[env] ?? "";

            // ~/adb -> /Users/<user>/adb
            if (tilde === "~") return os.homedir();

            const fsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!fsPath) return "";

            // ./adb -> <workspace>/adb
            if (tilde === ".") return fsPath;

            // ../adb -> <workspace>/../adb
            if (tilde === "..") return fsPath + "/..";

            return "";
        }
    );

    if (substituted.includes("/")) {
        // Resolve the path if it contains a path seperator.
        return path.resolve(substituted);
    } else {
        // Otherwise we treat it as a command that exists in PATH.
        return substituted;
    }
}

function getAdbExecutable(): string {
    const adbPath = vscode.workspace
        .getConfiguration("android-webview-debug")
        .get<string>("adbPath");

    if (adbPath) {
        return resolvePath(adbPath);
    } else {
        return "adb";
    }
}

export async function test(): Promise<void> {
    try {
        await adb.version({
            executable: getAdbExecutable()
        });
    } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
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

async function getSockets(serial: string): Promise<string[]> {
    const output = await adb.shell({
        executable: getAdbExecutable(),
        serial: serial,
        command: "cat /proc/net/unix"
    });

    /**
     * Parse 'cat /proc/net/unix' output which on Android looks like this:
     *
     * Num               RefCount Protocol Flags    Type St Inode Path
     * 0000000000000000: 00000002 00000000 00010000 0001 01 27955 /data/fpc/oem
     * 0000000000000000: 00000002 00000000 00010000 0001 01  3072 @chrome_devtools_remote
     *
     * We need to find records with paths starting from '@' (abstract socket)
     * and containing the channel pattern ("_devtools_remote").
     */

    const result: string[] = [];

    for (const line of output.split(/[\r\n]+/g)) {
        const columns = line.split(/\s+/g);
        if (columns.length < 8) {
            continue;
        }

        if (columns[3] !== "00010000" || columns[5] !== "01") {
            continue;
        }

        const colPath = columns[7];
        if (!colPath.startsWith("@") || !colPath.includes("_devtools_remote")) {
            continue;
        }

        result.push(colPath.substr(1));
    }

    return result;
}

async function getProcesses(serial: string): Promise<Process[]> {
    const output = await adb.shell({
        executable: getAdbExecutable(),
        serial: serial,
        command: "ps"
    });

    /**
     * Parse 'ps' output which on Android looks like this:
     *
     * USER       PID  PPID      VSZ     RSS  WCHAN  ADDR  S  NAME
     * root         1     0    24128    1752  0         0  S  init
     * u0_a100  22100  1307  1959228  128504  0         0  S  com.android.chrome
     */

    const result: Process[] = [];

    for (const line of output.split(/[\r\n]+/g)) {
        const columns = line.split(/\s+/g);
        if (columns.length < 9) {
            continue;
        }

        const pid = parseInt(columns[1], 10);
        if (isNaN(pid)) {
            continue;
        }

        result.push({
            pid: pid,
            name: columns[8]
        });
    }

    return result;
}

async function getPackages(serial: string): Promise<Package[]> {
    const output = await adb.shell({
        executable: getAdbExecutable(),
        serial: serial,
        command: "dumpsys package packages"
    });

    /**
     * Parse 'dumpsys package packages' output which on Android looks like this:
     *
     * Packages:
     *   Package [com.android.chrome] (76d4737):
     *     userId=10100
     *     pkg=Package{3e86c27 com.android.chrome}
     *     codePath=/data/app/com.android.chrome-MMpc6mFfM3KpEYJ7RaZaTA==
     *     resourcePath=/data/app/com.android.chrome-MMpc6mFfM3KpEYJ7RaZaTA==
     *     legacyNativeLibraryDir=/data/app/com.android.chrome-MMpc6mFfM3KpEYJ7RaZaTA==/lib
     *     primaryCpuAbi=armeabi-v7a
     *     secondaryCpuAbi=arm64-v8a
     *     versionCode=344009152 minSdk=24 targetSdk=28
     *     versionName=68.0.3440.91
     */

    const result: Package[] = [];

    let packageName: string | undefined;

    for (const line of output.split(/[\r\n]+/g)) {
        const columns = line.trim().split(/\s+/g);

        if (!packageName) {
            if (columns[0] === "Package") {
                packageName = columns[1].substring(1, columns[1].length - 1);
            }
        } else {
            if (columns[0].startsWith("versionName=")) {
                result.push({
                    packageName: packageName,
                    versionName: columns[0].substr(12)
                });

                packageName = undefined;
            }
        }
    }

    return result;
}

export async function findWebViews(device: Device): Promise<WebView[]> {
    const [
        sockets,
        processes,
        packages
    ] = await Promise.all([
        getSockets(device.serial),
        getProcesses(device.serial),
        getPackages(device.serial)
    ]);

    const result: WebView[] = [];

    for (const socket of sockets) {
        let type: WebViewType;
        let packageName: string | undefined;
        let versionName: string | undefined;

        if (socket === "chrome_devtools_remote") {
            type = "chrome";
            packageName = "com.android.chrome";
        } else if (socket.startsWith("webview_devtools_remote_")) {
            type = "webview";

            const pid = parseInt(socket.substr(24), 10);
            if (!isNaN(pid)) {
                const process = processes.find((el) => el.pid === pid);
                if (process) {
                    packageName = process.name;
                }
            }
        } else if (socket.endsWith("_devtools_remote")) {
            type = "crosswalk";
            packageName = socket.substring(0, socket.length - 16) || undefined;
        } else {
            type = "unknown";
        }

        if (packageName) {
            const aPackage = packages.find((el) => el.packageName === packageName);
            if (aPackage) {
                versionName = aPackage.versionName;
            }
        }

        result.push({
            device: device,
            socket: socket,
            type: type,
            packageName: packageName,
            versionName: versionName
        });
    }

    return result;
}

const forwardedSockets: adb.ForwardedSocket[] = [];

export async function forwardDebugger(application: WebView, port?: number): Promise<number> {
    if (port) {
        const idx = forwardedSockets.findIndex((el) => el.local === `tcp:${port}`);
        if (idx >= 0) {
            forwardedSockets.splice(idx, 1);

            try {
                await adb.unforward({
                    executable: getAdbExecutable(),
                    local: `tcp:${port}`
                });
            } catch {
                // Ignore
            }
        }
    }

    const socket = await adb.forward({
        executable: getAdbExecutable(),
        serial: application.device.serial,
        local: `tcp:${port || 0}`,
        remote: `localabstract:${application.socket}`
    });

    forwardedSockets.push(socket);

    return parseInt(socket.local.substr(4), 10);
}

export async function unforwardDebuggers(): Promise<void> {
    const promises: Promise<any>[] = [];

    for (const socket of forwardedSockets) {
        const promise = adb.unforward({
            executable: getAdbExecutable(),
            local: socket.local
        });
        promises.push(promise.catch(() => { /* Ignore */ }));
    }

    await Promise.all(promises);

    forwardedSockets.splice(0);
}

export async function getWebViewPages(port: number): Promise<WebViewPage[]> {
    return JSON.parse(await http.get(`http://127.0.0.1:${port}/json/list`)) as WebViewPage[];
}
