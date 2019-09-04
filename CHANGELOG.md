## 1.1.1 - 2019-09-04
* Change the `extensionKind` to `ui` because vscode-chrome-debug can not be installed on a remote system
* Add a check for VS LiveShare to prevent the debugging configuration from being resolved in a guest instance

## 1.1.0 - 2019-03-06
* Implement custom execution of `preLaunchTask` because otherwise the task gets executed _after_ the debugging connection is established

## 1.0.3 - 2018-10-08
* Disable the automatic opening of the `launch.json` configuration file if no device and/or WebView is found or the user aborted the picker dialog

## 1.0.2 - 2018-09-03
* Remove the portfinder dependency and let ADB find an unused port instead
* Improve the WebView detection in the ADB client bridge

## 1.0.1 - 2018-09-01
* Rename the `adbExecutable` configuration parameter

## 1.0.0 - 2018-08-31
* Initial release
