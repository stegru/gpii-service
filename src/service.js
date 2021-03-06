/* The GPII windows service.
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
    events = require("events"),
    logging = require("./logging.js"),
    parseArgs = require("minimist");

var service = new events.EventEmitter();

// true if the process running as a Windows Service.
service.isService = false;

service.args = parseArgs(process.argv.slice(2));

/**
 * Called when the service has just started.
 */
service.start = function () {
    service.isService = os_service.getState() !== "stopped";
    // Register the control codes that the service would be interested in.
    os_service.acceptControl(["start", "stop", "shutdown", "sessionchange"], true);
    // Handle all registered control codes.
    os_service.on("*", service.controlHandler);
    os_service.on("stop", service.stop);

    service.event("start");
    service.log("service start");
};

/**
 * Stop the service.
 */
service.stop = function () {
    service.event("stop");
    os_service.stop();
};

/**
 * Log something
 */
service.log = logging.log;
service.logFatal = logging.fatal;
service.logError = logging.error;
service.logWarn = logging.warn;
service.logDebug = logging.debug;

/**
 * Called when the service receives a control code. This is what's used to detect a shutdown, service stop, or Windows
 * user log-in/out.
 *
 * See https://msdn.microsoft.com/library/ms683241
 *
 * @param controlName Name of the control code.
 * @param eventType Event type.
 */
service.controlHandler = function (controlName, eventType) {
    service.logDebug("Service control: ", controlName, eventType);
    service.event("svc-" + controlName, eventType);
};

/**
 * Creates a new (or returns an existing) module.
 *
 * @param name {String} Module name
 * @param initial {Object} [optional] An existing object to add on to.
 * @return {Object}
 */
service.module = function (name, initial) {
    var mod = service.modules[name];
    if (!mod) {
        mod = initial || {};
        mod.moduleName = name;
        mod.event = function (event, arg1, arg2) {
            var eventName = name === "service" ? event : name + "." + event;
            service.logDebug("EVENT", eventName, arg1, arg2);
            service.emit(eventName, arg1, arg2);
        };
        service.modules[name] = mod;
    }
    return mod;
};
service.modules = { };
service.module("service", service);

module.exports = service;
