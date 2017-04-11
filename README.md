# GPII Windows Service

##Command-line arguments:

###Install the service:
```
node index.js --mode=install

    --programArgs=ARGS  Arguments for the service application (default: --node=service).
    --nodeArgs=ARGS     Arguments for node.
```

###Uninstall the service:
```
node index.js --mode=uninstall
```

###Running the service (invoked by windows):
```
node index.js --mode=service
```
