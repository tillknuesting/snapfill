// Synthesise five canonical German form PDFs as fixtures for the snap
// detector. Real German form sources (BMF, Arbeitsagentur, BZSt, etc.) gate
// downloads behind dynamic URLs that don't archive cleanly, so we generate
// vector PDFs that mimic the layout characteristics of each form type:
//
//   1. Anmeldung beim Einwohnermeldeamt  — resident registration
//   2. Krankmeldung / AU-Bescheinigung   — sick-leave certificate
//   3. Kündigung Arbeitsvertrag          — employment termination
//   4. Mietvertrag (Kurzform)            — short rental contract
//   5. Rechnung                           — invoice with line items
//
// Each form has labelled boxed inputs (Felder) drawn as 12–22 pt-tall
// rectangles. The detector should find every box; tests assert minimum cell
// counts. Run with: node scripts/build-de-fixtures.mjs

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', 'public', 'fixtures', 'forms')

function buildForm(title, subtitle, fields) {
  return async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([595.28, 841.89]) // A4
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const black = rgb(0, 0, 0)
    const grey  = rgb(0.4, 0.4, 0.4)
    const fieldStroke = rgb(0.55, 0.55, 0.55)

    // Header — title and a thin underline.
    page.drawText(title,    { x: 56, y: 790, size: 16, font: bold, color: black })
    page.drawText(subtitle, { x: 56, y: 770, size: 9,  font, color: grey })
    page.drawLine({ start: { x: 56, y: 760 }, end: { x: 539, y: 760 }, thickness: 0.6, color: black })

    let y = 730
    for (const row of fields) {
      const rowGap = 4
      const xStart = 56
      const xEnd = 539
      const totalGaps = (row.length - 1) * 8
      const widthSum = row.reduce((s, f) => s + (f.w ?? 0), 0)
      const remaining = (xEnd - xStart) - totalGaps - widthSum
      // Equal-share fallback for rows where widths weren't fully specified.
      const sharePerUnknown = remaining / row.filter((f) => f.w == null).length

      let x = xStart
      const labelGap = 14
      const fieldGap = 4
      const fieldH = Math.max(...row.map((f) => f.h ?? 18))

      for (const f of row) {
        const w = f.w ?? sharePerUnknown
        const h = f.h ?? 18
        // Label above the box.
        page.drawText(f.label, { x, y: y - labelGap + 4, size: 8, font, color: grey })
        // Boxed input — a real rectangle. The detector treats each as a cell.
        page.drawRectangle({
          x, y: y - labelGap - h, width: w, height: h,
          borderColor: fieldStroke, borderWidth: 0.6,
        })
        x += w + 8
      }
      y -= labelGap + fieldH + 14
    }

    // Footer line for "Datum / Unterschrift".
    y -= 8
    page.drawText('Datum, Unterschrift', { x: 56, y, size: 9, font, color: grey })
    page.drawLine({ start: { x: 56, y: y - 4 }, end: { x: 350, y: y - 4 }, thickness: 0.6, color: fieldStroke })

    return doc.save()
  }
}

const FORMS = [
  {
    file: 'de-anmeldung.pdf',
    title: 'Anmeldung bei der Meldebehörde',
    subtitle: 'Bitte alle Felder ausfüllen — Bundesmeldegesetz §17',
    rows: [
      [{ label: 'Familienname' }, { label: 'Frühere Namen', w: 200 }],
      [{ label: 'Vornamen' }, { label: 'Geschlecht', w: 80 }],
      [{ label: 'Geburtsdatum', w: 120 }, { label: 'Geburtsort' }, { label: 'Staatsangehörigkeit', w: 140 }],
      [{ label: 'Familienstand', w: 120 }, { label: 'Religionszugehörigkeit', w: 140 }, { label: 'Steuer-ID' }],
      [{ label: 'Straße, Hausnummer' }, { label: 'PLZ', w: 60 }, { label: 'Ort', w: 160 }],
      [{ label: 'Einzugsdatum', w: 120 }, { label: 'Eigentümer der Wohnung' }],
    ],
  },
  {
    file: 'de-krankmeldung.pdf',
    title: 'Arbeitsunfähigkeitsbescheinigung',
    subtitle: 'Krankmeldung für Arbeitgeber und Krankenkasse',
    rows: [
      [{ label: 'Versicherten-Nr.', w: 160 }, { label: 'Krankenkasse' }],
      [{ label: 'Name des Versicherten' }, { label: 'Geburtsdatum', w: 120 }],
      [{ label: 'Anschrift' }],
      [{ label: 'Arbeitsunfähig seit', w: 140 }, { label: 'Voraussichtlich bis', w: 140 }, { label: 'Festgestellt am', w: 140 }],
      [{ label: 'Diagnose (ICD-10)', w: 200 }, { label: 'Erstbescheinigung / Folgebescheinigung' }],
      [{ label: 'Behandelnder Arzt / Praxis' }],
    ],
  },
  {
    file: 'de-kuendigung.pdf',
    title: 'Kündigung des Arbeitsvertrags',
    subtitle: 'Schriftform gemäß § 623 BGB erforderlich',
    rows: [
      [{ label: 'Arbeitnehmer / Arbeitnehmerin' }],
      [{ label: 'Anschrift' }],
      [{ label: 'Personal-Nr.', w: 140 }, { label: 'Eintrittsdatum', w: 120 }],
      [{ label: 'Arbeitgeber' }],
      [{ label: 'Anschrift des Arbeitgebers' }],
      [{ label: 'Kündigung zum', w: 140 }, { label: 'Kündigungsgrund' }],
      [{ label: 'Bemerkungen', h: 36 }],
    ],
  },
  {
    file: 'de-mietvertrag.pdf',
    title: 'Mietvertrag (Kurzform) — Wohnraum',
    subtitle: 'Vertrag gemäß §§ 535 ff. BGB — bitte Originale aushändigen',
    rows: [
      [{ label: 'Vermieter (Name, Anschrift)' }],
      [{ label: 'Mieter (Name, Anschrift)' }],
      [{ label: 'Mietobjekt — Straße, Hausnummer' }],
      [{ label: 'PLZ', w: 60 }, { label: 'Ort', w: 160 }, { label: 'Wohnungs-Nr.', w: 100 }, { label: 'Geschoss', w: 80 }],
      [{ label: 'Wohnfläche (m²)', w: 120 }, { label: 'Zimmerzahl', w: 100 }, { label: 'Mietbeginn', w: 120 }, { label: 'Befristung bis', w: 120 }],
      [{ label: 'Kaltmiete (€)', w: 120 }, { label: 'Nebenkosten (€)', w: 120 }, { label: 'Kaution (€)', w: 120 }],
      [{ label: 'Bankverbindung — IBAN' }, { label: 'BIC', w: 120 }],
    ],
  },
  {
    file: 'de-rechnung.pdf',
    title: 'Rechnung',
    subtitle: 'Gemäß § 14 UStG — Aufbewahrungsfrist 10 Jahre',
    rows: [
      [{ label: 'Rechnungs-Nr.', w: 160 }, { label: 'Rechnungsdatum', w: 140 }, { label: 'Lieferdatum', w: 140 }],
      [{ label: 'Kundennummer', w: 160 }, { label: 'Bestellnummer' }],
      [{ label: 'Rechnungsempfänger (Firma, Anschrift)' }],
      [{ label: 'Position 1 — Beschreibung' }, { label: 'Menge', w: 60 }, { label: 'Einzelpreis €', w: 100 }, { label: 'Gesamt €', w: 100 }],
      [{ label: 'Position 2 — Beschreibung' }, { label: 'Menge', w: 60 }, { label: 'Einzelpreis €', w: 100 }, { label: 'Gesamt €', w: 100 }],
      [{ label: 'Position 3 — Beschreibung' }, { label: 'Menge', w: 60 }, { label: 'Einzelpreis €', w: 100 }, { label: 'Gesamt €', w: 100 }],
      [{ label: 'Zwischensumme (€)', w: 160 }, { label: 'USt 19 % (€)', w: 140 }, { label: 'Endbetrag (€)', w: 160 }],
      [{ label: 'IBAN', w: 240 }, { label: 'BIC', w: 120 }, { label: 'Verwendungszweck' }],
    ],
  },
]

for (const f of FORMS) {
  const buildFn = buildForm(f.title, f.subtitle, f.rows)
  const bytes = await buildFn()
  writeFileSync(join(OUT, f.file), bytes)
  console.log('wrote', f.file, '(' + bytes.length + ' bytes)')
}
