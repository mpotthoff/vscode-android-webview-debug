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

import * as child_process from "child_process";

export type DeviceState = "device" | "connecting" | "offline" | "unknown" | "bootloader" | "recovery" | "download" | "unauthorized" | "host" | "no permissions";

export interface Device {
    serial: string;
    state: DeviceState;
    usb?: string;
    product?: string;
    model?: string;
    device?: string;
    features?: string;
    transportId?: string;
}

export interface ForwardedSocket {
    local: string;
    remote: string;
}

export interface AdbOptions {
    executable: string;
}

export interface ShellOptions extends AdbOptions {
    serial: string;
    command: string;
}

export interface ForwardOptions extends AdbOptions {
    serial: string;
    local: string;
    remote: string;
}

export interface UnforwardOptions extends AdbOptions {
    local: string;
}

function adb(options: AdbOptions, ...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        let outBuff = Buffer.alloc(0);
        let errBuff = Buffer.alloc(0);

        const process = child_process.spawn(options.executable, args);

        process.stdout.on("data", (data) => {
            outBuff = Buffer.concat([outBuff, Buffer.from(data)]);
        });
        process.stderr.on("data", (data) => {
            errBuff = Buffer.concat([errBuff, Buffer.from(data)]);
        });

        process.on("error", (err) => {
            reject(err);
        });
        process.on("close", (code) => {
            if (code !== 0) {
                reject(new Error(errBuff.toString("UTF-8")));
            }

            resolve(outBuff.toString("UTF-8"));
        });
    });
}

export async function version(options: AdbOptions): Promise<string> {
    return await adb(options, "version");
}

export async function devices(options: AdbOptions): Promise<Device[]> {
    const output = await adb(options, "devices", "-l");

    const result: Device[] = [];

    const regex = /^([a-zA-Z0-9_-]+(?:\s?[\.a-zA-Z0-9_-]+)?(?:\:\d{1,})?)\s+(device|connecting|offline|unknown|bootloader|recovery|download|unauthorized|host|no permissions)(?:\s+usb:([^:]+))?(?:\s+product:([^:]+))?(?:\s+model\:([\S]+))?(?:\s+device\:([\S]+))?(?:\s+features:([^:]+))?(?:\s+transport_id:([^:]+))?$/gim;
    let match;
    while ((match = regex.exec(output)) !== null) {
        result.push({
            serial: match[1],
            state: match[2] as DeviceState,
            usb: match[3],
            product: match[4],
            model: match[5],
            device: match[6],
            features: match[7],
            transportId: match[8]
        });
    }

    return result;
}

export async function shell(options: ShellOptions): Promise<string> {
    return await adb(options, "-s", options.serial, "shell", options.command);
}

export async function forward(options: ForwardOptions): Promise<ForwardedSocket> {
    const output = await adb(options, "-s", options.serial, "forward", options.local, options.remote);

    if (options.local === "tcp:0") {
        return {
            local: "tcp:" + parseInt(output.trim(), 10),
            remote: options.remote
        };
    } else {
        return {
            local: options.local,
            remote: options.remote
        };
    }
}

export async function unforward(options: UnforwardOptions): Promise<void> {
    await adb(options, "forward", "--remove", options.local);
}
