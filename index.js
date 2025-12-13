const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const fs = require('fs');
const qrcode = require('qrcode');

let BOT_CONFIG = {
    "prefix": ">"
}

async function start() {

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: 'silent' }),
    });


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
        const type = Object.keys(m.message || {});
        const fromMe = m.key.fromMe || false;
        const text = m.message.conversation
        || m.message.extendedTextMessage?.text
        || m.message[type]?.caption
        || "";

        const msg = { key: m.key || {}, message: m.message, text, from, fromAlt, contactname, fromMe, type }

        console.log(msg)

        // command execution
        if (!text.startsWith(BOT_CONFIG.prefix)) return;
        
        const [raw, ...args] = text.slice(BOT_CONFIG.prefix.length).trim().split(" ");
        const cmd = raw.toLowerCase();
        msg.args = args;

        if (cmd === "ping") {
            await sock.sendMessage(from, { text: "Pong! Command has been detected."}, {quoted: msg });
            return;
        }


    });
}

start()