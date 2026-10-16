// //TR: Bu dosya TaskHub referans projesi için Business Analyst (CLAUDE_BUILDER) rolünün GERÇEK çıktısını SALT VERİ fixture olarak sağlar. İçerik yalnız TASKHUB_BRIEF (taskhub-brief.ts) içindeki özet/amaç/kısıt/paydaşlardan dürüstçe türetilir; özette olmayan hiçbir gerçek (metrik, teknoloji, isim) uydurulmaz. Özetin sessiz kaldığı yerde (ör. sayısal hedefler) açık varsayım/açık-soru maddesi assumptions[]/risks[] içine yazılır. goals[] kimlikleri (G1..G5) alt Requirements tarafından tracesTo ile referans alınır. Sır/ağ adresi yoktur ve yan etkisi yoktur.
import type {BusinessAnalysisContent} from "../../types.js";

// //TR: goals, TASKHUB_BRIEF.objectives'in beş amacından birebir türetilir (özette olmayan hedef eklenmez). id'ler izlenebilirlik köküdür.
export const TASKHUB_BUSINESS_ANALYSIS: BusinessAnalysisContent = {
  problem:
    "Küçük ve orta ölçekli ekipler işi tek bir yerde görünür kılamıyor: görevlerin kime atandığı, hangi durumda olduğu ve ne zaman biteceği e-posta, elektronik tablo ve sohbet arasında dağılıyor; bu da ilerlemenin izlenmesini ve iş yükünün dengelenmesini zorlaştırıyor.",
  stakeholders: [
    "Ekip üyeleri (görevleri oluşturan, güncelleyen ve tamamlayan son kullanıcılar)",
    "Ekip yöneticileri (iş yükünü ve ilerlemeyi gözeten)",
    "Workspace yöneticisi (kullanıcı davetlerini ve rolleri yöneten)",
    "Ürün ekibi (ürünü tanımlayan ve önceliklendiren)"
  ],
  goals: [
    {id: "G1", statement: "Kullanıcılar e-posta + parola ile güvenli şekilde oturum açabilsin."},
    {id: "G2", statement: "Kullanıcılar proje ve görev oluşturabilsin ve görevleri ekip üyelerine atayabilsin."},
    {id: "G3", statement: "Görevler durum (todo/in-progress/done), öncelik ve son tarih taşısın ve değişiklikler kalıcı olsun."},
    {id: "G4", statement: "Bir ekip panosu, projedeki görevleri duruma göre gruplayıp ilerlemeyi göstersin."},
    {id: "G5", statement: "Yetkisiz kullanıcılar başka workspace'lerin verisine erişemesin (temel yetkilendirme)."}
  ],
  constraints: [
    "Web tabanlı; modern masaüstü ve mobil tarayıcıları (responsive) desteklemeli.",
    "Veriler ilişkisel bir veritabanında tutulmalı (kullanıcı, workspace, proje, görev varlıkları).",
    "Kimlik doğrulama ve oturum yönetimi güvenli olmalı; parolalar düz metin saklanmamalı.",
    "İlk sürüm tek dil (İngilizce), tek para birimi gerektirmeyen bir iç ekip aracıdır."
  ],
  successMetrics: [
    "Bir kullanıcı oturum açıp bir proje ve o projede bir görev oluşturabilir (uçtan uca temel akış çalışır).",
    "Bir görevin durumu/önceliği/son tarihi güncellenip tekrar yüklendiğinde değişiklik korunur (kalıcılık).",
    "Pano, bir projenin görevlerini duruma göre üç sütunda (todo/in-progress/done) gösterir.",
    "ASSUMPTION: Özet sayısal performans/benimseme hedefi bağlamadı; ilk sürümde yukarıdaki yetenek-tabanlı ölçütler izlenecek, nicel eşikler sonraki sürüme açık soru olarak bırakıldı."
  ],
  assumptions: [
    "TaskHub belirli bir müşterinin canlı projesi değil, dürüst bir referans iç ekip aracıdır (TASKHUB_BRIEF.isReference=true).",
    "Bir kullanıcı bir veya daha fazla workspace'e üyedir ve her proje tam olarak bir workspace'e aittir (özet workspace izolasyonunu şart koşar; eşleme burada açık varsayım olarak sabitlenir).",
    "OPEN QUESTION: Kullanıcı davet/rol yönetimi akışının ilk sürüm kapsamında olup olmadığı özette net değil; workspace yöneticisi paydaş olarak anılıyor ama bir amaç olarak bağlanmamış."
  ],
  risks: [
    "Yetkilendirme kusuru workspace izolasyonunu bozarak bir ekibin verisini başka bir ekibe sızdırabilir (G5 doğrudan tehdit altında).",
    "Parola saklama/oturum yönetimi zayıf uygulanırsa kimlik doğrulama güvenliği (G1) tehlikeye girer.",
    "Görev durum geçişleri iyi tanımlanmazsa pano (G4) tutarsız ilerleme gösterebilir.",
    "OPEN QUESTION: Ölçek/eşzamanlı kullanıcı hedefi özette bağlanmadığından altyapı boyutlandırması belirsiz; mimari fazında açık soru olarak taşınmalı."
  ]
};
