const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const { CONFIG, saveLocalConfig } = require('./config');
const { makeId, clip } = require('./utils');
const settingNames = ['TICKET_KATEGORI','LOG_KANALI','YOKLAMA_LOG_KANALI','MADDEX_LOG_KANALI','DESTEK_ROL_1','DESTEK_ROL_2','AILE_UYESI_ROL','SWIZ_ROL','DOST_ROL'];
function commands() {
  return [
    new SlashCommandBuilder().setName('durum').setDescription('Bot sağlığını ve eksik sunucu ayarlarını gösterir'),
    new SlashCommandBuilder().setName('istatistik').setDescription('Mesaj ve ses istatistiklerini gösterir').addUserOption(o=>o.setName('kullanici').setDescription('Boş bırakırsan kendi istatistiklerin')),
    new SlashCommandBuilder().setName('sunucuozet').setDescription('Son 7 günün topluluk ve destek özeti'),
    new SlashCommandBuilder().setName('ticketdevral').setDescription('Bu ticket ile ilgilenen yetkili ol'),
    new SlashCommandBuilder().setName('etkinlikbitir').setDescription('Son açık etkinliği kapat ve kadroyu sakla'),
    new SlashCommandBuilder().setName('yedek').setDescription('Veritabanının tutarlı yerel yedeğini al'),
    new SlashCommandBuilder().setName('ayar').setDescription('Botun kanal ve rol ayarlarını yönet')
      .addStringOption(o=>o.setName('secenek').setDescription('Değiştirilecek ayar').setRequired(true).addChoices(...settingNames.map(s=>({name:s,value:s}))))
      .addChannelOption(o=>o.setName('kanal').setDescription('Kanal ayarları için seç'))
      .addRoleOption(o=>o.setName('rol').setDescription('Rol ayarları için seç')),
  ];
}
const methods = {
  async handleFeature(interaction) {
    if(!interaction.isChatInputCommand()) return false;
    const name = interaction.commandName;
    if(!commands().some(c=>c.name===name)) return false;
    const admin = interaction.user.id === interaction.guild.ownerId || interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
    const isPublic = name === 'istatistik';
    const permission = ['ayar','yedek'].includes(name) ? admin : admin || this.checkPermission(interaction,'uyari');
    if(!isPublic && !permission) { await interaction.reply({content:'Bu komut için yetkin yok.',flags:64}); return true; }
    if(name === 'etkinlikbitir') { await this.closeRoster(interaction); return true; }
    await interaction.deferReply({flags:64});
    if(name === 'istatistik') {
      const user = interaction.options.getUser('kullanici') || interaction.user;
      const row = await this.db.get('SELECT * FROM kullanici_istatistik WHERE kullanici_id=?',[user.id]);
      const ongoing = this.voiceSessions.get(user.id);
      const seconds = (row?.ses_sure || 0) + (ongoing ? Math.floor((Date.now()-ongoing.at)/1000) : 0);
      await interaction.editReply({embeds:[new EmbedBuilder().setTitle('Swiz • Kullanıcı İstatistikleri').setDescription(`${user}`).setColor(0x5865f2).addFields(
        {name:'Mesaj',value:String(row?.toplam_mesaj || 0),inline:true},
        {name:'Ses süresi',value:`${Math.floor(seconds/3600)} saat ${Math.floor(seconds%3600/60)} dakika`,inline:true},
        {name:'En aktif kanal',value:row?.en_aktif_kanal ? `<#${row.en_aktif_kanal}>` : 'Henüz kayıt yok.'},
      ).setFooter({text:'Sayaçlar ölçümün etkinleştirildiği tarihten itibaren birikir; mesaj içeriği kaydedilmez.'})]});
    } else if(name === 'sunucuozet') {
      const since = new Date(Date.now()-7*86400000).toISOString();
      const counts = await this.db.get('SELECT COALESCE(SUM(messages),0) messages, COALESCE(SUM(voice_seconds),0) seconds FROM daily_stats WHERE day>=?',[since.slice(0,10)]);
      const tickets = await this.db.get("SELECT COUNT(*) total, SUM(status='closed') closed, AVG(CASE WHEN status='closed' THEN (julianday(closed_at)-julianday(created_at))*1440 END) minutes FROM tickets WHERE created_at>=?",[since]);
      const events = await this.db.get('SELECT COUNT(*) count FROM event_rosters WHERE created_at>=?',[since]);
      await interaction.editReply({embeds:[new EmbedBuilder().setTitle('Swiz • Son 7 Gün').setColor(0x14b8a6).addFields(
        {name:'Mesaj',value:String(counts.messages),inline:true}, {name:'Ses',value:`${Math.floor(counts.seconds/3600)} saat`,inline:true},
        {name:'Ticket',value:`${tickets.total} açılan / ${tickets.closed || 0} kapanan`,inline:true},
        {name:'Ortalama çözüm',value:tickets.minutes == null ? 'Henüz tamamlanan yok.' : `${Math.round(tickets.minutes)} dakika`,inline:true},
        {name:'Etkinlik',value:String(events.count),inline:true},
      ).setFooter({text:'Mesaj/ses günlük toplamları UTC gün sınırına göre hesaplanır.'})]});
    } else if(name === 'ticketdevral') {
      const result = await this.db.run("UPDATE tickets SET assigned_to=? WHERE channel_id=? AND status='open' AND (assigned_to IS NULL OR assigned_to=?)",[interaction.user.id,interaction.channel.id,interaction.user.id]);
      await interaction.editReply(result.changes ? '✅ Bu ticket sana atandı.' : 'Ticket açık değil veya başka bir yetkiliye atanmış.');
    } else if(name === 'yedek') {
      await this.db.backup();
      await interaction.editReply('✅ Yerel yedek oluşturuldu. Son 14 otomatik/manuel yedek saklanır.');
    } else if(name === 'ayar') {
      const key = interaction.options.getString('secenek');
      const roleSetting = key.includes('ROL');
      const value = roleSetting ? interaction.options.getRole('rol') : interaction.options.getChannel('kanal');
      if(!settingNames.includes(key) || !value || value.guild?.id !== interaction.guild.id) await interaction.editReply('Seçilen ayara uygun bir rol veya kanal belirt.');
      else if(!roleSetting && (key === 'TICKET_KATEGORI' ? value.type !== 4 : !value.isTextBased())) await interaction.editReply('Ticket için kategori, log için metin kanalı seçmelisin.');
      else { CONFIG.IDS[key] = value.id; saveLocalConfig(); await interaction.editReply(`✅ ${key} güncellendi: ${value}`); }
    } else if(name === 'durum') {
      const missing = Object.entries(CONFIG.IDS).filter(([key,id])=>id && !(['EVERYONE_ROL'].includes(key)) && !(interaction.guild.roles.cache.has(id)||interaction.guild.channels.cache.has(id))).map(([key])=>key);
      const open = await this.db.get("SELECT COUNT(*) count FROM tickets WHERE status='open'");
      const active = await this.db.get('SELECT COUNT(*) count FROM aktif_durumlar WHERE tamamlandi=0');
      const botMember = interaction.guild.members.me;
      const permissions = ['ManageChannels','ManageRoles','ManageMessages','ViewChannel','SendMessages'].filter(p=>!botMember?.permissions.has(PermissionsBitField.Flags[p]));
      await interaction.editReply({embeds:[new EmbedBuilder().setTitle('Swiz • Durum').setColor(missing.length || permissions.length ? 0xf59e0b : 0x22c55e).addFields(
        {name:'Çalışma süresi',value:`${Math.floor(process.uptime()/60)} dakika`,inline:true}, {name:'Açık işler',value:`${open.count} ticket · ${active.count} yoklama/kadro`,inline:true},
        {name:'Bulunamayan ayarlar',value:clip(missing.join(', ')||'Yok')}, {name:'Eksik bot izinleri',value:clip(permissions.join(', ')||'Yok')},
      ).setFooter({text:'Rol hiyerarşisi ve kanala özel izinler de işlem sırasında kontrol edilir.'})]});
    }
    return true;
  },
  async handleUyariAffi(interaction) {
    if(!this.checkPermission(interaction,'uyariaffi')) return interaction.reply({content:'Bu işlem için yetkin yok.',flags:64});
    const id = makeId();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`affi_onay_${id}`).setLabel('Tüm uyarıları temizle').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`affi_iptal_${id}`).setLabel('İptal').setStyle(ButtonStyle.Secondary),
    );
    const response = await interaction.reply({content:'Tüm uyarı kayıtları ve uyarı rolleri temizlenecek. İşlem öncesinde yerel yedek alınır. Onay 30 saniye geçerlidir.',components:[row],flags:64,fetchReply:true});
    this.confirmations.set(id,{user:interaction.user.id,guild:interaction.guild.id,message:response.id,expires:Date.now()+30000});
    const timer = setTimeout(()=>{this.confirmations.delete(id); interaction.editReply({content:'Onay süresi sona erdi.',components:[]}).catch(()=>{});},30000);
    timer.unref();
    this.confirmations.get(id).timer = timer;
  },
  async handleUyariAffiButton(interaction) {
    const id = interaction.customId.split('_').at(-1);
    const pending = this.confirmations.get(id);
    if(!pending || pending.user !== interaction.user.id || pending.guild !== interaction.guild.id || pending.message !== interaction.message.id || pending.expires < Date.now() || !this.checkPermission(interaction,'uyariaffi')) return interaction.reply({content:'Bu onay geçersiz, süresi dolmuş veya sana ait değil.',flags:64});
    this.confirmations.delete(id); clearTimeout(pending.timer);
    if(interaction.customId.startsWith('affi_iptal_')) return interaction.update({content:'İşlem iptal edildi.',components:[]});
    await interaction.update({content:'Yedek alınıyor ve uyarılar temizleniyor…',components:[]});
    return this.locks.run('warning-reset',async()=>{
      await this.db.backup();
      const members = await interaction.guild.members.fetch();
      const failed = [];
      for(const member of members.values()) {
        if(member.user.bot) continue;
        const roles = Object.values(CONFIG.WARNING_ROLES).filter(id=>member.roles.cache.has(id));
        if(roles.length) await member.roles.remove(roles,'Yetkili uyarı affı').catch(()=>failed.push(member.id));
      }
      if(failed.length) await this.db.run(`DELETE FROM uyarilar WHERE kullanici_id NOT IN (${failed.map(()=>'?').join(',')})`,failed);
      else await this.db.run('DELETE FROM uyarilar');
      await this.db.run("UPDATE config SET deger=(SELECT COUNT(*) FROM uyarilar) WHERE anahtar='toplam_uyari'");
      await this.db.run('INSERT INTO moderation_history(actor_id,action,at,detail) VALUES (?,?,?,?)',[interaction.user.id,'warning_reset',new Date().toISOString(),`${failed.length} rol işlemi başarısız`]);
      await interaction.editReply({content:failed.length ? `Uyarı affı tamamlandı. Rolü kaldırılamayan ${failed.length} kişinin kayıtları korundu; bot rol hiyerarşisini kontrol et.` : '✅ Tüm uyarılar temizlendi. İşlem öncesi yedek saklandı.',components:[]});
    });
  },
};
module.exports = { commands, methods };
