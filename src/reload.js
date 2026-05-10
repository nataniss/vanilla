function run(sock, from, msg) {
    sock.sendMessage(from, { text: `Reloading plugins and commands...`}, { quoted: msg });
}

function post(sock, from, msg) {
    sock.sendMessage(from, { text: `All commands reloaded.`}, { quoted: msg });
}


module.exports = {
    run: run,
    post: post
};