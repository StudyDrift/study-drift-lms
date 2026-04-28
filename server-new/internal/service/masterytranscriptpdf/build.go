// SBG mastery transcript export (port of server/src/services/mastery_transcript_pdf.rs).
package masterytranscriptpdf

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/jung-kurt/gofpdf"
)

// Line is one standards row: Code (optional) and Label.
type Line struct {
	Code  string
	Label string
}

// BuildMasteryTranscriptPDF renders a one-page PDF listing the course, student, and one line per standard.
func BuildMasteryTranscriptPDF(courseTitle, courseCode, studentLabel string, lines []Line) ([]byte, error) {
	if strings.TrimSpace(courseTitle) == "" {
		return nil, fmt.Errorf("course title is required")
	}
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()
	pdf.SetFont("Helvetica", "B", 14)
	const left = 20.0
	y := 20.0
	pdf.SetXY(left, y)
	pdf.Cell(0, 8, "Mastery transcript \u2014 "+courseTitle)
	y += 8
	pdf.SetFont("Helvetica", "", 10)
	pdf.SetXY(left, y)
	pdf.Cell(0, 6, fmt.Sprintf("Course: %s  |  Learner: %s", courseCode, studentLabel))
	y += 12
	pdf.SetFont("Helvetica", "", 9)
	for _, row := range lines {
		y += 6
		if y > 270 {
			break
		}
		var line string
		if strings.TrimSpace(row.Code) == "" {
			line = row.Label
		} else {
			line = row.Code + " \u2014 " + row.Label
		}
		if len(line) > 120 {
			line = line[:120] + "…"
		}
		pdf.SetXY(left, y)
		pdf.Cell(0, 5, line)
	}
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
