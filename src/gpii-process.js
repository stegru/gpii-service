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
    windows = require("./windows.js");

var gpiiProcess = service.module("gpiiProcess");

// GPII pid.
gpiiProcess.pid = null;

// Currently starting GPII
gpiiProcess.startingGPII = false;

// Command to start GPII.
gpiiProcess.gpiiCommand = service.args.gpii || "c:\\program files (x86)\\GPII\\windows\\gpii-app.exe";

// When GPII was started (process.hrtime).
gpiiProcess.lastStart = null;

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
        // User just logged on.
        gpiiProcess.startGPII();
        break;
    }
};

/**
 * Determines if a process identified by the given pid is running.
 *
 * @param pid {Number} Process to check
 * @return {boolean} True if the pid is a running process.
 */
gpiiProcess.isProcessRunning = function (pid) {
    var running = false;
    if (pid) {
        try {
            // Check if it's still running.
            process.kill(pid, 0);
            // No error means the process is running.
            running = true;
            // TODO: Ensure the process really is GPII, and not just a re-use of the pid.
        } catch (e) {
            // Nothing.
        }
    }

    return running;
};

/**
 * Reads GPII's pid file
 *
 * @return {Number} The pid in the file, or null if the file doesn't exist.
 */
gpiiProcess.readPidFile = function () {
    var token = windows.getDesktopUser();
    var pidFile;

    try {
        // Get the APPDATA path for the desktop user.
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
    } catch (e) {
        // The pid file doesn't exist
        pid = null;
    }

    return pid;
};

/**
 * Determines if there's an instance of GPII already running, that isn't managed by this service.
 *
 * @return The pid of the GPII process, otherwise null.
 */
gpiiProcess.checkGPII = function () {
    var pid = gpiiProcess.readPidFile();
    return (pid && gpiiProcess.isProcessRunning(pid)) ? pid : null;
};

/**
 * Starts the GPII process in the context of the logged-in user.
 */
gpiiProcess.startGPII = function () {

    var running = gpiiProcess.startingGPII || gpiiProcess.checkGPII();

    if (running) {
        service.logWarn("GPII is already running.");
    } else {
        gpiiProcess.startingGPII = true;
        gpiiProcess.lastStart = process.hrtime();

        var command = gpiiProcess.gpiiCommand;
        if (!command) {
            command = "\"" + process.argv[0] + "\" " + path.resolve(__dirname, "../../gpii-app/main.js");
        }

        var options = {
            // If this process isn't a windows service, then run as the current user.
            alwaysRun: !service.isService,
            env: {}
        };

        service.log("Starting GPII: " + command);

        ipc.startProcess(command, options).then(function (proc) {
            gpiiProcess.pid = proc.pid;
            gpiiProcess.pipe = proc.pipe;

            windows.waitForProcessTermination(proc.processHandle).then(gpiiProcess.gpiiStopped);

            // Start the comms with GPII
            // TODO: GPII doesn't have this implemented yet
            // gpiiProcess.messagingSession = messaging.createSession(proc.pipe, "gpii");
            // gpiiProcess.messagingSession.on("close", gpiiProcess.stopGPII);

            gpiiProcess.event("started-gpii", gpiiProcess.pid);
            gpiiProcess.startingGPII = false;
        }, function (err) {
            service.logError(err);
        });
    }
};

/**
 * Stops the GPII process.
 */
gpiiProcess.stopGPII = function () {
    if (gpiiProcess.pid) {
        service.log("Stopping GPII");
        process.kill(gpiiProcess.pid);
        gpiiProcess.pid = null;
    }
};

/**
 * Called when the GPII process has been stopped.
 * If it wasn't intentional, then restart it unless it's failed to start a number of consecutive times. A running time
 * of under 20 seconds is deemed as a failure to start.
 */
gpiiProcess.gpiiStopped = function () {
    service.log("GPII stopped");

    // If the pid file wasn't removed, then it died unintentionally.
    var pid = gpiiProcess.readPidFile();
    var crashed = (pid && pid === gpiiProcess.pid);

    gpiiProcess.pid = null;

    if (crashed) {
        var restart = true;
        // Check if it's failing to start - if it's been running for less than 20 seconds.
        var timespan = process.hrtime(gpiiProcess.lastStart);
        var seconds = timespan[0];
        if (seconds > 20) {
            gpiiProcess.restartCount = 0;
        } else {
            service.logWarn("GPII failed at start.");
            gpiiProcess.restartCount = (gpiiProcess.restartCount || 0) + 1;
            if (gpiiProcess.restartCount > 2) {
                // Crashed at the start too many times.
                service.logError("Unable to start GPII.");
                restart = false;
            }
        }

        if (restart) {
            // Throttle the re-start rate, increasing 10 seconds each time.
            setTimeout(gpiiProcess.startGPII, gpiiProcess.restartCount * 10000 + 1000);
        }
    }
};

// Listen for service start and session change.
service.on("start", gpiiProcess.serviceStarted);
service.on("svc-sessionchange", gpiiProcess.sessionChange);

module.exports = gpiiProcess;
