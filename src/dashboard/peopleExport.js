import PDFDocument from "pdfkit"

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

function joinList(items) {
  return Array.isArray(items) ? items.join("; ") : ""
}

export function generatePeopleCsv(people) {
  const headers = [
    "ID",
    "Display name",
    "Title",
    "Department",
    "Status",
    "Email",
    "Roles",
    "Tags",
    "Location",
    "Timezone",
    "Manager",
    "Joined at",
    "Last seen",
    "Next check-in",
    "Last completed check-in"
  ]

  const lines = [headers.join(",")]

  for (const person of people) {
    const manager = person.managerId && person.managerName ? `${person.managerName} (${person.managerId})` : person.managerId ?? ""
    const roles = joinList(person.roles)
    const tags = joinList(person.tags)

    const nextCheckIn = person.checkins?.next?.dueAt
      ? `${person.checkins.next.cadence ?? ""}:${formatDate(person.checkins.next.dueAt)}`
      : ""
    const lastCheckIn = person.checkins?.lastCompleted?.completedAt
      ? `${person.checkins.lastCompleted.cadence ?? ""}:${formatDate(person.checkins.lastCompleted.completedAt)}`
      : ""

    const row = [
      person.id ?? "",
      person.displayName ?? "",
      person.title ?? "",
      person.department ?? "",
      person.status ?? "",
      person.email ?? "",
      roles,
      tags,
      person.location ?? "",
      person.timezone ?? "",
      manager,
      formatDate(person.joinedAt),
      formatDate(person.lastSeenAt),
      nextCheckIn,
      lastCheckIn
    ].map(escapeCsv)

    lines.push(row.join(","))
  }

  return `\uFEFF${lines.join("\n")}`
}

export async function generatePeoplePdf(people, { title = "People export", generatedAt = new Date() } = {}) {
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

    const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right

    if (!people.length) {
      doc.fontSize(12).text("No people matched the current filters.", { align: "left" })
      doc.end()
      return
    }

    for (const person of people) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 80) {
        doc.addPage()
      }

      doc.fontSize(14).fillColor("#111111").text(person.displayName ?? "Unknown member", { width: maxWidth })

      const subtitleParts = []
      if (person.title) subtitleParts.push(person.title)
      if (person.department) subtitleParts.push(person.department)
      if (person.status) subtitleParts.push(`Status: ${person.status}`)
      if (subtitleParts.length) {
        doc.fontSize(10).fillColor("#555555").text(subtitleParts.join(" | "), { width: maxWidth })
      }

      const details = [
        person.email ? `Email: ${person.email}` : null,
        person.location ? `Location: ${person.location}` : null,
        person.timezone ? `Timezone: ${person.timezone}` : null,
        person.managerName ? `Manager: ${person.managerName} (${person.managerId ?? "n/a"})` : null,
        person.roles?.length ? `Roles: ${person.roles.join(", ")}` : null,
        person.tags?.length ? `Tags: ${person.tags.join(", ")}` : null,
        person.joinedAt ? `Joined: ${new Date(person.joinedAt).toLocaleDateString()}` : null,
        person.lastSeenAt ? `Last seen: ${new Date(person.lastSeenAt).toLocaleString()}` : null
      ].filter(Boolean)

      if (details.length) {
        doc.fontSize(9).fillColor("#333333").text(details.join(" | "), { width: maxWidth })
      }

      const checkinParts = []
      if (person.checkins?.next?.dueAt) {
        checkinParts.push(
          `Next check-in (${person.checkins.next.cadence ?? "n/a"}): ${new Date(person.checkins.next.dueAt).toLocaleDateString()}`
        )
      }
      if (person.checkins?.lastCompleted?.completedAt) {
        checkinParts.push(
          `Last check-in (${person.checkins.lastCompleted.cadence ?? "n/a"}): ${new Date(
            person.checkins.lastCompleted.completedAt
          ).toLocaleDateString()}`
        )
      }
      if (checkinParts.length) {
        doc.fontSize(9).fillColor("#444444").text(checkinParts.join(" | "), { width: maxWidth })
      }

      doc.moveDown()
    }

    doc.end()
  })
}
