# Swiz Community Bot — v6

Mevcut Swiz sunucusunun ticket, moderasyon, yoklama/kadro ve FiveM ihtiyaçları için geliştirilmiş Node.js botu. Eski 26 slash komutu ve dört mesaj komutu korunur. Yeni sürüm yedi ek slash komutu, kalıcı etkinlik kadroları ve testler içerir.

## Çalıştırma

Node.js 22 veya üzeri gerekir; bu sürüm yerel Node.js 24 üzerinde kontrol edildi.

```powershell
npm ci
npm run check
npm test
npm start
```

Yeni kurulumda `.env.example` dosyasını `.env`, `config.example.json` dosyasını `config.local.json` olarak kopyalayıp ayarla. Token yalnız `.env` içinde tutulur. Bot veritabanını çalışma dizinine göre değil proje konumuna göre bulur. `SWIZ_DATA_DIR` özel bir veri dizini seçebilir.

Ana giriş `index.js` dosyasıdır. `index2.js` eski alternatif sürümdür; yeni özellikler ana girişte bulunur. Aynı botu birden çok girişten eşzamanlı başlatma. Slash komutları giriş başarılı olduğunda mevcut global kapsamda kaydedilir. Discord Developer Portal'da Server Members, Presence ve Message Content intent'lerinin botun kullanımına uygun olması gerekir.

## Korunan komutlar

`/komutlar`, `/bot`, `/bilgi`, `/alesta`, `/aktif`, `/swiz`, `/sunucular`, `/id`, `/tag`, `/ticket`, `/panel`, `/aktiflik`, `/aktiflikbitir`, `/maddex`, `/maddexbitir`, `/etkinlik`, `/uyari`, `/uyarilar`, `/uyariaffi`, `/uyarisil`, `/uyariliste`, `/clear`, `/kick`, `/ban`, `/unban`, `/banlar`.

Mesaj komutları: `!id`, `!tag`, `!swiz`, `!aktif`.

## Yeni araçlar

| Komut | İşlev |
|---|---|
| `/istatistik [kullanici]` | Mesaj sayısı, ses süresi, en aktif kanal |
| `/sunucuozet` | Yakın dönemde mesaj, ses, ticket ve etkinlik toplamları |
| `/ticketdevral` | Ticket'ı bir yetkiliye atama |
| `/etkinlikbitir` | Son açık etkinliği kapatma, kadroyu saklama |
| `/durum` | Eksik kanal/rol ayarları ve bot izinleri |
| `/ayar secenek … kanal/rol …` | Kanal/rol ayarlarını yeniden başlatmadan değiştirme |
| `/yedek` | Tutarlı yerel SQLite yedeği |

`/etkinlik isim … [kontenjan]` varsayılan 15, en çok 30 kişilik kadro oluşturur. Fazla katılanlar bekleme listesine alınır. Bir katılımcı ayrıldığında sıra ilerler. Kadro veritabanında saklanır ve yeniden başlatmalarda korunur.

Yoklama ve Maddex katılımı ilgili role bağlıdır. Süresi dolmuş veya tamamlanmış kayıtlara eski düğmelerden katılım kabul edilmez. Uyarı affı onayı yalnız işlemi başlatan yetkiliye özel, 30 saniyelik ve tek kullanımlıktır. Rol kaldırma başarısız olan üyelerin uyarı kayıtları korunur.

## Veriler ve yedekler

Mevcut SQLite tabloları korunur; yeni tablolar ve gerekli ek alanlar ilk başlangıçta eklenir. Ticket sahibi ve kanal ID'si veritabanında tutulur. Mesaj istatistikleri yalnız sayım yapar; mesaj içeriği veya ses kaydı saklanmaz. Eski tarihlere ait istatistikler geriye dönük oluşturulmaz. Ses süresi AFK kanalı dışındaki bağlantı süresidir; her dakika ve düzgün kapanışta kaydedilir. Ani sistem kesintisinde son kontrol aralığı kaybolabilir.

Yedekler yerel `backups` klasörüne SQLite `VACUUM INTO` ile alınır. Çalışan bot her 24 saatte yedek alır; `/yedek` ile elle alınabilir. Son 14 yedek saklanır. Uyarı affı öncesinde de yedek alınır. Yedekleri Discord'a yükleyen komut yoktur.

Geri dönüş için botu durdur, güncel veriyi ayrıca koru ve seçtiğin yedeği `swiz_bot.db` olarak geri getir. Eski sürüme dönmeden önce veri ve kod yedeğinin aynı tarihe ait olmasına dikkat et.

## Test kapsamı

Otomatik testler Discord'a bağlanmadan geçici veritabanları kullanır. Eski komut seçenekleri, yetkisiz işlemler, ticket eşzamanlılığı, başarısız kanal oluşturma, etkinlik bekleme listesi, tek bitiş işlemi, istatistikler ve yedekten okuma sınanır. `test/legacy-commands.json` önceki komut tanımlarının uyumluluk kaydıdır.

Gerçek Discord rol hiyerarşisi, kanal izinleri, FiveM erişimi ve ses bağlantısı ayrıca canlı deneme gerektirir. FiveM sorgulanamadığında bunu boş oyuncu listesi gibi sunmaz; çoklu sunucu aramasında ulaşılamayan sunucuları belirtir.

## Kod düzeni

`src/bot.js`: korunan komutlar ve yönlendirme; `tickets.js`: destek talepleri; `activities.js`: yoklama ve etkinlikler; `features.js`: yeni komutlar ve güvenli onay; `database.js`: veri erişimi/migrasyon; `runtime.js`: ölçüm, API ve yaşam döngüsü.

Bu sürüm mevcut tek sunucu için yapılandırılmıştır. `.env`, `config.local.json`, gerçek veritabanı, yedekler ve eski alternatif kod GitHub paylaşımından dışlanmıştır. Paylaşım öncesinde kaynak katkıları ve lisans ayrıca gözden geçirilmelidir.
