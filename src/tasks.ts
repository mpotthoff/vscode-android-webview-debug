/**
 * Copyright (c) 2018-2024 Michael Potthoff
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

export async function findTask(name: string): Promise<vscode.Task | undefined> {
    const tasks = await vscode.tasks.fetchTasks();
    return tasks.find((task) => task.name === name);
}

export async function executeTask(task: vscode.Task): Promise<boolean> {
    const activeTask = vscode.tasks.taskExecutions.find((t) => t.task.name === task.name);
    if (activeTask && activeTask.task.isBackground) {
        return true;
    }

    return new Promise((resolve, reject) => {
        let execution: vscode.TaskExecution | undefined;
        vscode.tasks.executeTask(task).then((exec) => {
            execution = exec;
        });

        if (task.isBackground) {
            resolve(true);
        } else {
            const endEvent = vscode.tasks.onDidEndTask((e) => {
                if (e.execution === execution) {
                    endEvent.dispose();

                    resolve(true);
                }
            });
        }
    });
}
