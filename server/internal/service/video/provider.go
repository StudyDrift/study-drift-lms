// Package video provides adapters for video conferencing providers (plan 6.4).
package video

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// MeetingParams are the inputs for creating a meeting room.
type MeetingParams struct {
	MeetingID      uuid.UUID
	CourseCode     string
	Title          string
	ScheduledStart *time.Time
}

// MeetingURLs holds the student join URL and (optional) instructor host URL.
type MeetingURLs struct {
	JoinURL string
	HostURL string
}

// Provider is the interface all video adapters must implement.
type Provider interface {
	// Name returns the provider key stored in the DB (e.g. "jitsi").
	Name() string
	// CreateMeeting allocates a room and returns join/host URLs.
	CreateMeeting(ctx context.Context, p MeetingParams) (*MeetingURLs, error)
}
