const { SlashCommandBuilder } = require('discord.js');
const { FIVEM_SERVERS } = require('./servers');
function legacyCommands() {
        const commands = [
            new SlashCommandBuilder().setName('komutlar').setDescription('Komut menüsünü gösterir'),
            new SlashCommandBuilder().setName('bot').setDescription('Bot bilgilerini gösterir'),
            new SlashCommandBuilder().setName('bilgi').setDescription('Kullanıcı bilgilerini gösterir')
                .addUserOption(option => option.setName('kullanici').setDescription('Bilgisi gösterilecek kullanıcı').setRequired(false)),
            new SlashCommandBuilder().setName('alesta').setDescription('Sunucu durumunu gösterir'),
            new SlashCommandBuilder().setName('aktif').setDescription('Sunucuda aktif olan Swiz üyelerini listeler (Dost rolü hariç)'),
            new SlashCommandBuilder().setName('swiz').setDescription('Alesta RP\'de Swiz taglı oyuncuları listeler'),
            new SlashCommandBuilder().setName('sunucular').setDescription('Tüm sunucuları listeler'),
            new SlashCommandBuilder()
                .setName('id')
                .setDescription('Sunucuda ID ile oyuncu bul')
                .addStringOption(option => option.setName('sunucu').setDescription('Sunucu seçin').setRequired(true)
                    .addChoices(...FIVEM_SERVERS.map(s => ({ name: s.name, value: s.name }))))
                .addIntegerOption(option => option.setName('id').setDescription('ID Check').setRequired(true)),
            new SlashCommandBuilder()
                .setName('tag')
                .setDescription('İsme göre oyuncu ara')
                .addStringOption(option => option.setName('isim').setDescription('Aranacak oyuncu adı').setRequired(true))
                .addStringOption(option => option.setName('sunucu').setDescription('Sunucu seçin').setRequired(false)
                    .addChoices(...FIVEM_SERVERS.map(s => ({ name: s.name, value: s.name })), { name: 'Tüm Sunucular', value: 'all' })),
            new SlashCommandBuilder().setName('ticket').setDescription('Ticket sistemini kurar'),
            new SlashCommandBuilder().setName('panel').setDescription('Aktif Oyuncuları Gösterir'),
            new SlashCommandBuilder()
                .setName('aktiflik')
                .setDescription('Aktiflik başlatır (Sadece Swiz Family rolü için)')
                .addIntegerOption(option => option.setName('sayi').setDescription('Süre miktarı (1-100)').setRequired(true))
                .addStringOption(option => option.setName('birim').setDescription('Süre birimi').setRequired(true)
                    .addChoices(
                        { name: 'Saniye', value: 'saniye' }, 
                        { name: 'Dakika', value: 'dakika' }, 
                        { name: 'Saat', value: 'saat' }
                    )),
            new SlashCommandBuilder()
                .setName('aktiflikbitir')
                .setDescription('Aktifliği manuel olarak bitirir ve mesajı siler'),
            new SlashCommandBuilder()
                .setName('maddex')
                .setDescription('Maddex kadrosu oluşturur')
                .addRoleOption(option => option.setName('rol').setDescription('Maddex Kadrosu yapılacak rol').setRequired(true))
                .addIntegerOption(option => option.setName('sayi').setDescription('Süre miktarı (1-100)').setRequired(true))
                .addStringOption(option => option.setName('birim').setDescription('Süre birimi').setRequired(true)
                    .addChoices(
                        { name: 'Saniye', value: 'saniye' }, 
                        { name: 'Dakika', value: 'dakika' }, 
                        { name: 'Saat', value: 'saat' }
                    )),
            new SlashCommandBuilder()
                .setName('maddexbitir')
                .setDescription('Maddexi manuel olarak bitirir ve mesajı siler'),
            new SlashCommandBuilder()
                .setName('etkinlik')
                .setDescription('Etkinlik kadrosu oluşturur (Max 15 kişi)')
                .addStringOption(option => option.setName('isim').setDescription('Etkinlik adı').setRequired(true)),
            new SlashCommandBuilder()
                .setName('uyari')
                .setDescription('Kullanıcıya uyarı verir')
                .addUserOption(option => option.setName('kullanici').setDescription('Uyarılacak kullanıcı').setRequired(true))
                .addStringOption(option => option.setName('tip').setDescription('Uyarı tipi').setRequired(true)
                    .addChoices(
                        { name: '📝 Sözlü Uyarı', value: 'sozlu' },
                        { name: '⚠️ 1x Strike', value: 'strike1' },
                        { name: '⚠️⚠️ 2x Strike', value: 'strike2' },
                        { name: '⚠️⚠️⚠️ 3x Strike', value: 'strike3' }
                    ))
                .addStringOption(option => option.setName('sebep').setDescription('Uyarı sebebi').setRequired(true)),
            new SlashCommandBuilder()
                .setName('uyarilar')
                .setDescription('Kullanıcının uyarılarını gösterir')
                .addUserOption(option => option.setName('kullanici').setDescription('Bakılacak kullanıcı').setRequired(true)),
            new SlashCommandBuilder()
                .setName('uyariaffi')
                .setDescription('Tüm kullanıcıların uyarı rollerini temizler (Yetkili)'),
            new SlashCommandBuilder()
                .setName('uyarisil')
                .setDescription('Belirtilen uyarıyı siler')
                .addUserOption(option => 
                    option.setName('kullanici')
                        .setDescription('Uyarısı silinecek kullanıcı')
                        .setRequired(true))
                .addIntegerOption(option => 
                    option.setName('uyari_no')
                        .setDescription('Silinecek uyarı numarası (/uyarilar ile görebilirsin)')
                        .setRequired(true)
                        .setMinValue(1)),
            new SlashCommandBuilder()
                .setName('uyariliste')
                .setDescription('Tüm kullanıcıların uyarılarını listeler (Yetkili)'),
            new SlashCommandBuilder()
                .setName('clear')
                .setDescription('Belirtilen sayıda mesaj siler')
                .addIntegerOption(option => option.setName('miktar').setDescription('Silinecek mesaj sayısı (1-100)').setRequired(true)),
            new SlashCommandBuilder()
                .setName('kick')
                .setDescription('Kullanıcıyı sunucudan atar')
                .addUserOption(option => option.setName('kullanici').setDescription('Atılacak kullanıcı').setRequired(true))
                .addStringOption(option => option.setName('sebep').setDescription('Atma sebebi').setRequired(false)),
            new SlashCommandBuilder()
                .setName('ban')
                .setDescription('Kullanıcıyı sunucudan yasaklar')
                .addUserOption(option => option.setName('kullanici').setDescription('Yasaklanacak kullanıcı').setRequired(true))
                .addStringOption(option => option.setName('sebep').setDescription('Yasaklama sebebi').setRequired(false)),
            new SlashCommandBuilder()
                .setName('unban')
                .setDescription('Banlı kullanıcının yasağını kaldırır')
                .addStringOption(option => option.setName('kullanici_id').setDescription('Yasağı kaldırılacak kullanıcı ID').setRequired(true))
                .addStringOption(option => option.setName('sebep').setDescription('Sebep').setRequired(false)),
            new SlashCommandBuilder().setName('banlar').setDescription('Banlanmış kullanıcıları listeler')
        ];
return commands;
}
function buildCommands() {
  const all = legacyCommands();
  all.find(c=>c.name==='etkinlik').addIntegerOption(o=>o.setName('kontenjan').setDescription('Kadro kapasitesi (varsayılan 15)').setMinValue(1).setMaxValue(30));
  return [...all, ...require('./features').commands()];
}
module.exports = { legacyCommands, buildCommands };
