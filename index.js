const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const fs = require('fs');
const qrcode = require('qrcode');
const path = require('path');
const fsp = require('fs/promises');

let BOT_CONFIG_DEFAULT = {
    "prefix": ">",
    "plugin_path": "./plugins/",
    "base_path": "./base/"
}

let BOT_CONFIG = BOT_CONFIG_DEFAULT;

let plugins = {
    "installed": [

    ]
};

let commands = {

};

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
                                plugin_folder: plugin
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
    console.log(Object.keys(commands), "commands loaded from the", pluginsArray, "plugins.");
    console.log(commands);
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
        const fromAlt = m.key?.participantAlt;

        const contactname = m.pushName || undefined;
        const type = Object.keys(m.message || {})[0];
        const fromMe = m.key.fromMe || false;
        const text = m.message?.conversation
        || m.message?.extendedTextMessage?.text
        || (m.message && type ? m.message[type]?.caption : undefined)
        || "";
        const timestamp = m.messageTmestamp?.low || m.messageTimestamp || 0;

        const msg = { key: m.key || {}, message: m.message, text, from, fromAlt, contactname, fromMe, type, timestamp }



        // command execution
        if (!text.startsWith(BOT_CONFIG.prefix)) return;
        
        const [raw, ...args] = text.slice(BOT_CONFIG.prefix.length).trim().split(" ");
        const cmd = raw.toLowerCase();
        msg.args = args;

        if (cmd === "reload") {
            await sock.sendMessage(from, { text: "Reloading plugins and commands."}, {quoted: msg });
            await loadPluginMeta();
            await sock.sendMessage(from, { text: `Done! ${Object.keys(commands).length} commands loaded from ${plugins.installed.length} plugins.`}, {quoted: msg });
            return;
        } else if (cmd === "ping") {
            await sock.sendMessage(from, { text: "Pong! Command has been detected."}, {quoted: msg });
            return;
        } else {
            const commandMeta = commands[cmd];

                if (commandMeta) {

                const fullPath = path.resolve(
                    BOT_CONFIG.plugin_path,
                    commandMeta.plugin_folder,
                    commandMeta.file
                );

                console.log(`Attempting to run command from: ${fullPath}`);
                try {
                    const pluginModule = require(fullPath);
                    if (pluginModule.run) {
                        await safeRun(() => pluginModule.run(sock, from, msg), sock, from, m, cmd);
                    } else {
                        console.warn(`Plugin at ${fullPath} is missing a 'run' function.`);
                    }
                } catch (err) {
                    console.error(`Failed to load or execute plugin at ${fullPath}:`, err);
                    await sock.sendMessage(from, { text: `Error loading plugin command \`${cmd}\`: \`${err.message}\`` });
                }
                return;
            } else {


                const fullPath = path.resolve(
                    BOT_CONFIG.base_path,
                    "command_not_found.js"
                );

                 try {
                    const pluginModule = require(fullPath);
                    if (pluginModule.run) {
                        await safeRun(() => pluginModule.run(sock, from, msg), sock, from, m, cmd);
                    } else {
                        console.warn(`Plugin at ${fullPath} is missing a 'run' function.`);
                    }
                } catch (err) {
                    console.error(`Failed to load or execute plugin at ${fullPath}:`, err);
                    await sock.sendMessage(from, { text: `Error loading plugin command \`${cmd}\`: \`${err.message}\`` });
                }
                return;
            }
        }



    });
}

start()