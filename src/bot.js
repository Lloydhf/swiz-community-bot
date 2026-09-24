const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    SlashCommandBuilder, 
    REST, 
    Routes, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionsBitField, 
    Collection,
    ActivityType
} = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const axios = require('axios');
const { CONFIG, saveLocalConfig } = require('./config');
const { FIVEM_SERVERS, SERVER_SHORTCUTS } = require('./servers');
const { DatabaseManager } = require('./database');
const { KeyedLock, makeId } = require('./utils');
const { buildCommands } = require('./commands');

class SwizBot {
    constructor(options = {}) {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildModeration,
                GatewayIntentBits.GuildMessageReactions,
                GatewayIntentBits.GuildPresences,
                GatewayIntentBits.GuildVoiceStates
            ]
        });

        this.db = options.db || new DatabaseManager();
        this.locks = new KeyedLock();
        this.confirmations = new Map();
        this.voiceSessions = new Map();
        this.runtimeTimers = new Set();
        this.stopping = false;
        this.commands = new Collection();
        this.aktiflikKatilim = new Collection();
        this.aktiflikTimers = new Collection();
        this.maddexKatilim = new Collection();
        this.maddexTimers = new Collection();
        this.etkinlikKatilim = new Collection();
        this.panelSayfa = 0;
        this.OYUNCU_LIMIT = 10;

        this.setupEventHandlers();
    }

    // ========================================================================
    // 📊 FIVEM VERİ ÇEKME
    // ========================================================================

    // ========================================================================
    // ✅ YETKİ KONTROL
    // ========================================================================
    checkPermission(interaction, commandName) {
        const permissionMap = {
            'ticket': [CONFIG.IDS.PRIVILEGED_ID_1, CONFIG.IDS.PRIVILEGED_ID_2],
            'panel': [CONFIG.IDS.PRIVILEGED_ID_3],
            'aktiflik': [CONFIG.IDS.PRIVILEGED_ID_4, CONFIG.IDS.DESTEK_ROL_1],
            'aktiflikbitir': [CONFIG.IDS.PRIVILEGED_ID_4, CONFIG.IDS.DESTEK_ROL_1],
            'maddex': [CONFIG.IDS.PRIVILEGED_ID_4, CONFIG.IDS.DESTEK_ROL_1],
            'maddexbitir': [CONFIG.IDS.PRIVILEGED_ID_4, CONFIG.IDS.DESTEK_ROL_1],
            'etkinlik': [CONFIG.IDS.PRIVILEGED_ID_4, CONFIG.IDS.DESTEK_ROL_1],
            'uyari': [CONFIG.IDS.PRIVILEGED_ID_4, CONFIG.IDS.DESTEK_ROL_1],
            'uyarilar': [CONFIG.IDS.PRIVILEGED_ID_4, CONFIG.IDS.DESTEK_ROL_1],
            'uyariaffi': [CONFIG.IDS.PRIVILEGED_ID_4, CONFIG.IDS.DESTEK_ROL_1],
            'uyarisil': [CONFIG.IDS.PRIVILEGED_ID_4, CONFIG.IDS.DESTEK_ROL_1],
            'uyariliste': [CONFIG.IDS.PRIVILEGED_ID_4, CONFIG.IDS.DESTEK_ROL_1],
            'clear': [CONFIG.IDS.PRIVILEGED_ID_4, CONFIG.IDS.DESTEK_ROL_1],
            'kick': [CONFIG.IDS.PRIVILEGED_ID_4, CONFIG.IDS.DESTEK_ROL_1],
            'ban': [CONFIG.IDS.PRIVILEGED_ID_4, CONFIG.IDS.DESTEK_ROL_1],
            'unban': [CONFIG.IDS.PRIVILEGED_ID_4],
            'banlar': [CONFIG.IDS.PRIVILEGED_ID_4, CONFIG.IDS.DESTEK_ROL_1],
            'yetki-ayarla': [CONFIG.IDS.PRIVILEGED_ID_1]
        };

        const requiredRoles = permissionMap[commandName];
        if (!requiredRoles) return ['komutlar', 'bot', 'bilgi', 'alesta', 'swiz', 'sunucular', 'id', 'tag', 'aktif'].includes(commandName);
        
        if (interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator) || 
            interaction.user.id === interaction.guild.ownerId) return true;
        
        const userRoles = interaction.member.roles.cache.map(r => r.id);
        return requiredRoles.some(roleId => userRoles.includes(roleId) || roleId === interaction.user.id);
    }

    // ========================================================================
    // 📝 LOG SİSTEMİ
    // ========================================================================
    async logEvent(guild, eventType, description, color = null, logChannelId = null) {
        const logChannel = logChannelId 
            ? guild.channels.cache.get(logChannelId)
            : guild.channels.cache.get(CONFIG.IDS.LOG_KANALI);
            
        if (!logChannel) return;

        const colors = {
            ticket_acildi: 0x00FF00,
            ticket_kapandi: 0xFFA500,
            uyari_verildi: 0xFFFF00,
            uyari_affi: 0x9B59B6,
            uyari_silindi: 0x00FF00,
            kullanici_ban: 0xFF0000,
            kullanici_unban: 0x00FF00,
            kullanici_kick: 0xFF0000,
            kanal_silindi: 0xFF0000,
            kanal_duzenlendi: 0xFF0000,
            aktiflik_basladi: 0x00FFFF,
            aktiflik_bitti: 0x00FFFF,
            maddex_basladi: 0xFF69B4,
            maddex_bitti: 0xFF69B4,
            etkinlik_basladi: 0x9B59B6,
            etkinlik_bitti: 0x9B59B6
        };

        const embed = new EmbedBuilder()
            .setTitle(`📋 Swiz Bot's | ${this.formatEventName(eventType)}`)
            .setDescription(description)
            .setColor(color || colors[eventType] || 0x808080)
            .setTimestamp()
            .setFooter({ text: `Swiz Bot's Log Sistemi` });

        await logChannel.send({ embeds: [embed] }).catch(() => {});
    }

    formatEventName(eventType) {
        return eventType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    // ========================================================================
    // 🎯 UYARI PUAN HESAPLAMA
    // ========================================================================
    calculateWarningPoints(warningType) {
        const points = {
            'sozlu': 0.5,
            'strike1': 1,
            'strike2': 2,
            'strike3': 3
        };
        return points[warningType] || 0;
    }

    // ========================================================================
    // 🎯 UYARI ROLÜ GÜNCELLEME
    // ========================================================================
    async updateWarningRoles(member, totalPoints) {
        console.log(`📊 ${member.user.tag} için uyarı puanı: ${totalPoints}`);

        const roles = CONFIG.WARNING_ROLES;
        
        await member.roles.remove(Object.values(roles).filter(Boolean)).catch(() => {});

        if (totalPoints >= 3) {
            if (roles.STRIKE3) await member.roles.add(roles.STRIKE3).catch(() => {});
            console.log('✅ 3x Strike rolü eklendi');
        } 
        else if (totalPoints >= 2.5) {
            if (roles.STRIKE2) await member.roles.add(roles.STRIKE2).catch(() => {});
            if (roles.SOZLU) await member.roles.add(roles.SOZLU).catch(() => {});
            console.log('✅ 2x Strike + Sözlü rolleri eklendi');
        } 
        else if (totalPoints >= 2) {
            if (roles.STRIKE2) await member.roles.add(roles.STRIKE2).catch(() => {});
            console.log('✅ 2x Strike rolü eklendi');
        } 
        else if (totalPoints >= 1.5) {
            if (roles.STRIKE1) await member.roles.add(roles.STRIKE1).catch(() => {});
            if (roles.SOZLU) await member.roles.add(roles.SOZLU).catch(() => {});
            console.log('✅ 1x Strike + Sözlü rolleri eklendi');
        } 
        else if (totalPoints >= 1) {
            if (roles.STRIKE1) await member.roles.add(roles.STRIKE1).catch(() => {});
            console.log('✅ 1x Strike rolü eklendi');
        } 
        else if (totalPoints >= 0.5) {
            if (roles.SOZLU) await member.roles.add(roles.SOZLU).catch(() => {});
            console.log('✅ Sözlü uyarı rolü eklendi');
        }
    }

    // ========================================================================
    // 📊 PANEL GÜNCELLEME - HATA YAKALAMALI
    // ========================================================================
    async updatePanel() {
        try {
            const panelKanal = await this.db.get('SELECT deger FROM config WHERE anahtar = "panel_kanal"');
            const panelMesaj = await this.db.get('SELECT deger FROM config WHERE anahtar = "panel_mesaj"');
            
            if (!panelKanal?.deger || !panelMesaj?.deger || panelKanal.deger === '0' || panelMesaj.deger === '0') return;
            
            const channel = await this.client.channels.fetch(panelKanal.deger).catch(() => null);
            if (!channel) return;
            
            const message = await channel.messages.fetch(panelMesaj.deger).catch(() => null);
            if (!message) return;
            
            let players;
            try { players = await this.getServerPlayers(FIVEM_SERVERS[0].url); }
            catch(error) {
                const unavailable = new EmbedBuilder().setTitle('Swiz • Oyuncu listesi güncellenemedi').setDescription(error.publicMessage || 'Veri servisine erişilemiyor.').setColor(0xf59e0b).setTimestamp();
                await message.edit({embeds:[unavailable],components:[]});
                return;
            }
            const totalPages = Math.ceil(players.length / this.OYUNCU_LIMIT) || 1;
            
            if (this.panelSayfa >= totalPages) this.panelSayfa = 0;
            
            const start = this.panelSayfa * this.OYUNCU_LIMIT;
            const end = start + this.OYUNCU_LIMIT;
            const pagePlayers = players.slice(start, end);
            
            let playerList = '';
            if (pagePlayers.length > 0) {
                playerList = pagePlayers.map(p => 
                    `\`[${p.id?.toString().padStart(4) || '???'}]\` **${p.name?.substring(0, 30) || 'İsimsiz'}** | Ping: ${p.ping || '?'}ms`
                ).join('\n');
            } else {
                playerList = 'Sunucuda oyuncu yok.';
            }
            
            const embed = new EmbedBuilder()
                .setTitle(' Swiz Bot\'s | Canlı Oyuncu Listesi')
                .setDescription(`**${FIVEM_SERVERS[0].name}**`)
                .addFields(
                    { name: '📊 Toplam Oyuncu', value: players.length.toString(), inline: true },
                    { name: '📄 Sayfa', value: `${this.panelSayfa + 1}/${totalPages}`, inline: true },
                    { name: '📋 Oyuncular', value: playerList }
                )
                .setColor(0xFFD700)
                .setFooter({ text: `Son güncelleme: ${new Date().toLocaleTimeString('tr-TR')}` })
                .setTimestamp();
            
            await message.edit({ 
                embeds: [embed], 
                components: [this.getPanelButtons(this.panelSayfa, totalPages)] 
            }).catch(() => {});
            
        } catch (error) {
            console.log('Panel güncelleme hatası:', error.message);
        }
    }

    // ========================================================================
    // 📤 SAYFALI MESAJ GÖNDERME - HER KULLANICI KENDİ SAYFASINI GÖRÜR
    // ========================================================================
    async sendPaginatedButtonEmbeds(channel, title, items, color, baslik = '') {
        if (!channel || items.length === 0) {
            if (!channel) return;
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription('Liste boş')
                .setColor(color);
            return await channel.send({ embeds: [embed] });
        }
        
        const pageSize = 10;
        const pages = Math.ceil(items.length / pageSize);
        
        const embeds = [];
        for (let i = 0; i < pages; i++) {
            const start = i * pageSize;
            const end = start + pageSize;
            const pageItems = items.slice(start, end);
            
            const description = pageItems.length > 0 ? pageItems.join('\n') : 'Liste boş';
            
            const embed = new EmbedBuilder()
                .setTitle(`${title}${baslik ? ` - ${baslik}` : ''}`)
                .setDescription(description)
                .setColor(color)
                .setFooter({ text: `Sayfa ${i + 1}/${pages}` });
            
            embeds.push(embed);
        }
        
        const uniqueId = Date.now() + '_' + Math.random().toString(36).substring(2, 10);
        
        const sentMsg = await channel.send({ 
            embeds: [embeds[0]], 
            components: [] 
        });
        
        if (pages <= 1) return sentMsg;
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`log_onceki_${uniqueId}`)
                    .setLabel('◀ Önceki')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`log_bilgi_${uniqueId}`)
                    .setLabel(`${1}/${pages}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`log_sonraki_${uniqueId}`)
                    .setLabel('Sonraki ▶')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(pages <= 1)
            );
        
        await sentMsg.edit({ components: [row] });
        
        const collector = sentMsg.createMessageComponentCollector({ 
            filter: i => i.customId.includes(uniqueId)
        });
        
        collector.on('collect', async i => {
            if (!i.isRepliable()) return;
            
            let currentPage = 0;
            const currentEmbed = i.message.embeds[0];
            const footerText = currentEmbed.footer?.text || '';
            const match = footerText.match(/Sayfa (\d+)/);
            if (match) {
                currentPage = parseInt(match[1]) - 1;
            }
            
            if (i.customId.includes('onceki')) {
                currentPage--;
            } else if (i.customId.includes('sonraki')) {
                currentPage++;
            }
            
            if (currentPage < 0) currentPage = 0;
            if (currentPage >= pages) currentPage = pages - 1;
            
            const newRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`log_onceki_${uniqueId}`)
                        .setLabel('◀ Önceki')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === 0),
                    new ButtonBuilder()
                        .setCustomId(`log_bilgi_${uniqueId}`)
                        .setLabel(`${currentPage + 1}/${pages}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId(`log_sonraki_${uniqueId}`)
                        .setLabel('Sonraki ▶')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === pages - 1)
                );
            
            try {
                await i.update({ 
                    embeds: [embeds[currentPage]], 
                    components: [newRow] 
                });
            } catch (error) {
                if (error.code === 10062) {
                    console.log('⚠️ Etkileşim süresi doldu, buton devre dışı');
                } else {
                    console.error('Buton güncelleme hatası:', error);
                }
            }
        });
        
        return sentMsg;
    }

    // ========================================================================
    // 🔘 BUTON OLUŞTURUCULAR
    // ========================================================================
    getTicketButton() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_ac')
                .setLabel('Ticket Aç')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🎫')
        );
    }

    getTicketCloseButton() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_kapat')
                .setLabel('Ticket Kapat')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔒')
        );
    }

    getAktiflikButton(aktiflikId) {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`aktiflik_${aktiflikId}`)
                .setLabel('Tıkla')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅')
        );
    }

    getMaddexButton(maddexId) {
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`maddex_katil_${maddexId}`)
                    .setLabel('Katıl')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('📌'),
                new ButtonBuilder()
                    .setCustomId(`maddex_cik_${maddexId}`)
                    .setLabel('Çık')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🚪')
            );
        return row;
    }

    getEtkinlikButton(etkinlikId) {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`etkinlik_${etkinlikId}`)
                .setLabel('📋 Etkinliğe Katıl')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎮')
        );
    }

    getPanelButtons(page, totalPages) {
        const row = new ActionRowBuilder();
        
        if (page > 0) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('panel_onceki')
                    .setLabel('◀ Önceki')
                    .setStyle(ButtonStyle.Primary)
            );
        }
        
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('panel_bilgi')
                .setLabel(`${page + 1}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );
        
        if (page < totalPages - 1) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('panel_sonraki')
                    .setLabel('Sonraki ▶')
                    .setStyle(ButtonStyle.Primary)
            );
        }
        
        return row;
    }

    // ========================================================================
    // 🎯 OLAY YÖNETİCİLERİ
    // ========================================================================
    setupEventHandlers() {
        this.client.once('clientReady', () => this.onReady().catch(e => console.error('Başlangıç:', e.message)));
        this.client.on('voiceStateUpdate', (oldState, newState) => this.onVoiceStateUpdate(oldState, newState).catch(e => console.error('Ses:', e.message)));
        this.client.on('interactionCreate', (interaction) => this.onInteractionCreate(interaction));
        this.client.on('messageCreate', (message) => this.onMessageCreate(message).catch(e => { console.error('Mesaj:', e.message); message.reply({content:e.publicMessage || 'İşlem tamamlanamadı. Biraz sonra tekrar dene.',allowedMentions:{repliedUser:false}}).catch(()=>{}); }));
    }

    async onReady() {
        await this.db.ready;
        await this.loadRuntimeSettings();
        await this.restoreOpenTickets();
        await this.beginMetrics();
        this.scheduleMaintenance();
        console.log('\n' + '='.repeat(50));
        console.log(`✅ Swiz Bot's Aktif!`);
        console.log(`🤖 Bot: ${this.client.user.tag}`);
        console.log(`📺 Yayın Mesajı: ${CONFIG.STREAM.MESSAGE}`);
        console.log('='.repeat(50) + '\n');

        // ⭐ AKTİF DURUMLARI GERİ YÜKLE
        await this.restoreAktifDurumlar();

        await this.startStatusRotation();
        await this.connectToVoice();
        await this.registerSlashCommands();

        this.updatePanel();
        this.runtimeTimers.add(setInterval(() => this.updatePanel(), 60000));
    }

    async onVoiceStateUpdate(oldState, newState) {
        await this.recordVoice(oldState, newState);
        if (newState.member?.id === this.client.user.id && !newState.channelId) {
            console.log('⚠️ Ses kanalından çıkarıldı, yeniden bağlanılıyor...');
            await this.connectToVoice();
        }
    }

    async connectToVoice() {
        if(this.stopping || !CONFIG.VOICE.CHANNEL_ID) return;
        try {
            const voiceChannel = await this.client.channels.fetch(CONFIG.VOICE.CHANNEL_ID);
            if (voiceChannel && voiceChannel.isVoiceBased()) {
                joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                });
                console.log(`✅ Ses kanalına bağlandı: ${voiceChannel.name}`);
            }
        } catch (error) {
            console.log('❌ Ses kanalına bağlanamadı:', error.message);
        }
    }

    async startStatusRotation() {
        const streamingTexts = ['Swiz 🤍 Lloyd'];
        let textIndex = 0;
        
        const changeStreamingStatus = () => {
            this.client.user.setPresence({
                status: 'dnd',
                activities: [{
                    name: streamingTexts[textIndex],
                    type: ActivityType.Streaming,
                    url: CONFIG.VOICE.STREAM_URL
                }]
            });
            console.log(`📺 Yayın durumu değiştirildi: ${streamingTexts[textIndex]}`);
            textIndex = (textIndex + 1) % streamingTexts.length;
        };
        
        changeStreamingStatus();
        this.runtimeTimers.add(setInterval(changeStreamingStatus, 43200000));
    }

    // ========================================================================
    // ⭐ AKTİF DURUMLARI GERİ YÜKLEME FONKSİYONU - FIXLENMİŞ
    // ========================================================================

    // ========================================================================
    // 📝 MESAJ KOMUTLARI (!id, !tag, !swiz)
    // ========================================================================
    async onMessageCreate(message) {
        if(this.stopping) return;
        if (!message.guild || message.author.bot || !this.isTargetGuild(message.guild.id)) return;
        await this.recordMessage(message);

        if (!message.content.startsWith('!')) return;

        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        if (command === 'id') {
            await this.handleIdCommand(message, args);
        } else if (command === 'tag') {
            await this.handleTagCommand(message, args);
        } else if (command === 'swiz') {
            await this.handleSwizCommand(message);
        } else if (command === 'aktif') {
            await this.handleAktifMessageCommand(message);
        }
    }

    async handleIdCommand(message, args) {
        const serverShort = args[0]?.toLowerCase();
        const playerId = parseInt(args[1]);

        if (!serverShort || !playerId) {
            return message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('❌ Hatalı Kullanım')
                        .setDescription('Kullanım: `!id [sunucu] [id]`\nÖrnek: `!id alesta 223`')
                        .addFields({
                            name: '📋 Kullanılabilir Sunucular',
                            value: FIVEM_SERVERS.map(s => `• **${s.short}** - ${s.name}`).join('\n')
                        })
                        .setColor(0xFF0000)
                ]
            });
        }

        const server = SERVER_SHORTCUTS[serverShort];
        if (!server) {
            return message.reply('❌ Geçersiz sunucu! `!id` yazarak kullanılabilir sunucuları görebilirsin.');
        }

        const loadingMsg = await message.reply(`🔍 **${server.name}** sunucusunda ID: **${playerId}** aranıyor...`);

        try {
            const players = await this.getServerPlayers(server.url);
            const player = players.find(p => p.id == playerId);

            if (!player) {
                return loadingMsg.edit(`❌ **${server.name}** sunucusunda ID **${playerId}** bulunamadı!`);
            }

            let steamId = 'Bulunamadı', licenseId = 'Bulunamadı', discordId = null;
            
            for (const id of player.identifiers || []) {
                if (typeof id === 'string') {
                    if (id.startsWith('steam:')) steamId = id.replace('steam:', '');
                    else if (id.startsWith('license:')) licenseId = id.replace('license:', '');
                    else if (id.startsWith('discord:')) discordId = id.replace('discord:', '');
                }
            }

            const embed = new EmbedBuilder()
                .setTitle(` Swiz Bot's | ID Sorgu - ${server.name}`)
                .setDescription(`**${player.name}**`)
                .setColor(0xFFD700)
                .addFields(
                    { name: '🆔 ID', value: `${playerId}`, inline: true },
                    { name: '📊 Ping', value: `${player.ping || '?'} ms`, inline: true },
                    { name: '🔐 IDENTIFIERLAR', value: [
                        `• Steam: ${steamId}`,
                        `• License: ${licenseId}`,
                        discordId ? `• Discord: <@${discordId}>` : null
                    ].filter(Boolean).join('\n') }
                )
                .setFooter({ text: `${server.name} | Swiz Bot's ID Sistemi` })
                .setTimestamp();

            await loadingMsg.edit({ content: null, embeds: [embed] });
        } catch (error) {
            console.error('!id hatası:', error);
            await loadingMsg.edit('❌ Sunucu bilgileri alınırken hata oluştu!');
        }
    }

    async handleTagCommand(message, args) {
        const searchName = args.join(' ').toLowerCase();
        
        if (!searchName) {
            return message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('❌ Hatalı Kullanım')
                        .setDescription('Kullanım: `!tag [isim]`\nÖrnek: `!tag swiz`')
                        .setColor(0xFF0000)
                ]
            });
        }

        const loadingMsg = await message.reply(`🔍 **${searchName}** tüm sunucularda aranıyor...`);

        try {
            const allResults = [];
            const unavailableServers = [];
            let totalFound = 0;

            for (const server of FIVEM_SERVERS) {
                await loadingMsg.edit(`🔍 ${server.name} sunucusunda aranıyor...`);

                let players;
                try { players = await this.getServerPlayers(server.url); }
                catch { unavailableServers.push(server.name); continue; }
                const filtered = players.filter(p => 
                    p.name && p.name.toLowerCase().includes(searchName)
                );

                if (filtered.length > 0) {
                    totalFound += filtered.length;
                    allResults.push({
                        serverName: server.name,
                        players: filtered
                    });
                }
            }

            if (unavailableServers.length) {
                await message.reply({content:'⚠️ Bazı sunucular sorgulanamadı: ' + unavailableServers.join(', ') + '. Sonuçlar yalnızca yanıt veren sunucuları kapsar.',allowedMentions:{parse:[]}});
            }

            if (totalFound === 0) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle(`❌ "${searchName}"`)
                    .setDescription(unavailableServers.length ? 'Yanıt veren sunucularda eşleşme bulunamadı; sorgulanamayan sunucular için sonuç bilinmiyor.' : 'Aradığın isimde kimse bulunamadı.')
                    .setTimestamp()
                    .setFooter({ text: `İsteyen: ${message.author.tag}` });

                return await loadingMsg.edit({ content: null, embeds: [embed] });
            }

            if (totalFound < 40) {
                const embed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle(`🔍 Swiz Bot's | "${searchName}" Arama Sonuçları`)
                    .setDescription(`✅ Toplam **${totalFound}** oyuncu bulundu:`)
                    .setTimestamp()
                    .setFooter({ 
                        text: `İsteyen: ${message.author.tag} • Swiz Bot's Tag Sistemi`, 
                        iconURL: message.author.displayAvatarURL() 
                    });

                for (const result of allResults) {
                    const playerList = result.players.map(p => 
                        `• **${p.name}** #${p.id} | Ping: ${p.ping || '?'}ms`
                    ).join('\n');

                    embed.addFields({ 
                        name: `**${result.serverName}** (${result.players.length} oyuncu)`, 
                        value: playerList.length > 1024 ? playerList.substring(0, 1000) + '...' : playerList 
                    });
                }

                return await loadingMsg.edit({ content: null, embeds: [embed] });
            }

            const pages = [];
            let currentPage = 0;

            for (const result of allResults) {
                const playerList = result.players.map(p => 
                    `• **${p.name}** #${p.id} | Ping: ${p.ping || '?'}ms`
                );

                const pageSize = 10;
                const totalPlayerPages = Math.ceil(playerList.length / pageSize);

                for (let i = 0; i < totalPlayerPages; i++) {
                    const start = i * pageSize;
                    const end = start + pageSize;
                    const pagePlayers = playerList.slice(start, end);

                    const embed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle(`🔍 "${searchName}" - ${result.serverName}`)
                        .setDescription(pagePlayers.join('\n'))
                        .setFooter({ 
                            text: `Sayfa ${pages.length + 1} • Toplam ${totalFound} oyuncu bulundu • İsteyen: ${message.author.tag}` 
                        })
                        .setTimestamp();

                    pages.push(embed);
                }
            }

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('tag_onceki')
                        .setLabel('◀ Önceki')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('tag_bilgi')
                        .setLabel(`1/${pages.length}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('tag_sonraki')
                        .setLabel('Sonraki ▶')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(pages.length <= 1)
                );

            const sentMsg = await loadingMsg.edit({ 
                content: null, 
                embeds: [pages[0]], 
                components: [row] 
            });

            const filter = i => i.user.id === message.author.id;
            const collector = sentMsg.createMessageComponentCollector({ 
                filter, 
                time: 60000
            });

            collector.on('collect', async i => {
                if (i.customId === 'tag_sonraki') {
                    currentPage++;
                } else if (i.customId === 'tag_onceki') {
                    currentPage--;
                }

                const newRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('tag_onceki')
                            .setLabel('◀ Önceki')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(currentPage === 0),
                        new ButtonBuilder()
                            .setCustomId('tag_bilgi')
                            .setLabel(`${currentPage + 1}/${pages.length}`)
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('tag_sonraki')
                            .setLabel('Sonraki ▶')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(currentPage === pages.length - 1)
                    );

                await i.update({ 
                    embeds: [pages[currentPage]], 
                    components: [newRow] 
                });
            });

            collector.on('end', () => {
                const disabledRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('tag_onceki')
                            .setLabel('◀ Önceki')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('tag_bilgi')
                            .setLabel(`${currentPage + 1}/${pages.length}`)
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('tag_sonraki')
                            .setLabel('Sonraki ▶')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true)
                    );

                sentMsg.edit({ components: [disabledRow] }).catch(() => {});
            });

        } catch (error) {
            console.error('!tag hatası:', error);
            await loadingMsg.edit('❌ Sunucu bilgileri alınırken hata oluştu!');
        }
    }

    async handleSwizCommand(message) {
        const loadingMsg = await message.reply(`🔍 Swiz taglı oyuncular aranıyor...`);

        try {
            const players = await this.getServerPlayers(FIVEM_SERVERS[0].url);
            const swizPlayers = players.filter(p => p.name && /swiz/i.test(p.name));
            const totalFound = swizPlayers.length;

            if (totalFound === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('Swiz Bot\'s | Aile Sistemi')
                    .setDescription(`**${FIVEM_SERVERS[0].name}** sunucusunda Swiz taglı oyuncu bulunamadı.`)
                    .setColor(0xFFD700)
                    .setFooter({ text: 'Swiz Bot\'s • Aile Sistemi' })
                    .setTimestamp();

                return await loadingMsg.edit({ content: null, embeds: [embed] });
            }

            swizPlayers.sort((a, b) => a.id - b.id);

            if (totalFound < 40) {
                let playerList = '';
                swizPlayers.forEach(p => {
                    playerList += `\`[${p.id.toString().padStart(4)}]\` **${p.name}** | 📶 ${p.ping || '?'}ms\n`;
                });

                const embed = new EmbedBuilder()
                    .setTitle('Swiz Bot\'s | Aile Sistemi')
                    .setDescription(`**${FIVEM_SERVERS[0].name}**'de **${totalFound}** Swiz ailesi üyesi online!`)
                    .addFields({ name: '📋 Online Aile Üyeleri', value: playerList })
                    .setColor(0xFFD700)
                    .setFooter({ text: 'Swiz Bot\'s • Aile Sistemi' })
                    .setTimestamp();

                return await loadingMsg.edit({ content: null, embeds: [embed] });
            }

            const playerList = swizPlayers.map(p => 
                `• **${p.name}** #${p.id} | Ping: ${p.ping || '?'}ms`
            );

            const pages = [];
            const pageSize = 10;
            const totalPages = Math.ceil(playerList.length / pageSize);
            let currentPage = 0;

            for (let i = 0; i < totalPages; i++) {
                const start = i * pageSize;
                const end = start + pageSize;
                const pagePlayers = playerList.slice(start, end);

                const embed = new EmbedBuilder()
                    .setTitle(`Swiz Bot's | Aile Sistemi - ${FIVEM_SERVERS[0].name}`)
                    .setDescription(`**${totalFound}** Swiz ailesi üyesi online!`)
                    .addFields({ name: '📋 Online Aile Üyeleri', value: pagePlayers.join('\n') })
                    .setColor(0xFFD700)
                    .setFooter({ text: `Sayfa ${i + 1}/${totalPages} • İsteyen: ${message.author.tag}` })
                    .setTimestamp();

                pages.push(embed);
            }

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('swiz_onceki')
                        .setLabel('◀ Önceki')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('swiz_bilgi')
                        .setLabel(`1/${totalPages}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('swiz_sonraki')
                        .setLabel('Sonraki ▶')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(totalPages <= 1)
                );

            const sentMsg = await loadingMsg.edit({ 
                content: null, 
                embeds: [pages[0]], 
                components: [row] 
            });

            const filter = i => i.user.id === message.author.id;
            const collector = sentMsg.createMessageComponentCollector({ 
                filter, 
                time: 60000
            });

            collector.on('collect', async i => {
                if (i.customId === 'swiz_sonraki') {
                    currentPage++;
                } else if (i.customId === 'swiz_onceki') {
                    currentPage--;
                }

                const newRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('swiz_onceki')
                            .setLabel('◀ Önceki')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(currentPage === 0),
                        new ButtonBuilder()
                            .setCustomId('swiz_bilgi')
                            .setLabel(`${currentPage + 1}/${totalPages}`)
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('swiz_sonraki')
                            .setLabel('Sonraki ▶')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(currentPage === totalPages - 1)
                    );

                await i.update({ 
                    embeds: [pages[currentPage]], 
                    components: [newRow] 
                });
            });

            collector.on('end', () => {
                const disabledRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('swiz_onceki')
                            .setLabel('◀ Önceki')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('swiz_bilgi')
                            .setLabel(`${currentPage + 1}/${totalPages}`)
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('swiz_sonraki')
                            .setLabel('Sonraki ▶')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true)
                    );

                sentMsg.edit({ components: [disabledRow] }).catch(() => {});
            });

        } catch (error) {
            console.error('!swiz hatası:', error);
            await loadingMsg.edit('❌ Sunucu bilgileri alınırken hata oluştu!');
        }
    }

    async handleAktifMessageCommand(message) {
        await this.processAktifCommand(message, false);
    }

    // ========================================================================
    // 🎯 ETKİLEŞİM KOMUTLARI
    // ========================================================================
    async onInteractionCreate(interaction) {
        if(this.stopping) return;
        try {
            if (!interaction.guild || !this.isTargetGuild(interaction.guildId || interaction.guild.id)) {
                if (interaction.isRepliable()) await interaction.reply({ content: 'Bu bot yapılandırılmış sunucuda kullanılabilir.', flags: 64 });
                return;
            }
            if (await this.handleFeature(interaction)) return;
            if (interaction.isButton()) {
                await this.handleButtonInteraction(interaction);
            } else if (interaction.isCommand()) {
                await this.handleSlashCommand(interaction);
            }
        } catch (error) {
            console.error('Etkileşim hatası:', error);
            
            const msg = {content: error.publicMessage || '❌ İşlem tamamlanamadı. Lütfen tekrar dene.', flags:64};
            if(interaction.deferred) await interaction.editReply(msg).catch(()=>{});
            else if(interaction.replied) await interaction.followUp(msg).catch(()=>{});
            else await interaction.reply(msg).catch(()=>{});
        }
    }

    async handleButtonInteraction(interaction) {
        const { customId } = interaction;

        if (customId === 'ticket_ac') {
            await this.handleTicketButton(interaction);
        } else if (customId === 'ticket_kapat') {
            await this.handleTicketCloseButton(interaction);
        } else if (customId.startsWith('aktiflik_')) {
            await this.handleAktiflikButton(interaction);
        } else if (customId.startsWith('maddex_katil_') || customId.startsWith('maddex_cik_')) {
            await this.handleMaddexButton(interaction);
        } else if (customId.startsWith('etkinlik_')) {
            await this.handleEtkinlikButton(interaction);
        } else if (customId === 'panel_onceki' || customId === 'panel_sonraki') {
            await this.handlePanelButton(interaction);
        } else if (customId.startsWith('affi_')) {
            await this.handleUyariAffiButton(interaction);
        }
    }








    async handlePanelButton(interaction) {
        await interaction.deferUpdate();
        if (interaction.customId === 'panel_onceki') {
            this.panelSayfa = Math.max(0, this.panelSayfa - 1);
        } else if (interaction.customId === 'panel_sonraki') {
            this.panelSayfa++;
        }
        
        await this.updatePanel();
    }


    // ========================================================================
    // 📝 SLASH KOMUT İŞLEYİCİLERİ
    // ========================================================================
    async handleSlashCommand(interaction) {
        const { commandName } = interaction;

        const publicCommands = ['komutlar', 'bot', 'bilgi', 'alesta', 'swiz', 'sunucular', 'id', 'tag', 'aktif'];
        
        if (!publicCommands.includes(commandName) && !this.checkPermission(interaction, commandName)) {
            return await interaction.reply({ 
                content: '❌ Bu komutu kullanma yetkin yok!', 
                flags: 64 
            });
        }

        const commandHandlers = {
            'komutlar': () => this.handleKomutlar(interaction),
            'bot': () => this.handleBot(interaction),
            'bilgi': () => this.handleBilgi(interaction),
            'alesta': () => this.handleAlesta(interaction),
            'sunucular': () => this.handleSunucular(interaction),
            'swiz': () => this.handleSwiz(interaction),
            'aktif': () => this.handleAktifSlash(interaction),
            'id': () => this.handleSlashId(interaction),
            'tag': () => this.handleTag(interaction),
            'ticket': () => this.handleTicket(interaction),
            'panel': () => this.handlePanel(interaction),
            'aktiflik': () => this.handleAktiflik(interaction),
            'aktiflikbitir': () => this.handleAktiflikBitir(interaction),
            'maddex': () => this.handleMaddex(interaction),
            'maddexbitir': () => this.handleMaddexBitir(interaction),
            'etkinlik': () => this.handleEtkinlik(interaction),
            'uyari': () => this.handleUyari(interaction),
            'uyarilar': () => this.handleUyarilar(interaction),
            'uyariaffi': () => this.handleUyariAffi(interaction),
            'uyarisil': () => this.handleUyariSil(interaction),
            'uyariliste': () => this.handleUyariListe(interaction),
            'clear': () => this.handleClear(interaction),
            'kick': () => this.handleKick(interaction),
            'ban': () => this.handleBan(interaction),
            'unban': () => this.handleUnban(interaction),
            'banlar': () => this.handleBanlar(interaction)
        };

        const handler = commandHandlers[commandName];
        if (handler) {
            await handler();
        }
    }

    async handleKomutlar(interaction) {
        const embed = new EmbedBuilder()
            .setTitle(' Swiz Bot\'s | Komut Menüsü')
            .setDescription('**Kullanılabilir Komutlar**')
            .setColor(0xFFD700)
            .addFields(
                { name: '🤖 `/bot`', value: 'Bot bilgilerini gösterir', inline: false },
                { name: '📊 `/bilgi [kullanici]`', value: 'Kullanıcı istatistiklerini gösterir', inline: false },
                { name: '🟢 `/alesta`', value: 'Aktif oyuncu sayısını gösterir', inline: false },
                { name: '🔍 `/id [sunucu] [id]`', value: 'Sunucuda ID ile oyuncu ara', inline: false },
                { name: '🏷️ `/tag [isim]`', value: 'İsme göre oyuncu ara', inline: false },
                { name: '👑 `/swiz`', value: 'Alesta Roleplay\'de Swiz taglı oyuncuları listeler', inline: false },
                { name: '🌍 `/sunucular`', value: 'Tüm sunucuları listeler', inline: false },
                { name: '🎫 `/ticket`', value: 'Ticket sistemini kurar (yetkili)', inline: false },
                { name: '📈 `/panel`', value: 'Online panel kurar (yetkili)', inline: false },
                { name: '⏱️ `/aktiflik`', value: 'Aktiflik başlatır (yetkili)', inline: false },
                { name: '⏹️ `/aktiflikbitir`', value: 'Aktifliği manuel bitirir (yetkili)', inline: false },
                { name: '📌 `/maddex`', value: 'Maddex kadrosu oluşturur (yetkili)', inline: false },
                { name: '⏹️ `/maddexbitir`', value: 'Maddexi manuel bitirir (yetkili)', inline: false },
                { name: '🎮 `/etkinlik [isim]`', value: 'Etkinlik kadrosu oluşturur (yetkili)', inline: false },
                { name: '⚠️ `/uyari`', value: 'Kullanıcıya uyarı verir (yetkili)', inline: false },
                { name: '📋 `/uyarilar`', value: 'Kullanıcının uyarılarını gösterir (yetkili)', inline: false },
                { name: '🔄 `/uyariaffi`', value: 'Tüm uyarıları temizler (yetkili)', inline: false },
                { name: '🗑️ `/uyarisil`', value: 'Belirtilen uyarıyı siler (yetkili)', inline: false },
                { name: '🧨 `/uyariliste`', value: 'Bütün uyarıları gösterir (yetkili)', inline: false },
                { name: '🧹 `/clear`', value: 'Mesaj siler (yetkili)', inline: false },
                { name: '👢 `/kick`', value: 'Kullanıcı atar (yetkili)', inline: false },
                { name: '🔨 `/ban`', value: 'Kullanıcı yasaklar (yetkili)', inline: false },
                { name: '✅ `/unban`', value: 'Ban kaldırır (yetkili)', inline: false },
                { name: '📜 `/banlar`', value: 'Banlıları listeler (yetkili)', inline: false }
            )
            .setFooter({ text: 'Swiz Bot\'s • Yardım Sistemi' })
            .setTimestamp();

        const newFeatures = new EmbedBuilder().setTitle('Yeni topluluk araçları').setColor(0x5865f2)
            .setDescription('`/istatistik` • mesaj ve ses süreleri\n`/sunucuozet` • son 7 gün\n`/ticketdevral` • talebi üstlen\n`/etkinlikbitir` • kadroyu kapat\n`/durum` • eksik ayarlar\n`/ayar` • rol/kanal ayarları\n`/yedek` • yerel veritabanı yedeği\n\n`/etkinlik` artık isteğe bağlı kontenjan ve bekleme listesi destekler.');
        await interaction.reply({ embeds: [embed,newFeatures] });
    }

    async handleBot(interaction) {
        const uptime = process.uptime();
        const days = Math.floor(uptime / 86400);
        const hours = Math.floor(uptime / 3600) % 24;
        const minutes = Math.floor(uptime / 60) % 60;
        const seconds = Math.floor(uptime % 60);

        const embed = new EmbedBuilder()
            .setTitle(' Swiz Bot\'s | Bot Bilgileri')
            .setDescription(`**Bu Bot Swiz Sunucusu için ${CONFIG.CREATOR} Tarafından Yapılmıştır**`)
            .setColor(0x9B59B6)
            .addFields(
                { name: '📌 Bot Adı', value: this.client.user.tag, inline: true },
                { name: '🔰 Versiyon', value: CONFIG.VERSION, inline: true },
                { name: '🆔 Bot ID', value: this.client.user.id, inline: true },
                { name: '📊 Sunucu Sayısı', value: this.client.guilds.cache.size.toString(), inline: true },
                { name: '👥 Kullanıcı Sayısı', value: this.client.users.cache.size.toString(), inline: true },
                { name: '⏰ Çalışma Süresi', value: `${days}g ${hours}s ${minutes}d ${seconds}sn`, inline: true },
                { name: '🌐 API Gecikmesi', value: `${this.client.ws.ping}ms`, inline: true },
                { name: '📝 Komut Sayısı', value: buildCommands().length.toString(), inline: true },
                { name: '🎯 Aktif Sunucular', value: FIVEM_SERVERS.length.toString(), inline: true }
            )
            .addFields({ name: '📢 Tanıtım', value: 'Bu tarz botlar için **discord.gg/swizfam** & **discord.gg/swizpack**' })
            .setFooter({ text: 'Swiz Bot\'s Tanıtım Sistemi' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }

    async handleBilgi(interaction) {
        const target = interaction.options.getUser('kullanici') || interaction.user;
        const member = interaction.guild.members.cache.get(target.id);

        if (!member) {
            return await interaction.reply({ 
                content: '❌ Kullanıcı bulunamadı!', 
                flags: 64 
            });
        }

        const stats = await this.db.get(
            'SELECT toplam_mesaj, en_aktif_kanal FROM kullanici_istatistik WHERE kullanici_id = ?', 
            [target.id]
        );

        const totalMessages = stats?.toplam_mesaj || 0;
        const mostActiveChannel = stats?.en_aktif_kanal ? `<#${stats.en_aktif_kanal}>` : 'Veri yok';
        
        let voiceStatus = 'Veri yok';
        if (member.voice.channel) voiceStatus = 'Şu anda seste';

        const roles = member.roles.cache
            .filter(r => r.name !== '@everyone')
            .map(r => `<@&${r.id}>`)
            .join(' ')
            .slice(0, 1000);

        const embed = new EmbedBuilder()
            .setTitle(` Swiz Bot's | ${target.username} İstatistikleri`)
            .setThumbnail(target.displayAvatarURL({ dynamic: true }))
            .setColor(0x3498DB)
            .addFields(
                { name: '👤 Kullanıcı', value: `${target}`, inline: false },
                { name: '🆔 ID', value: target.id, inline: true },
                { name: '📛 Takma Ad', value: member.displayName || 'Yok', inline: true },
                { name: '📅 Hesap Oluşturma', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '📥 Sunucuya Katılma', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
                { name: '💬 Toplam Mesaj', value: totalMessages.toString(), inline: true },
                { name: '🎤 Ses Durumu', value: voiceStatus, inline: true },
                { name: '📌 En Aktif Kanal', value: mostActiveChannel, inline: true },
                { name: '🎭 Rolleri', value: roles || 'Rolü yok', inline: false }
            )
            .setFooter({ text: 'Swiz Bot\'s • İstatistik Sistemi' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }

    async handleAlesta(interaction) {
        await interaction.deferReply();

        const players = await this.getServerPlayers(FIVEM_SERVERS[0].url);
        
        const embed = new EmbedBuilder()
            .setTitle(' Swiz Bot\'s | Sunucu Aktifi')
            .setDescription(`**${FIVEM_SERVERS[0].name}**`)
            .addFields({ name: '📊 Aktif Oyuncu', value: players.length.toString(), inline: true })
            .setColor(0xFFD700)
            .setTimestamp()
            .setFooter({ text: 'Swiz Bot\'s • Aktif Sistemi' });

        await interaction.editReply({ embeds: [embed] });
    }

    async handleSunucular(interaction) {
        const serverList = FIVEM_SERVERS.map(s => `• **${s.name}** (\`${s.short}\`)`).join('\n');
        
        const embed = new EmbedBuilder()
            .setTitle(' Swiz Bot\'s | Sunucu Listesi')
            .setDescription(serverList)
            .addFields(
                { name: '📌 Kullanım', value: '`/id [sunucu] [id]` ile ID bakabilirsiniz.\n`!id [kısayol] [id]` ile de kullanabilirsiniz.' },
                { name: '🎯 Örnek', value: '`/id "Alesta RP" 42` veya `!id alesta 42`' }
            )
            .setColor(0xFFD700)
            .setFooter({ text: `${FIVEM_SERVERS.length} sunucu aktif • Swiz Bot's` });

        await interaction.reply({ embeds: [embed] });
    }

    async handleSwiz(interaction) {
        await interaction.deferReply();

        const players = await this.getServerPlayers(FIVEM_SERVERS[0].url);
        const swizPlayers = players.filter(p => p.name && /swiz/i.test(p.name));

        if (swizPlayers.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle(' Swiz Bot\'s | Aile Sistemi')
                .setDescription(`**${FIVEM_SERVERS[0].name}** sunucusunda Swiz taglı oyuncu bulunamadı.`)
                .setColor(0xFFD700)
                .setFooter({ text: 'Swiz Bot\'s • Aile Sistemi' })
                .setTimestamp();

            return await interaction.editReply({ embeds: [embed] });
        }

        swizPlayers.sort((a, b) => a.id - b.id);

        let playerList = '';
        swizPlayers.slice(0, 15).forEach(p => {
            playerList += `\`[${p.id.toString().padStart(4)}]\` **${p.name}** | 📶 ${p.ping || '?'}ms\n`;
        });

        if (swizPlayers.length > 15) {
            playerList += `\n*...ve ${swizPlayers.length - 15} oyuncu daha*`;
        }

        const embed = new EmbedBuilder()
            .setTitle(' Swiz Bot\'s | Aile Sistemi')
            .setDescription(`**${FIVEM_SERVERS[0].name}**'de **${swizPlayers.length}** Swiz ailesi üyesi online!`)
            .addFields({ name: '📋 Online Aile Üyeleri', value: playerList })
            .setColor(0xFFD700)
            .setFooter({ text: 'Swiz Bot\'s • Aile Sistemi' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    async handleSlashId(interaction) {
        await interaction.deferReply();

        const serverName = interaction.options.getString('sunucu');
        const playerId = interaction.options.getInteger('id');
        
        const server = FIVEM_SERVERS.find(s => s.name === serverName);
        
        if (!server) {
            return await interaction.editReply(`❌ **${serverName}** bulunamadı!`);
        }

        const players = await this.getServerPlayers(server.url);
        const player = players.find(p => p.id == playerId);

        if (!player) {
            return await interaction.editReply(`❌ **${server.name}** ID **${playerId}** bulunamadı!`);
        }

        let steamId = 'Bulunamadı', licenseId = 'Bulunamadı', discordId = null;
        
        for (const id of player.identifiers || []) {
            if (typeof id === 'string') {
                if (id.startsWith('steam:')) steamId = id.replace('steam:', '');
                else if (id.startsWith('license:')) licenseId = id.replace('license:', '');
                else if (id.startsWith('discord:')) discordId = id.replace('discord:', '');
            }
        }

        const now = new Date();
        const dateStr = `${now.getDate().toString().padStart(2, '0')}.${(now.getMonth()+1).toString().padStart(2, '0')} - ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

        let identifierText = `• Steam: ${steamId}\n• License: ${licenseId}`;
        if (discordId) identifierText += `\n• Discord: <@${discordId}>`;

        const embed = new EmbedBuilder()
            .setTitle(` Swiz Bot's | ID Sorgu - ${server.name}`)
            .setDescription(`**${player.name}**`)
            .setColor(0xFFD700)
            .addFields(
                { name: '🆔 ID', value: `${playerId}`, inline: true },
                { name: '📊 Ping', value: `${player.ping || '?'} ms`, inline: true },
                { name: '🔐 IDENTIFIERLAR', value: identifierText }
            )
            .setFooter({ text: `${server.name} | ${dateStr} • Swiz Bot's ID Sistemi` });

        await interaction.editReply({ embeds: [embed] });
    }

    async handleTag(interaction) {
        await interaction.deferReply();

        const searchName = interaction.options.getString('isim');
        const serverChoice = interaction.options.getString('sunucu') || 'all';

        const serversToSearch = serverChoice === 'all' 
            ? FIVEM_SERVERS 
            : FIVEM_SERVERS.filter(s => s.name === serverChoice);

        try {
            const allResults = [];
            const unavailableServers = [];
            let totalFound = 0;

            for (const server of serversToSearch) {
                await interaction.editReply({ 
                    content: `🔍 ${server.name} sunucusunda aranıyor...` 
                });

                let players;
                try { players = await this.getServerPlayers(server.url); }
                catch { unavailableServers.push(server.name); continue; }
                const filtered = players.filter(p => 
                    p.name && p.name.toLowerCase().includes(searchName.toLowerCase())
                );

                if (filtered.length > 0) {
                    totalFound += filtered.length;
                    allResults.push({
                        serverName: server.name,
                        players: filtered
                    });
                }
            }

            if (unavailableServers.length) {
                await interaction.followUp({content:'⚠️ Bazı sunucular sorgulanamadı: ' + unavailableServers.join(', ') + '. Sonuçlar yalnızca yanıt veren sunucuları kapsar.',allowedMentions:{parse:[]}});
            }

            if (totalFound === 0) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle(`❌ "${searchName}"`)
                    .setDescription(unavailableServers.length ? 'Yanıt veren sunucularda eşleşme bulunamadı; sorgulanamayan sunucular için sonuç bilinmiyor.' : 'Aradığın isimde kimse bulunamadı.')
                    .setTimestamp()
                    .setFooter({ text: `İsteyen: ${interaction.user.tag}` });

                return await interaction.editReply({ content: null, embeds: [embed] });
            }

            if (totalFound < 40) {
                const embed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle(`🔍 Swiz Bot's | "${searchName}" Arama Sonuçları`)
                    .setDescription(`✅ Toplam **${totalFound}** oyuncu bulundu:`)
                    .setTimestamp()
                    .setFooter({ 
                        text: `İsteyen: ${interaction.user.tag} • Swiz Bot's Tag Sistemi`, 
                        iconURL: interaction.user.displayAvatarURL() 
                    });

                for (const result of allResults) {
                    const playerList = result.players.map(p => 
                        `• **${p.name}** #${p.id} | Ping: ${p.ping || '?'}ms`
                    ).join('\n');

                    embed.addFields({ 
                        name: `**${result.serverName}** (${result.players.length} oyuncu)`, 
                        value: playerList.length > 1024 ? playerList.substring(0, 1000) + '...' : playerList 
                    });
                }

                return await interaction.editReply({ content: null, embeds: [embed] });
            }

            const pages = [];
            let currentPage = 0;

            for (const result of allResults) {
                const playerList = result.players.map(p => 
                    `• **${p.name}** #${p.id} | Ping: ${p.ping || '?'}ms`
                );

                const pageSize = 10;
                const totalPlayerPages = Math.ceil(playerList.length / pageSize);

                for (let i = 0; i < totalPlayerPages; i++) {
                    const start = i * pageSize;
                    const end = start + pageSize;
                    const pagePlayers = playerList.slice(start, end);

                    const embed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle(`🔍 "${searchName}" - ${result.serverName}`)
                        .setDescription(pagePlayers.join('\n'))
                        .setFooter({ 
                            text: `Sayfa ${pages.length + 1} • Toplam ${totalFound} oyuncu bulundu • İsteyen: ${interaction.user.tag}` 
                        })
                        .setTimestamp();

                    pages.push(embed);
                }
            }

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('tag_onceki')
                        .setLabel('◀ Önceki')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('tag_bilgi')
                        .setLabel(`1/${pages.length}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('tag_sonraki')
                        .setLabel('Sonraki ▶')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(pages.length <= 1)
                );

            const reply = await interaction.editReply({ 
                embeds: [pages[0]], 
                components: [row],
                fetchReply: true 
            });

            const filter = i => i.user.id === interaction.user.id;
            const collector = reply.createMessageComponentCollector({ 
                filter, 
                time: 300000
            });

            collector.on('collect', async i => {
                if (i.customId === 'tag_sonraki') {
                    currentPage++;
                } else if (i.customId === 'tag_onceki') {
                    currentPage--;
                }

                const newRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('tag_onceki')
                            .setLabel('◀ Önceki')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(currentPage === 0),
                        new ButtonBuilder()
                            .setCustomId('tag_bilgi')
                            .setLabel(`${currentPage + 1}/${pages.length}`)
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('tag_sonraki')
                            .setLabel('Sonraki ▶')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(currentPage === pages.length - 1)
                    );

                await i.update({ 
                    embeds: [pages[currentPage]], 
                    components: [newRow] 
                });
            });

            collector.on('end', () => {
                const disabledRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('disabled_onceki')
                            .setLabel('◀ Önceki')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('disabled_bilgi')
                            .setLabel('Süre Doldu')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('disabled_sonraki')
                            .setLabel('Sonraki ▶')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true)
                    );
                interaction.editReply({ components: [disabledRow] }).catch(() => {});
            });

        } catch (error) {
            console.error('/tag hatası:', error);
            await interaction.editReply({ 
                content: '❌ Sunucu bilgileri alınırken hata oluştu!', 
                components: [] 
            });
        }
    }

    async handleTicket(interaction) {
        const embed = new EmbedBuilder()
            .setTitle(' Swiz Bot\'s | Ticket Sistemi')
            .setDescription('Aşağıdaki butona tıklayarak destek talebi oluşturabilirsiniz.\n\n**Not:** Ticketi açtıktan sonra sorununuzu beklemeden belirtin ve yetkilinin dönüş sağlamasını bekleyin.')
            .setColor(0xFFD700)
            .addFields({ name: 'Başvuru İçin:', value: 'FiveM Saatiniz ve Kill Pov Atınız.', inline: false })
            .setFooter({ text: 'Swiz Bot\'s • Ticket Sistemi' });

        await interaction.channel.send({ 
            embeds: [embed], 
            components: [this.getTicketButton()] 
        });

        await interaction.reply({ 
            content: '✅ Ticket metni atıldı!', 
            flags: 64 
        });
    }

    async handlePanel(interaction) {
        await interaction.deferReply({ flags: 64 });

        this.panelSayfa = 0;
        
        const players = await this.getServerPlayers(FIVEM_SERVERS[0].url);
        const totalPages = Math.ceil(players.length / this.OYUNCU_LIMIT) || 1;
        
        const start = 0;
        const end = this.OYUNCU_LIMIT;
        const pagePlayers = players.slice(start, end);

        let playerList = '';
        if (pagePlayers.length > 0) {
            playerList = pagePlayers.map(p => 
                `\`[${p.id?.toString().padStart(4) || '???'}]\` **${p.name?.substring(0, 30) || 'İsimsiz'}** | Ping: ${p.ping || '?'}ms`
            ).join('\n');
        } else {
            playerList = 'Sunucuda oyuncu yok.';
        }

        const embed = new EmbedBuilder()
            .setTitle(' Swiz Bot\'s | Canlı Oyuncu Listesi')
            .setDescription(`**${FIVEM_SERVERS[0].name}**`)
            .addFields(
                { name: '📊 Toplam Oyuncu', value: players.length.toString(), inline: true },
                { name: '📄 Sayfa', value: `1/${totalPages}`, inline: true },
                { name: '📋 Oyuncular', value: playerList }
            )
            .setColor(0xFFD700)
            .setFooter({ text: `Son güncelleme: ${new Date().toLocaleTimeString('tr-TR')} • Swiz Bot's Panel Sistemi` })
            .setTimestamp();

        const message = await interaction.channel.send({ 
            embeds: [embed], 
            components: [this.getPanelButtons(0, totalPages)] 
        });

        await this.db.run(
            'UPDATE config SET deger = ? WHERE anahtar = "panel_kanal"', 
            interaction.channel.id
        );
        
        await this.db.run(
            'UPDATE config SET deger = ? WHERE anahtar = "panel_mesaj"', 
            message.id
        );
        
        await this.db.run(
            'UPDATE config SET deger = ? WHERE anahtar = "panel_sayfa"', 
            '0'
        );

        await interaction.editReply('✅ Panel kuruldu! Her dakika güncellenecek.');
    }

    // ========================================================================
    // ⏱️ AKTİFLİK KOMUTU - RESTART KORUMALI
    // ========================================================================
    async handleAktiflik(interaction) {
        const roleId = CONFIG.IDS.AILE_UYESI_ROL;
        const role = interaction.guild.roles.cache.get(roleId);
        
        if (!role) {
            return await interaction.reply({ 
                content: '❌ Swiz Family rolü bulunamadı!', 
                flags: 64 
            });
        }

        const amount = interaction.options.getInteger('sayi');
        const unit = interaction.options.getString('birim');

        if (amount < 1 || amount > 100) {
            return await interaction.reply({ 
                content: '❌ Süre 1-100 arasında olmalı!', 
                flags: 64 
            });
        }

        let milliseconds = amount * 1000;
        let durationText = `${amount} saniye`;

        if (unit === 'dakika') {
            milliseconds = amount * 60 * 1000;
            durationText = `${amount} dakika`;
        } else if (unit === 'saat') {
            milliseconds = amount * 60 * 60 * 1000;
            durationText = `${amount} saat`;
        }

        const aktiflikId = makeId();
        this.aktiflikKatilim.set(aktiflikId, new Set());

        // ⭐ AKTIF DURUMLAR TABLOSUNA KAYDET
        await this.db.run(
            `INSERT INTO aktif_durumlar (durum_id, tip, rol_id, sure_dakika, baslama_zamani, bitis_zamani, baslatan_id, kanal_id, mesaj_id, katilanlar, tamamlandi) 
             VALUES (?, 'aktiflik', ?, ?, ?, ?, ?, ?, ?, '[]', 0)`,
            [
                aktiflikId,
                role.id,
                Math.ceil(milliseconds / 60000),
                new Date().toISOString(),
                new Date(Date.now() + milliseconds).toISOString(),
                interaction.user.id,
                interaction.channel.id,
                ''
            ]
        );

        const embed = new EmbedBuilder()
            .setTitle(' Swiz Bot\'s | Aktiflik Yoklaması')
            .setDescription(`${role} @everyone`)
            .setColor(0xFF0000)
            .addFields(
                { name: '⏳ Süre', value: `**${durationText}**`, inline: true },
                { name: '✅ Katılanlar', value: '**0** kişi', inline: true }
            )
            .setFooter({ text: 'Swiz Bot\'s Aktiflik Sistemi' })
            .setTimestamp();

        const message = await interaction.reply({ 
            content: `**Aktiflik Başladı !**`, 
            embeds: [embed], 
            components: [this.getAktiflikButton(aktiflikId)],
            fetchReply: true 
        });

        await this.db.run('UPDATE aktif_durumlar SET guild_id=? WHERE durum_id=?',[interaction.guild.id,aktiflikId]);

        // Mesaj ID'sini güncelle
        await this.db.run(
            `UPDATE aktif_durumlar SET mesaj_id = ? WHERE durum_id = ?`,
            [message.id, aktiflikId]
        );

        // Aktiflik kayıtlarına da ekle
        await this.db.run(
            `INSERT INTO aktiflik_kayitlari (aktiflik_id, rol_id, sure, baslatan_id, baslama_tarihi, mesaj_id, kanal_id, katilanlar, katilmayanlar, tamamlandi) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [aktiflikId, role.id, durationText, interaction.user.id, new Date().toISOString(), message.id, interaction.channel.id, '', '', 0]
        );

        await this.logEvent(interaction.guild, 'aktiflik_basladi', 
            `**Rol:** ${role.name}\n**Süre:** ${durationText}\n**Başlatan:** ${interaction.user.tag}`
        );

        // Zamanlayıcıyı kaydet
        const timer = setTimeout(() => this.bitirAktiflik(interaction, aktiflikId, role, message, false).catch(error => console.error('Etkinlik bitirme:', error.message)), milliseconds);
        this.aktiflikTimers.set(aktiflikId, timer);
    }

    // ========================================================================
    // ⏱️ AKTİFLİK BİTİR KOMUTU - FIXLENMİŞ
    // ========================================================================

    // ========================================================================
    // 📌 MADDEX KOMUTU - RESTART KORUMALI
    // ========================================================================
    async handleMaddex(interaction) {
        const role = interaction.options.getRole('rol');
        const amount = interaction.options.getInteger('sayi');
        const unit = interaction.options.getString('birim');

        if (amount < 1 || amount > 100) {
            return await interaction.reply({ 
                content: '❌ Süre 1-100 arasında olmalı!', 
                flags: 64 
            });
        }

        let milliseconds = amount * 1000;
        let durationText = `${amount} saniye`;

        if (unit === 'dakika') {
            milliseconds = amount * 60 * 1000;
            durationText = `${amount} dakika`;
        } else if (unit === 'saat') {
            milliseconds = amount * 60 * 60 * 1000;
            durationText = `${amount} saat`;
        }

        const maddexId = makeId();
        this.maddexKatilim.set(maddexId, new Set());

        // ⭐ AKTIF DURUMLAR TABLOSUNA KAYDET
        await this.db.run(
            `INSERT INTO aktif_durumlar (durum_id, tip, rol_id, sure_dakika, baslama_zamani, bitis_zamani, baslatan_id, kanal_id, mesaj_id, katilanlar, tamamlandi) 
             VALUES (?, 'maddex', ?, ?, ?, ?, ?, ?, ?, '[]', 0)`,
            [
                maddexId,
                role.id,
                Math.ceil(milliseconds / 60000),
                new Date().toISOString(),
                new Date(Date.now() + milliseconds).toISOString(),
                interaction.user.id,
                interaction.channel.id,
                ''
            ]
        );

        const embed = new EmbedBuilder()
            .setTitle(' Swiz Bot\'s | Maddex Kadro')
            .setDescription(`${role} @everyone`)
            .setColor(0xFF69B4)
            .addFields(
                { name: '⏳ Süre', value: `**${durationText}**`, inline: true },
                { name: '✅ Katılanlar', value: '**0** kişi', inline: true }
            )
            .setFooter({ text: 'Swiz Bot\'s Kadro Sistemi' })
            .setTimestamp();

        const message = await interaction.reply({ 
            content: `**Maddex Kadro Başladı !**`, 
            embeds: [embed], 
            components: [this.getMaddexButton(maddexId)],
            fetchReply: true 
        });

        await this.db.run('UPDATE aktif_durumlar SET guild_id=? WHERE durum_id=?',[interaction.guild.id,maddexId]);

        // Mesaj ID'sini güncelle
        await this.db.run(
            `UPDATE aktif_durumlar SET mesaj_id = ? WHERE durum_id = ?`,
            [message.id, maddexId]
        );

        await this.db.run(
            `INSERT INTO maddex_kayitlari (maddex_id, rol_id, sure, baslatan_id, baslama_tarihi, mesaj_id, kanal_id, katilanlar, katilmayanlar, tamamlandi) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [maddexId, role.id, durationText, interaction.user.id, new Date().toISOString(), message.id, interaction.channel.id, '', '', 0]
        );

        await this.logEvent(interaction.guild, 'maddex_basladi', 
            `**Rol:** ${role.name}\n**Süre:** ${durationText}\n**Başlatan:** ${interaction.user.tag}`,
            null,
            CONFIG.IDS.MADDEX_LOG_KANALI
        );

        // Zamanlayıcıyı kaydet
        const timer = setTimeout(() => this.bitirMaddex(interaction, maddexId, role, message, false).catch(error => console.error('Etkinlik bitirme:', error.message)), milliseconds);
        this.maddexTimers.set(maddexId, timer);
    }

    // ========================================================================
    // 📌 MADDEX BİTİR KOMUTU - FIXLENMİŞ
    // ========================================================================

    // ========================================================================
    // 🔚 AKTİFLİK BİTİRME FONKSİYONU - RESTART KORUMALI
    // ========================================================================
    async bitirAktiflik(interaction, aktiflikId, role, message = null, manuel = false) {
        const claim = await this.db.run('UPDATE aktif_durumlar SET tamamlandi = 1 WHERE durum_id = ? AND tamamlandi = 0', [aktiflikId]);
        if (!claim.changes) return;
        const persisted = await this.db.get('SELECT katilanlar FROM aktif_durumlar WHERE durum_id = ?', [aktiflikId]);
        this.aktiflikKatilim.set(aktiflikId, new Set(JSON.parse(persisted?.katilanlar || '[]')));
        await interaction.guild.members.fetch().catch(() => null);
        // Zamanlayıcıyı temizle
        const timer = this.aktiflikTimers.get(aktiflikId);
        if (timer) {
            clearTimeout(timer);
            this.aktiflikTimers.delete(aktiflikId);
            console.log('✅ Aktiflik zamanlayıcısı temizlendi');
        }

        // ⭐ AKTIF DURUMLAR TABLOSUNU GÜNCELLE
        await this.db.run(
            `UPDATE aktif_durumlar SET tamamlandi = 1 WHERE durum_id = ?`,
            [aktiflikId]
        );

        const katilanlar = this.aktiflikKatilim.get(aktiflikId) || new Set();
        
        const katilanArray = Array.from(katilanlar).map(id => `<@${id}>`);
        const katilmayanArray = role.members
            .filter(m => !m.user.bot && !katilanlar.has(m.id))
            .map(m => `<@${m.id}>`);

        // Veritabanını güncelle
        await this.db.run(
            `UPDATE aktiflik_kayitlari SET katilanlar = ?, katilmayanlar = ?, tamamlandi = 1 WHERE aktiflik_id = ?`,
            [katilanArray.join(','), katilmayanArray.join(','), aktiflikId]
        );

        // YOKLAMA LOG KANALINA rapor gönder
        const reportChannel = interaction.guild?.channels.cache.get(CONFIG.IDS.YOKLAMA_LOG_KANALI);
        
        if (reportChannel) {
            try {
                if (katilanArray.length > 0) {
                    await this.sendPaginatedButtonEmbeds(reportChannel, '✅ Aktiflik - Katılanlar', katilanArray, 0x00FF00);
                } else {
                    const embed = new EmbedBuilder()
                        .setTitle('✅ Aktiflik - Katılanlar')
                        .setDescription('Katılan kimse yok.')
                        .setColor(0x00FF00);
                    await reportChannel.send({ embeds: [embed] }).catch(() => {});
                }
                
                if (katilmayanArray.length > 0) {
                    await this.sendPaginatedButtonEmbeds(reportChannel, '❌ Aktiflik - Katılmayanlar', katilmayanArray, 0xFF0000);
                } else {
                    const embed = new EmbedBuilder()
                        .setTitle('❌ Aktiflik - Katılmayanlar')
                        .setDescription('Herkes katıldı! 🎉')
                        .setColor(0x00FF00);
                    await reportChannel.send({ embeds: [embed] }).catch(() => {});
                }
            } catch (err) {
                console.log('Log kanalına mesaj gönderilemedi:', err.message);
            }
        }

        // Orijinal mesajı güncelle
        if (!manuel && message) {
            try {
                const bitisEmbed = new EmbedBuilder()
                    .setTitle('Swiz Bot\'s | Aktiflik Sona Erdi')
                    .setDescription(`**${role.name}** rolü için aktiflik tamamlandı!`)
                    .setColor(katilmayanArray.length === 0 ? 0x00FF00 : 0xFF0000)
                    .addFields(
                        { name: '✅ Katılanlar', value: `**${katilanlar.size}** kişi`, inline: true },
                        { name: '❌ Katılmayanlar', value: `**${katilmayanArray.length}** kişi`, inline: true }
                    )
                    .setFooter({ text: 'Swiz Bot\'s • Aktiflik Sistemi' })
                    .setTimestamp();

                await message.edit({ embeds: [bitisEmbed], components: [] }).catch(() => {});
            } catch (err) {
                console.log('Mesaj güncellenemedi:', err.message);
            }
        }

        // Ana log kanalına bildirim
        const anaLogKanal = interaction.guild?.channels.cache.get(CONFIG.IDS.LOG_KANALI);
        
        if (anaLogKanal) {
            try {
                const bitisEmbed = new EmbedBuilder()
                    .setTitle('Swiz Bot\'s | Aktiflik Sona Erdi')
                    .setDescription(`**Rol:** ${role.name}\n**Katılan:** ${katilanlar.size}\n**Katılmayan:** ${katilmayanArray.length}\n**Başlatan:** ${interaction.user?.tag || 'Bilinmiyor'}${manuel ? '\n🔸 **Manuel Sonlandırıldı**' : ''}`)
                    .setColor(manuel ? 0xFFA500 : 0x00FFFF)
                    .setTimestamp()
                    .setFooter({ text: `Swiz Bot's Log Sistemi` });

                await anaLogKanal.send({ embeds: [bitisEmbed] }).catch(() => {});
            } catch (err) {
                console.log('Ana log kanalına mesaj gönderilemedi:', err.message);
            }
        }

        this.aktiflikKatilim.delete(aktiflikId);
    }

    // ========================================================================
    // 🔚 MADDEX BİTİRME FONKSİYONU - RESTART KORUMALI
    // ========================================================================
    async bitirMaddex(interaction, maddexId, role, message = null, manuel = false) {
        const claim = await this.db.run('UPDATE aktif_durumlar SET tamamlandi = 1 WHERE durum_id = ? AND tamamlandi = 0', [maddexId]);
        if (!claim.changes) return;
        const persisted = await this.db.get('SELECT katilanlar FROM aktif_durumlar WHERE durum_id = ?', [maddexId]);
        this.maddexKatilim.set(maddexId, new Set(JSON.parse(persisted?.katilanlar || '[]')));
        await interaction.guild.members.fetch().catch(() => null);
        // Zamanlayıcıyı temizle
        const timer = this.maddexTimers.get(maddexId);
        if (timer) {
            clearTimeout(timer);
            this.maddexTimers.delete(maddexId);
            console.log('✅ Maddex zamanlayıcısı temizlendi');
        }

        // ⭐ AKTIF DURUMLAR TABLOSUNU GÜNCELLE
        await this.db.run(
            `UPDATE aktif_durumlar SET tamamlandi = 1 WHERE durum_id = ?`,
            [maddexId]
        );

        const katilanlar = this.maddexKatilim.get(maddexId) || new Set();
        
        const katilanArray = Array.from(katilanlar).map(id => `<@${id}>`);
        const katilmayanArray = role.members
            .filter(m => !m.user.bot && !katilanlar.has(m.id))
            .map(m => `<@${m.id}>`);

        // Veritabanını güncelle
        await this.db.run(
            `UPDATE maddex_kayitlari SET katilanlar = ?, katilmayanlar = ?, tamamlandi = 1 WHERE maddex_id = ?`,
            [katilanArray.join(','), katilmayanArray.join(','), maddexId]
        );

        // Maddex log kanalına rapor gönder
        const reportChannel = interaction.guild?.channels.cache.get(CONFIG.IDS.MADDEX_LOG_KANALI);
        
        if (reportChannel) {
            try {
                if (katilanArray.length > 0) {
                    await this.sendPaginatedButtonEmbeds(reportChannel, '✅ Maddex - Katılanlar', katilanArray, 0x00FF00);
                } else {
                    const embed = new EmbedBuilder()
                        .setTitle('✅ Maddex - Katılanlar')
                        .setDescription('Katılan kimse yok.')
                        .setColor(0x00FF00);
                    await reportChannel.send({ embeds: [embed] }).catch(() => {});
                }
                
                if (katilmayanArray.length > 0) {
                    await this.sendPaginatedButtonEmbeds(reportChannel, '❌ Maddex - Katılmayanlar', katilmayanArray, 0xFF0000);
                } else {
                    const embed = new EmbedBuilder()
                        .setTitle('❌ Maddex - Katılmayanlar')
                        .setDescription('Herkes katıldı! 🎉')
                        .setColor(0x00FF00);
                    await reportChannel.send({ embeds: [embed] }).catch(() => {});
                }
            } catch (err) {
                console.log('Maddex log kanalına mesaj gönderilemedi:', err.message);
            }
        }

        // Orijinal mesajı güncelle
        if (!manuel && message) {
            try {
                const disabledRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`disabled_katil_${maddexId}`)
                            .setLabel('✅ Katıl')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId(`disabled_cik_${maddexId}`)
                            .setLabel('❌ Çık')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true)
                    );

                const bitisEmbed = new EmbedBuilder()
                    .setTitle('Swiz Bot\'s | Maddex Kadro Sona Erdi')
                    .setDescription(`**${role.name}** rolü için maddex kadrosu tamamlandı!`)
                    .setColor(katilmayanArray.length === 0 ? 0x00FF00 : 0xFF0000)
                    .addFields(
                        { name: '✅ Katılanlar', value: `**${katilanlar.size}** kişi`, inline: true },
                        { name: '❌ Katılmayanlar', value: `**${katilmayanArray.length}** kişi`, inline: true }
                    )
                    .setFooter({ text: 'Swiz Bot\'s • Kadro Sistemi' })
                    .setTimestamp();

                await message.edit({ embeds: [bitisEmbed], components: [disabledRow] }).catch(() => {});
            } catch (err) {
                console.log('Mesaj güncellenemedi:', err.message);
            }
        }

        // Ana log kanalına bildirim
        const anaLogKanal = interaction.guild?.channels.cache.get(CONFIG.IDS.LOG_KANALI);
        
        if (anaLogKanal) {
            try {
                const bitisEmbed = new EmbedBuilder()
                    .setTitle('Swiz Bot\'s | Maddex Kadro Sona Erdi')
                    .setDescription(`**Rol:** ${role.name}\n**Katılan:** ${katilanlar.size}\n**Katılmayan:** ${katilmayanArray.length}\n**Başlatan:** ${interaction.user?.tag || 'Bilinmiyor'}${manuel ? '\n🔸 **Manuel Sonlandırıldı**' : ''}`)
                    .setColor(manuel ? 0xFFA500 : 0xFF69B4)
                    .setTimestamp()
                    .setFooter({ text: `Swiz Bot's Log Sistemi` });

                await anaLogKanal.send({ embeds: [bitisEmbed] }).catch(() => {});
            } catch (err) {
                console.log('Ana log kanalına mesaj gönderilemedi:', err.message);
            }
        }

        this.maddexKatilim.delete(maddexId);
    }

    // ========================================================================
    // 🎮 ETKİNLİK KOMUTU
    // ========================================================================

    async handleUyari(interaction) {
        const user = interaction.options.getUser('kullanici');
        const warningType = interaction.options.getString('tip');
        const reason = interaction.options.getString('sebep');
        
        const member = interaction.guild.members.cache.get(user.id);

        if (!member) {
            return await interaction.reply({ 
                content: '❌ Kullanıcı sunucuda bulunamadı!', 
                flags: 64 
            });
        }

        const warningPoints = this.calculateWarningPoints(warningType);

        try {
            const warnings = await this.db.query(
                `SELECT uyari_tip, eski_uyari FROM uyarilar WHERE kullanici_id = ?`, 
                [user.id]
            );

            let totalPoints = 0;
            warnings?.forEach(row => {
                if (row.eski_uyari) {
                    totalPoints += row.eski_uyari;
                } else {
                    totalPoints += this.calculateWarningPoints(row.uyari_tip);
                }
            });

            totalPoints += warningPoints;

            const counter = await this.db.get(
                'SELECT deger FROM config WHERE anahtar = "toplam_uyari"'
            );
            
            const warningNo = counter ? parseInt(counter.deger) + 1 : 1;
            
            await this.db.run(
                'UPDATE config SET deger = ? WHERE anahtar = "toplam_uyari"', 
                warningNo.toString()
            );

            await this.db.run(
                `INSERT INTO uyarilar (kullanici_id, yetkili_id, uyari_tip, sebep, tarih) 
                 VALUES (?, ?, ?, ?, ?)`,
                [user.id, interaction.user.id, warningType, reason, new Date().toISOString()]
            );

            await this.updateWarningRoles(member, totalPoints);

            const warningNames = {
                sozlu: '📝 Sözlü Uyarı',
                strike1: '⚠️ 1x Strike',
                strike2: '⚠️⚠️ 2x Strike',
                strike3: '⚠️⚠️⚠️ 3x Strike'
            };

            const embed = new EmbedBuilder()
                .setTitle(` Swiz Bot's | Uyarı #${warningNo}`)
                .setDescription(`**Kullanıcı:** ${user}\n**Uyarı Tipi:** ${warningNames[warningType]}\n**Sebep:** ${reason}\n**Yetkili:** ${interaction.user}`)
                .addFields({ name: '📊 Toplam Uyarı Puanı', value: totalPoints.toString(), inline: true })
                .setColor(0xFFFF00)
                .setTimestamp()
                .setFooter({ text: 'Swiz Bot\'s • Uyarı Sistemi' });

            await interaction.reply({ embeds: [embed] });

            await this.logEvent(interaction.guild, 'uyari_verildi', 
                `**Kullanıcı:** ${user.tag}\n**Tip:** ${warningNames[warningType]}\n**Sebep:** ${reason}\n**Yetkili:** ${interaction.user.tag}`
            );

            try {
                await user.send({ embeds: [embed] });
            } catch (error) {}

        } catch (error) {
            console.error('Uyarı komutu hatası:', error);
            await interaction.reply({ 
                content: '❌ Uyarı verilirken beklenmeyen bir hata oluştu!', 
                flags: 64 
            });
        }
    }

    async handleUyarilar(interaction) {
        const user = interaction.options.getUser('kullanici');

        const warnings = await this.db.query(
            `SELECT yetkili_id, uyari_tip, sebep, tarih FROM uyarilar WHERE kullanici_id = ? ORDER BY tarih DESC`, 
            [user.id]
        );

        if (!warnings || warnings.length === 0) {
            return await interaction.reply({ 
                content: `✅ ${user} kullanıcısının hiç uyarısı yok.`, 
                flags: 64 
            });
        }

        let totalPoints = 0;
        warnings.forEach(row => {
            totalPoints += this.calculateWarningPoints(row.uyari_tip);
        });

        const warningNames = {
            sozlu: '📝 Sözlü',
            strike1: '⚠️ 1x',
            strike2: '⚠️⚠️ 2x',
            strike3: '⚠️⚠️⚠️ 3x'
        };

        const embed = new EmbedBuilder()
            .setTitle(` Swiz Bot's | ${user.username} Uyarıları`)
            .addFields(
                { name: '📊 Toplam Uyarı', value: warnings.length.toString(), inline: true },
                { name: '📊 Toplam Puan', value: totalPoints.toString(), inline: true }
            )
            .setColor(0xFFD700)
            .setTimestamp()
            .setFooter({ text: 'Swiz Bot\'s • Uyarı Sistemi' });

        for (let i = 0; i < Math.min(warnings.length, 5); i++) {
            const row = warnings[i];
            const yetkili = await this.client.users.fetch(row.yetkili_id).catch(() => null);
            const yetkiliAdi = yetkili ? yetkili.tag : 'Bilinmeyen Yetkili';
            const tarih = new Date(row.tarih).toLocaleDateString('tr-TR');
            
            embed.addFields({ 
                name: `Uyarı #${i + 1} - ${warningNames[row.uyari_tip] || row.uyari_tip}`, 
                value: `**Yetkili:** ${yetkiliAdi}\n**Sebep:** ${row.sebep}\n**Tarih:** ${tarih}`, 
                inline: false 
            });
        }

        if (warnings.length > 5) {
            embed.setFooter({ 
                text: `Swiz Bot's • Uyarı Sistemi • Toplam ${warnings.length} uyarıdan ilk 5 gösteriliyor` 
            });
        }

        await interaction.reply({ embeds: [embed] });
    }


    async handleUyariSil(interaction) {
        if (!this.checkPermission(interaction, 'uyari')) {
            return await interaction.reply({ 
                content: '❌ Bu komutu kullanma yetkin yok!', 
                flags: 64 
            });
        }

        await interaction.deferReply({ flags: 64 });

        const user = interaction.options.getUser('kullanici');
        const uyariNo = interaction.options.getInteger('uyari_no');
        
        const member = interaction.guild.members.cache.get(user.id);

        if (!member) {
            return await interaction.editReply({ 
                content: '❌ Kullanıcı sunucuda bulunamadı!'
            });
        }

        try {
            const warnings = await this.db.query(
                `SELECT id, uyari_tip, sebep, tarih FROM uyarilar WHERE kullanici_id = ? ORDER BY tarih ASC`, 
                [user.id]
            );

            if (!warnings || warnings.length === 0) {
                return await interaction.editReply({ 
                    content: `❌ ${user} kullanıcısının hiç uyarısı yok!`
                });
            }

            if (uyariNo < 1 || uyariNo > warnings.length) {
                return await interaction.editReply({ 
                    content: `❌ Geçersiz uyarı numarası! Kullanıcının **${warnings.length}** uyarısı var. (1-${warnings.length} arası)`
                });
            }

            const silinecekUyari = warnings[uyariNo - 1];

            await this.db.run(
                `DELETE FROM uyarilar WHERE id = ?`,
                [silinecekUyari.id]
            );

            const kalanUyarilar = await this.db.query(
                `SELECT uyari_tip FROM uyarilar WHERE kullanici_id = ?`, 
                [user.id]
            );

            let kalanPuan = 0;
            kalanUyarilar.forEach(row => {
                kalanPuan += this.calculateWarningPoints(row.uyari_tip);
            });

            const roles = CONFIG.WARNING_ROLES;
            await member.roles.remove(Object.values(roles).filter(Boolean)).catch(() => {});

            if (kalanPuan >= 3) {
                if (roles.STRIKE3) await member.roles.add(roles.STRIKE3).catch(() => {});
            } 
            else if (kalanPuan >= 2.5) {
                if (roles.STRIKE2) await member.roles.add(roles.STRIKE2).catch(() => {});
                if (roles.SOZLU) await member.roles.add(roles.SOZLU).catch(() => {});
            } 
            else if (kalanPuan >= 2) {
                if (roles.STRIKE2) await member.roles.add(roles.STRIKE2).catch(() => {});
            } 
            else if (kalanPuan >= 1.5) {
                if (roles.STRIKE1) await member.roles.add(roles.STRIKE1).catch(() => {});
                if (roles.SOZLU) await member.roles.add(roles.SOZLU).catch(() => {});
            } 
            else if (kalanPuan >= 1) {
                if (roles.STRIKE1) await member.roles.add(roles.STRIKE1).catch(() => {});
            } 
            else if (kalanPuan >= 0.5) {
                if (roles.SOZLU) await member.roles.add(roles.SOZLU).catch(() => {});
            }

            const warningNames = {
                sozlu: '📝 Sözlü Uyarı',
                strike1: '⚠️ 1x Strike',
                strike2: '⚠️⚠️ 2x Strike',
                strike3: '⚠️⚠️⚠️ 3x Strike'
            };

            const embed = new EmbedBuilder()
                .setTitle('🗑️ Uyarı Silindi')
                .setDescription(`**Kullanıcı:** ${user}`)
                .addFields(
                    { name: '📋 Silinen Uyarı', value: `**${warningNames[silinecekUyari.uyari_tip]}**\nSebep: ${silinecekUyari.sebep}\nTarih: <t:${Math.floor(new Date(silinecekUyari.tarih).getTime() / 1000)}:R>`, inline: false },
                    { name: '📊 Kalan Uyarı Sayısı', value: `${kalanUyarilar.length}`, inline: true },
                    { name: '📊 Kalan Toplam Puan', value: `${kalanPuan}`, inline: true }
                )
                .setColor(0x00FF00)
                .setTimestamp()
                .setFooter({ text: `Silen: ${interaction.user.tag}` });

            await interaction.editReply({ embeds: [embed] });

            await this.logEvent(interaction.guild, 'uyari_silindi', 
                `**Kullanıcı:** ${user.tag}\n**Silinen Uyarı:** ${warningNames[silinecekUyari.uyari_tip]}\n**Sebep:** ${silinecekUyari.sebep}\n**Kalan Puan:** ${kalanPuan}\n**Yetkili:** ${interaction.user.tag}`,
                0x00FF00
            );

        } catch (error) {
            console.error('Uyarı silme hatası:', error);
            await interaction.editReply({ 
                content: '❌ Uyarı silinirken bir hata oluştu!'
            });
        }
    }

    async handleUyariListe(interaction) {
        if (!this.checkPermission(interaction, 'uyarilar')) {
            return await interaction.reply({ 
                content: '❌ Bu komutu kullanma yetkin yok!', 
                flags: 64 
            });
        }

        await interaction.deferReply();

        try {
            const allWarnings = await this.db.query(`
                SELECT u.kullanici_id, u.uyari_tip, u.sebep, u.tarih, u.yetkili_id,
                       (SELECT COUNT(*) FROM uyarilar WHERE kullanici_id = u.kullanici_id) as toplam_uyari
                FROM uyarilar u
                ORDER BY u.kullanici_id, u.tarih DESC
            `);

            if (!allWarnings || allWarnings.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('📋 Uyarı Listesi')
                    .setDescription('Hiç uyarı bulunmuyor.')
                    .setColor(0x00FF00)
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            }

            const userWarnings = new Map();
            for (const warning of allWarnings) {
                if (!userWarnings.has(warning.kullanici_id)) {
                    userWarnings.set(warning.kullanici_id, []);
                }
                userWarnings.get(warning.kullanici_id).push(warning);
            }

            const sortedUsers = Array.from(userWarnings.entries())
                .sort((a, b) => b[1].length - a[1].length);

            const pageSize = 5;
            const pages = [];
            let currentPage = 0;

            const warningNames = {
                sozlu: '📝 Sözlü',
                strike1: '⚠️ 1x',
                strike2: '⚠️⚠️ 2x',
                strike3: '⚠️⚠️⚠️ 3x'
            };

            for (let i = 0; i < sortedUsers.length; i += pageSize) {
                const pageUsers = sortedUsers.slice(i, i + pageSize);
                let description = '';

                for (const [userId, warnings] of pageUsers) {
                    const member = await interaction.guild.members.fetch(userId).catch(() => null);
                    const mention = member ? `<@${userId}>` : userId;
                    
                    let totalPoints = 0;
                    warnings.forEach(w => {
                        totalPoints += this.calculateWarningPoints(w.uyari_tip);
                    });

                    description += `## 👤 ${mention}\n`;
                    description += `📊 **Toplam Uyarı:** ${warnings.length} | **Puan:** ${totalPoints}\n`;
                    description += `📋 **Uyarılar:**\n`;
                    
                    warnings.slice(0, 5).forEach((w, idx) => {
                        const tarih = new Date(w.tarih).toLocaleDateString('tr-TR');
                        const yetkiliId = w.yetkili_id;
                        const yetkili = interaction.guild.members.cache.get(yetkiliId);
                        const yetkiliAdi = yetkili ? yetkili.displayName : `ID: ${yetkiliId}`;
                        
                        description += `   **${idx + 1}.** ${warningNames[w.uyari_tip] || w.uyari_tip} - Sebep: ${w.sebep.substring(0, 50)}${w.sebep.length > 50 ? '...' : ''}\n`;
                        description += `      📅 ${tarih} | 👮 <@${yetkiliId}>\n`;
                    });
                    
                    if (warnings.length > 5) {
                        description += `   *...ve ${warnings.length - 5} uyarı daha*\n`;
                    }
                    description += '\n';
                }

                const embed = new EmbedBuilder()
                    .setTitle('📋 Swiz Bot\'s | Uyarı Listesi')
                    .setDescription(description || 'Liste boş')
                    .setColor(0xFFD700)
                    .setFooter({ 
                        text: `Sayfa ${pages.length + 1}/${Math.ceil(sortedUsers.length / pageSize)} • Toplam ${sortedUsers.length} kullanıcıda uyarı var` 
                    })
                    .setTimestamp();

                pages.push(embed);
            }

            if (pages.length === 1) {
                await interaction.editReply({ embeds: [pages[0]] });
                return;
            }

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('uyariliste_onceki')
                        .setLabel('◀ Önceki')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('uyariliste_bilgi')
                        .setLabel(`1/${pages.length}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('uyariliste_sonraki')
                        .setLabel('Sonraki ▶')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(pages.length <= 1)
                );

            const reply = await interaction.editReply({ 
                embeds: [pages[0]], 
                components: [row],
                fetchReply: true 
            });

            const filter = i => i.user.id === interaction.user.id;
            const collector = reply.createMessageComponentCollector({ 
                filter, 
                time: 60000
            });

            collector.on('collect', async i => {
                if (i.customId === 'uyariliste_sonraki') {
                    currentPage++;
                } else if (i.customId === 'uyariliste_onceki') {
                    currentPage--;
                }

                const newRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('uyariliste_onceki')
                            .setLabel('◀ Önceki')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(currentPage === 0),
                        new ButtonBuilder()
                            .setCustomId('uyariliste_bilgi')
                            .setLabel(`${currentPage + 1}/${pages.length}`)
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('uyariliste_sonraki')
                            .setLabel('Sonraki ▶')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(currentPage === pages.length - 1)
                    );

                await i.update({ 
                    embeds: [pages[currentPage]], 
                    components: [newRow] 
                });
            });

            collector.on('end', () => {
                const disabledRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('disabled_onceki')
                            .setLabel('◀ Önceki')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('disabled_bilgi')
                            .setLabel(`${currentPage + 1}/${pages.length}`)
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('disabled_sonraki')
                            .setLabel('Sonraki ▶')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true)
                    );
                interaction.editReply({ components: [disabledRow] }).catch(() => {});
            });

        } catch (error) {
            console.error('Uyarı liste hatası:', error);
            await interaction.editReply({ 
                content: '❌ Uyarı listesi alınırken bir hata oluştu!',
                components: []
            });
        }
    }

    async handleClear(interaction) {
        const amount = interaction.options.getInteger('miktar');

        if (amount < 1 || amount > 100) {
            return await interaction.reply({ 
                content: '❌ Miktar 1-100 arasında olmalı!', 
                flags: 64 
            });
        }

        await interaction.reply({ 
            content: `🧹 ${amount} mesaj siliniyor...`, 
            flags: 64 
        });

        const deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);

        if (deleted) {
            await interaction.followUp({ 
                content: `✅ ${deleted.size} mesaj silindi.`, 
                flags: 64 
            });
        } else {
            await interaction.followUp({ 
                content: '❌ Mesajlar silinirken hata oluştu!', 
                flags: 64 
            });
        }
    }

    async handleKick(interaction) {
        const member = interaction.options.getMember('kullanici');
        const reason = interaction.options.getString('sebep') || 'Belirtilmedi';

        if (!member) {
            return await interaction.reply({ 
                content: '❌ Kullanıcı bulunamadı!', 
                flags: 64 
            });
        }

        if (member.roles.highest.position >= interaction.member.roles.highest.position && 
            interaction.user.id !== interaction.guild.ownerId) {
            return await interaction.reply({ 
                content: '❌ Bu kullanıcıyı atamazsın!', 
                flags: 64 
            });
        }

        try {
            await member.send(`🚫 **${interaction.guild.name}** sunucusundan atıldın!\n**Sebep:** ${reason}`);
        } catch (error) {}

        await member.kick(reason);

        await interaction.reply(`👢 ${member} atıldı. **Sebep:** ${reason}`);

        await this.logEvent(interaction.guild, 'kullanici_kick', 
            `**Atılan:** ${member.user.tag}\n**Sebep:** ${reason}\n**Yetkili:** ${interaction.user.tag}`
        );
    }

    async handleBan(interaction) {
        const member = interaction.options.getMember('kullanici');
        const reason = interaction.options.getString('sebep') || 'Belirtilmedi';

        if (!member) {
            return await interaction.reply({ 
                content: '❌ Kullanıcı bulunamadı!', 
                flags: 64 
            });
        }

        if (member.roles.highest.position >= interaction.member.roles.highest.position && 
            interaction.user.id !== interaction.guild.ownerId) {
            return await interaction.reply({ 
                content: '❌ Bu kullanıcıyı banlayamazsın!', 
                flags: 64 
            });
        }

        try {
            await member.send(`🔨 **${interaction.guild.name}** sunucusundan banlandın!\n**Sebep:** ${reason}`);
        } catch (error) {}

        await this.db.run(
            `INSERT INTO banlar (kullanici_id, kullanici_tag, yetkili_id, sebep, tarih) 
             VALUES (?, ?, ?, ?, ?)`,
            [member.id, member.user.tag, interaction.user.id, reason, new Date().toISOString()]
        );

        await member.ban({ reason });

        await interaction.reply(`🔨 ${member} banlandı. **Sebep:** ${reason}`);

        await this.logEvent(interaction.guild, 'kullanici_ban', 
            `**Banlanan:** ${member.user.tag}\n**Sebep:** ${reason}\n**Yetkili:** ${interaction.user.tag}`
        );
    }

    async handleUnban(interaction) {
        const userId = interaction.options.getString('kullanici_id');
        const reason = interaction.options.getString('sebep') || 'Belirtilmedi';

        try {
            await interaction.guild.bans.fetch(userId);
            await interaction.guild.bans.remove(userId, reason);

            await interaction.reply(`✅ <@${userId}> kullanıcısının banı kaldırıldı. **Sebep:** ${reason}`);

            await this.logEvent(interaction.guild, 'kullanici_unban', 
                `**Banı Kaldırılan:** <@${userId}>\n**Sebep:** ${reason}\n**Yetkili:** ${interaction.user.tag}`
            );
        } catch (error) {
            await interaction.reply({ 
                content: '❌ Kullanıcı banlı değil veya ID hatalı!', 
                flags: 64 
            });
        }
    }

    async handleBanlar(interaction) {
        const bans = await this.db.query(
            `SELECT kullanici_id, kullanici_tag, yetkili_id, sebep, tarih FROM banlar ORDER BY tarih DESC LIMIT 20`, 
            []
        );

        if (!bans || bans.length === 0) {
            return await interaction.reply({ 
                content: '📋 Banlanmış kullanıcı yok.', 
                flags: 64 
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(' Swiz Bot\'s | Ban Listesi')
            .setColor(0xFF0000)
            .setTimestamp()
            .setFooter({ text: 'Swiz Bot\'s • Ban Sistemi' });

        for (let i = 0; i < Math.min(bans.length, 10); i++) {
            const row = bans[i];
            const yetkili = await this.client.users.fetch(row.yetkili_id).catch(() => null);
            const yetkiliAdi = yetkili ? yetkili.tag : 'Bilinmeyen Yetkili';
            const tarih = new Date(row.tarih).toLocaleDateString('tr-TR');
            
            embed.addFields({ 
                name: `${row.kullanici_tag} (${row.kullanici_id})`, 
                value: `**Yetkili:** ${yetkiliAdi}\n**Sebep:** ${row.sebep}\n**Tarih:** ${tarih}`, 
                inline: false 
            });
        }

        await interaction.reply({ embeds: [embed] });
    }

    // ========================================================================
    // 🟢 /aktif SLASH KOMUTU
    // ========================================================================
    async handleAktifSlash(interaction) {
        await this.processAktifCommand(interaction, true);
    }

    // ========================================================================
    // 🟢 AKTİF KOMUTU ANA İŞLEM
    // ========================================================================
    async processAktifCommand(source, isSlash = false) {
        const guild = source.guild;
        const swizRoleId = CONFIG.IDS.SWIZ_ROL;
        const dostRoleId = CONFIG.IDS.DOST_ROL;
        
        if (!swizRoleId || !dostRoleId) {
            const errMsg = '❌ Roller konfigüre edilmemiş!';
            if (isSlash) {
                await source.reply({ content: errMsg, flags: 64 });
            } else {
                await source.reply(errMsg);
            }
            return;
        }

        // Üyeleri getirmek Discord'un ilk yanıt süresini aşabilir.
        if (isSlash && !source.deferred && !source.replied) await source.deferReply();
        await guild.members.fetch();

        const onlineSwizMembers = guild.members.cache.filter(member => {
            return !member.user.bot &&
                   member.roles.cache.has(swizRoleId) &&
                   !member.roles.cache.has(dostRoleId) &&
                   (member.presence?.status === 'online' || 
                    member.presence?.status === 'idle' || 
                    member.presence?.status === 'dnd');
        });

        const memberLines = onlineSwizMembers.map(m => `• ${m.user}`);
        const count = onlineSwizMembers.size;

        const heading = `**Sunucuda şu anda ${count} aktif Swiz üyesi bulunuyor.**\n\n`;
        const fullDescription = heading + (memberLines.join('\n') || 'Henüz aktif Swiz üyesi yok.');
        let description = fullDescription;
        const files = [];
        if (fullDescription.length > 4096) {
            const footer = '\n\nTam üye listesi ekli metin dosyasında.';
            description = heading;
            for (const line of memberLines) {
                if (description.length + line.length + 1 + footer.length > 4096) break;
                description += line + '\n';
            }
            description += footer;
            const fullList = onlineSwizMembers.map(m => `${m.displayName || m.user.username || m.id} (${m.id})`).join('\n');
            files.push({ attachment: Buffer.from(`${count} aktif Swiz üyesi\n\n${fullList}`, 'utf8'), name: 'swiz-aktif-uyeler.txt' });
        }

        const embed = new EmbedBuilder()
            .setTitle('🟢 Swiz Aktifler')
            .setDescription(description)
            .setColor(0x57F287)
            .setTimestamp()
            .setFooter({ text: 'Swiz Bot\'s • Aktiflik Sistemi' });

        const payload = { embeds: [embed], files, allowedMentions: { parse: [] } };
        if (isSlash) {
            if (source.deferred) {
                await source.editReply(payload);
            } else if (source.replied) {
                await source.followUp(payload);
            } else {
                await source.reply(payload);
            }
        } else {
            await source.channel.send(payload);
        }
    }

    // ========================================================================
    // 📝 SLASH KOMUTLARINI KAYDET
    // ========================================================================

    // ========================================================================
    // 🚀 BOTU BAŞLAT - YENİDEN BAĞLANMA ÖZELLİKLİ
    // ========================================================================
}


Object.assign(SwizBot.prototype, require('./tickets'), require('./activities'), require('./features').methods, require('./runtime'));
for (const name of ['bitirAktiflik','bitirMaddex']) {
  const finish = SwizBot.prototype[name];
  SwizBot.prototype[name] = function(interaction,id,...args) { return this.locks.run(`attendance:${id}`,()=>finish.call(this,interaction,id,...args)); };
}
module.exports = { SwizBot };
