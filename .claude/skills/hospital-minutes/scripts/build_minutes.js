#!/usr/bin/env node
/**
 * 病院向け議事録ビルダー
 *
 * 使い方:
 *   node build_minutes.js <content.json> <output.docx>
 *
 * content.json のスキーマは references/content-schema.md を参照。
 * 依存: docx (npm i -g docx --prefix ~/.npm-global)
 */

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, ExternalHyperlink, convertInchesToTwip
} = require('docx');
const fs = require('fs');
const path = require('path');

const JP = "Yu Gothic";
const NAVY = "1F3864";
const ACCENT = "2E7D64";
const GRAY = "595959";
const NOTE_BG = "FFF6E5";
const NOTE_HEAD = "8A5A00";
const NOTE_BODY = "5A4000";

const META_W = [1900, 7460];

const AI_NOTICE_DEFAULT =
  "本議事録は、会議の録音をもとにAI（自動文字起こし・要約）を利用して作成し、担当者が編集したものです。" +
  "発言の聞き取り誤りや、要約の過程での認識の相違が含まれている可能性がございます。" +
  "記載内容に誤り・不足・認識の相違がございましたら、お手数ですがヘンリー担当までご指摘ください。" +
  "すみやかに修正のうえ、改めてご共有いたします。";

const FOOTER_DEFAULT =
  "本議事録はAIによる文字起こし・要約をもとに作成しております。" +
  "内容にお気づきの点・認識の相違がございましたら、ヘンリー担当までご連絡ください。";

// ---------- building blocks ----------

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 100, line: 280 },
    alignment: opts.align,
    children: [new TextRun({
      text, font: JP, size: opts.size ?? 20,
      bold: opts.bold, color: opts.color, italics: opts.italics,
    })],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    keepNext: true,
    keepLines: true,
    spacing: { before: 320, after: 140 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: NAVY, space: 4 } },
    children: [new TextRun({ text, font: JP, size: 24, bold: true, color: NAVY })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    keepNext: true,
    keepLines: true,
    spacing: { before: 200, after: 90 },
    children: [new TextRun({ text, font: JP, size: 21, bold: true, color: ACCENT })],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "dot", level: Math.min(level, 1) },
    spacing: { after: 60, line: 280 },
    children: [new TextRun({ text, font: JP, size: 20 })],
  });
}

function linkPara(label, url) {
  return new Paragraph({
    keepNext: true,
    keepLines: true,
    spacing: { after: 60, line: 280 },
    children: [
      new TextRun({ text: label + "：", font: JP, size: 20 }),
      new ExternalHyperlink({
        children: [new TextRun({ text: url, font: JP, size: 18, color: "0563C1", underline: {} })],
        link: url,
      }),
    ],
  });
}

function cell(text, opts = {}) {
  const lines = Array.isArray(text) ? text : [text];
  return new TableCell({
    width: { size: opts.w, type: WidthType.DXA },
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: lines.map(t => new Paragraph({
      spacing: { after: 0, line: 260 },
      children: [new TextRun({ text: t, font: JP, size: 18, bold: opts.bold, color: opts.color })],
    })),
  });
}

function metaTable(rows) {
  return new Table({
    columnWidths: META_W,
    width: { size: META_W[0] + META_W[1], type: WidthType.DXA },
    rows: rows.map(([k, v]) => new TableRow({
      cantSplit: true,
      children: [
        cell(k, { w: META_W[0], fill: "EEF2F7", bold: true }),
        cell(v, { w: META_W[1] }),
      ],
    })),
  });
}

function noticeBox(body) {
  const width = META_W[0] + META_W[1];
  return new Table({
    columnWidths: [width],
    width: { size: width, type: WidthType.DXA },
    rows: [new TableRow({
      cantSplit: true,
      children: [new TableCell({
        width: { size: width, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: NOTE_BG, color: "auto" },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        children: [
          new Paragraph({
            spacing: { after: 60, line: 260 },
            children: [new TextRun({ text: "【ご確認のお願い】", font: JP, size: 19, bold: true, color: NOTE_HEAD })],
          }),
          new Paragraph({
            spacing: { after: 0, line: 260 },
            children: [new TextRun({ text: body, font: JP, size: 18, color: NOTE_BODY })],
          }),
        ],
      })],
    })],
  });
}

// ---------- assemble ----------

function buildChildren(spec) {
  const out = [];

  out.push(new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text: spec.eyebrow || "", font: JP, size: 20, color: GRAY })],
  }));
  out.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: spec.title, font: JP, size: 32, bold: true, color: NAVY })],
  }));
  out.push(new Paragraph({
    spacing: { after: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 14, color: ACCENT, space: 6 } },
    children: [new TextRun({ text: spec.subtitle || "", font: JP, size: 18, color: GRAY })],
  }));

  if (spec.meta && spec.meta.length) {
    out.push(metaTable(spec.meta));
    out.push(para("", { after: 140 }));
  }

  if (spec.ai_notice !== false) {
    out.push(noticeBox(typeof spec.ai_notice === "string" ? spec.ai_notice : AI_NOTICE_DEFAULT));
    out.push(para("", { after: 200 }));
  }

  for (const section of spec.sections || []) {
    if (section.h1) out.push(h1(section.h1));
    for (const item of section.body || []) {
      if (item.h2 !== undefined) out.push(h2(item.h2));
      else if (item.bullet !== undefined) out.push(bullet(item.bullet, item.level || 0));
      else if (item.para !== undefined) out.push(para(item.para));
      else if (item.note !== undefined) out.push(para(item.note, { size: 18, color: GRAY, after: 60 }));
      else if (item.link !== undefined) out.push(linkPara(item.link.label, item.link.url));
      else throw new Error("不明なブロック: " + JSON.stringify(item));
    }
  }

  out.push(para("", { after: 300 }));
  out.push(new Paragraph({
    spacing: { before: 200 },
    border: { top: { style: BorderStyle.SINGLE, size: 6, color: "BFBFBF", space: 6 } },
    children: [new TextRun({ text: spec.footer || FOOTER_DEFAULT, font: JP, size: 18, color: GRAY })],
  }));

  return out;
}

function main() {
  const [, , specPath, outPath] = process.argv;
  if (!specPath || !outPath) {
    console.error("使い方: node build_minutes.js <content.json> <output.docx>");
    process.exit(1);
  }

  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  if (!spec.title) throw new Error("title は必須です");

  const doc = new Document({
    numbering: {
      config: [{
        reference: "dot",
        levels: [
          {
            level: 0, format: LevelFormat.BULLET, text: "●", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.28), hanging: convertInchesToTwip(0.19) } } },
          },
          {
            level: 1, format: LevelFormat.BULLET, text: "－", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.56), hanging: convertInchesToTwip(0.19) } } },
          },
        ],
      }],
    },
    sections: [{
      properties: { page: { margin: { top: 1150, bottom: 1000, left: 1100, right: 1100 } } },
      children: buildChildren(spec),
    }],
  });

  Packer.toBuffer(doc).then(buf => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buf);
    console.log("作成しました: " + outPath);
  });
}

main();
