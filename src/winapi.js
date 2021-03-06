/* Windows API interface.
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

var ffi = require("ffi"),
    ref = require("ref"),
    Struct = require("ref-struct"),
    arrayType = require("ref-array");

var winapi = {};

winapi.constants = {
    MAX_PATH: 260,
    // dwCreationFlags, https://msdn.microsoft.com/library/ms684863
    CREATE_UNICODE_ENVIRONMENT: 0x00000400,
    CREATE_NEW_CONSOLE: 0x00000010,
    DETACHED_PROCESS: 0x00000008,

    MIB_TCP_STATE_ESTAB: 5,

    // https://msdn.microsoft.com/library/aa374905
    TOKEN_ASSIGN_PRIMARY: 0x0001,
    TOKEN_DUPLICATE: 0x0002,
    TOKEN_QUERY: 0x0008,

    // CreateToolhelp32Snapshot; https://msdn.microsoft.com/library/ms682489
    TH32CS_SNAPPROCESS: 0x00000002,

    INVALID_HANDLE_VALUE: 0xFFFFFFFF, // Really (uint)-1

    // https://msdn.microsoft.com/library/ms683231
    STD_INPUT_HANDLE: -10 >>> 0,
    STD_OUTPUT_HANDLE: -11 >>> 0,
    STD_ERROR_HANDLE: -12 >>> 0,

    HANDLE_FLAG_INHERIT: 1,

    // https://msdn.microsoft.com/library/aa446632
    GENERIC_READ: 0x80000000,
    GENERIC_READWRITE: 0xC0000000, // GENERIC_READ | GENERIC_WRITE
    // https://msdn.microsoft.com/library/aa363858
    OPEN_EXISTING: 3,
    // file handle open (from CRT)
    FOPEN: 0x1,

    // https://msdn.microsoft.com/library/ms687032
    INFINITE: 0xFFFFFFFF,
    WAIT_OBJECT_0: 0,
    WAIT_TIMEOUT: 0x102,
    WAIT_FAILED: 0xFFFFFFFF


};

winapi.errorCodes = {
    ERROR_SUCCESS: 0,
    ERROR_ACCESS_DENIED: 5,
    ERROR_INSUFFICIENT_BUFFER: 122,
    ERROR_NO_TOKEN: 1008,
    ERROR_PRIVILEGE_NOT_HELD: 1314
};

winapi.types = {
    BOOL: "int",
    HANDLE: "uint",
    PHANDLE: "void*",
    LP: "void*",
    SIZE_T: "ulong",
    WORD: "uint16",
    DWORD: "ulong",
    LONG: "long",
    ULONG: "ulong",
    PULONG: "ulong*",
    LPTSTR: "char*",
    Enum: "uint"
};
var t = winapi.types;

// https://msdn.microsoft.com/library/bb485761
winapi.MIB_TCPROW2 = new Struct([
    [t.DWORD, "dwState"],
    [t.DWORD, "dwLocalAddr"],
    [t.DWORD, "dwLocalPort"],
    [t.DWORD, "dwRemoteAddr"],
    [t.DWORD, "dwRemotePort"],
    [t.DWORD, "dwOwningPid"],
    [t.Enum, "dwOffloadState"]
]);

// https://msdn.microsoft.com/library/ms686329
winapi.STARTUPINFOEX = new Struct([
    [t.DWORD, "cb"],
    [t.LPTSTR, "lpReserved"],
    [t.LPTSTR, "lpDesktop"],
    [t.LPTSTR, "lpTitle"],
    [t.DWORD, "dwX"],
    [t.DWORD, "dwY"],
    [t.DWORD, "dwXSize"],
    [t.DWORD, "dwYSize"],
    [t.DWORD, "dwXCountChars"],
    [t.DWORD, "dwYCountChars"],
    [t.DWORD, "dwFillAttribute"],
    [t.DWORD, "dwFlags"],
    [t.WORD, "wShowWindow"],
    [t.WORD, "cbReserved2"],
    [t.LP, "lpReserved2"],
    [t.HANDLE, "hStdInput"],
    [t.HANDLE, "hStdOutput"],
    [t.HANDLE, "hStdError"],
    [t.LP, "lpAttributeList"]
]);

// https://msdn.microsoft.com/library/ms684873
winapi.PROCESS_INFORMATION = new Struct([
    [t.HANDLE, "hProcess"],
    [t.HANDLE, "hThread"],
    [t.DWORD, "dwProcessId"],
    [t.DWORD, "dwThreadId"]
]);

// https://msdn.microsoft.com/library/bb773378
winapi.PROFILEINFO = new Struct([
    [t.DWORD,  "dwSize"],
    [t.DWORD,  "dwFlags"],
    [t.LPTSTR, "lpUserName"],
    [t.LPTSTR, "lpProfilePath"],
    [t.LPTSTR, "lpDefaultPath"],
    [t.LPTSTR, "lpServerName"],
    [t.LPTSTR, "lpPolicyPath"],
    [t.HANDLE, "hProfile"]
]);

// https://msdn.microsoft.com/library/ms684839
winapi.PROCESSENTRY32 = new Struct([
    [t.DWORD, "dwSize"],
    [t.DWORD, "cntUsage"],
    [t.DWORD, "th32ProcessID"],
    [t.LP, "th32DefaultHeapID"],
    [t.DWORD, "th32ModuleID"],
    [t.DWORD, "cntThreads"],
    [t.DWORD, "th32ParentProcessID"],
    [t.LONG, "pcPriClassBase"],
    [t.DWORD, "dwFlags"],
    [arrayType("char", winapi.constants.MAX_PATH), "szExeFile"]
]);


/**
 * Creates a struct for use with STARTUPINFO.lpReserved2, which is passed to the child's C runtime in order to use
 * them as file descriptors.
 *
 *   int number_of_fds
 *   unsigned char crt_flags[number_of_fds]
 *   HANDLE os_handle[number_of_fds]
 * https://github.com/nodejs/node/blob/master/deps/uv/src/win/process-stdio.c#L33
 *
 * @param handleCount {Number} The number of handles the structure is to contain.
 * @return {Struct}
 */
winapi.createHandleInheritStruct = function (handleCount) {

    var HandleStruct = new Struct([
        ["int", "length"],
        [arrayType("char", handleCount), "flags"],
        [arrayType(t.HANDLE, handleCount), "handle"]
    ], {
        packed: true
    });

    return new HandleStruct();
};

winapi.kernel32 = ffi.Library("kernel32", {
    // https://msdn.microsoft.com/library/aa383835
    "WTSGetActiveConsoleSessionId": [
        t.DWORD, []
    ],
    "CloseHandle": [
        t.BOOL, [t.HANDLE]
    ],
    "GetLastError": [
        "int32", []
    ],
    // https://msdn.microsoft.com/library/ms684320
    "OpenProcess": [
        t.HANDLE, [ t.DWORD, t.BOOL, t.DWORD ]
    ],
    // https://msdn.microsoft.com/library/ms683179
    "GetCurrentProcess": [
        t.HANDLE, []
    ],
    // https://msdn.microsoft.com/library/ms682489
    "CreateToolhelp32Snapshot": [
        t.HANDLE, [t.DWORD, t.DWORD]
    ],
    // https://msdn.microsoft.com/library/ms684834
    "Process32First": [
        "bool", [t.DWORD, "pointer"]
    ],
    // https://msdn.microsoft.com/library/ms684836
    "Process32Next": [
        t.BOOL, [t.HANDLE, "pointer"]
    ],
    // https://msdn.microsoft.com/library/ms683231
    "GetStdHandle": [
        t.HANDLE, [ t.DWORD ]
    ],
    // https://msdn.microsoft.com/library/ms724935
    "SetHandleInformation": [
        t.BOOL, [ t.HANDLE, t.DWORD, t.DWORD ]
    ],
    // https://msdn.microsoft.com/library/aa363858
    "CreateFileW": [
        t.HANDLE, [ t.LPTSTR, t.DWORD, t.DWORD, t.LP, t.DWORD, t.DWORD, t.HANDLE ]
    ],
    // https://msdn.microsoft.com/library/aa365747
    "WriteFile": [
        t.BOOL, [ t.HANDLE, t.LP, t.DWORD, t.LP, t.LP ]
    ],
    // https://msdn.microsoft.com/library/ms687032
    "WaitForSingleObject": [
        t.DWORD, [ t.HANDLE, t.DWORD ]
    ]
});

winapi.advapi32 = ffi.Library("advapi32", {
    // https://msdn.microsoft.com/library/ms682429
    // ANSI version used due to laziness
    "CreateProcessAsUserW": [
        t.BOOL, [
            t.HANDLE,  // HANDLE                hToken,
            t.LPTSTR,  // LPCTSTR               lpApplicationName,
            t.LPTSTR,  // LPTSTR                lpCommandLine,
            t.LP,      // LPSECURITY_ATTRIBUTES lpProcessAttributes,
            t.LP,      // LPSECURITY_ATTRIBUTES lpThreadAttributes,
            t.BOOL,    // BOOL                  bInheritHandles,
            t.DWORD,   // DWORD                 dwCreationFlags,
            t.LP,      // LPVOID                lpEnvironment,
            t.LP,      // LPCTSTR               lpCurrentDirectory,
            t.LP,      // LPSTARTUPINFO         lpStartupInfo,
            t.LP       // LPPROCESS_INFORMATION lpProcessInformation
        ]
    ],
    // https://msdn.microsoft.com/library/aa379295
    "OpenProcessToken": [
        t.BOOL, [ t.HANDLE, t.DWORD, t.PHANDLE ]
    ]
});

winapi.userenv = ffi.Library("userenv", {
    // https://msdn.microsoft.com/library/bb762281
    "LoadUserProfileW": [
        t.BOOL, [ t.HANDLE, t.LP ]
    ],
    "CreateEnvironmentBlock": [
        t.BOOL, [ t.LP, t.HANDLE, t.BOOL ]
    ]
});

// IP helper API
winapi.iphlpapi = ffi.Library("iphlpapi", {
    // https://msdn.microsoft.com/library/bb408406
    "GetTcpTable2": [
        t.ULONG, [ t.LP, t.PULONG, t.BOOL ]
    ]
});

// Windows Terminal Services API
winapi.wtsapi32 = ffi.Library("wtsapi32", {
    // https://msdn.microsoft.com/library/aa383840
    "WTSQueryUserToken": [
        t.BOOL, [ t.ULONG, t.LP ]
    ]
});

/**
 * Returns an error containing the last win32 error code in the message.
 *
 * @param msg {String} The error message.
 * @param errorCode {Number} [optional] The win2 error code (omit to use GetLastError)
 * @return {Error} The error.
 */
winapi.error = function (msg, errorCode) {
    errorCode = errorCode || winapi.kernel32.GetLastError();
    return new Error(msg + " win32=" + errorCode);
};

/**
 * Convert a string to a wide-char string.
 *
 * @param string {String} The string to convert.
 * @return {Buffer} A buffer containing the wide-char string.
 */
winapi.stringToWideChar = function (string) {
    return new Buffer(string + "\u0000", "ucs2"); // add null at the end
};

/**
 * Convert a buffer containing a wide-char string to a string.
 *
 * @param buffer {Buffer} A buffer containing the wide-char string.
 * @return {String} A string.
 */
winapi.stringFromWideChar = function (buffer) {
    return ref.reinterpretUntilZeros(buffer, 2, 0).toString("ucs2");
};

/**
 * Convert a buffer containing an array of wide-char strings, to an array of strings.
 *
 * The input array is a C style string array, where the values are separated by null characters. The array is terminated
 * by an additional 2 null characters.
 *
 * @param buffer The buffer to convert.
 * @return {Array} An array of string.
 */
winapi.stringFromWideCharArray = function (buffer) {
    var togo = [];
    var offset = 0;
    var current;
    do {
        current = ref.reinterpretUntilZeros(buffer, 2, offset);
        if (current.length) {
            togo.push(current.toString("ucs2"));
            offset += current.length + 2; // Extra 2 bytes is to skip the (wide) null separator
        }
    } while (current.length > 0);

    return togo;
};


module.exports = winapi;
