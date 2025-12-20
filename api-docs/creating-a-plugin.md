# Plug-ins

Plug-ins in VanillaBot are a collection of commands packaged inside a folder. Their file structure is relatively simple, with them having a single `manifest.json` file and multiple `*.js` files for the plug-in commands.

### Creating a plug-in
Inside your plug-in path folder, (default is `plugins/`, check your `bot_configs.json`) create a new folder with the name of your plugin.

> [!NOTE]
>
> It's recommended that plug-in folder names should **not** have spaces, as the message handler will interpret spaces as command arguments if you're running a command directly. ( E.g.: `>command@plugin_folder_name` is the correct approach -- with spaces, running `>command@plugin folder name` will interpret `folder` and `name` as arguments.)

Inside your newly created folder, make a `manifest.json` file. This the minimum necessary for VanillaBot's `reload` function to see your plug-in.
```json
{
    "title": "My Awesome Plug-in!",
    "commands": []
}
```
`title`: A external title for your plug-in. Internally, the folder name is used, so **it's good practice to set the folder name similar to the `title` string - in this case, use `my-awesome-plugin`.**

`commands`: A array of commands.

### Creating commands

Inside your manifest, add the following to your manifest, to declare a single command.

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

`file`: The JS file, located in the same directory as the manifest.
`aliases`: A array that defines what commands run the same JS file - if `"aliases": ["test", "test2"]`, running both `test` and `test2` will run the same file, in this case, `command.js`.

For multiple commands:

```json
{
    "title": "My Awesome Plug-in!",
    "commands": [
        {
            "file": "command.js",
            "aliases": ["test"]
        },
        {
            "file": "command2.js",
            "aliases": ["test2"]
        },
        {
            "file": "command3.js",
            "aliases": ["test3"]
        }
    ]
}
```

You can check out the [Commands](commands.md) API Document for running JavaScript code via a command.

You can now run the `reload` function inside a Whatsapp conversation to see that your plug-in is now getting recognized, alongside your commands.