/* Things related to the operating system.
 *
 * Copyright 2017 Raising the Floor - International
 *
 * Licensed under the New BSD license. You may not use this file except in
 * compliance with this License.
 *
 * The R&D leading to these results received funding from the
 * Department of Education - Grant H421A150005 (GPII-APCP). However,
 * these results do not necessarily represent the policy of the
 * Department of Education, and you should not assume endorsement by the
 * Federal Government.
 *
 * You may obtain a copy of the License at
 * https://github.com/GPII/universal/blob/master/LICENSE.txt
 */

"use strict";

var ref = require("ref"),
    Promise = require("bluebird"),
    logging = require("./logging.js"),
    winapi = require("./winapi.js"),
    path = require("path");

var windows = {
    winapi: winapi
};

/**
 * Determine if this process is running as a service.
 *
 * @return {Boolean} true if running as a service.
 */
windows.isService = function () {
    return require("./service.js").isService;
};

windows.win32Error = function (message, returnCode, errorCode) {
    var text = "win32 error: " + message
        + returnCode === undefined ? "" : (", return:" + returnCode)
        + ", win32:" + (errorCode || winapi.kernel32.GetLastError());
    logging.error(text);
};

/**
 * Get the user token for the current process.
 *
 * This token must be closed with CloseHandle when no longer needed.
 *
 * @return {Number} The token.
 */
windows.getOwnUserToken = function () {
    // A pseudo handle - doesn't need to be closed;
    var processHandle = winapi.kernel32.GetCurrentProcess();
    // Enough for CreateProcessAsUser
    var access = winapi.constants.TOKEN_ASSIGN_PRIMARY | winapi.constants.TOKEN_DUPLICATE
        | winapi.constants.TOKEN_QUERY;
    var tokenBuf = ref.alloc(winapi.types.HANDLE);
    var success = winapi.advapi32.OpenProcessToken(processHandle, access, tokenBuf);

    if (!success) {
        throw winapi.error("OpenProcessToken failed");
    }

    return tokenBuf.deref();
};

/**
 * Gets the user token for the active desktop session.
 *
 * This token must be closed with CloseHandle when no longer needed.
 *
 * @return {Number} The token
 */
windows.getDesktopUser = function () {

    if (!windows.isService()) {
        return windows.getOwnUserToken();
    }

    // Get the session ID of the console session.
    var sessionId = winapi.kernel32.WTSGetActiveConsoleSessionId();
    logging.debug("session id:", sessionId);

    var token;

    if (sessionId === 0xffffffff) {
        // There isn't a session.
        token = 0;
    } else {
        // Get the access token of the user logged into the session.
        var tokenBuf = ref.alloc(winapi.types.HANDLE);
        var success = winapi.wtsapi32.WTSQueryUserToken(sessionId, tokenBuf);

        if (success) {
            token = tokenBuf.deref();
        } else {
            var errorCode = winapi.kernel32.GetLastError();
            switch (errorCode) {
            case winapi.errorCodes.ERROR_NO_TOKEN:
            case winapi.errorCodes.ERROR_SUCCESS:
                // There is no user on this session.
                logging.log("WTSQueryUserToken failed (win32=" + errorCode + ")");
                token = 0;
                break;
            case winapi.errorCodes.ERROR_ACCESS_DENIED:
            case winapi.errorCodes.ERROR_PRIVILEGE_NOT_HELD:
                // Not running as a service.
                token = 0;
                break;
            default:
                throw winapi.error("WTSQueryUserToken", errorCode);
                break;
            }
        }
    }

    return token;
};

/**
 * Determines if the active console session is a user logged on.
 */
windows.isUserLoggedOn = function () {
    var token = windows.getDesktopUser();
    var loggedOn = !!token;
    if (token) {
        winapi.kernel32.CloseHandle(token);
    }

    return loggedOn;
};

/**
 * Gets the environment variables for the specified user.
 *
 * @param token {Number} Token handle for the user.
 * @return {Array} An array of string for each variable, in the format of "name=value"
 */
windows.getEnv = function (token) {
    var envPtr = ref.alloc(winapi.types.LP);
    var success = winapi.userenv.CreateEnvironmentBlock(envPtr, token, false);
    if (!success) {
        throw winapi.error("CreateEnvironmentBlock");
    }
    return winapi.stringFromWideCharArray(envPtr.deref(), true);
};

/**
 * Gets the GPII data directory for the specified user.
 *
 * @param token {Number} Token handle for the user.
 */
windows.getUserDataDir = function (token) {
    // Search the environment block for the APPDATA value. (A better way would be to use SHGetKnownFolderPath)
    var env = windows.getEnv(token);
    var appData = null;
    for (var n = 0, len = env.length; n < len; n++) {
        var match = env[n].match(/^APPDATA=(.*)/i);
        if (match) {
            appData = match[1];
            break;
        }
    }

    return appData && path.join(appData, "GPII");
};

/**
 * Gets the parent process ID of the given pid.
 *
 * @param pid {Number} The child pid.
 * @return {Number} The parent pid.
 */
windows.getParentPid = function (pid) {

    var snapshot = windows.kernel32.CreateToolhelp32Snapshot(winapi.constants.TH32CS_SNAPPROCESS, null);
    if (snapshot === winapi.constants.INVALID_HANDLE_VALUE) {
        throw winapi.error("CreateToolhelp32Snapshot failed");
    }

    var parentPid = null;

    try {
        var entry = new winapi.PROCESSENTRY32();
        entry.dwSize = winapi.PROCESSENTRY32.size;

        var success = winapi.kernel32.Process32First(snapshot, entry.ref());
        while (success) {
            if (entry.th32ProcessID === pid) {
                parentPid = entry.th32ParentProcessID;
                break;
            }
            success = winapi.kernel32.Process32Next(snapshot, entry.ref());
        }
    } finally {
        if (snapshot) {
            winapi.kernel32.CloseHandle(snapshot);
        }
    }

    return parentPid;
};

/**
 *
 * @param childPid
 * @param parentPid
 * @param depth
 */
windows.isParentPid = function (childPid, parentPid, depth) {
    depth = depth || 5;

    var pid = childPid;
    var found = false;
    while (pid && depth-- > 0) {
        pid = windows.getParentPid(pid);
        if (pid === parentPid) {
            found = true;
            break;
        }
    }

    return found;
};

windows.waitForProcessTermination = function (processHandle, timeout) {
    return new Promise(function (resolve, reject) {
        if (!timeout && timeout !== 0) {
            timeout = winapi.constants.INFINITE;
        }
        winapi.kernel32.WaitForSingleObject.async(processHandle, timeout, function (err, ret) {
            switch (ret) {
            case winapi.constants.WAIT_OBJECT_0:
                resolve();
                break;
            case winapi.constants.WAIT_TIMEOUT:
                resolve("timeout");
                break;
            case winapi.constants.WAIT_FAILED:
                throw windows.win32Error("WaitForSingleObject");
            default:
                reject();
                break;
            }
        });
    });
};

module.exports = windows;
