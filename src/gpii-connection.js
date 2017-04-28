/* Handles the connection between the service and GPII user process.
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

var service = require("./service.js"),
    net = require("net"),
    JsonSocket = require("json-socket"),
    Promise = require("bluebird"),
    windows = require("./windows.js");

var gpiiConnection = service.module("gpiiConnection");

gpiiConnection.pid = null;
gpiiConnection.socket = null;

/**
 * Start listening for a connection from the GPII process.
 *
 * @return {Promise} A promise that resolves with the url, when the socket is bound.
 */
gpiiConnection.listen = function () {

    return new Promise(function (resolve) {
        gpiiConnection.server = net.createServer();
        gpiiConnection.server.on("connection", gpiiConnection.connected);

        gpiiConnection.server.listen(0, "127.0.0.1", function () {
            var addr = gpiiConnection.server.address();
            var url = "tcp://" + addr.address + ":" + addr.port;
            resolve(url);
        });
    });
};

/**
 * Something has connected to the service.
 *
 * @param socket {Socket} The socket.
 * @return {boolean} true if the connection is good.
 */
gpiiConnection.connected = function (socket) {

    var valid = gpiiConnection.checkConnection(socket);
    if (!valid) {
        service.logWarn("Rejected connection from unknown source.");
        socket.end();
        return;
    }

    // Stop listening
    gpiiConnection.server.close();

    service.log("Accepted connection from GPII process.");
    service.socket = new JsonSocket(socket);
    service.socket.on("message", gpiiConnection.gotMessage);
    service.socket.on("close", gpiiConnection.connectionClosed);

    gpiiConnection.event("connected");
};

/**
 * A message has been received from the GPII process.
 *
 * @param message {Object}
 */
gpiiConnection.gotMessage = function (message) {

    switch (message.type) {
    case "error":
        break;
    case "ping":
        gpiiConnection.sendMessage("pong", message.payload);
        break;
    }

    gpiiConnection.event("message." + message.type, message.payload);
};

/**
 * Send a message to the GPII process.
 *
 * @param type {String} The type of message.
 * @param payload {Object} [optional] The data to send.
 */
gpiiConnection.sendMessage = function (type, payload) {
    // TODO: A way to wait for a response.
    gpiiConnection.socket.sendMessage({
        type: type,
        payload: payload
    });
};

/**
 * Checks if the given socket has the child process on the other end, by inspecting the TCP table.
 *
 * @param socket {Socket} The socket.
 * @return {boolean} true if the child process is at the remote end of the socket.
 */
gpiiConnection.checkConnection = function (socket) {

    var pids = windows.getTcpConnectionPids(socket.localPort, socket.remotePort);

    var success = pids && (pids.localPid === process.pid) && pids.remotePid
        && ((pids.remotePid === gpiiConnection.pid) || windows.isParentPid(gpiiConnection.pid, pids.remotePid));
    return success;

};

module.exports = gpiiConnection;
