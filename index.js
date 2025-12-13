const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const fs = require('fs');
const qrcode = require('qrcode');
const path = require('path');
const fsp = require('fs/promises');

let BOT_CONFIG = {
    "prefix": ">",
    "plugin_path": "./plugins/"
}

let plugins = {
    "installed": [

    ]
};

let commands = {

};

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
                                plugin: content.title
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
    console.log(Object.keys(commands), "commands loaded from the", plugins.installed, "plugins.");
    console.log(commands);
}



async function start() {

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
        console.log("\nMessage detected!\n")

        global.sock = sock;
        const m = messages[0];
        console.log(m)
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
            let commandFound = Object.keys(commands).find(key => key === cmd);

            if (commandFound) {
                // Command exists
                return;
            } else {
                await sock.sendMessage(from, { text: `Command does not exist.`}, {quoted: msg });
                return;
            }
        }



    });
}

start()