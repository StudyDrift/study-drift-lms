package httpserver

import (
	"context"

	"github.com/google/uuid"

	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/discussions"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/service/notifications"
)

func (d Deps) notificationsService() *notifications.Service {
	return &notifications.Service{Pool: d.Pool, Config: d.effectiveConfig()}
}

func (d Deps) emitDiscussionReplyNotifications(ctx context.Context, courseID uuid.UUID, courseCode string, threadID, authorID uuid.UUID, threadTitle string) {
	ns := d.notificationsService()
	if !ns.Config.EmailNotificationsEnabled {
		return
	}
	participants, err := discussions.ListThreadParticipantIDs(ctx, d.Pool, threadID, authorID)
	if err != nil || len(participants) == 0 {
		return
	}
	pub, _ := course.GetPublicByCourseCode(ctx, d.Pool, courseCode)
	courseName := courseCode
	if pub != nil && pub.Title != "" {
		courseName = pub.Title
	}
	var orgID *uuid.UUID
	if oid, err := course.CourseOrgID(ctx, d.Pool, courseCode); err == nil && oid != nil {
		orgID = oid
	}
	ns.NotifyDiscussionReply(ctx, participants, courseName, threadTitle, courseCode, threadID.String(), orgID)
}

func (d Deps) emitAssignmentCreatedNotifications(ctx context.Context, courseCode, assignmentTitle string) {
	ns := d.notificationsService()
	if !ns.Config.EmailNotificationsEnabled {
		return
	}
	students, err := enrollment.ListStudentUsersForCourseCode(ctx, d.Pool, courseCode, nil)
	if err != nil || len(students) == 0 {
		return
	}
	pub, _ := course.GetPublicByCourseCode(ctx, d.Pool, courseCode)
	courseName := courseCode
	if pub != nil && pub.Title != "" {
		courseName = pub.Title
	}
	var orgID *uuid.UUID
	if oid, err := course.CourseOrgID(ctx, d.Pool, courseCode); err == nil && oid != nil {
		orgID = oid
	}
	ids := make([]uuid.UUID, 0, len(students))
	for _, s := range students {
		ids = append(ids, s.UserID)
	}
	ns.NotifyAssignmentCreated(ctx, ids, courseName, assignmentTitle, courseCode, orgID)
}
