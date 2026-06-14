const index = require("../index.js")
const vanilla = require('../vanilla.js');

async function run(sock, from, msg) {
    await sock.sendMessage(from, {text: "Please wait " + vanilla.code((index.BOT_CONFIG.cooldown / 1000) + " seconds") + " before running a command again." }, { quoted: msg } )
}

module.exports = {
    run: run
};