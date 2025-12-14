function run(sock, from, msg) {
    sock.sendMessage(from, { text: `Pong! Command received.`}, { quoted: msg });
}

module.exports = {
    run: run
};