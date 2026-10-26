// //TR: Bu dosya pre-dev çıktı iskeletlerinin yer tutucu işaretini ve PAYLAŞILAN korumasını tanımlar (C-FLOW-ANALYSIS-2, #237 incelemesi). Koruma validateArtifactContent'in içinde çalışır; böylece driver, store yazma kapısı (apply.ts), CrewCoordinator.reproduceSuperseding ve yetkinlik değerlendirmesi (golden-predev) AYNI kuralı alır. Saf fonksiyonlardır: dosya sistemi, ağ, süreç yok.
export const PLACEHOLDER_MARKER = "<<FILL";

// //TR: İşaret karşılaştırması NORMALLEŞTİRİLMİŞ metinde yapılır: NFKC (tam genişlikli ＜＜ＦＩＬＬ -> <<FILL) ve YALNIZ GÖRÜNMEZ karakterlerin atılması: biçim karakterleri (\p{Cf}: sıfır genişlikli boşluk/birleştirici, yumuşak tire, çift yönlü işaretler, BOM) ve varsayılan olarak yok sayılan kod noktaları (\p{Default_Ignorable_Code_Point}: varyasyon seçicileri, birleştirici grafem birleştiricisi U+034F, Hangul dolguları, Moğol varyasyon seçicileri); sonra büyük/küçük harf duyarsız, `<` işaretleri ve FILL arasında boşluk (satır sonu dahil) serbest. İskeletin biçimi `<<FILL: ipucu>>` olduğundan eşleşme İŞARETİN KENDİSİDİR: FILL'den sonra boşluk bırakılarak `:` ya da `>` gelmelidir (`<<FILL: x>>`, `<<FILL>>`, `<< fill : x>>`). GÖRÜNÜR işaretler (aksan, üst/alt çizgi bindirmesi, Mc/Me işaretleri) ATILMAZ: aksanlı dürüst metin (`<<Fíll>>` İzlandaca, `<< fíll: >>`) önceki NFKC korumasının kabul ettiği gibi KABUL edilir; doğrulayıcı yeniden oynatmada da çalıştığından daha sıkı bir kural, önceki yapının kabul ettiği bir artefaktı yeniden oynatmada reddedip mağazayı mühürleyebilirdi (#257 incelemesi). Bu, dürüst metni (`<<Fill-in form>>`, `std::cout << fill('0')`, `<<fillable>>`) de reddetmez. YAKALANMAYAN (belgelenmiş sınır): görünür işaretli harfler (F + birleştirici akut, İ), betikler arası benzer görünen harfler (Kiril І, Yunan Ι); bu koruma tembel bir iskelet yankısına karşıdır, kasıtlı gizlemeye karşı değildir.
const MARKER_RE = /<\s*<\s*fill\s*[:>]/i;
const normalise = (s: string): string => s.normalize("NFKC").replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "");
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
