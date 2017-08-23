"use strict";

process.on("uncaughtException", function (e) {
    setTimeout(process.exit, 3000);
    console.error(e);
});

console.log("child started");


var option = process.argv[2];


if (option === "inherited-pipe") {
    // For the gpii-ipc.startProcess test: A pipe should be at FD 3.
    var fs = require("fs");

    var pipeFD = 3;
    var input = fs.createReadStream(null, {fd: pipeFD});
    var output = fs.createWriteStream(null, {fd: pipeFD});
    output.write("FROM CHILD\n");

    var allData = "";
    input.on("data", function (data) {
        allData += data;
        if (allData.indexOf("\n") >= 0) {
            output.write("received: " + allData);
        }
    });

    input.on("error", function (err) {
        if (err.code === "EOF") {
            process.nextTick(process.exit);
        } else {
            console.log("input error", err);
            throw err;
        }
    });

} else {
    // For the gpii-ipc.execute test: send some information to the pipe named on the command line.
    var net = require("net");

    var info = {
        env: process.env,
        currentDir: process.cwd()
    };

    var pipeName = process.argv[2];
    var connection = net.createConnection(pipeName, function () {
        console.log("connected");
        connection.write(JSON.stringify(info));
        connection.end();
    });
}
