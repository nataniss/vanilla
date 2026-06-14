const index = require("../index.js")

async function run(sock, from, msg) {
    await sock.sendMessage(
    from,
        {
            react: {
                text: '🔄',
                key: msg.key
            }
        }
    );
    index.reloadCommands()
    await index.loadPluginMeta()
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

module.exports = {
    run: run
};