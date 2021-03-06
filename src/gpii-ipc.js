/* IPC for GPII.
 * Starts a process (as another user) with a communications channel.
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

/*
How it works:
- A (randomly) named pipe is created and connected to.
- The child process is created, with one end of the pipe passed to it (using c-runtime file descriptor inheritance).
- The child process is then able to use the pipe as it would with any file descriptor.
- The parent (this process) can trust the client end of the pipe because it opened it itself.
- See GPII-2399.

The server (this process) end of the pipe is a node IPC socket and is created by node. The client end of the pipe can
also be a node socket, however due to how the child process is being started (as another user), node's exec/spawn can't
be used and the file handle for the pipe needs to be known. For this reason, the child-end of the pipe needs to be
created using the Win32 API. This doesn't affect how the client receives the pipe.

*/

var ref = require("ref"),
    net = require("net"),
    crypto = require("crypto"),
    Promise = require("bluebird"),
    windows = require("./windows.js"),
    logging = require("./logging.js");

var winapi = windows.winapi;
var ipc = exports;

/**
 * Starts a process as the current desktop user, with an open pipe inherited.
 *
 * @param command {String} The command to execute.
 * @param options {Object} [optional] Options
 * @param options.alwaysRun {boolean} true to run as the current user, if the console user token could not be received.
 * @param options.env {object} Additional environment key-value pairs.
 * @param options.currentDir {string} Current directory for the new process.
 * @return {Promise}
 */
ipc.startProcess = function (command, options) {
    options = Object.assign({}, options);
    var pipeName = ipc.generatePipeName();

    // Create the pipe, and pass it to a new process.
    return ipc.createPipe(pipeName).then(function (pipePair) {
        options.inheritHandles = [pipePair.clientHandle];
        var processInfo = ipc.execute(command, options);

        return {
            pipe: pipePair.serverConnection,
            pid: processInfo.pid,
            processHandle: processInfo.handle
        };
    });
};

/**
 * Generates a named-pipe name.
 *
 * @return {string} The name of the pipe.
 */
ipc.generatePipeName = function () {
    var pipeName = "\\\\.\\pipe\\gpii-" + crypto.randomBytes(18).toString("base64").replace(/[\\/]/g, ".");
    logging.debug("Pipe name:", pipeName);
    return pipeName;
};

/**
 * Open a named pipe, and connect to it.
 *
 * @param pipeName {String} Name of the pipe.
 * @return {Promise} A promise resolving when the pipe has been connected to, with an object containing both ends to the
 * pipe.
 */
ipc.createPipe = function (pipeName) {
    return new Promise(function (resolve, reject) {
        var pipe = {
            serverConnection: null,
            clientHandle: null
        };

        var server = net.createServer();

        server.maxConnections = 1;
        server.on("connection", function (connection) {
            logging.debug("ipc got connection");
            pipe.serverConnection = connection;
            server.close();
            if (pipe.clientHandle) {
                resolve(pipe);
            }
        });

        server.on("error", function (err) {
            //logging.log("ipc server error", err);
            reject(err);
        });

        server.listen(pipeName, function () {
            ipc.connectToPipe(pipeName).then(function (pipeHandle) {
                logging.debug("ipc connected to pipe");
                pipe.clientHandle = pipeHandle;
                if (pipe.serverConnection) {
                    resolve(pipe);
                }
            }, reject);
        });
    });
};

/**
 * Connect to a named pipe.
 *
 * @param pipeName {String} Name of the pipe.
 * @return {Promise} Resolves when the connection is made, with the win32 handle of the pipe.
 */
ipc.connectToPipe = function (pipeName) {
    return new Promise(function (resolve, reject) {
        var pipeNameBuf = winapi.stringToWideChar(pipeName);
        winapi.kernel32.CreateFileW.async(
            pipeNameBuf, winapi.constants.GENERIC_READWRITE, 0, ref.NULL, winapi.constants.OPEN_EXISTING, 0, 0,
            function (err, pipeHandle) {
                if (err) {
                    reject(err);
                } else if (pipeHandle === winapi.constants.INVALID_HANDLE_VALUE || !pipeHandle) {
                    reject(winapi.error("CreateFile"));
                } else {
                    resolve(pipeHandle);
                }
            });
    });
};

/**
 * Executes a command in the context of the console user.
 *
 * https://blogs.msdn.microsoft.com/winsdk/2013/04/30/how-to-launch-a-process-interactively-from-a-windows-service/
 *
 * @param command {String} The command to execute.
 * @param options {Object} [optional] Options
 * @param options.alwaysRun {boolean} true to run as the current user (what this process is running as), if the console
 * user token could not be received. Should only be true if not running as a service.
 * @param options.env {object} Additional environment key-value pairs.
 * @param options.currentDir {string} Current directory for the new process.
 * @param options.inheritHandles {Number[]} An array of win32 file handles for the child to inherit.
 *
 * @return {Object} The pid and handle of the new process.
 */
ipc.execute = function (command, options) {
    options = Object.assign({}, options);

    var userToken = windows.getDesktopUser();
    if (!userToken) {
        // There is no token for this session - perhaps no one is logged on, or is in the lock-screen (screen saver).
        // Continuing could cause something to be executed as the LocalSystem account, which may be undesired.
        if (!options.alwaysRun) {
            throw new Error("Unable to get the current desktop user (error=" + userToken.error + ")");
        }

        logging.warn("ipc.startProcess invoking as current user.");
        userToken = 0;
    }

    var processInfo = {
        pid: null,
        handle: null
    };

    try {

        // Create a user-specific environment block. Without this, the new process will take the environment variables
        // of this process, causing GPII to use the incorrect data directory.
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

        if (options.inheritHandles) {
            var STARTF_USESTDHANDLES = 0x00000100;
            startupInfo.dwFlags = STARTF_USESTDHANDLES;

            // Get the standard handles.
            startupInfo.hStdInput = winapi.kernel32.GetStdHandle(winapi.constants.STD_INPUT_HANDLE);
            startupInfo.hStdOutput = winapi.kernel32.GetStdHandle(winapi.constants.STD_OUTPUT_HANDLE);
            startupInfo.hStdError = winapi.kernel32.GetStdHandle(winapi.constants.STD_ERROR_HANDLE);

            // Add the handles to the lpReserved2 structure. This is how the CRT passes handles to a child. When the
            // child starts it is able to use the file as a normal file descriptor.
            // Node uses this same technique: https://github.com/nodejs/node/blob/master/deps/uv/src/win/process.c#L1048
            var allHandles = [startupInfo.hStdInput, startupInfo.hStdOutput, startupInfo.hStdError];
            allHandles.push.apply(allHandles, options.inheritHandles);

            var handles = winapi.createHandleInheritStruct(allHandles.length);
            handles.ref().fill(0);
            handles.length = allHandles.length;

            for (var n = 0; n < allHandles.length; n++) {
                handles.flags[n] = winapi.constants.FOPEN;
                handles.handle[n] = allHandles[n];
                // Mark the handle as inheritable.
                winapi.kernel32.SetHandleInformation(
                    allHandles[n], winapi.constants.HANDLE_FLAG_INHERIT, winapi.constants.HANDLE_FLAG_INHERIT);
            }

            startupInfo.cbReserved2 = handles["ref.buffer"].byteLength;
            startupInfo.lpReserved2 = handles.ref();
        }
        var processInfoBuf = new winapi.PROCESS_INFORMATION();
        processInfoBuf.ref().fill(0);

        var ret = winapi.advapi32.CreateProcessAsUserW(userToken, ref.NULL, commandBuf, ref.NULL, ref.NULL,
            !!options.inheritHandles, creationFlags, envBuf, currentDirectory, startupInfo.ref(), processInfoBuf.ref());

        if (!ret) {
            throw winapi.error("CreateProcessAsUser");
        }

        processInfo.pid = processInfoBuf.dwProcessId;
        processInfo.handle = processInfoBuf.hProcess;

        winapi.kernel32.CloseHandle(processInfoBuf.hThread);

    } finally {
        if (userToken) {
            winapi.kernel32.CloseHandle(userToken);
        }
    }

    return processInfo;
};
