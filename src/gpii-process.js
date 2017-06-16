/* Manages the GPII user process.
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

var path = require("path"),
    fs = require("fs"),
    service = require("./service.js"),
    ipc = require("./gpii-ipc"),
    gpiiConnection = require("./gpii-connection.js"),
    windows = require("./windows.js");

var gpiiProcess = service.module("gpiiProcess");

// GPII pid.
gpiiProcess.pid = null;

// Currently starting GPII
gpiiProcess.startingGPII = false;

// Command to start GPII.
gpiiProcess.gpiiCommand = null;

/**
 * Called when the service has started.
 */
gpiiProcess.serviceStarted = function () {
    if (!service.isService || windows.isUserLoggedOn()) {
        gpiiProcess.startGPII();
    }
};

/**
 * The active console session has changed.
 */
gpiiProcess.sessionChange = function (eventType) {
    service.logDebug("session change", eventType);

    switch (eventType) {
    case "session-logon":
        gpiiProcess.startGPII();
        break;
    }
};

/**
 * Determines if there's an instance of GPII already running, that isn't managed by this service.
 */
gpiiProcess.checkGPII = function () {

    var token = windows.getDesktopUser();
    var pidFile;

    try {
        var dataDir = windows.getUserDataDir(token);
        if (!dataDir) {
            throw new Error("Unable to get the current user's data directory.");
        }
        pidFile = path.join(dataDir, "gpii.pid");
    } finally {
        if (token) {
            windows.winapi.kernel32.CloseHandle(token);
        }
    }

    var pid;

    try {
        // Get the old pid from the lock file
        var content = fs.readFileSync(pidFile, {encoding: "utf8"});
        pid = parseInt(content);
        // A "0" PID will never be GPII (and process.kill will succeed on Linux).
        if (pid) {
            // Check if it's still running.
            process.kill(pid, 0);
            // No error means the process is running.
            // TODO: Ensure the process really is GPII, and not just a re-use of the pid.
        }
    } catch (e) {
        // The pid file doesn't exist, or the pid isn't running
        pid = null;
    }

    return pid || null;
};

/**
 * Starts the GPII process in the context of the logged-in user.
 *
 */
gpiiProcess.startGPII = function () {

    if (gpiiProcess.checkGPII()) {
        // Another instance of GPII is running.
        service.log("Another GPII is already running");
    } else if (gpiiProcess.startingGPII) {
        // Another instance of GPII is running.
        service.log(new Error("GPII is already starting"));
    } else {
        gpiiProcess.startingGPII = true;

        gpiiConnection.listen().then(function () {
            var command = gpiiProcess.gpiiCommand;
            if (!command) {
                command = "\"" + process.argv[0] + "\" " + path.resolve(__dirname, "../../gpii-app/main.js");
            }

            var options = {
                // run as the current user if this process isn't a windows service.
                alwaysRun: !service.isService,
                env: {}
            };

            service.log("Starting GPII: " + command);

            ipc.startProcess(command, options).then(function (proc) {
                gpiiProcess.pid = proc.pid;
                gpiiProcess.pipe = proc.pipe;
                gpiiProcess.event("started-gpii", gpiiProcess.pid);
                gpiiProcess.pipe.on("data", function (data) {
                    service.log("ipc.data", data);
                });
            });

        }).lastly(function () {
            gpiiProcess.startingGPII = false;
        });
    }
};

gpiiProcess.stopGPII = function () {
    if (gpiiProcess.pid) {
        service.log("Stopping GPII");
        process.kill(gpiiProcess.pid);
    }
};


service.on("start", gpiiProcess.serviceStarted);
service.on("svc-sessionchange", gpiiProcess.sessionChange);

module.exports = gpiiProcess;
