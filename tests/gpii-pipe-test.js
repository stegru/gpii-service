"use strict";

var jqUnit = require("node-jqunit"),
    net = require("net"),
    path = require("path"),
    gpiiPipe = require("../src/gpii-pipe.js");

var teardowns = [];

jqUnit.module("GPII pipe tests", {
    teardown: function () {
        while (teardowns.length) {
            teardowns.pop()();
        }
    }
});
/*
// Tests generatePipeName
jqUnit.test("Test generatePipeName", function () {
    var pipePrefix = "\\\\.\\pipe\\";


    // Because the names are random, check against a sample of them to avoid lucky results.
    var sampleSize = 300;
    var pipeNames = [];
    for (var n = 0; n < sampleSize; n++) {
        pipeNames.push(gpiiPipe.generatePipeName());
    }

    for (var pipeIndex = 0; pipeIndex < sampleSize; pipeIndex++) {
        var fullName = pipeNames[pipeIndex];

        // Pipe Names: https://msdn.microsoft.com/library/aa365783
        jqUnit.assertTrue("Pipe path must begin with " + pipePrefix, fullName.startsWith(pipePrefix));
        jqUnit.assertTrue("Entire pipe name must <= 256 characters", fullName.length <= 256);

        var pipeName = fullName.substr(pipePrefix.length);
        jqUnit.assertTrue("Pipe name must at least 1 character", pipeName.length > 0);
        // "any character other than a backslash, including numbers and special characters"
        // This also includes '/' because node swaps it with '\'.
        jqUnit.assertFalse("Pipe name must not contain a slash or blackslash", pipeName.match(/[\\\/]/));

        // There shouldn't be any repeated names in a sample size of this size.
        var dup = pipeNames.indexOf(fullName) !== pipeIndex;
        jqUnit.assertFalse("There shouldn't be any repeated pipe names", dup);
    }

});

// Tests a successful connectToPipe.
jqUnit.asyncTest("Test connectToPipe", function () {
    jqUnit.expect(6);

    var pipeName = gpiiPipe.generatePipeName();

    // The invocation order of the callbacks for client or server connection varies.
    var serverConnected = false,
        clientConnected = false;
    var connected = function () {
        if (serverConnected && clientConnected) {
            jqUnit.start();
        }
    };

    // Create a server to listen for the connection.
    var server = net.createServer();
    server.on("connection", function () {
        jqUnit.assert("Got connection");
        serverConnected = true;
        connected();
    });

    server.listen(pipeName, function () {
        var promise = gpiiPipe.connectToPipe(pipeName);

        jqUnit.assertNotNull("connectToPipe must return non-null", promise);
        jqUnit.assertEquals("connectToPipe must return a promise", "function", typeof(promise.then));

        promise.then(function (pipeHandle) {
            jqUnit.assert("connectToPipe promise resolved (connection worked)");
            jqUnit.assertTrue("pipeHandle must be something", !!pipeHandle);
            jqUnit.assertFalse("pipeHandle must be a number", isNaN(pipeHandle));
            clientConnected = true;
            connected();
        });
    });
});

// Make connectToPipe fail.
jqUnit.asyncTest("Test connectToPipe failures", function () {

    var pipeNames = [
        // A pipe that doesn't exist.
        gpiiPipe.generatePipeName(),
        // A pipe with a bad name.
        gpiiPipe.generatePipeName() + "\\",
        // Badly formed name
        "invalid",
        null
    ];

    jqUnit.expect(pipeNames.length * 3);

    var testPipes = function (pipeNames) {
        var pipeName = pipeNames.shift();
        console.log("Checking bad pipe name:", pipeName);
        var promise = gpiiPipe.connectToPipe(pipeName);
        jqUnit.assertNotNull("connectToPipe must return non-null", promise);
        jqUnit.assertEquals("connectToPipe must return a promise", "function", typeof(promise.then));

        promise.then(function () {
            jqUnit.fail("connectToPipe promise resolved (connection should not have worked)");
        }, function () {
            jqUnit.assert("connectToPipe promise should reject");

            if (pipeNames.length > 0) {
                testPipes(pipeNames);
            } else {
                jqUnit.start();
            }
        });
    };

    testPipes(Array.from(pipeNames));
});

jqUnit.asyncTest("Test createPipe", function () {
    var INVALID_HANDLE = -1 >>> 0;

    jqUnit.expect(8);

    var pipeName = gpiiPipe.generatePipeName();

    var promise = gpiiPipe.createPipe(pipeName);
    jqUnit.assertNotNull("createPipe must return non-null", promise);
    jqUnit.assertEquals("createPipe must return a promise", "function", typeof(promise.then));

    promise.then(function (pipePair) {
        jqUnit.assertTrue("createPipe should have resolved with a value", !!pipePair);

        jqUnit.assertTrue("serverConnection should be set", !!pipePair.serverConnection);
        jqUnit.assertTrue("clientHandle should be set", !!pipePair.clientHandle);

        jqUnit.assertTrue("serverConnection should be a Socket", pipePair.serverConnection instanceof net.Socket);
        jqUnit.assertFalse("clientHandle should be a number", isNaN(pipePair.clientHandle));
        jqUnit.assertNotEquals("clientHandle should be a valid handle", pipePair.clientHandle, INVALID_HANDLE);

        jqUnit.start();
    }, function (err) {
        console.error(err);
        jqUnit.fail("createPipe should have resolved");
    });
});

jqUnit.asyncTest("Test createPipe fails", function () {

    var existingPipe = gpiiPipe.generatePipeName();

    var pipeNames = [
        // A pipe that exists.
        existingPipe,
        // Badly formed name
        "invalid",
        null
    ];

    jqUnit.expect(pipeNames.length * 3);

    var testPipes = function (pipeNames) {
        var pipeName = pipeNames.shift();
        console.log("Checking bad pipe name:", pipeName);

        var promise = gpiiPipe.createPipe(pipeName);
        jqUnit.assertNotNull("createPipe must return non-null", promise);
        jqUnit.assertEquals("createPipe must return a promise", "function", typeof(promise.then));

        promise.then(function () {
            jqUnit.fail("createPipe should not have resolved");
        }, function (err) {
            console.error(err);
            jqUnit.assert("createPipe should reject");

            if (pipeNames.length > 0) {
                testPipes(pipeNames);
            } else {
                jqUnit.start();
            }
        });
    };

    // Create a pipe to see what happens if another pipe is created with the same name.
    gpiiPipe.createPipe(existingPipe).then(function () {
        // run the tests.
        testPipes(Array.from(pipeNames));
    }, function (err) {
        console.error(err);
        jqUnit.fail("initial createPipe failed");
    });

});
*/

function readPipe(pipeName, callback) {
    var buffer = "";
    var server = net.createServer(function (con) {
        con.setEncoding("utf8");
        buffer = "";

        con.on("error", function (err) {
            console.error(err);
            callback(err);
        });
        con.on("data", function (data) {
            buffer += data;
        });
        con.on("close", function () {
            callback(null, buffer);
        });
    });
    server.listen(pipeName);
    server.on("error", function (err) {
        console.error(err);
        jqUnit.fail("Error with the pipe server");
    });
}

jqUnit.asyncTest("Test execute", function () {

    // Kill any run-away processes.
    var runningPids = [];
    teardowns.push(function() {
        try {
            var pid = runningPids.shift();
            if (pid) {
                process.kill(pid);
            }
        } catch (e) {
            // Ignored.
        }
    });

    var script = path.join(__dirname, "gpii-pipe-test-child.js");
    // re-used:
    var command,
        proc;

    // Create a pipe so the child process can talk back.
    var pipeName = gpiiPipe.generatePipeName();
    readPipe(pipeName, checkReturn);

    command = [ "node", script, pipeName ].join(" ");
    console.log("Executing", command);
    proc = gpiiPipe.execute(command);

    jqUnit.assertTrue("execute should return something", !!proc);
    jqUnit.assertEquals("execute should return an object", "object", typeof(proc));
    jqUnit.assertEquals("pid should be numeric", "number", typeof(proc.pid));
    jqUnit.assertEquals("handle should be numeric", "number", typeof(proc.handle));

    jqUnit.assertTrue("pid should be set", !!proc.pid);
    jqUnit.assertTrue("handle should be set", !!proc.handle);

    function checkReturn(err, data) {
        if (err) {
            console.error(err);
            jqUnit.fail("The was something wrong with the pipe");
        }
        console.log("got data", data);

        jqUnit.start();
    };

    runningPids.push(proc.pid);



});