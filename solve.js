// swift-csv: a faster drop-in for csv-reader 1.0.0.
//
// Same answers as csv-reader 1.0.0 for every input {text, header} -> {columns, rows, errors},
// written from scratch from the behaviour the kit's RULES.txt states. It is fast because the
// common record is handled without a per-character loop: a record whose line holds no quote and
// no carriage return is one slice plus one native split(','), and only the rare broken records
// (quoted fields, stray CRs, quote junk, unterminated quotes) go through the careful path.
//
// Behaviour mirrored exactly (see RULES.txt):
//  - U+FEFF at the very start is dropped; a record ends at LF or CRLF; a line left with no
//    characters is no record.
//  - Outside quotes a CR not followed by LF is dropped (error stray_cr).
//  - A field opening with a quote runs to the next quote that is not doubled ("" is one quote);
//    CRLF or a lone CR inside it reads as LF; what follows its closing quote up to the next comma
//    or line break is appended as it stands (error quote_junk when the field ends, if anything
//    was appended); a quote that never closes is a literal character and the text after it is
//    read again as unquoted (error unterminated_quote).
//  - A quote inside an unquoted field is a literal character. Fields stay strings.
//  - columns is the first record when header is true, else null; rows holds the records after
//    it, each padded with "" (short_row, with fields: its field count) or cut (long_row, with
//    extra: the cut fields) to the first record's width.
//  - Each error is {code, line, row}, in the order met; line is the 1-based line its record
//    starts on (counting every LF, CRLF and lone CR inside quotes), row its record's index in
//    rows (null for the header).

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

// A quoted-field segment with CR/LF in it: count its line breaks into st.line and read each
// CRLF or lone CR as one LF. Segments without CR/LF never reach here (checked by the caller).
function xform(seg, st) {
  const m = seg.match(/\r\n|\r|\n/g);
  if (m !== null) st.line += m.length;
  return seg.replace(/\r\n?/g, '\n');
}

// Reads unquoted characters onto `value` up to the next comma or line break. A CR not followed
// by LF is dropped (stray_cr). Returns {value, ended, added}; `added` counts kept characters.
function readUnquoted(text, st, value, recordLine, recordRow, errors) {
  const len = text.length;
  let added = 0;
  let pos = st.pos;
  let line = st.line;
  while (pos < len) {
    const ci = text.indexOf(',', pos);
    const ni = text.indexOf('\n', pos);
    const ri = text.indexOf('\r', pos);
    let m = -1;
    let kind = 0; // 0 comma, 1 LF, 2 CR
    if (ci !== -1) { m = ci; kind = 0; }
    if (ni !== -1 && (m === -1 || ni < m)) { m = ni; kind = 1; }
    if (ri !== -1 && (m === -1 || ri < m)) { m = ri; kind = 2; }
    if (m === -1) {
      value += text.slice(pos);
      added += len - pos;
      pos = len;
      break;
    }
    if (kind === 0) {
      value += text.slice(pos, m);
      added += m - pos;
      st.pos = m + 1;
      st.line = line;
      return { value, ended: COMMA, added };
    }
    if (kind === 1) {
      value += text.slice(pos, m);
      added += m - pos;
      st.pos = m + 1;
      st.line = line + 1;
      return { value, ended: LINE_BREAK, added };
    }
    if (text.charCodeAt(m + 1) === 10) {
      value += text.slice(pos, m);
      added += m - pos;
      st.pos = m + 2;
      st.line = line + 1;
      return { value, ended: LINE_BREAK, added };
    }
    // Lone CR: dropped, error recorded, the field goes on.
    errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
    value += text.slice(pos, m);
    added += m - pos;
    pos = m + 1;
  }
  st.pos = pos;
  st.line = line;
  return { value, ended: END, added };
}

// Reads one record starting at st.pos (which holds no blank line). Returns {fields, quoted}
// where `quoted` says whether the record's last field opened with a quote.
function readRecordSlow(text, st, recordLine, recordRow, errors) {
  const len = text.length;
  const fields = [];
  let fieldValue;
  let ended;
  let lastQuoted = false;
  do {
    lastQuoted = text.charCodeAt(st.pos) === 34; // '"'
    if (lastQuoted) {
      const open = st.pos;
      const openLine = st.line;
      let value = '';
      let p = open + 1;
      let closed = false;
      let closePos = -1;
      while (true) {
        const q = text.indexOf('"', p);
        if (q === -1) break; // the quote never closes
        if (text.charCodeAt(q + 1) === 34) {
          // Doubled quote: one literal quote, and the scan goes on.
          const seg = text.slice(p, q);
          value += seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1 ? seg : xform(seg, st);
          value += '"';
          p = q + 2;
          continue;
        }
        const seg = text.slice(p, q);
        value += seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1 ? seg : xform(seg, st);
        closePos = q;
        closed = true;
        break;
      }
      if (!closed) {
        // The quote never closes: it is a literal character, and the text after it is read
        // again as unquoted (line reset to the quote's line, as the reference does).
        st.pos = open + 1;
        st.line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        const r = readUnquoted(text, st, '"', recordLine, recordRow, errors);
        fieldValue = r.value;
        ended = r.ended;
      } else {
        st.pos = closePos + 1;
        if (st.pos >= len) {
          fieldValue = value;
          ended = END;
        } else {
          const c = text.charCodeAt(st.pos);
          if (c === 44) {
            st.pos += 1;
            fieldValue = value;
            ended = COMMA;
          } else if (c === 10) {
            st.pos += 1;
            st.line += 1;
            fieldValue = value;
            ended = LINE_BREAK;
          } else if (c === 13 && text.charCodeAt(st.pos + 1) === 10) {
            st.pos += 2;
            st.line += 1;
            fieldValue = value;
            ended = LINE_BREAK;
          } else {
            // What follows the closing quote is appended as it stands.
            const r = readUnquoted(text, st, value, recordLine, recordRow, errors);
            if (r.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            fieldValue = r.value;
            ended = r.ended;
          }
        }
      }
    } else {
      const r = readUnquoted(text, st, '', recordLine, recordRow, errors);
      fieldValue = r.value;
      ended = r.ended;
    }
    fields.push(fieldValue);
  } while (ended === COMMA);
  return { fields, quoted: lastQuoted };
}

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let line = 1;
  const st = { pos: 0, line: 1 };

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;

    let fields;
    let lastQuoted = false;
    if (text.charCodeAt(pos) === 34) {
      // The record opens with a quote: straight to the careful path.
      st.pos = pos;
      st.line = line;
      const r = readRecordSlow(text, st, recordLine, recordRow, errors);
      pos = st.pos;
      line = st.line;
      fields = r.fields;
      lastQuoted = r.quoted;
    } else {
      // Fast path: the record's whole line holds no quote and no carriage return, so it is
      // one slice plus one native split. (The slice bounds the quote/CR check to this line:
      // a quote or CR further on belongs to a later record.)
      const nl = text.indexOf('\n', pos);
      const hasNL = nl !== -1;
      const lineEnd = hasNL ? nl : len;
      const segEnd = hasNL && lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
      const seg = text.slice(pos, segEnd);
      if (!/["\r]/.test(seg)) {
        fields = seg.split(',');
        if (hasNL) {
          pos = nl + 1;
          line += 1;
        } else {
          pos = len;
        }
      } else {
        st.pos = pos;
        st.line = line;
        const r = readRecordSlow(text, st, recordLine, recordRow, errors);
        pos = st.pos;
        line = st.line;
        fields = r.fields;
        lastQuoted = r.quoted;
      }
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr
    // errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
