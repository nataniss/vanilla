function run(sock, from, msg) {
    sock.sendMessage(from, { text: `Command ${msg.cmd} does not exist.`}, { quoted: msg });
}

module.exports = {
    run: run
};