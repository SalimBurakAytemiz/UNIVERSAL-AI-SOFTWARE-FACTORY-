// //TR: Bu dosya TaskHub için Architect (CLAUDE_BUILDER) rolünün GERÇEK çıktısını SALT VERİ fixture olarak sağlar. Her component'in covers[] alanı YALNIZ onaylı Plan (plan.ts) içindeki GERÇEK scope id'lerine (SC1..SC6) referans verir; Plan kapsamındaki her madde en az bir bileşence kapsanır. techChoices gerekçe + değerlendirilen alternatifler taşır; özette bağlanmayan bilgi (ör. ölçek hedefi) risks[] içine açık ASSUMPTION/OPEN QUESTION olarak yazılır (uydurma yok). Sır/ağ adresi yok, yan etki yok.
import type {ArchitectureContent} from "../../types.js";

export const TASKHUB_ARCHITECTURE: ArchitectureContent = {
  components: [
    {
      id: "CMP1",
      name: "AuthService",
      responsibility: "E-posta+parola ile kimlik doğrulama, oturum oluşturma/sonlandırma ve parola hash doğrulaması.",
      covers: ["SC1"]
    },
    {
      id: "CMP2",
      name: "AuthorizationGuard",
      responsibility: "Her isteği istek sahibinin workspace üyeliğine göre sınırlayan tenant-izolasyon ve yetkilendirme kontrolü.",
      covers: ["SC2"]
    },
    {
      id: "CMP3",
      name: "ProjectTaskApi",
      responsibility: "Proje ve görev CRUD uçları ile görev-ekip üyesi atama işlemleri.",
      covers: ["SC3"]
    },
    {
      id: "CMP4",
      name: "TaskDomainStore",
      responsibility: "Görev durum/öncelik/son tarih alanlarının alan kurallarıyla ilişkisel veritabanında kalıcılaştırılması.",
      covers: ["SC4"]
    },
    {
      id: "CMP5",
      name: "BoardViewService",
      responsibility: "Bir projenin görevlerini duruma göre gruplayıp sütun başına ilerleme sayıları sağlayan okuma modeli.",
      covers: ["SC5"]
    },
    {
      id: "CMP6",
      name: "WebClient",
      responsibility: "Masaüstü ve mobil tarayıcıda çalışan responsive web arayüzü (giriş, proje/görev yönetimi, pano).",
      covers: ["SC6"]
    }
  ],
  techChoices: [
    {
      choice: "İlişkisel veritabanı (PostgreSQL)",
      rationale: "Özet ilişkisel kalıcılık (kullanıcı/workspace/proje/görev) şart koşuyor; yabancı anahtar bütünlüğü workspace izolasyonu ve atama ilişkileri için uygun.",
      alternativesConsidered: ["MySQL/MariaDB", "SQLite (tek-düğüm iç araç için fazla sınırlı)"]
    },
    {
      choice: "HTTP tabanlı backend API katmanı",
      rationale: "Web UI ile ilişkisel veritabanı arasında yetkilendirmeyi tek noktada zorlayan bir API; özetteki UI+API+DB üçlüsüne doğrudan karşılık gelir.",
      alternativesConsidered: ["İstemciden doğrudan DB erişimi (yetkilendirme sınırını zayıflatır, reddedildi)"]
    },
    {
      choice: "Sunucu tarafı parola hash'leme (ör. bcrypt/argon2 ailesi)",
      rationale: "NFR1 düz metin parola yasağını karşılamak için tek yönlü güçlü özet; uyarlanabilir maliyet faktörü kaba-kuvvete direnç sağlar.",
      alternativesConsidered: ["Tuzsuz SHA-256 (yetersiz, reddedildi)"]
    },
    {
      choice: "Responsive tek-sayfa web istemcisi",
      rationale: "NFR4 masaüstü+mobil responsive gereksinimini karşılar; yerel mobil uygulama kapsam dışı olduğundan tek responsive istemci yeterli.",
      alternativesConsidered: ["Ayrı masaüstü ve mobil istemciler (kapsam dışı yerel uygulamalar, reddedildi)"]
    }
  ],
  dataModel:
    "Varlıklar: users(id, email, passwordHash), workspaces(id, name), memberships(userId, workspaceId, role), projects(id, workspaceId, name), tasks(id, projectId, title, status∈{todo,in-progress,done}, priority, dueDate?, assigneeId?). İzolasyon workspaceId üzerinden; atama assigneeId ile aynı workspace üyesine kısıtlı.",
  integrations: [],
  infraNeeds: [
    "Yönetilen ilişkisel veritabanı örneği (PostgreSQL).",
    "Backend API ve statik web istemcisini sunan uygulama barındırma ortamı."
  ],
  risks: [
    "AuthorizationGuard'daki bir boşluk NFR2/NFR3 workspace izolasyonunu bozarak çapraz-kiracı veri sızıntısına yol açabilir.",
    "Parola hash parametreleri zayıf seçilirse NFR1'in sağladığı koruma pratikte yetersiz kalabilir.",
    "OPEN QUESTION: Özet eşzamanlı kullanıcı/ölçek hedefi bağlamadığından veritabanı ve barındırma boyutlandırması bir varsayıma dayanıyor; nicel ölçek hedefi ürün ekibine açık soru olarak kalır.",
    "ASSUMPTION: Dağıtım topolojisi (tek bölge, tek örnek) iç araç varsayımıyla alındı; yüksek erişilebilirlik gereksinimi özette yok ve açık soru olarak taşınır."
  ]
};
