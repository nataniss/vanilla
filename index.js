const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const fsp = require('fs/promises');

let BOT_CONFIG_DEFAULT = {
    "prefix": ">",
    "plugin_path": "./plugins/",
    "base_path": "./base/",
    "base": "vanilla"
}

let BOT_CONFIG = BOT_CONFIG_DEFAULT;

let plugins = {
    "installed": [

    ]
};

let commands = {

};

async function execute_file(fp, sock, from, msg, m, cmd, func, printwarn) {
    try {
        const pluginModule = require(fp);
        switch (func) {
            case (1):
                if (pluginModule.post) {
                    await safeRun(() => pluginModule.post(sock, from, msg), sock, from, m, cmd);
                } else {
                    if (printwarn === true || printwarn === undefined) {
                        console.warn(`Plugin at ${fp} is missing a 'post' function.`);
                    }
                }
                break;

            default:
                if (pluginModule.run) {
                    await safeRun(() => pluginModule.run(sock, from, msg), sock, from, m, cmd);
                } else {
                    if (printwarn === true || printwarn === undefined) {
                        console.warn(`Plugin at ${fp} is missing a 'run' function.`);
                    }
                }
                break;
        }
    } catch (err) {
        console.error(`Failed to load or execute file at ${fp}:`, err);
        await sock.sendMessage(from, { text: `Error executing command \`\`\`${cmd}\`\`\`.\n\n\`\`\`${err.message}\`\`\``}, {quoted: msg });
    }
    return;
}

async function changeBase(fp, newbase) {
    try {
        const json = await fsp.readFile(fp, 'utf-8');
        
        const data = JSON.parse(json);
        data.base = newbase;
        const new_data = JSON.stringify(data, null, 2);

        BOT_CONFIG = data;
        await fsp.writeFile(fp, new_data, { encoding: 'utf-8' });

        console.log(`Successfully changed base to ${newbase}.`);
        return true;
    } catch (err) {
        console.error("Error changing base:", err.message);
        throw err;
    }
}

// safe run, in case something goes wrong
async function safeRun(fn, sock, from, msg, cmdName = "command") {
    try {
        await fn();
    } catch (err) {
        console.error(`Error executing command ${cmdName}:`, err);
        try {
            await sock.sendMessage(from, {text: `Error executing command \`\`\`${cmdName}\`\`\`:\n\`\`\`${err.message || err}\`\`\``})
        } catch (_) {}
    }
}

async function loadJson(filepath, fallback = {}) {
    try {
        const data = await fsp.readFile(filepath, 'utf-8')
        return JSON.parse(data);
    } catch (error) {
        if (error.code === "ENOENT") {
            try {
                const json = JSON.stringify(fallback, null, 2);
                await fsp.writeFile(filepath, json, {encoding: 'utf-8', flag: 'w'});
                return fallback;
            } catch (writeError) {
                console.error(`Failed to write file ${filepath}: ${writeError}`)
                throw writeError;
            }
        } else {
            console.error("Error processing JSON:", error)
            throw error;
        }
    }
}

async function loadPluginMeta() {

    let directories = [];
    commands = {}; 

    try {
        const entries = await fsp.readdir(BOT_CONFIG.plugin_path, { withFileTypes: true });
        directories = entries
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
    } catch (err) {
        console.error(`Error reading directory: ${err}`);
        throw err; 
    }

    await Promise.all(directories.map(async (plugin) => { 
        console.log(`Loading plugin metadata for: ${plugin}`);
        
        try {
            const manifestPath = path.join(BOT_CONFIG.plugin_path, plugin, "manifest.json");
            const data = await fsp.readFile(manifestPath, 'utf8');
            let content = JSON.parse(data);
            
            plugins.installed.push(content.title);

            if (content.commands && Array.isArray(content.commands)) {
                content.commands.forEach(commandMeta => {
                    const { file, aliases } = commandMeta;
                    
                    if (aliases && Array.isArray(aliases)) {
                        aliases.forEach(alias => {
                            const commandName = alias.toLowerCase();

                            if (commands[commandName]) {
                                console.warn(`Command conflict detected! Alias "${commandName}" from plugin "${content.title}" is already used by plugin "${commands[commandName].plugin}". The existing one will be overwritten.`);
                            }

                            commands[commandName] = {
                                file: file,
                                plugin: content.title,
                                plugin_folder: plugin,
                                fullPath: path.resolve(BOT_CONFIG.plugin_path, plugin, file)
                            };
                        });
                    }
                });
            }

            console.log(`Successfully loaded manifest for ${content.title}.`);

        } catch (err) {
            console.error(`Got an error trying to read or process manifest of ${plugin}: ${err.message}`);
        }
    }));
    
    console.log("Done loading plugins and commands.");
    pluginsArray = plugins.installed.filter(function(item, pos) {
        return plugins.installed.indexOf(item) == pos;
    })
    console.log(Object.keys(commands), "command(s) loaded from the", pluginsArray, "plugin(s).");
    console.log(commands);
}

function reloadCommands() {
    console.log("Reloading command files...");
    
    const pathsToClear = Object.values(commands).map(meta => meta.fullPath).filter(p => p);

    let clearedCount = 0;
    
    pathsToClear.forEach(fullPath => {
        if (require.cache[fullPath]) {
            delete require.cache[fullPath];
            clearedCount++;
        }
    });
    
    console.log(`Reloaded ${clearedCount} command file(s).`);
}



async function start() {

    BOT_CONFIG = await loadJson("./bot_configs.json", BOT_CONFIG_DEFAULT);

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: 'silent' }),
    });

    await loadPluginMeta();

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) ? 
                (lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut) : 
                true;

            if (shouldReconnect) {
                start();
            } else {
                console.log('Connection closed. You are logged out.');
            }
        } else if (connection === 'open') {
            console.log('Connection opened successfully!');
        }

        if (qr) {
            console.log(await qrcode.toString(qr, {type:'terminal', small: true}))
        }

    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        global.sock = sock;
        const m = messages[0];
        global.lastMsg = { from: m.key.remoteJid, msg: m }

        const from = m.key?.remoteJid || m.key?.participant;
        const fromAlt = m.key.participantAlt;

        const contactname = m.pushName || undefined;
        const type = Object.keys(m.message || {})[0];
        const fromMe = m.key.fromMe || false;
        const text = m.message?.conversation
        || m.message?.extendedTextMessage?.text
        || (m.message && type ? m.message[type]?.caption : undefined)
        || "";
        const timestamp = m.messageTimestamp?.low || m.messageTimestamp || 0;
        
        const msg = { key: m.key || {}, message: m.message, text, from, fromAlt, contactname, fromMe, type, timestamp };
        // build a simpler message

        // command execution
        let [raw, ...args] = text.slice(BOT_CONFIG.prefix.length).trim().split(" ");

        if (!text.startsWith(BOT_CONFIG.prefix)) return;

        let cmd = raw.toLowerCase();
        msg.args = args;
        msg.cmd = cmd;

        const commandMeta = commands[cmd];

        switch (cmd) {
            // TODO: I should really remove these hardcoded cases...
            case ("reload"): {
                const fp = path.resolve(
                    BOT_CONFIG.base_path,
                    BOT_CONFIG.base,
                    "reload.js"
                );
                await safeRun(() => execute_file(fp, sock, from, msg, m, cmd), sock, from, m, cmd);

                reloadCommands();
                await loadPluginMeta();

                await safeRun(() => execute_file(fp, sock, from, msg, m, cmd, 1), sock, from, m, cmd);
                return;
            }
            case ("ping"): {
                const fp = path.resolve(
                    BOT_CONFIG.base_path,
                    BOT_CONFIG.base,
                    "ping.js"
                );
                await safeRun(() => execute_file(fp, sock, from, msg, m, cmd), sock, from, m, cmd);
                return;
            }
            case ("base"): {
                if (args.length === 0) {
                await sock.sendMessage(from, { text: `Current base is ${BOT_CONFIG.base}.`}, {quoted: msg });
            } else {
                if (args[0] === "switch") {
                    await safeRun(() => changeBase("./bot_configs.json", args[1]), sock, from, m, cmd);
                    await loadPluginMeta(); 
                    reloadCommands();
                    await sock.sendMessage(from, { text: `Base switched to *${BOT_CONFIG.base}*. Plugins reloaded.`}, {quoted: msg });
                }
            }
                return;
            }

            default: {
                if (commandMeta) {

                    const fp = path.resolve(
                        BOT_CONFIG.plugin_path,
                        commandMeta.plugin_folder,
                        commandMeta.file
                    );

                    console.log(`Attempting to run command from: ${fp}`);
                    await safeRun(() => execute_file(fp, sock, from, msg, m, cmd), sock, from, m, cmd);
                    await safeRun(() => execute_file(fp, sock, from, msg, m, cmd, 1, false), sock, from, m, cmd); // run post, if not existent, fail silently
                    return;
                } else {
                    const fp = path.resolve(
                        BOT_CONFIG.base_path,
                        BOT_CONFIG.base,
                        "command_not_found.js"
                    );
                    await safeRun(() => execute_file(fp, sock, from, msg, m, cmd), sock, from, m, cmd);
                    return;
                }
            }
        }

    });
}

start()