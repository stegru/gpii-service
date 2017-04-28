/* Bootstrap for the GPII windows service.
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

var os_service = require("os-service"),
    yargs = require("yargs"),
    fs = require("fs"),
    path = require("path"),
    logging = require("./src/logging.js");

var startMode = yargs.argv.mode;
var isService = startMode === "service";
var dataDir = path.join(process.env.ProgramData, "GPII");

try {
    fs.mkdirSync(dataDir);
} catch (e) {
    if (e.code !== "EEXIST") {
        throw e;
    }
}

// Set up the logging early - there's no way to capture stdout for windows services.
if (isService) {
    var logFile = path.join(dataDir, "gpii-service.log");
    logging.setFile(logFile);
}

logging.logLevel = logging.levels.DEBUG;

process.on("uncaughtException", function (err) {
    logging.log(err, (err && err.stack) ? err.stack : err);
});

var startModes = {
    /**
     * Install the service. This needs to be ran as Administrator.
     *
     * @param serviceName {String} [optional] Name of the service (default: "gpii-service").
     */
    install: function (serviceName) {
        serviceName = serviceName || "gpii-service";

        var programArgs = yargs.argv.programArgs
            ? yargs.argv.programArgs.split(/,+/)
            : [];

        var nodeArgs = yargs.argv.nodeArgs
            ? yargs.argv.nodeArgs.split(/,+/)
            : null;

        programArgs.push("--mode=service");

        if (yargs.argv.gpii) {
            programArgs.push("--gpii=" + yargs.argv.gpii);
        } else {
            var gpiiPath = getGPIIPath();
            programArgs.push(gpiiPath);
        }

        console.log("Installing");

        os_service.add(serviceName, {
            nodeArgs: nodeArgs,
            programArgs: programArgs,
            displayName: "GPII Service"
        }, function (error) {
            console.log(error || "Success");
        });
    },

    /**
     * Removes the service. This needs to be ran as Administrator, and the service should be already stopped.
     *
     * @param serviceName {String} [optional] Name of the service (default: "gpii-service").
     */
    uninstall: function (serviceName) {
        serviceName = serviceName || "gpii-service";

        console.log("Uninstalling");
        os_service.remove(serviceName, function (error) {
            console.log(error || "Success");
        });
    },

    /**
     * Called when the service has started.
     */
    service: function () {
        // Running the service
        os_service.on("start", runService);
        os_service.run(fs.createWriteStream(logging.logFile));
    }
};

var startFunction = startModes[startMode];
if (startFunction) {
    startFunction();
} else {
    runService();
}

/**
 * Start the service.
 */
function runService() {
    require("./src/main.js");
}

/**
 * Detect where GPII is.
 */
function getGPIIPath() {
    var getEntryJs = function (dir) {
        var parentPackage = require("../package.json");

    };

}

