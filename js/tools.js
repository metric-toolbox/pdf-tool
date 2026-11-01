/* FreePDFHub — all tools run 100% client-side. Files never leave the device. */
(function(){
"use strict";

var TOOL = document.body.getAttribute("data-tool");
if(!TOOL) return;

if(window.pdfjsLib){
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

var files = [];
var dz = document.getElementById("dropzone");
var input = document.getElementById("fileInput");
var listEl = document.getElementById("fileList");
var runBtn = document.getElementById("runBtn");
var statusEl = document.getElementById("status");
var resultBox = document.getElementById("resultBox");

var MULTI = (TOOL === "merge" || TOOL === "jpg-to-pdf");

function fmtSize(b){
  if(b < 1024) return b + " B";
  if(b < 1048576) return (b/1024).toFixed(1) + " KB";
  return (b/1048576).toFixed(2) + " MB";
}
function setStatus(msg, cls){
  statusEl.textContent = msg || "";
  statusEl.className = "status " + (cls || "");
}
function renderList(){
  listEl.innerHTML = "";
  files.forEach(function(f, i){
    var row = document.createElement("div");
    row.className = "file-item";
    row.innerHTML = '<span>📄</span><span class="fname"></span><span class="fsize">' +
      fmtSize(f.size) + '</span><button type="button" aria-label="Remove">✕</button>';
    row.querySelector(".fname").textContent = f.name;
    row.querySelector("button").onclick = function(){ files.splice(i,1); renderList(); };
    listEl.appendChild(row);
  });
  runBtn.disabled = files.length === 0;
}
function addFiles(fl){
  var arr = Array.prototype.slice.call(fl);
  if(!MULTI){ files = arr.slice(0,1); } else { files = files.concat(arr); }
  resultBox.classList.remove("show");
  setStatus("");
  renderList();
}

dz.addEventListener("click", function(){ input.click(); });
input.addEventListener("change", function(){ addFiles(input.files); input.value=""; });
["dragover","dragenter"].forEach(function(ev){
  dz.addEventListener(ev, function(e){ e.preventDefault(); dz.classList.add("drag"); });
});
["dragleave","drop"].forEach(function(ev){
  dz.addEventListener(ev, function(e){ e.preventDefault(); dz.classList.remove("drag"); });
});
dz.addEventListener("drop", function(e){ addFiles(e.dataTransfer.files); });

function download(bytes, name, mime){
  var blob = bytes instanceof Blob ? bytes : new Blob([bytes], {type: mime || "application/pdf"});
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  return blob.size;
}
function showResult(html){
  resultBox.innerHTML = html;
  resultBox.classList.add("show");
}
function readAsArrayBuffer(file){
  return new Promise(function(res, rej){
    var r = new FileReader();
    r.onload = function(){ res(r.result); };
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}
function readAsDataURL(file){
  return new Promise(function(res, rej){
    var r = new FileReader();
    r.onload = function(){ res(r.result); };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function parseRanges(str, max){
  var out = [];
  str.split(",").forEach(function(part){
    part = part.trim();
    if(!part) return;
    var m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if(m){
      var a = +m[1], b = +m[2];
      for(var i = Math.min(a,b); i <= Math.max(a,b); i++)
        if(i >= 1 && i <= max && out.indexOf(i-1) < 0) out.push(i-1);
    } else if(/^\d+$/.test(part)){
      var n = +part;
      if(n >= 1 && n <= max && out.indexOf(n-1) < 0) out.push(n-1);
    }
  });
  return out;
}

/* ---------- tool implementations ---------- */

async function doMerge(){
  var merged = await PDFLib.PDFDocument.create();
  for(var i = 0; i < files.length; i++){
    setStatus("Merging file " + (i+1) + " of " + files.length + "…", "busy");
    var buf = await readAsArrayBuffer(files[i]);
    var src = await PDFLib.PDFDocument.load(buf, {ignoreEncryption:true});
    var pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach(function(p){ merged.addPage(p); });
  }
  var out = await merged.save();
  var size = download(out, "merged.pdf");
  showResult("✅ <strong>Done!</strong> " + files.length + " PDFs merged into one (" + fmtSize(size) + "). Your download has started.");
}

async function doSplit(){
  var buf = await readAsArrayBuffer(files[0]);
  var src = await PDFLib.PDFDocument.load(buf, {ignoreEncryption:true});
  var total = src.getPageCount();
  var rangeStr = document.getElementById("pageRange").value.trim() || ("1-" + total);
  var idx = parseRanges(rangeStr, total);
  if(!idx.length) throw new Error("Invalid page range. This PDF has " + total + " pages. Example: 1-3,5");
  var mode = document.getElementById("splitMode").value;
  if(mode === "single"){
    for(var i = 0; i < idx.length; i++){
      setStatus("Extracting page " + (i+1) + " of " + idx.length + "…", "busy");
      var doc = await PDFLib.PDFDocument.create();
      var p = await doc.copyPages(src, [idx[i]]);
      doc.addPage(p[0]);
      download(await doc.save(), "page-" + (idx[i]+1) + ".pdf");
      await new Promise(function(r){ setTimeout(r, 350); });
    }
    showResult("✅ <strong>Done!</strong> " + idx.length + " pages extracted as separate PDFs.");
  } else {
    var doc2 = await PDFLib.PDFDocument.create();
    var ps = await doc2.copyPages(src, idx);
    ps.forEach(function(p){ doc2.addPage(p); });
    var size = download(await doc2.save(), "split.pdf");
    showResult("✅ <strong>Done!</strong> Extracted " + idx.length + " of " + total + " pages (" + fmtSize(size) + ").");
  }
}

async function doCompress(){
  var q = parseFloat(document.getElementById("quality").value);
  var scale = q >= 0.8 ? 1.6 : (q >= 0.6 ? 1.3 : 1.0);
  var buf = await readAsArrayBuffer(files[0]);
  var pdf = await pdfjsLib.getDocument({data: buf}).promise;
  var jspdf = null;
  for(var i = 1; i <= pdf.numPages; i++){
    setStatus("Compressing page " + i + " of " + pdf.numPages + "…", "busy");
    var page = await pdf.getPage(i);
    var vp = page.getViewport({scale: scale});
    var canvas = document.createElement("canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({canvasContext: canvas.getContext("2d"), viewport: vp}).promise;
    var img = canvas.toDataURL("image/jpeg", q);
    var wPt = vp.width / scale, hPt = vp.height / scale;
    var orient = wPt > hPt ? "l" : "p";
    if(!jspdf){
      jspdf = new window.jspdf.jsPDF({orientation: orient, unit: "pt", format: [wPt, hPt]});
    } else {
      jspdf.addPage([wPt, hPt], orient);
    }
    jspdf.addImage(img, "JPEG", 0, 0, wPt, hPt);
  }
  var blob = jspdf.output("blob");
  var size = download(blob, "compressed.pdf");
  var orig = files[0].size;
  var saved = Math.max(0, Math.round((1 - size/orig) * 100));
  showResult("✅ <strong>Done!</strong> " + fmtSize(orig) + " → <strong>" + fmtSize(size) + "</strong>" +
    (size < orig ? " (" + saved + "% smaller)" : " — this PDF was already very small") + ". Download started.");
}

async function doJpgToPdf(){
  var doc = await PDFLib.PDFDocument.create();
  for(var i = 0; i < files.length; i++){
    setStatus("Adding image " + (i+1) + " of " + files.length + "…", "busy");
    var f = files[i];
    var bytes = await readAsArrayBuffer(f);
    var img;
    if(/png$/i.test(f.type) || /\.png$/i.test(f.name)) img = await doc.embedPng(bytes);
    else img = await doc.embedJpg(bytes);
    var page = doc.addPage([img.width, img.height]);
    page.drawImage(img, {x:0, y:0, width: img.width, height: img.height});
  }
  var size = download(await doc.save(), "images.pdf");
  showResult("✅ <strong>Done!</strong> " + files.length + " image(s) converted to one PDF (" + fmtSize(size) + ").");
}

async function doPdfToJpg(){
  var buf = await readAsArrayBuffer(files[0]);
  var pdf = await pdfjsLib.getDocument({data: buf}).promise;
  for(var i = 1; i <= pdf.numPages; i++){
    setStatus("Converting page " + i + " of " + pdf.numPages + "…", "busy");
    var page = await pdf.getPage(i);
    var vp = page.getViewport({scale: 2});
    var canvas = document.createElement("canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({canvasContext: canvas.getContext("2d"), viewport: vp}).promise;
    var blob = await new Promise(function(res){ canvas.toBlob(res, "image/jpeg", 0.92); });
    download(blob, "page-" + i + ".jpg", "image/jpeg");
    await new Promise(function(r){ setTimeout(r, 350); });
  }
  showResult("✅ <strong>Done!</strong> " + pdf.numPages + " page(s) downloaded as high-quality JPG images.");
}

async function doRotate(){
  var angle = parseInt(document.getElementById("angle").value, 10);
  var buf = await readAsArrayBuffer(files[0]);
  var doc = await PDFLib.PDFDocument.load(buf, {ignoreEncryption:true});
  doc.getPages().forEach(function(p){
    var cur = p.getRotation().angle || 0;
    p.setRotation(PDFLib.degrees(((cur + angle) % 360 + 360) % 360));
  });
  var size = download(await doc.save(), "rotated.pdf");
  showResult("✅ <strong>Done!</strong> All pages rotated by " + angle + "° (" + fmtSize(size) + ").");
}

async function doPdfToWord(){
  var buf = await readAsArrayBuffer(files[0]);
  var pdf = await pdfjsLib.getDocument({data: buf}).promise;
  var html = "";
  for(var i = 1; i <= pdf.numPages; i++){
    setStatus("Extracting text from page " + i + " of " + pdf.numPages + "…", "busy");
    var page = await pdf.getPage(i);
    var tc = await page.getTextContent();
    var lines = [], lastY = null, line = [];
    tc.items.forEach(function(it){
      var y = Math.round(it.transform[5]);
      if(lastY !== null && Math.abs(y - lastY) > 4){ lines.push(line.join(" ")); line = []; }
      line.push(it.str); lastY = y;
    });
    if(line.length) lines.push(line.join(" "));
    html += lines.map(function(l){
      return "<p>" + l.replace(/&/g,"&amp;").replace(/</g,"&lt;") + "</p>";
    }).join("") + (i < pdf.numPages ? '<br style="page-break-before:always">' : "");
  }
  if(!html.replace(/<[^>]+>/g,"").trim()){
    throw new Error("No selectable text found — this PDF looks scanned (image-based). Try PDF to JPG instead.");
  }
  var docHtml = '<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">' +
    "<style>body{font-family:Calibri,Arial;font-size:11pt;line-height:1.5}</style></head><body>" + html + "</body></html>";
  var size = download(new Blob(["\ufeff", docHtml], {type: "application/msword"}), "converted.doc", "application/msword");
  showResult("✅ <strong>Done!</strong> Text extracted to an editable Word file (" + fmtSize(size) + "). Opens in MS Word, Google Docs & LibreOffice.");
}

var runners = {
  "merge": doMerge, "split": doSplit, "compress": doCompress,
  "jpg-to-pdf": doJpgToPdf, "pdf-to-jpg": doPdfToJpg,
  "rotate": doRotate, "pdf-to-word": doPdfToWord
};

runBtn.addEventListener("click", async function(){
  if(!files.length) return;
  runBtn.disabled = true;
  resultBox.classList.remove("show");
  try{
    setStatus("Working… your files never leave this device.", "busy");
    await runners[TOOL]();
    setStatus("Finished ✓", "ok");
  }catch(e){
    console.error(e);
    setStatus("⚠ " + (e && e.message ? e.message : "Something went wrong. Please check your file and try again."), "err");
  }
  runBtn.disabled = false;
});
})();
