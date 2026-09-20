const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CONFIG } = require('./config');
const { makeId, clip } = require('./utils');
async function changeAttendance(bot, interaction, id, type, leave = false) {
  await interaction.deferReply({flags:64});
  return bot.locks.run(`attendance:${id}`, async()=>{
    const row = await bot.db.get('SELECT * FROM aktif_durumlar WHERE durum_id=? AND tip=?',[id,type]);
    if(!row || row.tamamlandi || Date.parse(row.bitis_zamani) <= Date.now() || row.mesaj_id !== interaction.message.id || row.kanal_id !== interaction.channel.id) return interaction.editReply('Bu katılım artık açık değil.');
    if (!leave && row.rol_id && !interaction.member.roles.cache.has(row.rol_id)) return interaction.editReply('Bu yoklama/kadro için seçilen role sahip olmalısın.');
    const members = new Set(JSON.parse(row.katilanlar || '[]'));
    if(leave ? !members.has(interaction.user.id) : members.has(interaction.user.id)) return interaction.editReply(leave ? 'Kadroda değilsin.' : 'Zaten katıldın.');
    leave ? members.delete(interaction.user.id) : members.add(interaction.user.id);
    const result = await bot.db.run('UPDATE aktif_durumlar SET katilanlar=? WHERE durum_id=? AND tamamlandi=0',[JSON.stringify([...members]),id]);
    if(!result.changes) return interaction.editReply('Katılım sona erdi.');
    bot[type === 'maddex' ? 'maddexKatilim' : 'aktiflikKatilim'].set(id,members);
    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    embed.spliceFields(1,1,{name:'✅ Katılanlar',value:`**${members.size}** kişi`,inline:true});
    await interaction.message.edit({embeds:[embed]});
    await interaction.editReply(leave ? '✅ Kadrodan çıktın.' : '✅ Katılımın kaydedildi.');
  });
}
async function finishLatest(bot, interaction, type) {
  await interaction.deferReply({flags:64});
  const row = await bot.db.get('SELECT * FROM aktif_durumlar WHERE tip=? AND tamamlandi=0 AND (guild_id=? OR guild_id IS NULL) ORDER BY baslama_zamani DESC LIMIT 1',[type,interaction.guild.id]);
  if(!row) return interaction.editReply('Şu anda devam eden bir kayıt yok.');
  const role = interaction.guild.roles.cache.get(row.rol_id);
  if(!role) return interaction.editReply('İlgili rol bulunamadı; /durum ile ayarları kontrol et.');
  const channel = await bot.client.channels.fetch(row.kanal_id).catch(()=>null);
  const message = channel ? await channel.messages.fetch(row.mesaj_id).catch(()=>null) : null;
  await bot[type === 'maddex' ? 'bitirMaddex' : 'bitirAktiflik'](interaction,row.durum_id,role,message,true);
  if(message) await message.delete().catch(()=>{});
  return interaction.editReply('✅ Katılım tamamlandı, rapor hazırlandı.');
}
async function renderRoster(bot, event) {
  const members = await bot.db.query('SELECT * FROM event_members WHERE event_id=? ORDER BY joined_at,rowid',[event.id]);
  const admitted = members.slice(0,event.capacity);
  const waiting = members.slice(event.capacity);
  const embed = new EmbedBuilder().setTitle('Swiz • Etkinlik Kadrosu').setDescription(clip(event.name,300)).setColor(event.closed_at ? 0x64748b : 0x8b5cf6).addFields(
    {name:`Katılımcılar (${admitted.length}/${event.capacity})`,value:clip(admitted.map((m,i)=>`${i+1}. <@${m.user_id}>`).join('\n') || 'Henüz katılan yok.')},
    {name:`Bekleme listesi (${waiting.length})`,value:clip(waiting.slice(0,20).map((m,i)=>`${i+1}. <@${m.user_id}>`).join('\n') || 'Bekleyen yok.')},
  ).setFooter({text:event.closed_at ? 'Etkinlik kapatıldı' : 'Yer açıldığında sıradaki kişi otomatik olarak kadroya alınır.'});
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`etkinlik_${event.id}`).setLabel('Katıl').setStyle(ButtonStyle.Success).setDisabled(!!event.closed_at),
    new ButtonBuilder().setCustomId(`etkinlik_cik_${event.id}`).setLabel('Ayrıl').setStyle(ButtonStyle.Secondary).setDisabled(!!event.closed_at),
  );
  return {embeds:[embed],components:[row],allowedMentions:{parse:[]}};
}
module.exports = {
  async handleAktiflikButton(i) { return changeAttendance(this,i,i.customId.slice('aktiflik_'.length),'aktiflik'); },
  async handleMaddexButton(i) {
    const leave = i.customId.startsWith('maddex_cik_');
    return changeAttendance(this,i,i.customId.replace(leave ? 'maddex_cik_' : 'maddex_katil_',''),'maddex',leave);
  },
  async handleAktiflikBitir(i) { return finishLatest(this,i,'aktiflik'); },
  async handleMaddexBitir(i) { return finishLatest(this,i,'maddex'); },
  async restoreAktifDurumlar() {
    const guild = this.client.guilds.cache.get(CONFIG.GUILD_ID);
    if(!guild) return;
    await this.db.run('UPDATE aktif_durumlar SET guild_id=? WHERE guild_id IS NULL',[guild.id]);
    const rows = await this.db.query('SELECT * FROM aktif_durumlar WHERE tamamlandi=0 AND guild_id=?',[guild.id]);
    for(const row of rows) {
      const collection = row.tip === 'maddex' ? this.maddexKatilim : this.aktiflikKatilim;
      collection.set(row.durum_id,new Set(JSON.parse(row.katilanlar || '[]')));
      const run = async()=>{
        const role = guild.roles.cache.get(row.rol_id);
        if(!role) { console.warn('Etkinlik rolü bulunamadı:',row.durum_id); return; }
        const channel = await this.client.channels.fetch(row.kanal_id).catch(()=>null);
        const message = channel && row.mesaj_id ? await channel.messages.fetch(row.mesaj_id).catch(()=>null) : null;
        await this[row.tip === 'maddex' ? 'bitirMaddex' : 'bitirAktiflik']({guild,user:{tag:'Sistem (yeniden başlatma)'}},row.durum_id,role,message,false);
      };
      const remaining = Date.parse(row.bitis_zamani)-Date.now();
      if(remaining <= 0) await run();
      else {
        const timer = setTimeout(()=>run().catch(e=>console.error('Etkinlik kurtarma:',e.message)),remaining);
        this[row.tip === 'maddex' ? 'maddexTimers' : 'aktiflikTimers'].set(row.durum_id,timer);
      }
    }
  },
  async handleEtkinlik(interaction) {
    await interaction.deferReply();
    const event = {id:makeId(),guild_id:interaction.guild.id,channel_id:interaction.channel.id,name:interaction.options.getString('isim'),capacity:interaction.options.getInteger('kontenjan') || 15,creator_id:interaction.user.id,created_at:new Date().toISOString()};
    await this.db.run('INSERT INTO event_rosters(id,guild_id,channel_id,name,capacity,creator_id,created_at) VALUES (?,?,?,?,?,?,?)',Object.values(event));
    const message = await interaction.editReply(await renderRoster(this,event));
    await this.db.run('UPDATE event_rosters SET message_id=? WHERE id=?',[message.id,event.id]);
  },
  async handleEtkinlikButton(interaction) {
    await interaction.deferReply({flags:64});
    const leave = interaction.customId.startsWith('etkinlik_cik_');
    const id = interaction.customId.replace(leave ? 'etkinlik_cik_' : 'etkinlik_','');
    return this.locks.run(`roster:${id}`,async()=>{
      let event = await this.db.get('SELECT * FROM event_rosters WHERE id=?',[id]);
      if(!event) {
        const legacy = await this.db.get('SELECT * FROM etkinlik_kayitlari WHERE etkinlik_id=?',[id]);
        if(legacy && !legacy.tamamlandi) {
          await this.db.run('INSERT OR IGNORE INTO event_rosters(id,guild_id,channel_id,message_id,name,capacity,creator_id,created_at) VALUES (?,?,?,?,?,?,?,?)',[id,interaction.guild.id,interaction.channel.id,interaction.message.id,legacy.etkinlik_adi,15,legacy.baslatan_id,legacy.baslama_tarihi]);
          await this.db.run('INSERT OR IGNORE INTO event_members(event_id,user_id,joined_at) SELECT etkinlik_id,kullanici_id,CAST(strftime(\'%s\',katilma_tarihi) AS INTEGER)*1000 FROM etkinlik_katilim WHERE etkinlik_id=?',[id]);
          event = await this.db.get('SELECT * FROM event_rosters WHERE id=?',[id]);
        }
      }
      if(!event || event.closed_at || event.message_id !== interaction.message.id || event.guild_id !== interaction.guild.id) return interaction.editReply('Bu etkinlik katılıma kapalı.');
      const before = await this.db.query('SELECT user_id FROM event_members WHERE event_id=? ORDER BY joined_at,rowid',[id]);
      if(leave) await this.db.run('DELETE FROM event_members WHERE event_id=? AND user_id=?',[id,interaction.user.id]);
      else await this.db.run('INSERT OR IGNORE INTO event_members(event_id,user_id,joined_at) VALUES (?,?,?)',[id,interaction.user.id,Date.now()]);
      const members = await this.db.query('SELECT user_id FROM event_members WHERE event_id=? ORDER BY joined_at,rowid',[id]);
      await interaction.message.edit(await renderRoster(this,event));
      const position = members.findIndex(m=>m.user_id === interaction.user.id);
      const already = before.some(m=>m.user_id === interaction.user.id);
      return interaction.editReply(leave ? 'Etkinlikten ayrıldın. Yer açıldıysa bekleme listesi ilerletildi.' : already ? 'Zaten kayıtlısın.' : position < event.capacity ? '✅ Kadroya katıldın.' : `Bekleme listesine alındın. Sıran: ${position-event.capacity+1}`);
    });
  },
  async closeRoster(interaction) {
    await interaction.deferReply({flags:64});
    const event = await this.db.get('SELECT * FROM event_rosters WHERE guild_id=? AND closed_at IS NULL ORDER BY created_at DESC LIMIT 1',[interaction.guild.id]);
    if(!event) return interaction.editReply('Açık etkinlik bulunamadı.');
    return this.locks.run(`roster:${event.id}`,async()=>{
      event.closed_at = new Date().toISOString();
      await this.db.run('UPDATE event_rosters SET closed_at=? WHERE id=?',[event.closed_at,event.id]);
      await this.db.run('UPDATE etkinlik_kayitlari SET tamamlandi=1 WHERE etkinlik_id=?',[event.id]);
      const channel = await this.client.channels.fetch(event.channel_id).catch(()=>null);
      const message = channel ? await channel.messages.fetch(event.message_id).catch(()=>null) : null;
      if(message) await message.edit(await renderRoster(this,event));
      return interaction.editReply('✅ Son açık etkinlik kapatıldı; kadro kaydı saklandı.');
    });
  },
};
