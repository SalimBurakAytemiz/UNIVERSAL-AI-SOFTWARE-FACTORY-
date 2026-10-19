// //TR: Bu modül UI-023 "Görev Kanban Panosu"nun saf (DOM'suz) çekirdeğidir: #/work görünümünün ZATEN okuduğu GET /v1/missions satırlarını yaşam-döngüsü sütunlarına dağıtır; kendi okuması, yeni uç noktası veya yazımı YOKTUR. Mutlu yol sütunları (MISSION_PATH) boş olsa da daima görünür (dürüst 0), yol dışı bilinen durumlar yalnız mission varsa eklenir, tanınmayan durumlar ATILMAZ: ham değeriyle ayrı "tanınmayan durum" sütununda gösterilir. Durum geçişi panodan yapılmaz; kart, mevcut onaylı geçiş denetimlerinin bulunduğu mission ayrıntısını açar. Görünüm düzeni (liste/pano) yalnız bellek-içi oturum durumudur (depo yok).
import {MISSION_STATUSES,MISSION_PATH} from "./work-core.js";

export const BOARD_LAYOUTS=Object.freeze(["list","board"]);
export const UNRECOGNIZED_COLUMN="UNRECOGNIZED";
export const MAX_CARDS_PER_COLUMN=50;
/** Yol dışı bilinen durumlar (MISSION_STATUSES sırasıyla): ENGELLİ, DÜZELTME, FOUNDER DİKKATİ vb. */
export const OFF_PATH_STATUSES=Object.freeze(MISSION_STATUSES.filter(s=>!MISSION_PATH.includes(s)));

const state={layout:"list"};
/** Geçerli düzen; varsayılan "list" (mevcut filtre + tablo akışı bozulmaz). */
export const boardLayout=()=>state.layout;
/** Yalnız bilinen düzen kabul edilir; başarı true. */
export function setBoardLayout(x){if(!BOARD_LAYOUTS.includes(x))return false;state.layout=x;return true}
export function resetBoard(){state.layout="list"}

const isKnown=s=>typeof s==="string"&&MISSION_STATUSES.includes(s);
/**
 * Mission'ları sütunlara dağıtır -> [{status, known, count, items, truncated}].
 * Sıra: MISSION_PATH (daima), sonra mission bulunan yol-dışı bilinen durumlar, en son (varsa) UNRECOGNIZED.
 * Her mission tam olarak bir sütunda yer alır; sütun içi sıra API sırasıdır (yeniden sıralama/uydurma yok).
 */
export function boardColumns(missions){
  const list=Array.isArray(missions)?missions.filter(m=>m&&typeof m==="object"):[];
  const by=new Map();
  for(const m of list){const k=isKnown(m.status)?m.status:UNRECOGNIZED_COLUMN;if(!by.has(k))by.set(k,[]);by.get(k).push(m)}
  const col=(status,known)=>{const all=by.get(status)??[];return {status,known,count:all.length,items:all.slice(0,MAX_CARDS_PER_COLUMN),truncated:all.length>MAX_CARDS_PER_COLUMN}};
  return [...MISSION_PATH.map(s=>col(s,true)),...OFF_PATH_STATUSES.filter(s=>by.has(s)).map(s=>col(s,true)),...(by.has(UNRECOGNIZED_COLUMN)?[col(UNRECOGNIZED_COLUMN,false)]:[])];
}
