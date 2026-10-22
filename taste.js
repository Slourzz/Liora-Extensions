const fs = require("fs"); const path = require("path"); const https = require("https"); const vm = require("vm");
const KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
function post(hostname, p, body, headers) {
  return new Promise((res, rej) => {
    const r = https.request({ hostname, path: p, method: "POST", headers: Object.assign({"Content-Type":"application/json"}, headers) },
      (x) => { let d=""; x.on("data",c=>d+=c); x.on("end",()=>res(d)); });
    r.on("error", rej); r.write(body); r.end();
  });
}
(async () => {
  const raw = await post("music.youtube.com", "/youtubei/v1/search?key="+KEY,
    JSON.stringify({context:{client:{clientName:"WEB_REMIX",clientVersion:"1.20250310.01.00",hl:"en",gl:"US"}},query:"taste sabrina"}),
    {"X-YouTube-Client-Name":"67","X-YouTube-Client-Version":"1.20250310.01.00","User-Agent":"Mozilla/5.0"});
  const host = { http: (m,u,b,h,s) => ({ ok:true, statusCode:200, body: raw }),
    storage:{get:()=>null,set:()=>({ok:true})}, session:{has:()=>false},
    log:{info:()=>{},warn:()=>{},error:()=>{}} };
  const src = fs.readFileSync("D:/Descargas/Liora-Extensions/extensions/ytmusic/src/index.js","utf8");
  const reg = {}; const sb = { host, registerExtension:(f)=>{for(const k in f) reg[k]=f[k];},
    JSON,Math,Date,String,Number,encodeURIComponent,console }; sb.global = sb;
  vm.createContext(sb); vm.runInContext(src, sb);
  reg.initialize({ settings:{} });
  const res = reg.searchTracks({ query: "taste sabrina", limit: 6 });
  for (const t of res.tracks) console.log("id=[" + t.id + "] len=" + t.id.length + " | " + t.title + " | " + t.artist);
})();
