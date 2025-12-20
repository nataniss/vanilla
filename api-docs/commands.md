# Commands

Commands are `*.js` files inside plug-ins. They get executed when a user requests a command.

### Syntax

The command syntax only requires only a `run(sock, from, msg)` function and a `module.exports` object, as they get loaded as Node.JS modules. A simple command that prints `Hello, world!` in the terminal looks like this:

```js
function run(sock, from, msg) {
    console.log("Hello, world!");
}

module.exports = {
    run: run
};
```

If you have a `manifest.json` that looks like this:
```json
{
    "title": "My Awesome Plug-in!",
    "commands": [
        {
            "file": "command.js",
            "aliases": ["test"]
        }
    ]
}
```

By running `>reload`, and then `>test` on a Whatsapp conversation, you'll see `Hello, world!` on your terminal.

If you want to send messages, check the [Messages](messages.md) API Documentation.