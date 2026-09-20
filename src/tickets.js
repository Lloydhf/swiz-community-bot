const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const { CONFIG } = require('./config');
function canClose(interaction, row) {
  return row.user_id === interaction.user.id || interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ||
    [CONFIG.IDS.DESTEK_ROL_1,CONFIG.IDS.DESTEK_ROL_2].some(id => interaction.member?.roles.cache.has(id));
}
module.exports = {
  async restoreOpenTickets() {
    const guild = this.client.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return;
    await guild.channels.fetch();
    for (const channel of guild.channels.cache.values()) {
      if (channel.parentId !== CONFIG.IDS.TICKET_KATEGORI || !channel.name.startsWith('ticket-')) continue;
      const ticketNo = Number(channel.name.split('-').pop());
      if (!Number.isInteger(ticketNo)) continue;
      const log = await this.db.get('SELECT * FROM ticket_log WHERE ticket_no = ?', [ticketNo]);
      const owner = log?.acan_kullanici || channel.permissionOverwrites.cache.find(o => o.type === 1 && o.id !== this.client.user.id)?.id;
      if (owner) await this.db.run('INSERT OR IGNORE INTO tickets(ticket_no,guild_id,user_id,channel_id,status,created_at) VALUES (?,?,?,?,?,?)',
        [ticketNo,guild.id,owner,channel.id,'open',log?.acilma_tarihi || new Date().toISOString()]);
    }
    const rows = await this.db.query("SELECT * FROM tickets WHERE status IN ('open','creating') AND guild_id = ?", [guild.id]);
    for (const row of rows) {
      if (!row.channel_id || !guild.channels.cache.has(row.channel_id)) await this.db.run("UPDATE tickets SET status='closed', closed_at=? WHERE ticket_no=?",[new Date().toISOString(), row.ticket_no]);
    }
    await this.db.run("UPDATE config SET deger=MAX(CAST(deger AS INTEGER),COALESCE((SELECT MAX(ticket_no) FROM tickets),0)) WHERE anahtar='ticket_sayaci'");
  },
  async handleTicketButton(interaction) {
    await interaction.deferReply({flags:64});
    return this.locks.run(`ticket:${interaction.guild.id}:${interaction.user.id}`, async () => {
      let existing = await this.db.get("SELECT * FROM tickets WHERE guild_id=? AND user_id=? AND status IN ('creating','open')", [interaction.guild.id,interaction.user.id]);
      if (existing) {
        const channel = existing.channel_id ? await interaction.guild.channels.fetch(existing.channel_id).catch(e => { if(e.code === 10003) return null; throw e; }) : null;
        if (channel || existing.status === 'creating') return interaction.editReply(`Zaten açık bir ticket'ın var${channel ? ': ' + channel : '. Oluşturma devam ediyor.'}`);
        await this.db.run("UPDATE tickets SET status='closed',closed_at=? WHERE ticket_no=?",[new Date().toISOString(),existing.ticket_no]);
      }
      const limit = await this.db.get('SELECT son_ticket FROM ticket_limits WHERE kullanici_id=?',[interaction.user.id]);
      const remaining = limit ? 30 * 60000 - (Date.now() - new Date(limit.son_ticket).getTime()) : 0;
      if (remaining > 0) return interaction.editReply(`Yeni ticket için ${Math.ceil(remaining/60000)} dakika beklemelisin.`);
      const category = interaction.guild.channels.cache.get(CONFIG.IDS.TICKET_KATEGORI);
      if (!category || category.type !== 4) return interaction.editReply('Ticket kategorisi bulunamadı. Yetkili /ayar ile ayarlayabilir.');
      const no = await this.db.nextCounter('ticket_sayaci');
      const createdAt = new Date().toISOString();
      await this.db.run('INSERT INTO tickets(ticket_no,guild_id,user_id,status,created_at) VALUES (?,?,?,?,?)',[no,interaction.guild.id,interaction.user.id,'creating',createdAt]);
      let channel;
      try {
        const P = PermissionsBitField.Flags;
        const overwrites = [
          {id:interaction.guild.id,deny:[P.ViewChannel]},
          {id:interaction.user.id,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.AttachFiles]},
          {id:this.client.user.id,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.ManageChannels]},
        ];
        for (const id of new Set([CONFIG.IDS.DESTEK_ROL_1,CONFIG.IDS.DESTEK_ROL_2])) {
          if (interaction.guild.roles.cache.has(id)) overwrites.push({id,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.ManageMessages]});
        }
        channel = await interaction.guild.channels.create({name:`ticket-${interaction.user.username.slice(0,10)}-${no}`,type:0,parent:category.id,permissionOverwrites:overwrites,topic:`Ticket #${no} | ${interaction.user.id}`});
        await this.db.run("UPDATE tickets SET channel_id=?,status='open' WHERE ticket_no=?",[channel.id,no]);
        await channel.send({content:`${interaction.user}`,embeds:[new EmbedBuilder().setTitle(`Swiz • Ticket #${no}`).setDescription('Sorununu veya başvurunu buraya yazabilirsin. Yetkili /ticketdevral ile talebi üstlenebilir.').setColor(0x5865f2)],components:[this.getTicketCloseButton()],allowedMentions:{users:[interaction.user.id]}});
        await this.db.run('INSERT OR REPLACE INTO ticket_limits(kullanici_id,son_ticket) VALUES (?,?)',[interaction.user.id,createdAt]);
        await this.db.run('INSERT OR REPLACE INTO ticket_log(ticket_no,acan_kullanici,acilma_tarihi) VALUES (?,?,?)',[no,interaction.user.id,createdAt]);
      } catch(error) {
        let removed = !channel;
        if(channel) removed = await channel.delete('Ticket oluşturma tamamlanamadı').then(()=>true,()=>false);
        if(removed) await this.db.run("UPDATE tickets SET status='failed',closed_at=? WHERE ticket_no=?",[new Date().toISOString(),no]);
        console.error('Ticket oluşturma:', error.message);
        return interaction.editReply(removed ? 'Ticket açılamadı. Bekleme süresi uygulanmadı; yetkileri kontrol edip tekrar deneyebilirsin.' : `Ticket kısmen oluşturuldu: ${channel}. Yetkilinin kontrol etmesi gerekiyor.`);
      }
      await interaction.editReply(`✅ Ticket oluşturuldu: ${channel}`);
      await this.logEvent(interaction.guild,'ticket_acildi',`**Açan:** ${interaction.user.tag}\n**Ticket No:** #${no}`).catch(()=>{});
    });
  },
  async handleTicketCloseButton(interaction) {
    await interaction.deferReply({flags:64});
    return this.locks.run(`close:${interaction.channel.id}`,async()=>{
      const row = await this.db.get("SELECT * FROM tickets WHERE channel_id=? AND status='open'",[interaction.channel.id]);
      if(!row) return interaction.editReply('Bu kanal için açık ticket kaydı bulunamadı.');
      if(!canClose(interaction,row)) return interaction.editReply('Bu ticket’ı kapatma yetkin yok.');
      await interaction.editReply('Ticket kapatılıyor…');
      await interaction.channel.delete(`Ticket #${row.ticket_no}; kapatan ${interaction.user.id}`);
      const now = new Date().toISOString();
      await this.db.run("UPDATE tickets SET status='closed',closed_at=?,close_reason=? WHERE ticket_no=?",[now,'Kullanıcı/yetkili tarafından kapatıldı',row.ticket_no]);
      await this.db.run('UPDATE ticket_log SET kapanma_tarihi=? WHERE ticket_no=?',[now,row.ticket_no]);
      await this.logEvent(interaction.guild,'ticket_kapandi',`**Kapatan:** ${interaction.user.tag}\n**Ticket No:** #${row.ticket_no}`).catch(()=>{});
    });
  },
};
