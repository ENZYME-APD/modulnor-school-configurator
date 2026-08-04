import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

// Added adosamientos_excel to the list!
const directoriesToScan = [
  './classroom_excel',
  './electrical_excel',
  './roof_excel',
  './facade_excel',
  './structure_excel',
  './adosamientos_excel'
];

const outputFile = './src/bom.json';
const bom = {};

directoriesToScan.forEach(dir => {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx') && !f.startsWith('~'));

  files.forEach(file => {
    // Matches the WEB-XXX prefix and grabs the ID
    const match = file.match(/WEB-\d+\s+([A-Z0-9_]+)/i);
    if (!match) return;

    const moduleKey = match[1].toUpperCase();
    bom[moduleKey] = {};

    const workbook = XLSX.readFile(path.join(dir, file));
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 6) continue;

      const id = row[0];
      const name = row[1];
      const qty = parseFloat(row[5]);

      if (id && name && id !== 'Element ID' && !isNaN(qty) && qty > 0) {
        bom[moduleKey][id] = {
          name: String(name).trim(),
          qty: qty
        };
      }
    }
  });
});

fs.writeFileSync(outputFile, JSON.stringify(bom, null, 2));
console.log(`✅ BOM generated successfully! Parsed ${Object.keys(bom).length} total kits/modules.`);