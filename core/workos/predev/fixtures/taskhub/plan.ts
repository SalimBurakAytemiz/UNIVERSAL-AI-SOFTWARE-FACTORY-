// //TR: Bu dosya TaskHub için Product Owner / Product Manager (CLAUDE_BUILDER) rolünün GERÇEK çıktısını SALT VERİ fixture olarak sağlar. Her workPackage'ın satisfies[] alanı YALNIZ onaylı Requirements (requirements.ts) içindeki GERÇEK gereksinim id'lerine referans verir; tüm gereksinimler en az bir iş paketince karşılanır (tam kapsama). dependsOn[] yalnız var olan workPackage id'lerine işaret eder ve kendine bağımlılık içermez. scope id'leri (SC1..SC6) alt Architecture tarafından covers ile kapsanır. Eksik bilgi outOfScope veya ilgili workPackage başlığında açık ASSUMPTION/OPEN QUESTION olarak işaretlenir. Sır/ağ adresi yok, yan etki yok.
import type {PlanContent} from "../../types.js";

export const TASKHUB_PLAN: PlanContent = {
  scope: [
    {id: "SC1", statement: "Kimlik doğrulama ve oturum yönetimi yüzeyi (login/logout/session)."},
    {id: "SC2", statement: "Workspace izolasyonu ve yetkilendirme sınırı."},
    {id: "SC3", statement: "Proje ve görev yönetimi (oluşturma + atama)."},
    {id: "SC4", statement: "Görev nitelikleri (durum/öncelik/son tarih) ve kalıcılık."},
    {id: "SC5", statement: "Ekip panosu (duruma göre gruplama ve ilerleme)."},
    {id: "SC6", statement: "Responsive web istemcisi."}
  ],
  workPackages: [
    {
      id: "WP1",
      title: "Kimlik doğrulama servisi (login/logout/session + parola hash'leme)",
      dependsOn: [],
      estimate: "5d",
      satisfies: ["FR1", "FR2", "NFR1"]
    },
    {
      id: "WP2",
      title: "Workspace izolasyonu ve yetkilendirme katmanı",
      dependsOn: ["WP1"],
      estimate: "5d",
      satisfies: ["NFR2", "NFR3"]
    },
    {
      id: "WP3",
      title: "Proje/görev API'si (proje oluşturma, görev oluşturma, atama)",
      dependsOn: ["WP1", "WP2"],
      estimate: "8d",
      satisfies: ["FR3", "FR4", "FR5"]
    },
    {
      id: "WP4",
      title: "Görev nitelikleri ve kalıcılık (durum/öncelik/son tarih)",
      dependsOn: ["WP3"],
      estimate: "6d",
      satisfies: ["FR6", "FR7", "FR8", "FR9"]
    },
    {
      id: "WP5",
      title: "Ekip panosu (duruma göre gruplama + ilerleme göstergesi)",
      dependsOn: ["WP4"],
      estimate: "5d",
      satisfies: ["FR10", "FR11"]
    },
    {
      id: "WP6",
      title: "Responsive web istemcisi (ASSUMPTION: asgari tarayıcı sürümleri UX fazında netleşecek)",
      dependsOn: ["WP3"],
      estimate: "6d",
      satisfies: ["NFR4"]
    }
  ],
  milestones: [
    {id: "MS1", title: "Güvenli temel (auth + izolasyon)", workPackageIds: ["WP1", "WP2"]},
    {id: "MS2", title: "Çekirdek görev yönetimi (API + nitelikler)", workPackageIds: ["WP3", "WP4"]},
    {id: "MS3", title: "Pano ve responsive beta", workPackageIds: ["WP5", "WP6"]}
  ],
  outOfScope: [
    "Gerçek-zamanlı sohbet / mesajlaşma (özet kapsam dışı).",
    "Faturalandırma veya ödeme alma (özet kapsam dışı).",
    "Harici takvim / SSO entegrasyonları (ilk sürümde değil).",
    "Yerel mobil uygulamalar (yalnız responsive web).",
    "OPEN QUESTION: Kullanıcı davet/rol yönetimi akışı; özette paydaş var ama amaç olarak bağlanmadığından ilk sürüm kapsamı dışı tutuldu, karar ürün ekibine açık soru."
  ]
};
