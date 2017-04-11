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
    logging = require("./logging.js"),
    winapi = require("./winapi.js"),
    path = require("path");

var windows = {
    winapi: winapi
};


function htons(n) {
    return ((n & 0xff) << 8) | ((n >> 8) & 0xff);
}

/**
 * Gets the pids of the processes on either side of a connection between the given ports on localhost.
 *
 * @param localPort {Number} The local port.
 * @param remotePort {Number} The remote port.
 * @return {Object} localPid and remotePid of the connection. null if there's no such connection found.
 */
windows.getTcpConnectionPids = function (localPort, remotePort) {

    var localhost = 0x0100007F;
    var local = {
        port: htons(localPort),
        address: localhost
    };
    var remote = {
        port: htons(remotePort),
        address: localhost
    };

    var sizeBuffer = ref.alloc(winapi.types.ULONG);

    // GetTcpTable2 is called first to get the required buffer size.
    var ret = winapi.iphlpapi.GetTcpTable2(ref.NULL, sizeBuffer, false);

    if (ret !== winapi.errorCodes.ERROR_INSUFFICIENT_BUFFER) {
        winapi.checkSuccess(ret, "GetTcpTable2");
        return null;
    }

    // Add extra space in case the table grew (the chance of this is slim, unless node stops to read this comment).
    var size = sizeBuffer.deref() + 100;
    sizeBuffer.writeUInt32LE(size);
    var tableBuffer = new Buffer(size);

    ret = winapi.iphlpapi.GetTcpTable2(tableBuffer, sizeBuffer, false);
    winapi.checkSuccess(ret, "GetTcpTable2 #2");

    var table = winapi.createMIBTcpTable2(tableBuffer);

    var rowCount = table.dwNumEntries;
    var pidsTogo = {
        localPid: undefined,
        remotePid: undefined
    };
    for (var r = 0; r < rowCount; r++) {
        var row = table.table[r];
        if (row.dwState === winapi.constants.MIB_TCP_STATE_ESTAB) {

            // "The upper 16 bits may contain uninitialized data." - MSDN
            var lp = row.dwLocalPort & 0xFFFF;
            var rp = row.dwRemotePort & 0xFFFF;

            if ((row.dwLocalAddr === local.address) && (row.dwRemoteAddr === remote.address)
                && (lp === local.port) && (rp === remote.port)) {
                // The local end of the connection
                pidsTogo.localPid = row.dwOwningPid;
                if (pidsTogo.remotePid) {
                    break;
                }
            } else if ((row.dwLocalAddr === remote.address) && (row.dwRemoteAddr === local.address)
                && (lp === remote.port) && (rp === local.port)) {
                // The remote end of the connection
                pidsTogo.remotePid = row.dwOwningPid;
                if (pidsTogo.localPid) {
                    break;
                }
            }
        }
    }

    return pidsTogo;
};

/**
 * Executes a command in the context of the console user.
 *
 * https://blogs.msdn.microsoft.com/winsdk/2013/04/30/how-to-launch-a-process-interactively-from-a-windows-service/
 *
 * @param command {String} The command to execute.
 * @param options {Object} [optional] Options
 * @param options.alwaysRun {boolean} true to run as the current user, if the console user token could not be received.
 * @param options.env {object} Additional environment key-value pairs.
 * @param options.currentDir {string} Current directory for the new process.
 *
 * @return {Number} The PID of the new process.
 */
windows.runAsUser = function (command, options) {
    options = Object.assign({}, options);

    var userToken = windows.getDesktopUser();
    if (userToken.error || !userToken) {
        // In most cases it would fail due to lack of privileges, which implies not running as a service and it should
        // be ok to invoke this command as the same user. However, the edge case of it failing for some other reason
        // would cause something to be executed as the LocalSystem account even though that's undesired.
        if (!options.alwaysRun) {
            throw new Error("Unable to get the current desktop user (error=" + userToken.error + ")");
        }

        logging.warn("winapi.runAsUser invoking as current user.");
        userToken = 0;
    }

    var pidTogo = null;
    try {

        // Create an environment block for the user. Without this, the new process will take the environment variables of
        // this process (causing GPII to use the incorrect data directory).
        var env = windows.getEnv(userToken);
        if (options.env) {
            for (var name in options.env) {
                if (options.env.hasOwnProperty(name)) {
                    var value = options.env[name];
                    env.push(name + "=" + value);
                }
            }
        }

        // Convert the environment block into a C string array.
        var envString = env.join("\0") + "\0";
        var envBuf = winapi.stringToWideChar(envString);

        var commandBuf = winapi.stringToWideChar(command);
        var creationFlags = winapi.constants.CREATE_UNICODE_ENVIRONMENT | winapi.constants.CREATE_NEW_CONSOLE;

        var currentDirectory = options.currentDir
            ? winapi.stringToWideChar(options.currentDir)
            : ref.NULL;

        var startupInfo = new winapi.STARTUPINFOEX();
        startupInfo.ref().fill(0);
        startupInfo.cb = winapi.STARTUPINFOEX.size;
        startupInfo.lpDesktop = winapi.stringToWideChar("winsta0\\default");

        var processInfo = new winapi.PROCESS_INFORMATION();
        processInfo.ref().fill(0);

        var ret = winapi.advapi32.CreateProcessAsUserW(userToken, ref.NULL, commandBuf, ref.NULL, ref.NULL,
            0, creationFlags, envBuf, currentDirectory, startupInfo.ref(), processInfo.ref());

        winapi.kernel32.CloseHandle(processInfo.hProcess);
        winapi.kernel32.CloseHandle(processInfo.hThread);

        if (!ret) {
            throw winapi.error("CreateProcessAsUser");
        }

        pidTogo = processInfo.dwProcessId;
    } finally {
        if (userToken) {
            winapi.kernel32.CloseHandle(userToken);
        }
    }

    return pidTogo;
};

/**
 * Determine if this process is running as a service.
 *
 * @return {Boolean} true if running as a service.
 */
windows.isService = function () {
    return require("./service.js").isService;
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
 */
windows.isParentPid = function (childPid, parentPid) {

};

module.exports = windows;
