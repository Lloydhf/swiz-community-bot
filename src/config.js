const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
const local = path.join(root, 'config.local.json');
const CONFIG = JSON.parse(fs.readFileSync(fs.existsSync(local) ? local : path.join(root, 'config.example.json'), 'utf8'));
CONFIG.TOKEN = process.env.DISCORD_TOKEN || '';
CONFIG.GUILD_ID = process.env.GUILD_ID || CONFIG.IDS.EVERYONE_ROL;
function saveLocalConfig() {
  const { TOKEN, ...safe } = CONFIG;
  const temp = local + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(safe, null, 2) + '\n');
  fs.renameSync(temp, local);
}
module.exports = { CONFIG, saveLocalConfig, root };
