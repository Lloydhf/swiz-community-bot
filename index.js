const { SwizBot } = require('./src/bot');
if (require.main === module) {
  const bot = new SwizBot();
  bot.start().catch(error => { console.error('Bot başlatılamadı:', error.message); process.exitCode = 1; bot.stop(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => bot.stop().then(() => process.exit(0)));
}
module.exports = { SwizBot };
