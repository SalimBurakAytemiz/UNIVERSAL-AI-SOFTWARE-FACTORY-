// //TR: Bu dosya TaskHub için Requirements / Software Analyst (CLAUDE_BUILDER) rolünün GERÇEK çıktısını SALT VERİ fixture olarak sağlar. Her gereksinim YALNIZ onaylı Business Analysis (business-analysis.ts) içindeki GERÇEK goal id'lerine (G1..G5) tracesTo ile iz düşer; var olmayan hedefe iz düşülmez. Bilgi eksikse ilgili acceptanceCriteria[] içine açık ASSUMPTION/OPEN QUESTION maddesi yazılır (uydurma yok). id'ler alt Plan tarafından satisfies ile referans alınır. Sır/ağ adresi yok, yan etki yok.
import type {RequirementsContent} from "../../types.js";

export const TASKHUB_REQUIREMENTS: RequirementsContent = {
  functional: [
    {
      id: "FR1",
      statement: "Sistem, kayıtlı bir kullanıcının e-posta ve parola ile oturum açmasına izin vermeli.",
      acceptanceCriteria: [
        "Geçerli e-posta/parola ile oturum açıldığında kullanıcı kimliği doğrulanır ve bir oturum başlar.",
        "Geçersiz kimlik bilgisi reddedilir ve hangi alanın hatalı olduğu sızdırılmaz."
      ],
      tracesTo: ["G1"]
    },
    {
      id: "FR2",
      statement: "Sistem, oturum açmış kullanıcının oturumu kapatmasına ve oturumun sonlanmasına izin vermeli.",
      acceptanceCriteria: [
        "Oturum kapatıldıktan sonra korumalı kaynaklara erişim yeniden kimlik doğrulaması gerektirir."
      ],
      tracesTo: ["G1"]
    },
    {
      id: "FR3",
      statement: "Oturum açmış kullanıcı bir workspace içinde proje oluşturabilmeli.",
      acceptanceCriteria: [
        "Bir isimle oluşturulan proje kalıcıdır ve yalnız ait olduğu workspace'te listelenir."
      ],
      tracesTo: ["G2"]
    },
    {
      id: "FR4",
      statement: "Kullanıcı bir proje içinde görev oluşturabilmeli.",
      acceptanceCriteria: [
        "Oluşturulan görev bir başlık taşır, ait olduğu projeye bağlanır ve kalıcıdır."
      ],
      tracesTo: ["G2"]
    },
    {
      id: "FR5",
      statement: "Kullanıcı bir görevi aynı workspace'teki bir ekip üyesine atayabilmeli.",
      acceptanceCriteria: [
        "Bir görev tek bir atanana sahip olabilir ve atama değiştirilebilir.",
        "ASSUMPTION: Özet tek-atanan mı çok-atanan mı olduğunu belirtmiyor; ilk sürümde tek atanan varsayıldı, çok-atanan sonraki sürüme açık soru."
      ],
      tracesTo: ["G2"]
    },
    {
      id: "FR6",
      statement: "Kullanıcı bir görevin durumunu todo / in-progress / done arasında değiştirebilmeli.",
      acceptanceCriteria: [
        "Durum yalnız bu üç değerden biri olabilir ve değişiklik kalıcıdır."
      ],
      tracesTo: ["G3"]
    },
    {
      id: "FR7",
      statement: "Kullanıcı bir göreve öncelik atayabilmeli.",
      acceptanceCriteria: [
        "Görev bir öncelik taşır ve öncelik güncellenebilir.",
        "ASSUMPTION: Özet öncelik ölçeğini vermiyor; low/medium/high varsayıldı, nihai ölçek açık soru."
      ],
      tracesTo: ["G3"]
    },
    {
      id: "FR8",
      statement: "Kullanıcı bir göreve son tarih atayabilmeli.",
      acceptanceCriteria: [
        "Görev bir son tarih taşıyabilir (opsiyonel) ve güncellenebilir."
      ],
      tracesTo: ["G3"]
    },
    {
      id: "FR9",
      statement: "Görevlerde yapılan değişiklikler kalıcı olmalı ve tekrar yüklemede korunmalı.",
      acceptanceCriteria: [
        "Bir görevin durumu/önceliği/son tarihi güncellendikten sonra yeniden okunduğunda son değerler döner."
      ],
      tracesTo: ["G3"]
    },
    {
      id: "FR10",
      statement: "Pano, bir projenin görevlerini duruma göre (todo/in-progress/done) gruplanmış sütunlarda göstermeli.",
      acceptanceCriteria: [
        "Her görev durumuna karşılık gelen tek bir sütunda görünür."
      ],
      tracesTo: ["G4"]
    },
    {
      id: "FR11",
      statement: "Pano, projedeki ilerlemeyi (ör. her durumdaki görev sayısı) göstermeli.",
      acceptanceCriteria: [
        "Her durum sütunu, içindeki görev sayısını yansıtan bir ilerleme göstergesi sunar."
      ],
      tracesTo: ["G4"]
    }
  ],
  nonFunctional: [
    {
      id: "NFR1",
      statement: "Parolalar düz metin saklanmamalı; yalnız tek yönlü güçlü bir özet (hash) olarak tutulmalı.",
      acceptanceCriteria: [
        "Kalıcı depoda hiçbir kayıtta düz metin parola bulunmaz."
      ],
      tracesTo: ["G1"]
    },
    {
      id: "NFR2",
      statement: "Her workspace'in verisi tenant-izole olmalı; sorgular yalnız istek sahibinin workspace'iyle sınırlanmalı.",
      acceptanceCriteria: [
        "Bir workspace'in projeleri/görevleri yalnız o workspace üyelerine döner."
      ],
      tracesTo: ["G5"]
    },
    {
      id: "NFR3",
      statement: "Yetkilendirme, bir kullanıcının üyesi olmadığı workspace'in kaynaklarına erişimini engellemeli.",
      acceptanceCriteria: [
        "Başka bir workspace'in proje/görev kimliğine doğrudan erişim denemesi yetkisiz olarak reddedilir."
      ],
      tracesTo: ["G5"]
    },
    {
      id: "NFR4",
      statement: "Web arayüzü responsive olmalı; modern masaüstü ve mobil tarayıcılarda kullanılabilmeli.",
      acceptanceCriteria: [
        "Proje/görev yönetimi ve pano görünümü hem masaüstü hem dar mobil genişlikte kullanılabilir.",
        "OPEN QUESTION: Desteklenecek asgari tarayıcı sürümleri özette bağlanmadı; mimari/UX fazında netleştirilecek."
      ],
      tracesTo: ["G2", "G3", "G4"]
    }
  ]
};
