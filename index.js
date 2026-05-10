const vanilla = require('./vanilla.js');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const fsp = require('fs/promises');

let BOT_CONFIG_DEFAULT = {
    "prefix": "/",
    "plugin_path": "./plugins/",
}

let BOT_CONFIG = BOT_CONFIG_DEFAULT;
let plugins = { "installed": [] };
let commands = {};

const vanilla_arguments = process.argv.slice(2);


async function execute_file(fp, sock, from, msg, m, cmd, func, printwarn) {
    try {
        const pluginModule = require(fp);
        switch (func) {
            case (1):
                if (pluginModule.post) {
                    await safeRun(() => pluginModule.post(sock, from, msg), sock, from, m, cmd);
                } else {
                    if (printwarn === true || printwarn === undefined) {
                        if (vanilla_arguments.includes("-vcpfm")) console.warn(` :: Plugin at ${fp} is missing a 'post' function.`);
                    }
                }
                break;

            default:
                if (pluginModule.run) {
                    await safeRun(() => pluginModule.run(sock, from, msg), sock, from, m, cmd);
                } else {
                    if (printwarn === true || printwarn === undefined) {
                        console.warn(` :: Plugin at ${fp} is missing a 'run' function.\n :: Did you forget to include "module.exports = { run }"?`);
                    }
                }
                break;
        }
    } catch (err) {
        console.error(` :: Failed to load or execute file at ${fp}:`, err);
        await sock.sendMessage(from, { text: `Error executing command \`\`\`${cmd}\`\`\`.\n\n\`\`\`${err.message}\`\`\``}, {quoted: msg });
    }
    return;
}

async function safeRun(fn, sock, from, msg, cmdName = "command") {
    try {
        await fn();
    } catch (err) {
        console.error(` :: Error executing command ${cmdName}:`, err);
        try {
            await sock.sendMessage(from, {text: `Error executing command \`\`\`${cmdName}\`\`\`:\n\`\`\`${err.message || err}\`\`\``})
        } catch (_) {}
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
        if (err.code === "ENOENT") {
        	console.log(` :: ${BOT_CONFIG.plugin_path} does not exist. Creating folder.`);
    	    try {
        		await fsp.mkdir(BOT_CONFIG.plugin_path, { recursive: true });
       	        const entries = await fsp.readdir(BOT_CONFIG.plugin_path, { withFileTypes: true });
		        directories = entries
		        .filter(dirent => dirent.isDirectory())
		        .map(dirent => dirent.name);
	        } catch (err) {
	        	console.log(" :: Error making folder.");
	        	throw err;
	        }
        } else {
        console.error(`Error reading directory: ${err}`);
        throw err; 
        }
    }

    console.log("\n :: Loading plugins...")

    await Promise.all(directories.map(async (plugin) => { 
        if (vanilla_arguments.includes("-vpl")) console.log(` :: Loading plugin metadata for: ${plugin}`);
        
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
                                console.warn(` :: WARNING: Alias "${commandName}" from plugin "${content.title}" is already used by plugin "${commands[commandName].plugin}".\n :: The existing one will be overwritten.`);
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

            if (vanilla_arguments.includes("-vpl")) console.log(` :: Successfully loaded manifest for ${content.title}.`);

        } catch (err) {
            console.error(` :: Got an error trying to read or process manifest of ${plugin}: ${err.message}`);
        }
    }));
    
    pluginsArray = plugins.installed.filter(function(item, pos) {
        return plugins.installed.indexOf(item) == pos;
    })
    console.log(" :: Done.", Object.keys(commands).length, "command(s) loaded from ", pluginsArray.length, "plugin(s).");
}


function reloadCommands() {
    console.log(" :: Reloading command files...");
    
    const pathsToClear = Object.values(commands).map(meta => meta.fullPath).filter(p => p);

    let clearedCount = 0;
    
    pathsToClear.forEach(fullPath => {
        if (require.cache[fullPath]) {
            delete require.cache[fullPath];
            clearedCount++;
        }
    });
    
    console.log(` :: Reloaded ${clearedCount} command file(s).`);
}



async function start() {

    console.log(` :: VanillaBot v${vanilla.version.join(".")}`)

    BOT_CONFIG = await vanilla.loadJson("./bot_configs.json", BOT_CONFIG_DEFAULT);

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
                console.log('\n :: Connection closed. You are logged out.\n :: Disconnecting... (You\'ll need to login again)');
                await fsp.rm(__dirname + "/auth_info_baileys/", { recursive: true, force: true });
                start();
            }
        } else if (connection === 'open') {
            console.log('\n :: Connection opened successfully!');
        }

        if (qr) {
            console.log("\n")
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
            case ("reload"): {
                const fp = path.resolve(
                    "./src/",
                    "command_not_found.js"
                );
                await safeRun(() => execute_file(fp, sock, from, msg, m, cmd), sock, from, m, cmd);

                reloadCommands();
                await loadPluginMeta();

                await safeRun(() => execute_file(fp, sock, from, msg, m, cmd, 1), sock, from, m, cmd);
                return;
            }
            case ("ping"): {
                const fp = path.resolve(
                    "./src/",
                    "command_not_found.js"
                );
                await safeRun(() => execute_file(fp, sock, from, msg, m, cmd), sock, from, m, cmd);
                return;
            }

            default: {
                if (commandMeta) {

                    const fp = path.resolve(
                        BOT_CONFIG.plugin_path,
                        commandMeta.plugin_folder,
                        commandMeta.file
                    );

                    if (vanilla_arguments.includes("-vpe")) console.log(` :: Attempting to run command from: ${fp}`);
                    await safeRun(() => execute_file(fp, sock, from, msg, m, cmd), sock, from, m, cmd);
                    await safeRun(() => execute_file(fp, sock, from, msg, m, cmd, 1, false), sock, from, m, cmd);
                    return;
                } else {
                    const fp = path.resolve(
                        "./src/",
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
