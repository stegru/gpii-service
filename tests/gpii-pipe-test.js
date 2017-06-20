"use strict";

var jqUnit = require("node-jqunit"),
    gpiiPipe = require("../src/gpii-pipe.js");

jqUnit.module("GPII pipe tests");

// Tests generatePipeName
jqUnit.test("generatePipeName", function () {
    var pipePrefix = "\\\\.\\pipe\\";

    var fullName = gpiiPipe.generatePipeName();

    // Pipe Names: https://msdn.microsoft.com/library/aa365783
    jqUnit.assertTrue("Pipe path must begin with " + pipePrefix, fullName.startsWith(pipePrefix));
    jqUnit.assertTrue("Entire pipe name must <= 256 characters", fullName.length <=  256);

    var pipeName = fullName.substr(pipePrefix.length);
    jqUnit.assertTrue("Pipe name must at least 1 character", pipeName.length > 0);
    // "any character other than a backslash, including numbers and special characters"
    // This also includes '/' because node swaps it with '\'.
    jqUnit.assertFalse("Pipe name must not contain a slash or blackslash", pipeName.match(/[\\\/]/));

    // The names are random, so each call should return something different.
    var pipe2 = gpiiPipe.generatePipeName();
    jqUnit.assertNotEquals("Generated pipe name must not be constant", fullName, pipe2);

});

// Tests createPipe and connectToPipe.
jqUnit.asyncTest("createPipe + connectToPipe", function () {

});
