package notifications

import "github.com/lextures/lextures/server/internal/notificationevents"

const (
	EventGradePosted           = notificationevents.GradePosted
	EventAssignmentCreated     = notificationevents.AssignmentCreated
	EventDiscussionReply       = notificationevents.DiscussionReply
	EventCourseAnnouncement    = notificationevents.CourseAnnouncement
	EventSubmissionReceived    = notificationevents.SubmissionReceived
	EventAssignmentDueReminder = notificationevents.AssignmentDueReminder
	EventPasswordReset         = notificationevents.PasswordReset
	EventWelcomeInvite         = notificationevents.WelcomeInvite
	EventMeetingReminder       = notificationevents.MeetingReminder
)

// AllEventTypes re-exports the canonical event list for callers outside this package.
var AllEventTypes = notificationevents.All
