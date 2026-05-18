package notificationevents

// Event types for notification preferences and email jobs (plan 6.2).
const (
	GradePosted            = "grade_posted"
	AssignmentCreated      = "assignment_created"
	DiscussionReply        = "discussion_reply"
	CourseAnnouncement     = "course_announcement"
	SubmissionReceived     = "submission_received"
	AssignmentDueReminder  = "assignment_due_reminder"
	PasswordReset          = "password_reset"
	WelcomeInvite          = "welcome_invite"
)

// All is the canonical list for defaults and UI.
var All = []string{
	GradePosted,
	AssignmentCreated,
	DiscussionReply,
	CourseAnnouncement,
	SubmissionReceived,
	AssignmentDueReminder,
	PasswordReset,
	WelcomeInvite,
}
