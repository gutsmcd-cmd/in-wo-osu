# 印を押す (Stamp & Sign)

PDFや書類の写真に、はんこ（印鑑）や手書きサインを押して保存する、ブラウザだけの道具です。プリンターやスキャナーがなくても、印のいる書類に。無料・広告なし・ログイン不要。最初の読み込みのあとはオフラインで使えます。

- はんこをつくる：名字を入れると丸い認印に／指やマウスでサイン（黒・青）／本物の印影の写真から（白い背景を消します）
- つくったはんこは6つまで、この端末に保存（消せます）
- PDFか写真をひらいて、タップで押す。指で動かす、大きさを変える、もどす
- PDFは元の中身（文字など）をそのまま残して保存。写真はJPEG/PNGで保存

ファイルはどこにも送らず、保存もしません。保存するのは、つくったはんこだけです。※これは便利のための自分の印影の画像です。役所などの書類では、実物の印鑑や登録した印が必要なことがあります。

**English:** Put your hanko (personal seal) or a handwritten signature onto a PDF or a photo of a document, then save. Make a round red seal from a surname, draw a signature, or import a photo of a real stamp. PDFs keep their original content; stamps are embedded at the right spot. Free, no ads, no login, works offline. Files never leave your device; only your stamps are stored. Some official documents still require a physical or registered seal.

Live: https://gutsmcd-cmd.github.io/in-wo-osu/

## Develop

```bash
npm install
npm run dev
npm run build
```

Published with GitHub Pages from `.github/workflows/pages.yml`. PDF rendering uses pdf.js (bundled, works offline); saving uses pdf-lib. PWA icons live in `public/icons/` (added separately).

MIT License.
