"use strict";

const { PDFDocument } = PDFLib;

const A4_W = 595.28, A4_H = 841.89;   // pt（1pt = 1/72inch）
const MARGIN = 24, GUTTER = 16;       // pt
const CELL_W = (A4_W - 2 * MARGIN - GUTTER) / 2;
const CELL_H = (A4_H - 2 * MARGIN - GUTTER) / 2;

// ---- 状態 ----
let files = [];          // 選択順のまま保持する File 配列（並べ替えは行わない）
let objectUrls = [];     // files と対になるプレビュー用 objectURL（差し替え時に revoke する）
let outputBlob = null;
let building = false;

// Web Share（ファイル共有）に対応しているブラウザかどうかは、ページ読み込み時に一度だけ判定して
// ボタンの見た目を固定する。実際に使えるかの最終判定は共有ボタン押下時に navigator.canShare() で行う
// （API はあってもファイル種別によっては使えないことがあるため、その場合はダウンロードへ自動で切り替える）。
const shareApiPresent = typeof navigator.share === "function" && typeof navigator.canShare === "function";

// ---- 要素 ----
const $ = (id) => document.getElementById(id);
const fileInput = $("file");
const countEl = $("count");
const pageInfoEl = $("pageInfo");
const buildBtn = $("build");
const shareBtn = $("share");
const shareHintEl = $("shareHint");
const statusEl = $("status");
const pagesEl = $("pages");

const setStatus = (m) => { statusEl.textContent = m || ""; };

shareBtn.textContent = shareApiPresent ? "📤 PDFを共有" : "⬇ PDFをダウンロード";
shareHintEl.textContent = shareApiPresent
  ? "対応アプリ（メール等）の共有シートが開きます"
  : "このブラウザは共有に対応していないため、ダウンロードします";

// ---- ファイル選択 ----
fileInput.onchange = (e) => setFiles(Array.from(e.target.files || []));

function setFiles(list) {
  if (building) return;   // 同上：作成中の再選択は無視（inputはbuild中disabledにしているので通常は来ない）
  for (const url of objectUrls) URL.revokeObjectURL(url);
  files = list.filter((f) => f.type.startsWith("image/"));
  objectUrls = files.map((f) => URL.createObjectURL(f));
  outputBlob = null;
  shareBtn.disabled = true;
  renderPreview();
}

function removeAt(i) {
  if (building) return;   // PDF作成中に配列を横から書き換えると生成ループが壊れるため無視
  URL.revokeObjectURL(objectUrls[i]);
  files.splice(i, 1);
  objectUrls.splice(i, 1);
  outputBlob = null;
  shareBtn.disabled = true;
  renderPreview();
}

// ---- プレビュー（実際のPDFと同じ 2×2 割り付けをブラウザ上で再現） ----
function renderPreview() {
  pagesEl.innerHTML = "";
  const n = files.length;
  buildBtn.disabled = n === 0;

  countEl.textContent = n ? `${n}枚選択中` : "未選択";
  countEl.className = "badge" + (n ? " ok" : "");
  const numPages = Math.ceil(n / 4);
  pageInfoEl.textContent = n ? `${n}枚 → ${numPages}ページ` : "";

  if (n === 0) {
    setStatus("左の「🖼 スクショを選ぶ」で画像を選ぶと、A4ページの割り付けがここに表示されます。");
    return;
  }
  setStatus(`${n}枚のスクショを ${numPages}ページのA4に割り付けます（1ページ4枚）。内容を確認してから「PDFを作成」を押してください。`);

  for (let p = 0; p < numPages; p++) {
    const wrap = document.createElement("div");
    wrap.className = "page";
    const head = document.createElement("div");
    head.className = "phead";
    head.textContent = `p.${p + 1}`;
    const a4 = document.createElement("div");
    a4.className = "a4";
    for (let c = 0; c < 4; c++) {
      const i = p * 4 + c;
      const cell = document.createElement("div");
      cell.className = "cell";
      if (i < n) {
        const img = document.createElement("img");
        img.src = objectUrls[i];
        const idx = document.createElement("span");
        idx.className = "idx";
        idx.textContent = String(i + 1);
        const rm = document.createElement("button");
        rm.className = "rm";
        rm.title = "この1枚を除外";
        rm.textContent = "✕";
        rm.onclick = () => removeAt(i);
        cell.appendChild(img);
        cell.appendChild(idx);
        cell.appendChild(rm);
      }
      a4.appendChild(cell);
    }
    wrap.appendChild(head);
    wrap.appendChild(a4);
    pagesEl.appendChild(wrap);
  }
}

// ---- PDF作成 ----
buildBtn.onclick = async () => {
  if (building || files.length === 0) return;
  building = true;
  buildBtn.disabled = true;
  shareBtn.disabled = true;
  fileInput.disabled = true;
  pagesEl.classList.add("building");
  const n = files.length;
  const numPages = Math.ceil(n / 4);
  setStatus(`PDFを作成中…（${n}枚 / ${numPages}ページ）`);
  try {
    const out = await PDFDocument.create();
    for (let p = 0; p < numPages; p++) {
      const page = out.addPage([A4_W, A4_H]);
      for (let c = 0; c < 4; c++) {
        const i = p * 4 + c;
        if (i >= n) break;
        const img = await embedImage(out, files[i]);
        const col = c % 2, row = Math.floor(c / 2);
        const cellX = MARGIN + col * (CELL_W + GUTTER);
        const cellYBottom = A4_H - MARGIN - CELL_H - row * (CELL_H + GUTTER);
        const rect = containRect(img.width, img.height, cellX, cellYBottom, CELL_W, CELL_H);
        page.drawImage(img, rect);
      }
      setStatus(`PDFを作成中… ${p + 1}/${numPages}ページ`);
    }
    out.setTitle("スクショPDF");
    out.setProducer("screenshot-pdf");
    out.setCreator("screenshot-pdf");
    const bytes = await out.save();
    outputBlob = new Blob([bytes], { type: "application/pdf" });
    shareBtn.disabled = false;
    setStatus(`完了：${n}枚を${numPages}ページのA4 PDFにまとめました。「${shareBtn.textContent}」で保存してください。`);
  } catch (err) {
    console.error(err);
    setStatus("PDFの作成に失敗しました。画像の形式を確認するか、枚数を減らしてもう一度お試しください。");
  } finally {
    building = false;
    buildBtn.disabled = files.length === 0;
    fileInput.disabled = false;
    pagesEl.classList.remove("building");
  }
};

// File を pdf-lib に埋め込む。PNG/JPEGはそのまま（無劣化）、それ以外の形式（WebP等）や
// MIME判定に失敗したファイルは canvas 経由で一度 PNG に変換してから埋め込む。
async function embedImage(doc, file) {
  const type = (file.type || "").toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  try {
    if (type === "image/png") return await doc.embedPng(buf);
    if (type === "image/jpeg" || type === "image/jpg") return await doc.embedJpg(buf);
  } catch (err) {
    // 拡張子とヘッダが食い違っている等、そのまま埋め込めなかった場合は下のcanvas変換にフォールバック
  }
  const pngBytes = await toPngBytes(file);
  return await doc.embedPng(pngBytes);
}

async function toPngBytes(file) {
  const bitmap = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  c.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

// セル内に、アスペクト比を保ったまま収まる最大サイズで中央配置する（fit / contain）
function containRect(imgW, imgH, cellX, cellYBottom, cellW, cellH) {
  const scale = Math.min(cellW / imgW, cellH / imgH);
  const w = imgW * scale, h = imgH * scale;
  return { x: cellX + (cellW - w) / 2, y: cellYBottom + (cellH - h) / 2, width: w, height: h };
}

// ---- 共有 / ダウンロード ----
shareBtn.onclick = async () => {
  if (!outputBlob) return;
  const filename = `screenshots-${timestamp()}.pdf`;
  const file = new File([outputBlob], filename, { type: "application/pdf" });

  if (shareApiPresent && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;   // 共有シートをキャンセルした場合は何もしない
      // それ以外の失敗（対応アプリがない等）はダウンロードへフォールバック
    }
  }
  downloadBlob(outputBlob, filename);
};

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
