
const fsp = require('fs/promises');

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

module.exports = {
	loadJson
}
