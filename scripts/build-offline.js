"use strict";
// public/index.html + public/app.js + vendor/pdf-lib.min.js から、外部通信なしで動く
// 単一HTMLファイル（オフライン版）を public/screenshot-pdf-offline.html に生成する。
// 依存パッケージなし（Node標準機能のみ）。ロジックはWeb公開版と同じソースから生成するため、
// 手作業での二重管理は発生しない。

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const VENDOR = path.join(ROOT, "vendor");
const OUT = path.join(PUBLIC, "screenshot-pdf-offline.html");

const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
const pdfLib = fs.readFileSync(path.join(VENDOR, "pdf-lib.min.js"), "utf8");
const favicon = fs.readFileSync(path.join(PUBLIC, "favicon.svg"));

// </script> をライブラリ本文がそのまま含んでいた場合にHTMLを壊さないようにエスケープ
const escapeScriptClose = (s) => s.replace(/<\/script/gi, "<\\/script");

const CDN_SCRIPT_TAG =
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"></script>';

if (!html.includes(CDN_SCRIPT_TAG)) {
  throw new Error("index.html の CDN <script> タグが見つかりません。build-offline.js の CDN_SCRIPT_TAG を確認してください。");
}
// 表示文言が変わっても壊れないよう、リンク先(href)基準の正規表現で検出する
const OFFLINE_LINK_RE = /\n[ \t]*<a class="link" href="screenshot-pdf-offline\.html" download>[^<]*<\/a>/;
if (!OFFLINE_LINK_RE.test(html)) {
  throw new Error("index.html のオフライン版ダウンロードリンクが見つかりません。build-offline.js の OFFLINE_LINK_RE を確認してください。");
}

const inlineLib = `<script>\n${escapeScriptClose(pdfLib)}\n</script>`;

let out = html.replace(CDN_SCRIPT_TAG, () => inlineLib);
out = out.replace(
  '<script src="app.js"></script>',
  () => `<script>\n${escapeScriptClose(appJs)}\n</script>`
);
out = out.replace("<title>スクショ PDF化</title>", () => "<title>スクショ PDF化（オフライン版）</title>");
// favicon も外部ファイル参照だと file:// 単体配布時に読み込めないため data URI に埋め込む
const faviconDataUri = `data:image/svg+xml;base64,${favicon.toString("base64")}`;
out = out.replace('<link rel="icon" type="image/svg+xml" href="favicon.svg">', () => `<link rel="icon" type="image/svg+xml" href="${faviconDataUri}">`);
// オフライン版自身の中に「オフライン版をダウンロード」リンク（自己参照）は不要なので取り除く
out = out.replace(OFFLINE_LINK_RE, () => "");
out = out.replace(
  "処理はすべてお使いのブラウザ内で行われ、<b>スクショもPDFもどこにも送信されません</b>。",
  () => "これはオフライン版です。<b>ライブラリも含めて外部通信を一切行いません</b>（このHTMLファイル単体で完結）。" +
        "※file://で直接開いた場合、共有機能（Web Share API）はブラウザ仕様上使えず、自動的にダウンロードになります。"
);

fs.writeFileSync(OUT, out, "utf8");
console.log(`generated: ${path.relative(ROOT, OUT)} (${(Buffer.byteLength(out) / 1024).toFixed(0)} KB)`);
