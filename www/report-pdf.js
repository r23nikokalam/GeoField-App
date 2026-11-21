import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function pdfSafe(value) {
  const text = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  // Standard Helvetica uses WinAnsi. Refuse lossy Unicode conversion instead of silently corrupting report values.
  if (/[^\u0009\u000A\u000D\u0020-\u00FF]/.test(text)) {
    throw new Error("PDF export currently supports Latin/WinAnsi characters only. Use XLSX export to preserve non-Latin text.");
  }
  return text;
}

export async function buildProjectReport({ project, observations = [], samples = [], generatedAt = new Date().toISOString() }) {
  if (!project || typeof project !== "object") throw new Error("A project is required to build the PDF report.");
  const pdf = await PDFDocument.create();
  pdf.setTitle("GeoField Project Report - " + pdfSafe(project.name));
  pdf.setAuthor("GeoField");
  pdf.setSubject("Geological field observations and sample register");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize = [595.28, 841.89];
  const margin = 42;
  const maxWidth = pageSize[0] - margin * 2;
  let page;
  let y;

  const newPage = () => {
    page = pdf.addPage(pageSize);
    y = pageSize[1] - margin;
  };
  const wrap = (text, font, size) => {
    const words = pdfSafe(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
      else {
        if (line) lines.push(line);
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          let part = "";
          for (const char of word) {
            if (font.widthOfTextAtSize(part + char, size) > maxWidth && part) {
              lines.push(part);
              part = char;
            } else part += char;
          }
          line = part;
        } else line = word;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  };
  const write = (text, { size = 9, font = regular, gap = 3, indent = 0 } = {}) => {
    const lines = wrap(text, font, size);
    for (const line of lines) {
      if (y < margin + size + 8) newPage();
      page.drawText(line, { x: margin + indent, y, size, font, color: rgb(0.12, 0.22, 0.25) });
      y -= size + gap;
    }
  };
  const heading = text => {
    y -= 5;
    write(text, { size: 13, font: bold, gap: 6 });
  };
  newPage();
  write("GEOFIELD | GEOLOGICAL FIELD REPORT", { size: 16, font: bold, gap: 10 });
  write("Project: " + project.name, { size: 12, font: bold });
  write("Generated: " + generatedAt);
  heading("PROJECT DETAILS");
  [
    ["Project Code", project.code], ["Client", project.client], ["Area", project.area],
    ["Description", project.description], ["Coordinate System", project.coordinateSystem || "Unknown"],
    ["Horizontal Datum", project.datum || "Unknown"], ["UTM Zone", project.utmZone || "Unknown"],
    ["Hemisphere", project.hemisphere || "Unknown"], ["Horizontal Unit", project.horizontalUnit || "Unknown"],
    ["Vertical Datum", project.verticalDatum || "Unknown"], ["Elevation Unit", project.elevationUnit || "Unknown"]
  ].forEach(([key, value]) => { if (value) write(key + ": " + value); });
  heading("OBSERVATIONS (" + observations.length + ")");
  if (!observations.length) write("No observations registered.");
  observations.forEach((record, index) => {
    const label = record.WPT_NO || record.Profile_No || record.Lithology || record.id || ("Record " + (index + 1));
    write((index + 1) + ". " + label, { size: 10, font: bold, gap: 4 });
    const entries = Object.entries(record).filter(([key, value]) =>
      key !== "id" && key !== "projectId" && key !== "_legacy" && value !== "" && value !== null && value !== undefined
    );
    entries.forEach(([key, value]) => write(key + ": " + value, { indent: 10, size: 8, gap: 2 }));
    y -= 4;
  });
  heading("SAMPLE REGISTER (" + samples.length + ")");
  if (!samples.length) write("No samples registered.");
  samples.forEach((sample, index) => {
    write((index + 1) + ". " + sample.code, { size: 10, font: bold, gap: 4 });
    [
      ["Type", sample.sampleType], ["Material", sample.material],
      ["Linked Observation", sample.observationId], ["Collected At", sample.collectedAt],
      ["Notes", sample.notes]
    ].forEach(([key, value]) => { if (value) write(key + ": " + value, { indent: 10, size: 8, gap: 2 }); });
    y -= 4;
  });
  const pages = pdf.getPages();
  pages.forEach((item, index) => {
    item.drawText("GeoField | Page " + (index + 1) + " of " + pages.length, {
      x: margin, y: 22, size: 8, font: regular, color: rgb(0.35, 0.43, 0.45)
    });
  });
  return pdf.save();
}
