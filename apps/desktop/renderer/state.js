// //TR: Bu modül renderer'ın tek durum sahibidir: seçili proje, görünüm önbelleği ve epoch; proje değişince önbellek geçersiz kılınır ve epoch artar (DSK-061-06), böylece eski epoch'a ait gecikmiş yanıtlar atılır.
export const PROJECT_STORAGE_KEY="uasco.projectId";
const PROJECT_ID=/^prj_[0-9a-f]{24}$/;
export function createStore(storage){
  let projectId=null,epoch=0,lastRefreshAt=null;const cache=new Map(),listeners=new Set(),samples=new Map();
  try{const v=storage?.getItem(PROJECT_STORAGE_KEY);if(typeof v==="string"&&PROJECT_ID.test(v))projectId=v}catch{/* depolama yok */}
  const notify=()=>{for(const fn of listeners)fn()};
  return {
    get projectId(){return projectId},get epoch(){return epoch},get lastRefreshAt(){return lastRefreshAt},cache,samples,
    selectProject(id){
      const next=typeof id==="string"&&PROJECT_ID.test(id)?id:null;if(next===projectId)return false;
      projectId=next;epoch+=1;cache.clear();
      try{if(next)storage?.setItem(PROJECT_STORAGE_KEY,next);else storage?.removeItem(PROJECT_STORAGE_KEY)}catch{/* sessiz */}
      notify();return true;
    },
    invalidate(){epoch+=1;cache.clear();notify()},
    markRefreshed(date=new Date()){lastRefreshAt=date.toISOString()},
    onChange(fn){listeners.add(fn);return ()=>listeners.delete(fn)}
  };
}
