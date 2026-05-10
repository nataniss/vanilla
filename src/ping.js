function run(sock, from, msg) {
    const now = Date.now();

    const latency = now - msg.timestamp * 1000
    sock.sendMessage(from, { text: `Pong! Command received. Took ${latency / 10000} second(s).`}, { quoted: msg });
}

module.exports = {
    run: run
};