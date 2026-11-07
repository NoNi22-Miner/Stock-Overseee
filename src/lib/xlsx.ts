// Minimal Excel (.xlsx) reading and writing for the item import: the first sheet as rows of text.
// An .xlsx file is a zip of XML files; fflate unzips / zips it in plain JavaScript.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const encode = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // characters XML cannot hold
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** All <t> texts inside a piece of XML, joined (rich text has several). */
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');

/** "B12" -> 1 (column index). */
function columnIndex(ref: string) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function firstSheetPath(files: Record<string, Uint8Array>) {
  const wb = files['xl/workbook.xml'] && strFromU8(files['xl/workbook.xml']);
  const rels = files['xl/_rels/workbook.xml.rels'] && strFromU8(files['xl/_rels/workbook.xml.rels']);
  const rid = wb && /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
  const target = rid && rels && new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
  const alt = rid && rels && new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1];
  const t = target || alt;
  if (t) {
    const path = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
    if (files[path]) return path;
  }
  return Object.keys(files).find((f) => /^xl\/worksheets\/[^/]+\.xml$/.test(f)) ?? null;
}

/** The first sheet of an .xlsx file as rows of cell text (empty cells are ''). */
export function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('This is not an Excel (.xlsx) file.');
  }
  const sheetPath = firstSheetPath(files);
  if (!sheetPath) throw new Error('No sheet found in this Excel file.');

  const shared: string[] = [];
  const ss = files['xl/sharedStrings.xml'];
  if (ss) for (const m of strFromU8(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));

  const rows: string[][] = [];
  const sheet = strFromU8(files[sheetPath]);
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNo = Number(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1) - 1;
    const row: string[] = [];
    let next = 0;
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = texts(body);
      else if (v != null) value = decode(v);
      row[col] = value;
    }
    rows[rowNo] = Array.from(row, (c) => c ?? '');
  }
  return Array.from(rows, (r) => r ?? []);
}

/** A one-sheet .xlsx file with the given rows (all text; the first row in bold as a header). */
export function writeXlsx(rows: string[][], sheetName = 'Items'): Uint8Array {
  const colName = (i: number) => {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const sheetRows = rows
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">${r
          .map(
            (v, ci) =>
              `<c r="${colName(ci)}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${encode(v)}</t></is></c>`,
          )
          .join('')}</row>`,
    )
    .join('');
  const widths = (rows[0] ?? [])
    .map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="16" customWidth="1"/>`)
    .join('');
  const x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `${x}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      `${x}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      `${x}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${encode(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${x}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>',
    ),
    'xl/styles.xml': strToU8(
      `${x}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `${x}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
        `${widths ? `<cols>${widths}</cols>` : ''}<sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
  });
}

/** Rows from a .csv file (comma or semicolon separated, quotes allowed). */
export function readCsv(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const sep = (lines[0] ?? '').split(';').length > (lines[0] ?? '').split(',').length ? ';' : ',';
  return lines
    .filter((l) => l.trim())
    .map((line) => {
      const out: string[] = [];
      let cur = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quoted) {
          if (c === '"' && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else if (c === '"') quoted = false;
          else cur += c;
        } else if (c === '"') quoted = true;
        else if (c === sep) {
          out.push(cur);
          cur = '';
        } else cur += c;
      }
      out.push(cur);
      return out.map((v) => v.trim());
    });
}
