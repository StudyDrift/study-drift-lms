// Package gradingdisplay maps stored points to display strings (Rust `services/grading/conversion` subset).
package gradingdisplay

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

const eps = 1e-6

// Kind is how a column or course displays grades.
type Kind int8

const (
	Points Kind = iota
	Percentage
	Letter
	Gpa
	PassFail
	CompleteIncomplete
)

// ParseKind matches Rust `DisplayGradingKind::from_str`.
func ParseKind(s string) (Kind, bool) {
	switch strings.TrimSpace(s) {
	case "points":
		return Points, true
	case "percentage":
		return Percentage, true
	case "letter":
		return Letter, true
	case "gpa":
		return Gpa, true
	case "pass_fail":
		return PassFail, true
	case "complete_incomplete":
		return CompleteIncomplete, true
	default:
		return Points, false
	}
}

func (k Kind) String() string {
	switch k {
	case Points:
		return "points"
	case Percentage:
		return "percentage"
	case Letter:
		return "letter"
	case Gpa:
		return "gpa"
	case PassFail:
		return "pass_fail"
	case CompleteIncomplete:
		return "complete_incomplete"
	default:
		return "points"
	}
}

// LetterTier is one band in a letter / GPA scale.
type LetterTier struct {
	Label  string
	MinPct float64
	Gpa    *float64
}

// ParsedScale is validated scale data for `ToDisplayGrade`.
type ParsedScale struct {
	Kind           Kind
	LetterTiers    []LetterTier // sorted by min_pct descending (highest floor first)
	PassMinPct     float64
	CompleteMinPct float64
}

// ParseScale validates and parses `scale_json` (Rust `parse_scale`).
func ParseScale(kind Kind, scaleJSON *json.RawMessage) (ParsedScale, error) {
	p := ParsedScale{Kind: kind, PassMinPct: 60, CompleteMinPct: 50}
	switch kind {
	case Points, Percentage:
		return p, nil
	case Letter, Gpa:
		if scaleJSON == nil || len(*scaleJSON) == 0 {
			return ParsedScale{}, errors.New("letter and GPA schemes need scaleJson")
		}
		var arr []struct {
			Label  string   `json:"label"`
			MinPct float64  `json:"min_pct"`
			Gpa    *float64 `json:"gpa"`
		}
		if err := json.Unmarshal(*scaleJSON, &arr); err != nil {
			return ParsedScale{}, err
		}
		if len(arr) == 0 {
			return ParsedScale{}, errors.New("letter scale must include at least one band")
		}
		var tiers []LetterTier
		for i := range arr {
			label := strings.TrimSpace(arr[i].Label)
			if label == "" {
				return ParsedScale{}, fmt.Errorf("band %d: empty label", i)
			}
			m := arr[i].MinPct
			if math.IsNaN(m) || math.IsInf(m, 0) || m < 0 || m > 100+eps {
				return ParsedScale{}, fmt.Errorf("band %d: min_pct out of range", i)
			}
			tiers = append(tiers, LetterTier{Label: label, MinPct: m, Gpa: arr[i].Gpa})
		}
		sort.Slice(tiers, func(i, j int) bool { return tiers[i].MinPct > tiers[j].MinPct })
		asc := append([]LetterTier(nil), tiers...)
		sort.Slice(asc, func(i, j int) bool { return asc[i].MinPct < asc[j].MinPct })
		if math.Abs(asc[0].MinPct) > eps {
			return ParsedScale{}, errors.New("lowest letter band must start at min_pct 0")
		}
		for w := 1; w < len(asc); w++ {
			if asc[w].MinPct <= asc[w-1].MinPct+eps {
				return ParsedScale{}, errors.New("letter bands must have strictly increasing min_pct")
			}
		}
		p.LetterTiers = tiers
		return p, nil
	case PassFail:
		if scaleJSON == nil {
			return p, nil
		}
		var o struct {
			PassMin *float64 `json:"pass_min_pct"`
		}
		_ = json.Unmarshal(*scaleJSON, &o)
		if o.PassMin != nil {
			if math.IsNaN(*o.PassMin) || math.IsInf(*o.PassMin, 0) || *o.PassMin < 0 || *o.PassMin > 100+eps {
				return ParsedScale{}, errors.New("pass_min_pct out of range")
			}
			p.PassMinPct = *o.PassMin
		}
		return p, nil
	case CompleteIncomplete:
		if scaleJSON == nil {
			return p, nil
		}
		var o struct {
			CompleteMin *float64 `json:"complete_min_pct"`
		}
		_ = json.Unmarshal(*scaleJSON, &o)
		if o.CompleteMin != nil {
			if math.IsNaN(*o.CompleteMin) || math.IsInf(*o.CompleteMin, 0) || *o.CompleteMin < 0 || *o.CompleteMin > 100+eps {
				return ParsedScale{}, errors.New("complete_min_pct out of range")
			}
			p.CompleteMinPct = *o.CompleteMin
		}
		return p, nil
	default:
		return p, nil
	}
}

// ResolveEffective picks column display kind (Rust `resolve_effective`).
func ResolveEffective(courseKind *Kind, assignmentOverride *string) Kind {
	if assignmentOverride != nil {
		if t := strings.TrimSpace(*assignmentOverride); t != "" {
			if k, ok := ParseKind(t); ok {
				return k
			}
		}
	}
	if courseKind != nil {
		return *courseKind
	}
	return Points
}

// ToDisplayGrade maps points to a display string (Rust `to_display_grade`).
func ToDisplayGrade(points float64, maxPoints *int, courseScale *ParsedScale, effective Kind) string {
	if isBadFloat(points) || points < 0 {
		return ""
	}
	var maxF *float64
	if maxPoints != nil && *maxPoints > 0 {
		m := float64(*maxPoints)
		maxF = &m
	}
	return toDisplayWithMax(points, maxF, courseScale, effective)
}

func toDisplayWithMax(points float64, max *float64, courseScale *ParsedScale, effective Kind) string {
	if isBadFloat(points) || points < 0 {
		return ""
	}
	maxF := 0.0
	hasMax := false
	if max != nil && *max > eps {
		maxF = *max
		hasMax = true
	}
	switch effective {
	case Points:
		return formatPoints(points)
	case Percentage:
		if !hasMax {
			return formatPoints(points)
		}
		return formatPct(pctFromPoints(points, maxF)) + "%"
	case Letter, Gpa:
		if !hasMax {
			return formatPoints(points)
		}
		if courseScale == nil {
			return formatPoints(points)
		}
		pct := pctFromPoints(points, maxF)
		for i := range courseScale.LetterTiers {
			t := &courseScale.LetterTiers[i]
			upper := tierUpperPct(courseScale.LetterTiers, i)
			if pct+eps >= t.MinPct && pct <= upper+eps {
				if effective == Gpa && t.Gpa != nil {
					return formatGpa(*t.Gpa)
				}
				return t.Label
			}
		}
		if n := len(courseScale.LetterTiers); n > 0 {
			return courseScale.LetterTiers[n-1].Label
		}
		return formatPoints(points)
	case PassFail:
		if !hasMax {
			if points >= eps {
				return "Pass"
			}
			return "Fail"
		}
		if courseScale == nil {
			if points >= eps {
				return "Pass"
			}
			return "Fail"
		}
		pct := pctFromPoints(points, maxF)
		if pct+eps >= courseScale.PassMinPct {
			return "Pass"
		}
		return "Fail"
	case CompleteIncomplete:
		if !hasMax {
			if points >= eps {
				return "Complete"
			}
			return "Incomplete"
		}
		if courseScale == nil {
			if points >= eps {
				return "Complete"
			}
			return "Incomplete"
		}
		pct := pctFromPoints(points, maxF)
		if pct+eps >= courseScale.CompleteMinPct {
			return "Complete"
		}
		return "Incomplete"
	default:
		return formatPoints(points)
	}
}

func formatGpa(g float64) string {
	if isBadFloat(g) || g < 0 {
		return ""
	}
	return strings.TrimRight(strings.TrimRight(strconv.FormatFloat(g, 'f', 2, 64), "0"), ".")
}

func tierUpperPct(tiersSortedDesc []LetterTier, idx int) float64 {
	if idx == 0 {
		return 100.0
	}
	return tiersSortedDesc[idx-1].MinPct
}

func pctFromPoints(points, max float64) float64 {
	if max <= eps {
		return 0
	}
	return math.Round((points/max)*100.0*1000) / 1000
}

func formatPoints(points float64) string {
	if isBadFloat(points) || points < 0 {
		return ""
	}
	i := int64(points)
	if math.Abs(float64(i)-points) < eps {
		return strconv.FormatInt(i, 10)
	}
	return trimTrailingZeros(strconv.FormatFloat(points, 'f', 4, 64))
}

func formatPct(p float64) string {
	if isBadFloat(p) {
		return ""
	}
	return trimTrailingZeros(strconv.FormatFloat(p, 'f', 2, 64))
}

func trimTrailingZeros(s string) string {
	if !strings.Contains(s, ".") {
		return s
	}
	for len(s) > 0 && (s[len(s)-1] == '0' || s[len(s)-1] == '.') {
		s = s[:len(s)-1]
	}
	return s
}

func isBadFloat(f float64) bool { return math.IsNaN(f) || math.IsInf(f, 0) }
