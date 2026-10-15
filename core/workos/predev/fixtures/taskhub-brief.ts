// //TR: Bu dosya TaskHub REFERANS projesinin dürüst, gerçekçi kapsamlı bir proje özetini SALT VERİ fixture olarak sağlar: bir ekip görev-yönetimi web uygulaması (web UI + backend API + ilişkisel veritabanı + kimlik doğrulama). Bu, gerçek bir müşteri projesi DEĞİLDİR; yalnız driver/role-prompt'ları deterministik denemek için referans bağlamdır. Hiçbir alan verified/certified olarak işaretli değildir ve sır/ağ adresi içermez.
import type {ProjectBrief} from "../driver.js";

// //TR: TaskHub referans özeti. isReference=true ve label açıkça referans olduğunu bildirir; içerik dürüst ve kendi içinde tutarlıdır (uydurma metrik/teknoloji iddiası yoktur, yalnız tipik bir ekip görev yöneticisinin makul kapsamıdır).
export const TASKHUB_BRIEF: ProjectBrief = {
  projectName: "TaskHub",
  isReference: true,
  label: "TaskHub reference project (not a customer project; honest reference content, not verified/certified)",
  summary: "TaskHub küçük ve orta ölçekli ekiplerin işi görünür kılması için bir görev-yönetimi web uygulamasıdır: kullanıcılar oturum açar, projeler ve görevler oluşturur, görevleri ekip üyelerine atar, durum (todo/in-progress/done) ve son tarih takip eder ve bir pano üzerinde ilerlemeyi görür. Sistem bir web arayüzü (UI), bir backend API ve kalıcılık için ilişkisel bir veritabanından oluşur; erişim kimlik doğrulama ile korunur.",
  stakeholders: [
    "Ekip üyeleri (görevleri oluşturan, güncelleyen ve tamamlayan son kullanıcılar)",
    "Ekip yöneticileri (iş yükünü ve ilerlemeyi gözeten)",
    "Workspace yöneticisi (kullanıcı davetlerini ve rolleri yöneten)",
    "Ürün ekibi (ürünü tanımlayan ve önceliklendiren)"
  ],
  objectives: [
    "Kullanıcılar kimlik doğrulama (e-posta + parola) ile güvenli şekilde oturum açabilsin.",
    "Kullanıcılar proje ve görev oluşturabilsin, görevleri ekip üyelerine atayabilsin.",
    "Görevler durum (todo/in-progress/done), öncelik ve son tarih taşısın; değişiklikler kalıcı olsun.",
    "Bir ekip panosu, projedeki görevleri duruma göre gruplayıp ilerlemeyi göstersin.",
    "Yetkisiz kullanıcılar başka workspace'lerin verisine erişemesin (temel yetkilendirme)."
  ],
  constraints: [
    "Web tabanlı; modern masaüstü ve mobil tarayıcıları desteklemeli.",
    "Veriler ilişkisel bir veritabanında tutulmalı (kullanıcı, workspace, proje, görev varlıkları).",
    "Kimlik doğrulama ve oturum yönetimi güvenli olmalı (parolalar düz metin saklanmamalı).",
    "İlk sürüm tek dil (İngilizce) ve tek para birimi gerektirmeyen bir iç araçtır."
  ],
  outOfScope: [
    "Gerçek-zamanlı sohbet / mesajlaşma.",
    "Faturalandırma veya ödeme alma.",
    "Harici takvim/SSO entegrasyonları (ilk sürümde değil).",
    "Yerel mobil uygulamalar (yalnız responsive web)."
  ],
  notes: [
    "Bu özet referans amaçlıdır; belirli bir kullanıcının gerçek projesi değildir.",
    "Sayısal performans/ölçek hedefleri bu özette bağlanmamıştır; gereken yerde rol çıktısı açık varsayım/açık-soru olarak işaretlemelidir."
  ]
};
