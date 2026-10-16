// //TR: Bu dosya TaskHub için UX Designer (CLAUDE_BUILDER) rolünün GERÇEK çıktısını SALT VERİ fixture olarak sağlar. Ekranlar, akışlar ve bileşenler YALNIZ onaylı Plan/Requirements kapsamındaki yeteneklerden türetilir; kapsam dışı ekran uydurulmaz. Tüm ekran/akış/bileşen id'leri kendi listesinde benzersizdir. Özette bağlanmayan erişilebilirlik ayrıntısı a11yNotes[] içine açık ASSUMPTION/OPEN QUESTION olarak yazılır. Sır/ağ adresi yok, yan etki yok.
import type {UxSpecContent} from "../../types.js";

export const TASKHUB_UX_SPEC: UxSpecContent = {
  screens: [
    {id: "SCR1", name: "Oturum açma (Login)"},
    {id: "SCR2", name: "Proje listesi (workspace kapsamında)"},
    {id: "SCR3", name: "Proje detayı / görev listesi"},
    {id: "SCR4", name: "Görev panosu (todo/in-progress/done)"},
    {id: "SCR5", name: "Görev detayı / düzenleme"}
  ],
  flows: [
    {
      id: "FL1",
      name: "Oturum açma",
      steps: [
        "Kullanıcı Login ekranını açar.",
        "E-posta ve parolasını girer.",
        "Geçerli kimlikte workspace proje listesine (SCR2) yönlendirilir."
      ]
    },
    {
      id: "FL2",
      name: "Görev oluşturma ve atama",
      steps: [
        "Kullanıcı proje detayından (SCR3) yeni görev oluşturur.",
        "Başlık, öncelik ve (opsiyonel) son tarih girer.",
        "Görevi aynı workspace'teki bir ekip üyesine atar ve kaydeder."
      ]
    },
    {
      id: "FL3",
      name: "Panoda durum değiştirme",
      steps: [
        "Kullanıcı görev panosunu (SCR4) açar.",
        "Bir görevi bir durum sütunundan diğerine taşır.",
        "Yeni durum kalıcılaşır ve sütun ilerleme sayıları güncellenir."
      ]
    }
  ],
  components: [
    {id: "UC1", name: "TaskCard (başlık, atanan, öncelik, son tarih rozetleri)"},
    {id: "UC2", name: "StatusColumn (bir durum sütunu + görev sayısı)"},
    {id: "UC3", name: "PriorityBadge"},
    {id: "UC4", name: "DueDateChip"},
    {id: "UC5", name: "AssigneePicker (yalnız aynı workspace üyeleri)"}
  ],
  a11yNotes: [
    "Pano sütunları ve kartları klavye ile gezilebilir ve görev taşıma klavyeyle de yapılabilir olmalı.",
    "Görev durumu değiştiğinde ekran okuyuculara aria-live bölge ile bildirim yapılmalı.",
    "Öncelik ve durum yalnız renkle değil, metin/etiketle de ayırt edilebilir olmalı (renk körlüğü).",
    "OPEN QUESTION: Hedeflenen WCAG uyum düzeyi özette bağlanmadı; AA varsayıldı, nihai hedef ürün/erişilebilirlik gözden geçirmesine açık soru.",
    "ASSUMPTION: Yerelleştirme ilk sürümde tek dil (İngilizce) olduğundan çift-yönlü (RTL) metin kapsam dışı; gelecekte açık soru."
  ]
};
