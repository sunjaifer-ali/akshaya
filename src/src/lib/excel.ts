export type Sheet = {
  name: string;
  rows: (string | number | null)[][];
};

export async function downloadWorkbook(filename: string, sheets: Sheet[]): Promise<void> {
  const imported = (await import("exceljs")) as typeof import("exceljs") & { default?: typeof import("exceljs") };
  const excel = imported.Workbook ? imported : imported.default;
  if (!excel?.Workbook) throw new Error("Excel file was not created.");
  const workbook = new excel.Workbook();
  workbook.creator = "Akshaya Centre Thrikkadeeri";
  workbook.created = new Date();
  for (const sheet of sheets) {
    const grid = workbook.addWorksheet(sheet.name.slice(0, 31));
    for (const row of sheet.rows) grid.addRow(row);
    const header = grid.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: "middle" };
    const width = sheet.rows[0]?.length ?? 1;
    if (sheet.rows.length > 1 && width > 0) {
      grid.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: width } };
      grid.views = [{ state: "frozen", ySplit: 1 }];
    }
    for (let column = 1; column <= width; column += 1) {
      let size = 12;
      grid.eachRow((row) => {
        const value = row.getCell(column).value;
        const text = value == null ? "" : String(value);
        size = Math.max(size, Math.min(28, text.length + 2));
        if (typeof value === "number") row.getCell(column).numFmt = "#,##0";
      });
      grid.getColumn(column).width = size;
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
