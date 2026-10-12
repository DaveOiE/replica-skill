/** Small RFC 4180 CSV reader: quotes, doubled quotes, commas and newlines inside quotes, CRLF, a leading BOM. Returns an array of rows. */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = []; let row = [], field = '', inQ = false, any = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c;
    } else if (c === '"') { inQ = true; any = true; }
    else if (c === ',') { row.push(field); field = ''; any = true; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; if (any || field !== '') { row.push(field); rows.push(row); } row = []; field = ''; any = false; }
    else { field += c; any = true; }
  }
  if (any || field !== '') { row.push(field); rows.push(row); }
  return rows;
}
