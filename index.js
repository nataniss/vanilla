const fs = require('fs');
const vanilla = require('./vanilla.js');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const fsp = require('fs/promises');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');

const rl = readline.createInterface({ input, output });

const GROUP_CACHE = new Map();
const COOLDOWNS = new Map();

let BOT_CONFIG_DEFAULT = {
    "prefix": "/",
    "plugin_path": "./plugins/",
    "source_path": "./src/",
    "cooldown": 5000,
    "global": false,
    "owners": [],
    "allowed_jids": [],
    "group_cache_duration": 1000 * 60 * 10,
}


let BOT_CONFIG = BOT_CONFIG_DEFAULT;
let plugins = { "installed": [] };
let commands = {};
let source_ignore;

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
                        if (vanilla_arguments.includes("PRINT_MISSING_POST_FUNCTION")) console.warn(` :: Plugin at ${fp} is missing a 'post' function.`);
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
        await sock.sendMessage(from, { text: `Error executing command ${vanilla.code(cmd)}.\n\n${vanilla.code(err.message || err)}`}, {quoted: msg });
    }
    return;
}

async function safeRun(fn, sock, from, msg, cmdName = "command") {
    try {
        await fn();
    } catch (err) {
        console.error(` :: Error executing command ${cmdName}:`, err);
        try {
            await sock.sendMessage(from, {text: `Error executing command ${vanilla.code(cmd)}.\n\n${vanilla.code(err.message || err)}`}, {quoted: msg })
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
        if (vanilla_arguments.includes("PRINT_MANIFEST_LOGS")) console.log(` :: Loading plugin metadata for: ${plugin}`);
        
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

            if (vanilla_arguments.includes("PRINT_MANIFEST_LOGS")) console.log(` :: Successfully loaded manifest for ${content.title || plugin + " ( folder name )"}.`);

        } catch (err) {
            console.error(` :: Got an error trying to read or process manifest of ${plugin}: ${err.message}`);
        }
    }));
    
    pluginsArray = plugins.installed.filter(function(item, pos) {
        return plugins.installed.indexOf(item) == pos;
    })
    console.log(" :: Done.", Object.keys(commands).length, "command(s) loaded from", pluginsArray.length, "plugin(s).");
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

    console.log(` :: VanillaBot v${vanilla.version.join(".")} ${vanilla.sdk}`)

    if (!fs.existsSync("./bot_configs.json")) { 
        console.log(" :: Your bot configuration file is not set up yet. Follow the steps on screen to continue.")

        response_bot_whitelist = await rl.question(`\n :: VanillaBot's command execution is by default global, meaning that every person, on every group or any direct message, can execute commands.\n :: Allow global command execution? (Y/N) > `)

        BOT_CONFIG_DEFAULT.global = ((response_bot_whitelist === "y") || (response_bot_whitelist === "Y"))
        rl.close();

        console.log("\n :: You're set up now; Starting bot...")
    }

    BOT_CONFIG = await vanilla.loadJson("./bot_configs.json", BOT_CONFIG_DEFAULT);

    try {
        const src_ignore_data = fs.readFileSync(path.resolve(BOT_CONFIG.source_path + "src_ignore.json"), 'utf8');
        source_ignore = JSON.parse(src_ignore_data)
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(':: Error: src_ignore.js not found at current source folder.');
        } else {
            console.error(' :: Error reading src_ignore.js inside source folder:', error.message);
        }
        source_ignore = []
    }

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
        const isGroup = from.endsWith('@g.us');

        let senderNumber = "";
        let participants = [];
        const lid = m.key.participant || m.key.remoteJid;
        const now = Date.now();
        const cachedData = GROUP_CACHE.get(from);

        if (isGroup) {
            if (cachedData && (now - cachedData.timestamp) < BOT_CONFIG.group_cache_duration) {
		        participants = cachedData.participants;
		    } else {
                try {
                    const metadata = await sock.groupMetadata(from);
                    participants = metadata.participants;
                    GROUP_CACHE.set(from, { 
                        participants: participants, 
                        timestamp: now 
                    });
                } catch (e) {
                    console.error(" :: Error checking group metadata:", e);
                    if (cachedData) {
                        participants = cachedData.participants;
                    } else {
                        return; 
                    }
                }
		    }

            const match = participants.find(p => p.id === lid);
		    if (match && match.phoneNumber) {
		        senderNumber = match.phoneNumber.split('@')[0];
		    }
        } else {
            // lid
            senderNumber = "-1"
        }

        const contactname = m.pushName || undefined;
        const type = Object.keys(m.message || {})[0];
        const fromMe = m.key.fromMe || false;
        const text = m.message?.conversation
        || m.message?.extendedTextMessage?.text
        || (m.message && type ? m.message[type]?.caption : undefined)
        || "";
        const timestamp = m.messageTimestamp?.low || m.messageTimestamp || 0;
        
        const msg = { key: m.key || {}, message: m.message, text, from, fromAlt, contactname, fromMe, type, timestamp, participants, senderNumber };

        let [raw, ...args] = text.slice(BOT_CONFIG.prefix.length).trim().split(" ");

        let cmd = raw.toLowerCase();
        msg.args = args;
        msg.cmd = cmd;

        if (BOT_CONFIG.owners.includes(senderNumber) && text.startsWith(BOT_CONFIG.prefix)) {
            if (cmd == "bot") {
                let metadata = await sock.groupMetadata(from);
    
                let groupName = metadata.subject; 
                if (args[0] == "allow") {
                    if (BOT_CONFIG.allowed_jids.includes(from)) {
                        await sock.sendMessage(from, {text: `This group (${vanilla.code(groupName)}) is already in the whitelist.`})
                    } else {
                        console.log(` :: ${groupName} can now run commands (allowed by ${senderNumber})`)
                        BOT_CONFIG.allowed_jids.push(from)
                        vanilla.updateBotConfiguration(BOT_CONFIG)
                        await sock.sendMessage(
                        from,
                            {
                                react: {
                                    text: '✅',
                                    key: msg.key
                                }
                            }
                        );
                    }
                } else if (args[0] == "ignore") {
                    if (BOT_CONFIG.allowed_jids.includes(from)) {
                        console.log(` :: ${groupName} can not run commands anymore (ignored by ${senderNumber})`)
                        BOT_CONFIG.allowed_jids = BOT_CONFIG.allowed_jids.filter(jid => jid !== from);
                        vanilla.updateBotConfiguration(BOT_CONFIG)
                        await sock.sendMessage(
                        from,
                            {
                                react: {
                                    text: '✅',
                                    key: msg.key
                                }
                            }
                        );
                    } else {
                        await sock.sendMessage(from, {text:`This group (${vanilla.code(groupName)}) is already not found in the whitelist.`})
                    }
                }

                return;
            }
        }

        if (fs.existsSync(path.resolve(BOT_CONFIG.source_path, "on_raw_message.js"))) {
            await safeRun(() => execute_file(path.resolve(BOT_CONFIG.source_path, "on_raw_message.js"), sock, from, msg, m, cmd, 0, false), sock, from, m, cmd);
        }

        if (!BOT_CONFIG.allowed_jids.includes(from) && BOT_CONFIG.global === false && text.startsWith(BOT_CONFIG.prefix)) {
            console.log(` :: Command executed on ${from} (${cmd}), however it's not on the whitelist. Ignoring.`)
            return;
        }

        if (fs.existsSync(path.resolve(BOT_CONFIG.source_path, "on_message.js")) && BOT_CONFIG.allowed_jids.includes(from)) {
            await safeRun(() => execute_file(path.resolve(BOT_CONFIG.source_path, "on_message.js"), sock, from, msg, m, cmd, 0, false), sock, from, m, cmd);
        }


        if (!text.startsWith(BOT_CONFIG.prefix)) return;
        

        const cooldown_id = senderNumber;

        if (COOLDOWNS.has(cooldown_id)) {
            if (fs.existsSync(path.resolve(BOT_CONFIG.source_path, "on_cooldown.js"))) {
                await safeRun(() => execute_file(path.resolve(BOT_CONFIG.source_path, "on_cooldown.js"), sock, from, msg, m, cmd, 0, false), sock, from, m, cmd);
            } else {
			    await sock.sendMessage(from, {text: "Please wait " + vanilla.code((BOT_CONFIG.cooldown / 1000)) + " seconds before running a command again." }, { quoted: msg } )
            }
		    return;
		}

        COOLDOWNS.set(cooldown_id, true);
		
		setTimeout(() => {
		    COOLDOWNS.delete(cooldown_id);
		}, BOT_CONFIG.cooldown);


        const commandMeta = commands[cmd];

        if (commandMeta) {

            const fp = path.resolve(
                BOT_CONFIG.plugin_path,
                commandMeta.plugin_folder,
                commandMeta.file
            );

            if (vanilla_arguments.includes("PRINT_COMMAND_EXECUTION")) console.log(` :: Attempting to run command from: ${fp}`);
            await safeRun(() => execute_file(fp, sock, from, msg, m, cmd), sock, from, m, cmd);
            await safeRun(() => execute_file(fp, sock, from, msg, m, cmd, 1, false), sock, from, m, cmd);
            return;
        } else {
            if (fs.existsSync(path.resolve(BOT_CONFIG.source_path, cmd + ".js"))) {

                if (source_ignore.includes(cmd)) return;

                const fp = path.resolve(
                    BOT_CONFIG.source_path,
                    cmd + ".js"
                );
                
                if (vanilla_arguments.includes("PRINT_COMMAND_EXECUTION")) console.log(` :: Attempting to run command from: ${path.resolve(BOT_CONFIG.source_path, cmd + ".js")}`);
                await safeRun(() => execute_file(fp, sock, from, msg, m, cmd), sock, from, m, cmd);
                return;
            } else {
                const fp = path.resolve(
                    BOT_CONFIG.source_path,
                    "command_not_found.js"
                );
                await safeRun(() => execute_file(fp, sock, from, msg, m, cmd), sock, from, m, cmd);
                return;
            }
        }
    });
}

start()

module.exports = {
    reloadCommands,
    loadPluginMeta,
    BOT_CONFIG,
    BOT_CONFIG_DEFAULT
}