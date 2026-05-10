
const fsp = require('fs/promises');

version = ["1", "0 (AppleCake)"]

async function loadJson(filepath, fallback = {}) {
    try {
        const data = await fsp.readFile(filepath, 'utf-8')
        return JSON.parse(data);
    } catch (error) {
        if (error.code === "ENOENT") {
            try {
                const json = JSON.stringify(fallback, null, 2);
                await fsp.writeFile(filepath, json, {encoding: 'utf-8', flag: 'w'});
                return fallback;
            } catch (writeError) {
                console.error(`Failed to write file ${filepath}: ${writeError}`)
                throw writeError;
            }
        } else {
            console.error("Error processing JSON:", error)
            throw error;
        }
    }
}

async function updateBotConfiguration() {
    try {
        await fsp.writeFile("./bot_configs.json", JSON.stringify(BOT_CONFIG, null, 2));
    } catch (err) {
        console.error(`Failed to write file ${filepath}: ${writeError}`)
        throw err;
    }

}

module.exports = {
	loadJson,
    version
}
