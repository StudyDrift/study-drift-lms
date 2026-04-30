package accommodations

import (
	"database/sql"
	"strings"
	"time"
)

// AccommodationSummaryPublic is returned for an enrollment (instructor / roster read).
type AccommodationSummaryPublic struct {
	HasAccommodation bool     `json:"hasAccommodation"`
	Flags            []string `json:"flags"`
}

// UserSearchHit is a learner from /api/v1/accommodations/users.
type UserSearchHit struct {
	ID          string  `json:"id"`
	Email       string  `json:"email"`
	DisplayName *string `json:"displayName,omitempty"`
	FirstName   *string `json:"firstName,omitempty"`
	LastName    *string `json:"lastName,omitempty"`
	Sid         *string `json:"sid,omitempty"`
}

// UserSearchResponse wraps search hits.
type UserSearchResponse struct {
	Users []UserSearchHit `json:"users"`
}

// StudentAccommodation is the full public row for a learner.
type StudentAccommodation struct {
	ID                    string  `json:"id"`
	UserID                string  `json:"userId"`
	CourseID              *string `json:"courseId,omitempty"`
	CourseCode            *string `json:"courseCode,omitempty"`
	TimeMultiplier        float64 `json:"timeMultiplier"`
	ExtraAttempts         int32   `json:"extraAttempts"`
	HintsAlwaysEnabled    bool    `json:"hintsAlwaysEnabled"`
	ReducedDistraction    bool    `json:"reducedDistractionMode"`
	AlternativeFormat     *string `json:"alternativeFormat,omitempty"`
	EffectiveFrom         *string `json:"effectiveFrom,omitempty"`
	EffectiveUntil        *string `json:"effectiveUntil,omitempty"`
	CreatedBy             string  `json:"createdBy"`
	UpdatedBy             *string `json:"updatedBy,omitempty"`
	CreatedAt             string  `json:"createdAt"`
	UpdatedAt             string  `json:"updatedAt"`
}

// CreateRequest is POST /api/v1/users/{id}/accommodations.
type CreateRequest struct {
	CourseCode         *string  `json:"courseCode"`
	TimeMultiplier     *float64 `json:"timeMultiplier"`
	ExtraAttempts      *int32   `json:"extraAttempts"`
	HintsAlwaysEnabled *bool    `json:"hintsAlwaysEnabled"`
	ReducedDistraction *bool    `json:"reducedDistractionMode"`
	AlternativeFormat  *string  `json:"alternativeFormat"`
	EffectiveFrom      *string  `json:"effectiveFrom"`
	EffectiveUntil     *string  `json:"effectiveUntil"`
}

// UpdateRequest is PUT to an accommodation row.
type UpdateRequest struct {
	TimeMultiplier     float64 `json:"timeMultiplier"`
	ExtraAttempts      int32   `json:"extraAttempts"`
	HintsAlwaysEnabled bool    `json:"hintsAlwaysEnabled"`
	ReducedDistraction bool    `json:"reducedDistractionMode"`
	AlternativeFormat  *string `json:"alternativeFormat"`
	EffectiveFrom    *string `json:"effectiveFrom"`
	EffectiveUntil     *string `json:"effectiveUntil"`
}

// YYYYMMDDFromNull maps a SQL DATE to an API YYYY-MM-DD string.
func YYYYMMDDFromNull(nt sql.NullTime) *string {
	if !nt.Valid {
		return nil
	}
	s := nt.Time.UTC().Format("2006-01-02")
	return &s
}

// MyResponse is GET /api/v1/me/accommodations.
type MyResponse struct {
	Accommodations []MyEntry `json:"accommodations"`
}

// MyEntry is one active (by effective dates) row for the signed-in user.
type MyEntry struct {
	CourseCode                 *string `json:"courseCode,omitempty"`
	HasExtendedTime            bool    `json:"hasExtendedTime"`
	HasExtraAttempts           bool    `json:"hasExtraAttempts"`
	HintsAlwaysAvailable       bool    `json:"hintsAlwaysAvailable"`
	ReducedDistraction         bool    `json:"reducedDistractionRecommended"`
	EffectiveFrom              *string `json:"effectiveFrom,omitempty"`
	EffectiveUntil             *string `json:"effectiveUntil,omitempty"`
}

// ParseDate parses YYYY-MM-DD; empty or whitespace is nil, nil error.
func ParseDate(s *string) (*time.Time, error) {
	if s == nil {
		return nil, nil
	}
	v := strings.TrimSpace(*s)
	if v == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", v)
	if err != nil {
		return nil, err
	}
	utc := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	return &utc, nil
}
