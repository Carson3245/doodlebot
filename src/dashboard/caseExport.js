import PDFDocument from "pdfkit"

function escapeCsv(value) {
  if (value === null || value === undefined) {
    return ""
  }
  const text = String(value)
  if (!/[",\n]/.test(text)) {
    return text
  }
  return `"${text.replace(/"/g, '""')}"`
}

function formatDate(value) {
  if (!value) {
    return ""
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  return date.toISOString()
}

function resolveSlaState(entry) {
  if (entry?.sla?.state) {
    return entry.sla.state
  }
  if (!entry?.sla?.dueAt) {
    return "none"
  }
  if (entry.sla?.completedAt) {
    return "met"
  }
  const normalizedStatus = entry?.status ? String(entry.status).toLowerCase() : null
  if (normalizedStatus === "closed" || normalizedStatus === "archived") {
    return "met"
  }
  const due = Date.parse(entry.sla.dueAt)
  if (!Number.isFinite(due)) {
    return "none"
  }
  const now = Date.now()
  if (due < now) {
    return "overdue"
  }
  const hours = (due - now) / (1000 * 60 * 60)
  if (hours <= 24) {
    return "due-soon"
  }
  return "pending"
}

export function generateCaseCsv(cases) {
  const headers = [
    "Case ID",
    "Status",
    "Category",
    "Ticket type",
    "Subject",
    "Member ID",
    "Member tag",
    "Assignee",
    "SLA due",
    "SLA state",
    "Created at",
    "Updated at",
    "Last message at"
  ]

  const lines = [headers.join(",")]
  for (const entry of cases) {
    const row = [
      entry.id ?? "",
      entry.status ?? "",
      entry.category ?? "",
      entry.ticketType ?? "",
      entry.subject ?? "",
      entry.userId ?? "",
      entry.userTag ?? "",
      entry.assignee?.tag ?? entry.assignee?.displayName ?? "",
      formatDate(entry.sla?.dueAt),
      resolveSlaState(entry),
      formatDate(entry.createdAt),
      formatDate(entry.updatedAt),
      formatDate(entry.lastMessageAt)
    ].map(escapeCsv)
    lines.push(row.join(","))
  }

  return `\uFEFF${lines.join("\n")}`
}

export async function generateCasePdf(cases, { title = "Cases export", generatedAt = new Date() } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 })
    const chunks = []

    doc.on("data", (chunk) => chunks.push(chunk))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)

    doc.fontSize(18).text(title, { align: "left" })
    if (generatedAt) {
      const label = generatedAt instanceof Date ? generatedAt.toLocaleString() : String(generatedAt)
      doc.moveDown(0.25)
      doc.fontSize(10).fillColor("#666666").text(`Generated ${label}`)
    }
    doc.moveDown()
    doc.fillColor("#000000")

    if (!cases.length) {
      doc.fontSize(12).text("No cases matched the current filters.", { align: "left" })
      doc.end()
      return
    }

    const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right

    for (const entry of cases) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 80) {
        doc.addPage()
      }

      doc.fontSize(13).fillColor("#111111").text(entry.subject ?? `Case ${entry.id}`, { width: maxWidth })

      const subtitleParts = [
        entry.id ? `#${entry.id}` : null,
        entry.status ? entry.status.toUpperCase() : null,
        entry.category ?? null,
        entry.ticketType ?? null
      ].filter(Boolean)

      if (subtitleParts.length) {
        doc.fontSize(10).fillColor("#555555").text(subtitleParts.join(" | "), { width: maxWidth })
      }

      const detailParts = []
      if (entry.userTag || entry.userId) {
        detailParts.push(`Member: ${entry.userTag ?? entry.userId}`)
      }
      if (entry.assignee?.tag || entry.assignee?.displayName) {
        detailParts.push(`Assignee: ${entry.assignee.tag ?? entry.assignee.displayName}`)
      }
      if (entry.sla?.dueAt) {
        const state = resolveSlaState(entry)
        detailParts.push(`SLA: ${new Date(entry.sla.dueAt).toLocaleString()} (${state})`)
      }
      detailParts.push(`Opened: ${entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "Unknown"}`)
      detailParts.push(`Updated: ${entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : "Unknown"}`)

      doc.fontSize(9).fillColor("#333333").text(detailParts.join(" | "), { width: maxWidth })
      doc.moveDown()
    }

    doc.end()
  })
}
