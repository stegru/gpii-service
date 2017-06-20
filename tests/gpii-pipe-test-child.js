var net = require("net");

console.log("child started");



var info = {
    env: process.env,
    currentDir: process.cwd(),

}

var pipeName = process.argv[2];
var connection = net.createConnection(pipeName, function () {
    console.log("connected");
    connection.write("hello\n");
});
