function run(sock, from, msg) {
    sock.sendMessage(from, { text: "Command does not exist."}, { quoted: msg });
}

module.exports = {
    run: run
};