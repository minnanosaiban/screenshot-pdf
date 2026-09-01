"use strict";

const { PDFDocument, StandardFonts, rgb } = PDFLib;

const A4_W = 595.28, A4_H = 841.89;   // pt（1pt = 1/72inch）
const MARGIN = 24, GUTTER = 16;       // pt
const CELL_W = (A4_W - 2 * MARGIN - GUTTER) / 2;
const CELL_H = (A4_H - 2 * MARGIN - GUTTER) / 2;

// ---- 状態 ----
let files = [];          // 選択順のまま保持する File 配列（並べ替えは行わない）
let objectUrls = [];     // files と対になるプレビュー用 objectURL（差し替え時に revoke する）
let outputBlob = null;
let building = false;
let order = "N";         // 1ページ内（4枚）の並び順。"N"＝左上→左下→右上→右下（既定）、"Z"＝左上→右上→左下→右下

// Web Share（ファイル共有）に対応しているブラウザかどうかは、ページ読み込み時に一度だけ判定して
// ボタンの見た目を固定する。実際に使えるかの最終判定は共有ボタン押下時に navigator.canShare() で行う
// （API はあってもファイル種別によっては使えないことがあるため、その場合はダウンロードへ自動で切り替える）。
// なお Web Share は仕様上 HTTPS（またはlocalhost）でないとブラウザに存在すら出現しない。
// 案内文で「ブラウザが対応していない」のか「HTTPだから今だけ使えない」のかを区別するため、
// isSecureContext を分けて見ておく。
const secureContext = window.isSecureContext;
const shareApiPresent = secureContext && typeof navigator.share === "function" && typeof navigator.canShare === "function";

// アイコン（Bootstrap Icons, MIT License, https://github.com/twbs/icons）を必要な分だけ生SVGで埋め込む。
// Webフォント・CDNは使わない（読み込み待ちでのチラつきが起きず、外部通信も発生しない）。
const ICON_SEND =
  '<svg class="icon" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">' +
  '<path d="M15.964.686a.5.5 0 0 0-.65-.65L.767 5.855H.766l-.452.18a.5.5 0 0 0-.082.887l.41.26.001.002 4.995 3.178 3.178 4.995.002.002.26.41a.5.5 0 0 0 .886-.083zm-1.833 1.89L6.637 10.07l-.215-.338a.5.5 0 0 0-.154-.154l-.338-.215 7.494-7.494 1.178-.471z"/></svg>';
const ICON_DOWNLOAD =
  '<svg class="icon" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">' +
  '<path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5"/>' +
  '<path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708z"/></svg>';
const ICON_X =
  '<svg class="icon" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">' +
  '<path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/></svg>';

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
const orderRadios = document.querySelectorAll('input[name="order"]');

const setStatus = (m) => { statusEl.textContent = m || ""; };
// モバイル幅（サイドバーが本文の上に縦積みになるブレークポイント。CSSの@mediaと同じ768px）の判定。
const mobileQuery = window.matchMedia("(max-width: 768px)");
// スクショ選択直後にプレビュー（本文）が画面外にあり「反応がない」ように見えるため、自動で本文へスクロールする。
const scrollToMain = () => {
  if (mobileQuery.matches) statusEl.scrollIntoView({ behavior: "smooth", block: "start" });
};

// 「このアプリについて」「免責事項」は、モバイル幅では情報より先に操作・結果を見せたいので
// プレビュー（本文）の下へ実際に移動し、デスクトップ幅ではサイドバー内の元の位置に戻す。
// 複製はしない（免責事項へのリンク先要素が常に1つだけになるようにするため）。
const secondaryInfo = $("secondary-info");
const sidebarEl = document.querySelector(".sidebar");
const mainEl = document.querySelector("main.main");
const placeSecondaryInfo = () => (mobileQuery.matches ? mainEl : sidebarEl).appendChild(secondaryInfo);
placeSecondaryInfo();
mobileQuery.addEventListener("change", placeSecondaryInfo);

// スマホでの利用が前提のため、主経路はメール・チャットへの直接送信（Web Share）。
// 非対応ブラウザ（主にPCのFirefoxなど）のときだけ「保存」に文言を切り替える。
// ※ shareBtn.textContent は後続コードでもラベル文言の取得に使う（SVGはテキストノードを持たないため、
//    innerHTML に <svg>+<span> を入れても textContent は <span> の文字列だけを正しく返す）。
shareBtn.innerHTML = shareApiPresent
  ? `${ICON_SEND}<span>PDF共有</span>`
  : `${ICON_DOWNLOAD}<span>PDF保存</span>`;
// 「メール・LINE・Xなどで共有できます」は常時表示の固定文言(HTML側)なので、ここでは
// 共有できない場合の注記だけを出す。共有できる場合は固定文言だけで説明が足りるため空にする。
// 表示できない理由がHTTP接続(非セキュアコンテキスト)かブラウザ非対応かはsecureContextで
// 区別できるが、「HTTP/HTTPS」は一般利用者には伝わりにくく不安を煽るだけなので、
// 案内文は理由を問わず1つに統一する（本番はCloudflare Pagesで常時HTTPS配信のため、
// このHTTP接続のケースはローカルでのテスト時以外はまず発生しない）。
shareHintEl.textContent = shareApiPresent
  ? ""
  : "※このブラウザでは直接の送信に対応していないため、PDFを保存します（保存後にメール等へ添付できます）";
shareHintEl.style.display = shareHintEl.textContent ? "" : "none";

// ---- アプリ内ブラウザ（X/Twitter等）向けの案内 ----
// X等のSNSアプリ内蔵ブラウザは、ファイル共有・ダウンロードをホストアプリ側でブロックしている
// ことがあり、これはページ側のJSからは解除できない（実機で「外部ブラウザへ自動で切り替える」
// 系の手段を試したが反応しなかったため、無理に自動化はせず案内文に留める）。
// 該当ブラウザをUAで検出できたときだけ、静的な案内＋確実に動く「リンクをコピー」を表示する。
(function setupInAppHint() {
  if (!/^https?:/.test(location.protocol)) return;   // file://（オフライン版）では出さない
  const ua = navigator.userAgent || "";
  const isInApp = /Twitter for (iPhone|iPad|Android)|\bTwitter\b|Instagram|FBAN|FBAV|\bLine\//i.test(ua);
  if (!isInApp) return;

  const hintEl = $("inappHint");
  const copyBtn = $("inappCopy");
  if (!hintEl || !copyBtn) return;
  hintEl.hidden = false;

  copyBtn.onclick = async () => {
    const original = copyBtn.textContent;
    try {
      await navigator.clipboard.writeText(location.href);
      copyBtn.textContent = "コピーしました";
    } catch (err) {
      copyBtn.textContent = "コピーできませんでした";
    }
    setTimeout(() => { copyBtn.textContent = original; }, 2500);
  };
})();

// ---- ファイル選択 ----
fileInput.onchange = (e) => setFiles(Array.from(e.target.files || []));

// ---- 並び順（N型／Z型） ----
orderRadios.forEach((r) => {
  r.onchange = () => {
    if (building || !r.checked) return;   // 同上：作成中の変更は無視
    order = r.value;
    outputBlob = null;
    shareBtn.disabled = true;
    renderPreview();
  };
});

// 1ページ内（4枚）でのグリッド位置(col:0=左/1=右, row:0=上/1=下)を、選択中の並び順から求める。
// Z型：左上→右上→左下→右下（横方向優先、通常の読み順）
// N型：左上→左下→右上→右下（縦方向優先。既定）
function cellPos(c) {
  return order === "Z"
    ? { col: c % 2, row: Math.floor(c / 2) }
    : { col: Math.floor(c / 2), row: c % 2 };
}

function setFiles(list) {
  if (building) return;   // 同上：作成中の再選択は無視（inputはbuild中disabledにしているので通常は来ない）
  for (const url of objectUrls) URL.revokeObjectURL(url);
  files = list.filter((f) => f.type.startsWith("image/"));
  objectUrls = files.map((f) => URL.createObjectURL(f));
  outputBlob = null;
  shareBtn.disabled = true;
  renderPreview();
  if (files.length > 0) scrollToMain();
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

// 選択ダイアログが返す順序はタップ順と必ずしも一致しない（機種・ピッカー依存）ため、
// 1つ前/後ろの画像と入れ替えて順序を直せるようにする。ページをまたいだ移動も同じロジックで扱える。
function moveTo(i, dir) {
  if (building) return;   // PDF作成中に配列を横から書き換えると生成ループが壊れるため無視
  const j = i + dir;
  if (j < 0 || j >= files.length) return;
  [files[i], files[j]] = [files[j], files[i]];
  [objectUrls[i], objectUrls[j]] = [objectUrls[j], objectUrls[i]];
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
  pageInfoEl.textContent = n ? `※${n}枚 → ${numPages}ページ` : "";

  if (n === 0) {
    setStatus("左の「スクショを選ぶ」で画像を選ぶと、A4ページの割り付けがここに表示されます。");
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
      const { col, row } = cellPos(c);
      cell.style.gridColumn = String(col + 1);
      cell.style.gridRow = String(row + 1);
      if (i < n) {
        const img = document.createElement("img");
        img.src = objectUrls[i];
        const idx = document.createElement("span");
        idx.className = "idx";
        idx.textContent = String(i + 1);
        const rm = document.createElement("button");
        rm.className = "rm";
        rm.title = "この1枚を除外";
        rm.setAttribute("aria-label", "この1枚を除外");
        rm.innerHTML = ICON_X;
        rm.onclick = () => removeAt(i);
        const prev = document.createElement("button");
        prev.className = "move prev";
        prev.title = "1つ前へ";
        prev.setAttribute("aria-label", "1つ前へ");
        prev.textContent = "◀";
        prev.disabled = i === 0;
        prev.onclick = () => moveTo(i, -1);
        const next = document.createElement("button");
        next.className = "move next";
        next.title = "1つ後ろへ";
        next.setAttribute("aria-label", "1つ後ろへ");
        next.textContent = "▶";
        next.disabled = i === n - 1;
        next.onclick = () => moveTo(i, 1);
        cell.appendChild(img);
        cell.appendChild(idx);
        cell.appendChild(rm);
        cell.appendChild(prev);
        cell.appendChild(next);
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
  orderRadios.forEach((r) => (r.disabled = true));
  pagesEl.classList.add("building");
  const n = files.length;
  const numPages = Math.ceil(n / 4);
  setStatus(`PDFを作成中…（${n}枚 / ${numPages}ページ）`);
  try {
    const out = await PDFDocument.create();
    const badgeFont = await out.embedFont(StandardFonts.HelveticaBold);
    for (let p = 0; p < numPages; p++) {
      const page = out.addPage([A4_W, A4_H]);
      for (let c = 0; c < 4; c++) {
        const i = p * 4 + c;
        if (i >= n) break;
        const img = await embedImage(out, files[i]);
        const { col, row } = cellPos(c);
        const cellX = MARGIN + col * (CELL_W + GUTTER);
        const cellYBottom = A4_H - MARGIN - CELL_H - row * (CELL_H + GUTTER);
        const rect = containRect(img.width, img.height, cellX, cellYBottom, CELL_W, CELL_H);
        page.drawImage(img, rect);
        drawIndexBadge(page, badgeFont, i + 1, cellX, cellYBottom + CELL_H);
      }
      setStatus(`PDFを作成中… ${p + 1}/${numPages}ページ`);
    }
    out.setTitle("スクショPDF");
    out.setProducer("screenshot-pdf");
    out.setCreator("screenshot-pdf");
    const bytes = await out.save();
    outputBlob = new Blob([bytes], { type: "application/pdf" });
    shareBtn.disabled = false;
    setStatus(`完了：${n}枚を${numPages}ページのA4 PDFにまとめました。左の「${shareBtn.textContent}」をタップしてください。`);
  } catch (err) {
    console.error(err);
    setStatus("PDFの作成に失敗しました。画像の形式を確認するか、枚数を減らしてもう一度お試しください。");
  } finally {
    building = false;
    buildBtn.disabled = files.length === 0;
    fileInput.disabled = false;
    orderRadios.forEach((r) => (r.disabled = false));
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

// 並び順の番号（プレビューの丸バッジ .idx と同じ役割）をPDF上にも描く。
// 画像の収まり方（余白）に関わらず位置が揃うよう、画像矩形ではなくセル自体の左上を基準にする。
const BADGE_R = 9, BADGE_PAD = 5;
function drawIndexBadge(page, font, n, cellLeft, cellTop) {
  const cx = cellLeft + BADGE_PAD + BADGE_R;
  const cy = cellTop - BADGE_PAD - BADGE_R;
  page.drawCircle({
    x: cx, y: cy, size: BADGE_R,
    color: rgb(1, 1, 1), opacity: 0.9,
    borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.75,
  });
  const label = String(n);
  const fontSize = 9;
  const textW = font.widthOfTextAtSize(label, fontSize);
  page.drawText(label, {
    x: cx - textW / 2,
    y: cy - fontSize * 0.36,
    size: fontSize,
    font,
    color: rgb(0.33, 0.33, 0.33),
  });
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
