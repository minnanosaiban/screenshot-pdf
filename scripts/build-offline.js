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

// Web公開版も外部CDNを使わないよう、vendor/ のライブラリを public/ へコピーして同一オリジンから配信する
fs.copyFileSync(path.join(VENDOR, "pdf-lib.min.js"), path.join(PUBLIC, "pdf-lib.min.js"));

const LIB_SCRIPT_TAG = '<script src="pdf-lib.min.js"></script>';
const APP_SCRIPT_TAG = '<script src="app.js"></script>';
const TITLE_TAG = "<title>スクショPDF化</title>";
const FAVICON_TAG = '<link rel="icon" type="image/svg+xml" href="favicon.svg">';
const PRIVACY_TEXT = "処理はお使いのローカルで完結し画像・PDFは外部送信されませんが、";

// String.replace は一致しなくても黙って素通りするため、置換対象が必ず存在することを先に確認する
for (const needle of [LIB_SCRIPT_TAG, APP_SCRIPT_TAG, TITLE_TAG, FAVICON_TAG, PRIVACY_TEXT]) {
  if (!html.includes(needle)) {
    throw new Error(`index.html に置換対象が見つかりません。build-offline.js を確認してください: ${needle}`);
  }
}
// 表示文言が変わっても壊れないよう、リンク先(href)基準の正規表現で検出する
// （中身にアイコンSVGを含むため、タグを含む内容にもマッチするよう [\s\S]*? にしている）
const OFFLINE_LINK_RE = /\n[ \t]*<a class="link" href="screenshot-pdf-offline\.html" download>[\s\S]*?<\/a>/;
if (!OFFLINE_LINK_RE.test(html)) {
  throw new Error("index.html のオフライン版ダウンロードリンクが見つかりません。build-offline.js の OFFLINE_LINK_RE を確認してください。");
}

const inlineLib = `<script>\n${escapeScriptClose(pdfLib)}\n</script>`;

let out = html.replace(LIB_SCRIPT_TAG, () => inlineLib);
out = out.replace(
  APP_SCRIPT_TAG,
  () => `<script>\n${escapeScriptClose(appJs)}\n</script>`
);
out = out.replace(TITLE_TAG, () => "<title>スクショPDF化（オフライン版）</title>");
// favicon も外部ファイル参照だと file:// 単体配布時に読み込めないため data URI に埋め込む
const faviconDataUri = `data:image/svg+xml;base64,${favicon.toString("base64")}`;
out = out.replace(FAVICON_TAG, () => `<link rel="icon" type="image/svg+xml" href="${faviconDataUri}">`);
// オフライン版自身の中に「オフライン版をダウンロード」リンク（自己参照）は不要なので取り除く
out = out.replace(OFFLINE_LINK_RE, () => "");
out = out.replace(
  PRIVACY_TEXT,
  () => "これはオフライン版です。ライブラリも含めて外部通信を一切行いません（このHTMLファイル単体で完結）。" +
        "※file://で直接開いた場合、共有機能（Web Share API）はブラウザ仕様上使えず、自動的にダウンロードになります。また、"
);

fs.writeFileSync(OUT, out, "utf8");
console.log(`generated: ${path.relative(ROOT, OUT)} (${(Buffer.byteLength(out) / 1024).toFixed(0)} KB)`);
