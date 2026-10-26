// //TR: Bu dosya pre-dev çıktı iskeletlerinin yer tutucu işaretini ve PAYLAŞILAN korumasını tanımlar (C-FLOW-ANALYSIS-2, #237 incelemesi). Koruma validateArtifactContent'in içinde çalışır; böylece driver, store yazma kapısı (apply.ts), CrewCoordinator.reproduceSuperseding ve yetkinlik değerlendirmesi (golden-predev) AYNI kuralı alır. Saf fonksiyonlardır: dosya sistemi, ağ, süreç yok.
export const PLACEHOLDER_MARKER = "<<FILL";

// //TR: İşaret karşılaştırması NORMALLEŞTİRİLMİŞ metinde yapılır: NFKC (tam genişlikli ＜＜ＦＩＬＬ -> <<FILL) ve biçim karakterlerinin (\p{Cf}: sıfır genişlikli boşluk/birleştirici, yumuşak tire, çift yönlü işaretler, BOM) atılması; sonra büyük/küçük harf duyarsız, `<` işaretleri ve FILL arasında boşluk (satır sonu dahil) serbest. İskeletin biçimi `<<FILL: ipucu>>` olduğundan eşleşme İŞARETİN KENDİSİDİR: FILL'den sonra boşluk bırakılarak `:` ya da `>` gelmelidir (`<<FILL: x>>`, `<<FILL>>`, `<< fill : x>>`). Bu, dürüst metni (`<<Fill-in form>>`, `std::cout << fill('0')`, `<<fillable>>`) reddetmez; bağımsız inceleme (#237) daha geniş `<<\s*fill\b` desenini, geçmiş journal'larda bu metinleri içeren bir artefaktın yeniden oynatmada mağazayı mühürlemesi nedeniyle gerçek bir sorun olarak buldu.
const MARKER_RE = /<\s*<\s*fill\s*[:>]/i;
const normalise = (s: string): string => s.normalize("NFKC").replace(/\p{Cf}/gu, "");
export const containsPlaceholderMarker = (s: string): boolean => MARKER_RE.test(normalise(s));

// //TR: Geçerli bir artefakt en çok ~5 düzey iç içedir (nesne > dizi > nesne > dizi > metin). Bu sınırı aşan yanıt (JSON.parse yinelemelidir ve çok derin bir yapıyı sorunsuz ayrıştırır) tipli bir retle (CONTENT_TOO_DEEP) reddedilir; koruma YİNELEMELİDİR (açık yığın), bu yüzden hiçbir girdi RangeError üretemez.
export const MAX_CONTENT_DEPTH = 32;

export type PlaceholderProblem = "PLACEHOLDER_VALUE" | "CONTENT_TOO_DEEP";

// //TR: İçerikteki HER metin değeri ve HER anahtar (her derinlikte) taranır. İlk bulunan sorun döner; sorun yoksa null.
export function placeholderProblem(content: unknown): PlaceholderProblem | null {
  const stack: Array<[unknown, number]> = [[content, 0]];
  while (stack.length > 0) {
    const [x, depth] = stack.pop()!;
    if (typeof x === "string") { if (containsPlaceholderMarker(x)) return "PLACEHOLDER_VALUE"; continue; }
    if (typeof x !== "object" || x === null) continue;
    if (depth >= MAX_CONTENT_DEPTH) return "CONTENT_TOO_DEEP";
    if (Array.isArray(x)) { for (const v of x) stack.push([v, depth + 1]); continue; }
    for (const [k, v] of Object.entries(x)) {
      if (containsPlaceholderMarker(k)) return "PLACEHOLDER_VALUE";
      stack.push([v, depth + 1]);
    }
  }
  return null;
}

export const hasPlaceholder = (content: unknown): boolean => placeholderProblem(content) === "PLACEHOLDER_VALUE";
