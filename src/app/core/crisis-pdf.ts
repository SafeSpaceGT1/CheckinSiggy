import { EMERGENCY_DISCLAIMER, type PlanBundle } from "./crisis-plan.service";

/**
 * Client-side PDF export. jspdf is imported lazily so it stays out of the
 * initial bundle. Every page carries the emergency disclaimer footer.
 */
export async function exportCrisisPlanPdf(bundle: PlanBundle): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const marginX = 16;
  const width = 210 - marginX * 2;
  const bottomLimit = 272;
  let y = 20;

  const ensureSpace = (needed: number) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = 20;
    }
  };

  const writeLines = (text: string, size: number, style: "normal" | "bold", gap = 5) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, width) as string[];
    for (const line of lines) {
      ensureSpace(gap + 1);
      doc.text(line, marginX, y);
      y += gap;
    }
  };

  // Title
  writeLines("My Crisis Plan", 20, "bold", 9);
  writeLines("Check-In with SIGGY — Reflect between sessions. Arrive ready to talk.", 10, "normal", 6);
  writeLines(
    `Exported ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`,
    9,
    "normal",
    6
  );
  y += 4;

  const section = (title: string, rows: string[]) => {
    if (rows.length === 0) return;
    ensureSpace(14);
    y += 3;
    writeLines(title, 13, "bold", 7);
    for (const row of rows) {
      writeLines(`•  ${row}`, 11, "normal", 5.5);
    }
  };

  const contactLine = (name: string, meta: string | null, phone: string | null) =>
    [name, meta, phone].filter(Boolean).join("  ·  ");

  section("1. Warning signs", bundle.warningSigns.map((item) => item.text));
  section("2. Things I can do myself", bundle.copingStrategies.map((item) => item.text));
  section(
    "3. People & places for distraction",
    bundle.distractions.map((item) =>
      contactLine(item.name, item.kind === "place" ? "Place" : "Person", item.phone)
    )
  );
  section(
    "4. People I can ask for help",
    bundle.supportContacts.map((item) => contactLine(item.name, item.relationship, item.phone))
  );
  section(
    "5. Professionals & agencies",
    bundle.professionalContacts.map((item) =>
      contactLine(item.name, item.organization, item.phone)
    )
  );
  section("6. Making my space safer", bundle.safetySteps.map((item) => item.text));
  section("Worth remembering", bundle.reasonsForLiving.map((item) => item.text));

  // Footer disclaimer on every page.
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    const footer = doc.splitTextToSize(EMERGENCY_DISCLAIMER, width) as string[];
    doc.text(footer, 105, 285, { align: "center" });
    doc.setTextColor(0);
  }

  doc.save("siggy-crisis-plan.pdf");
}
