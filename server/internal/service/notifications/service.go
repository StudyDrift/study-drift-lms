package notifications

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/repos/emaildigest"
	"github.com/lextures/lextures/server/internal/repos/emailjobs"
	"github.com/lextures/lextures/server/internal/repos/notificationprefs"
	"github.com/lextures/lextures/server/internal/repos/orgbranding"
	"github.com/lextures/lextures/server/internal/repos/user"
)

// Service enqueues transactional notification emails (plan 6.2).
type Service struct {
	Pool   *pgxpool.Pool
	Config config.Config
}

func (s *Service) enabled() bool {
	return s.Config.EmailNotificationsEnabled
}

func (s *Service) publicWebOrigin() string {
	o := strings.TrimRight(strings.TrimSpace(s.Config.PublicWebOrigin), "/")
	if o == "" {
		o = "http://localhost:5173"
	}
	return o
}

// UnsubscribeURL builds a signed one-click unsubscribe link for an event type.
func (s *Service) UnsubscribeURL(userID uuid.UUID, eventType string) string {
	tok := UnsubscribeToken(s.Config.JWTSecret, userID.String(), eventType)
	return fmt.Sprintf("%s/unsubscribe?token=%s", s.publicWebOrigin(), tok)
}

func (s *Service) brandingForOrg(ctx context.Context, orgID *uuid.UUID) *orgbranding.Row {
	if orgID == nil || s.Pool == nil {
		return nil
	}
	row, err := orgbranding.Get(ctx, s.Pool, *orgID)
	if err != nil || row == nil {
		return nil
	}
	return row
}

// EnqueueEmail checks preferences and queues an email or digest item.
func (s *Service) EnqueueEmail(ctx context.Context, recipientID uuid.UUID, eventType, template string, vars map[string]string, orgID *uuid.UUID) error {
	if !s.enabled() || s.Pool == nil {
		return nil
	}
	pref, err := notificationprefs.Get(ctx, s.Pool, recipientID, eventType)
	if err != nil {
		return err
	}
	if !pref.EmailEnabled || pref.DigestMode == "off" {
		return nil
	}
	if vars == nil {
		vars = map[string]string{}
	}
	vars["unsubscribeUrl"] = s.UnsubscribeURL(recipientID, eventType)

	if pref.DigestMode == "daily" {
		line := vars["digestLine"]
		if line == "" {
			line = vars["subject"]
		}
		return emaildigest.Append(ctx, s.Pool, recipientID, eventType, line, vars["link"])
	}

	subject := vars["subject"]
	if subject == "" {
		subject = defaultSubject(eventType)
	}
	_, err = emailjobs.Enqueue(ctx, s.Pool, recipientID, eventType, subject, template, vars)
	return err
}

func defaultSubject(eventType string) string {
	switch eventType {
	case EventGradePosted:
		return "Grade posted"
	case EventAssignmentCreated:
		return "New assignment"
	case EventDiscussionReply:
		return "New discussion reply"
	case EventPasswordReset:
		return "Reset your password"
	default:
		return "Notification from StudyDrift"
	}
}

// NotifyGradePosted emails students when grades are released.
func (s *Service) NotifyGradePosted(ctx context.Context, studentUserID uuid.UUID, courseName, assignmentName, courseCode string, orgID *uuid.UUID) {
	if !s.enabled() {
		return
	}
	link := fmt.Sprintf("%s/courses/%s/grades", s.publicWebOrigin(), courseCode)
	vars := map[string]string{
		"courseName":     courseName,
		"assignmentName": assignmentName,
		"link":           link,
		"digestLine":     fmt.Sprintf("Grade posted for %s in %s", assignmentName, courseName),
	}
	if err := s.EnqueueEmail(ctx, studentUserID, EventGradePosted, "grade_posted", vars, orgID); err != nil {
		slog.Warn("notifications.grade_posted", "err", err, "user_id", studentUserID)
	}
}

// NotifyAssignmentCreated emails enrolled students about a new assignment.
func (s *Service) NotifyAssignmentCreated(ctx context.Context, studentIDs []uuid.UUID, courseName, assignmentName, courseCode string, orgID *uuid.UUID) {
	if !s.enabled() {
		return
	}
	link := fmt.Sprintf("%s/courses/%s", s.publicWebOrigin(), courseCode)
	vars := map[string]string{
		"courseName":     courseName,
		"assignmentName": assignmentName,
		"link":           link,
		"digestLine":     fmt.Sprintf("New assignment %s in %s", assignmentName, courseName),
	}
	for _, sid := range studentIDs {
		if err := s.EnqueueEmail(ctx, sid, EventAssignmentCreated, "assignment_created", vars, orgID); err != nil {
			slog.Warn("notifications.assignment_created", "err", err, "user_id", sid)
		}
	}
}

// NotifyDiscussionReply emails thread participants except the author.
func (s *Service) NotifyDiscussionReply(ctx context.Context, recipientIDs []uuid.UUID, courseName, threadTitle, courseCode, threadID string, orgID *uuid.UUID) {
	if !s.enabled() {
		return
	}
	link := fmt.Sprintf("%s/courses/%s/discussions/threads/%s", s.publicWebOrigin(), courseCode, threadID)
	vars := map[string]string{
		"courseName":  courseName,
		"threadTitle": threadTitle,
		"link":        link,
		"digestLine":  fmt.Sprintf("New reply in %s (%s)", threadTitle, courseName),
	}
	for _, rid := range recipientIDs {
		if err := s.EnqueueEmail(ctx, rid, EventDiscussionReply, "discussion_reply", vars, orgID); err != nil {
			slog.Warn("notifications.discussion_reply", "err", err, "user_id", rid)
		}
	}
}

// EnqueuePasswordReset queues password reset email via the notification pipeline.
func (s *Service) EnqueuePasswordReset(ctx context.Context, userID uuid.UUID, email, resetURL string, orgID *uuid.UUID) error {
	if s.Pool == nil {
		return nil
	}
	vars := map[string]string{
		"resetUrl": resetURL,
		"subject":  "Reset your StudyDrift password",
	}
	// Password reset always sends when SMTP configured, even if feature flag off — use direct path when disabled.
	if !s.enabled() {
		return nil
	}
	pref, err := notificationprefs.Get(ctx, s.Pool, userID, EventPasswordReset)
	if err != nil {
		return err
	}
	if !pref.EmailEnabled {
		return nil
	}
	_, err = emailjobs.Enqueue(ctx, s.Pool, userID, EventPasswordReset, vars["subject"], "password_reset", vars)
	return err
}

// RecipientEmail loads a user's email for delivery.
func RecipientEmail(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (string, error) {
	row, err := user.FindByID(ctx, pool, userID)
	if err != nil {
		return "", err
	}
	if row == nil {
		return "", fmt.Errorf("user not found")
	}
	return row.Email, nil
}
