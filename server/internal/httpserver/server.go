package httpserver

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/auth/hibp"
	"github.com/lextures/lextures/server/internal/commevents"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/lti"
	"github.com/lextures/lextures/server/internal/notifevents"
	"github.com/lextures/lextures/server/internal/openapi"
	"github.com/lextures/lextures/server/internal/platformstate"
	"github.com/lextures/lextures/server/internal/repos/orgbranding"
	"github.com/lextures/lextures/server/internal/service/cleverauth"
	"github.com/lextures/lextures/server/internal/service/oidcauth"
	"github.com/lextures/lextures/server/internal/service/openrouter"
)

// Deps is the minimal set of server dependencies. Expand with auth, LTI, etc. during the migration.
type Deps struct {
	Pool      *pgxpool.Pool
	Ready     ReadyChecker
	JWTSigner *auth.JWTSigner
	// Config is the environment-only configuration (used with DB overrides in Platform).
	Config   config.Config
	Platform *platformstate.Platform
	OIDC     *oidcauth.Service
	Clever   *cleverauth.Service
	Comm     *commevents.Hub
	Lti      *lti.Runtime
	// BrandingResolver caches hostname→org branding (plan 5.7). Optional; nil builds an ephemeral resolver per request group via brandingResolver().
	BrandingResolver *orgbranding.Resolver
	// PasswordChecker overrides HIBP / password breach checks (tests). When nil, a production checker is built from Pool.
	PasswordChecker hibp.Checker
	// NotifHub broadcasts SSE signals for real-time in-app notification bell updates (plan 6.3). Optional.
	NotifHub *notifevents.Hub
}

func (d Deps) effectiveConfig() config.Config {
	if d.Platform != nil {
		return d.Platform.Config()
	}
	return d.Config
}

func (d Deps) openRouterClient() *openrouter.Client {
	if d.Platform != nil {
		return d.Platform.OpenRouter()
	}
	return nil
}

// NewHandler builds the HTTP API (routes only; does not start listening).
func NewHandler(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(corsAll)
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	ready := d.Ready
	if ready == nil {
		ready = defaultReady(d.Pool)
	}
	r.Get("/api/openapi.json", openapi.ServeOpenAPI)
	r.Get("/api/docs", openapi.ServeDocs)
	r.Get("/health", handleHealth())
	r.Get("/health/ready", handleReady(ready))
	r.Post("/api/v1/public/onboarding/track", d.handlePublicOnboardingTrack())
	r.Get("/api/v1/public/branding/resolve", d.handlePublicBrandingResolve())
	r.Get("/api/v1/public/org-branding/{orgId}/{asset}", d.handlePublicOrgBrandAsset())
	d.registerSAMLBrowserRoutes(r)
	d.registerLTIHTTPRoutes(r)
	r.Get("/auth/oidc/{provider}/login", d.handleOIDCLogin())
	r.Get("/auth/oidc/{provider}/callback", d.handleOIDCCallback())
	r.Get("/auth/clever/login", d.handleCleverLogin())
	r.Get("/auth/clever/callback", d.handleCleverCallback())
	r.Post("/api/v1/auth/login", d.handleLogin())
	r.Post("/api/v1/auth/mfa/totp/enrol", d.handleMFATOTPEnrol())
	r.Post("/api/v1/auth/mfa/totp/verify-enrol", d.handleMFATOTPVerifyEnrol())
	r.Post("/api/v1/auth/mfa/totp/challenge", d.handleMFATOTPChallenge())
	r.Post("/api/v1/auth/mfa/backup/challenge", d.handleMFABackupChallenge())
	r.Post("/api/v1/auth/mfa/webauthn/register/begin", d.handleMFAWebAuthnRegisterBegin())
	r.Post("/api/v1/auth/mfa/webauthn/register/complete", d.handleMFAWebAuthnRegisterComplete())
	r.Post("/api/v1/auth/mfa/webauthn/authenticate/begin", d.handleMFAWebAuthnAuthBegin())
	r.Post("/api/v1/auth/mfa/webauthn/authenticate/complete", d.handleMFAWebAuthnAuthComplete())
	r.Post("/api/v1/auth/mfa/setup/complete", d.handleMFASetupComplete())
	r.Get("/api/v1/auth/password-policy", d.handleGetPublicPasswordPolicy())
	r.Post("/api/v1/auth/signup", d.handleSignup())
	r.Post("/api/v1/auth/forgot-password", d.handleForgotPassword())
	r.Post("/api/v1/auth/magic-link/request", d.handleMagicLinkRequest())
	r.Get("/api/v1/auth/magic-link/consume", d.handleMagicLinkConsume())
	r.Post("/api/v1/auth/magic-link/consume", d.handleMagicLinkConsume())
	r.Post("/api/v1/auth/cli/request", d.handleCLIAuthRequest())
	r.Get("/api/v1/auth/cli/poll", d.handleCLIAuthPoll())
	r.Post("/api/v1/auth/cli/approve", d.handleCLIAuthApprove())
	r.Post("/api/v1/auth/reset-password", d.handleResetPassword())
	r.Post("/api/v1/auth/refresh", d.handleAuthRefresh())
	r.Post("/api/v1/auth/logout", d.handleAuthLogout())
	r.Post("/api/v1/auth/logout-all", d.handleAuthLogoutAll())
	r.Post("/api/v1/auth/change-password", d.handleChangePassword())
	r.Get("/api/v1/auth/saml/status", d.handleSAMLStatus())
	r.Get("/api/v1/auth/oidc/status", d.handleOIDCStatus())
	r.Post("/api/v1/auth/oidc/link", d.handleOIDCLink())
	r.Get("/api/v1/me/mfa", d.handleListMyMFA())
	r.Delete("/api/v1/me/mfa/{id}", d.handleDeleteMyMFA())
	r.Get("/api/v1/me/permissions", d.handleMyPermissions())
	r.Get("/api/v1/me/org-role-capabilities", d.handleMeOrgRoleCapabilities())
	r.Get("/api/v1/me/notification-preferences", d.handleGetMyNotificationPreferences())
	r.Put("/api/v1/me/notification-preferences", d.handlePutMyNotificationPreferences())
	r.Get("/api/unsubscribe", d.handleUnsubscribe())
	// Push notifications (plan 6.3)
	r.Get("/api/v1/push/vapid-public-key", d.handleGetVAPIDPublicKey())
	r.Post("/api/v1/me/push-subscriptions", d.handlePostMyPushSubscription())
	r.Delete("/api/v1/me/push-subscriptions/{id}", d.handleDeleteMyPushSubscription())
	r.Get("/api/v1/me/notifications", d.handleGetMyNotifications())
	r.Post("/api/v1/me/notifications/{id}/read", d.handleMarkNotificationRead())
	r.Post("/api/v1/me/notifications/read-all", d.handleMarkAllNotificationsRead())
	r.Get("/api/v1/me/notifications/sse", d.handleNotificationsSSE())
	r.Get("/api/v1/me/sessions", d.handleListMySessions())
	r.Delete("/api/v1/me/sessions", d.handleDeleteMyOtherSessions())
	r.Delete("/api/v1/me/sessions/{id}", d.handleDeleteMySession())
	r.Get("/api/v1/parent/children", d.handleParentChildren())
	r.Get("/api/v1/parent/students/{sid}/courses", d.handleParentStudentCourses())
	r.Get("/api/v1/parent/students/{sid}/grades", d.handleParentStudentGrades())
	r.Get("/api/v1/parent/students/{sid}/assignments", d.handleParentStudentAssignments())
	r.Get("/api/v1/courses", d.handleListCourses())
	r.Post("/api/v1/courses", d.handleCreateCourse())
	r.Get("/api/v1/orgs/{orgId}/courses", d.handleOrgCoursesCatalog())
	r.Get("/api/v1/orgs/{orgId}/role-grants", d.handleOrgRoleGrantsCollection())
	r.Post("/api/v1/orgs/{orgId}/role-grants", d.handleOrgRoleGrantsCollection())
	r.Delete("/api/v1/orgs/{orgId}/role-grants/{grantId}", d.handleOrgRoleGrantDelete())
	r.Get("/api/v1/orgs/{orgId}/parent-links", d.handleOrgParentLinksCollection())
	r.Post("/api/v1/orgs/{orgId}/parent-links", d.handleOrgParentLinksCollection())
	r.Post("/api/v1/orgs/{orgId}/parent-links/bulk", d.handleOrgParentLinksBulk())
	r.Delete("/api/v1/orgs/{orgId}/parent-links/{lid}", d.handleOrgParentLinkDelete())
	r.Get("/api/v1/orgs/{orgId}/terms", d.handleOrgTermsRead())
	r.Post("/api/v1/orgs/{orgId}/terms", d.handleOrgTermsPost())
	r.Patch("/api/v1/orgs/{orgId}/terms/{tid}", d.handleOrgTermPatch())
	r.Delete("/api/v1/orgs/{orgId}/terms/{tid}", d.handleOrgTermDelete())
	r.Get("/api/v1/orgs/{orgId}/cross-list-groups", d.handleOrgCrossListGroupsGet())
	r.Post("/api/v1/orgs/{orgId}/cross-list-groups", d.handleOrgCrossListGroupsPost())
	r.Post("/api/v1/orgs/{orgId}/cross-list-groups/{gid}/members", d.handleOrgCrossListMembersPost())
	r.Delete("/api/v1/orgs/{orgId}/cross-list-groups/{gid}/members/{sid}", d.handleOrgCrossListMemberDelete())
	r.Get("/api/v1/orgs/{orgId}/branding", d.handleOrgBrandingItem())
	r.Put("/api/v1/orgs/{orgId}/branding", d.handleOrgBrandingItem())
	r.Post("/api/v1/orgs/{orgId}/branding/logo", d.handleOrgBrandingUpload("logo"))
	r.Post("/api/v1/orgs/{orgId}/branding/favicon", d.handleOrgBrandingUpload("favicon"))
	r.Get("/api/v1/orgs/{orgId}/users", d.handleOrgUsersSearch())
	r.Get("/api/v1/users", d.handleUsersList())
	r.Get("/api/v1/users/{user_id}", d.handleUsersGet())
	r.Post("/api/v1/users", d.handleUsersCreate())
	// Course calendar feed (iCalendar) — must register before /api/v1/courses/{course_code} static routes that might shadow.
	r.Get("/api/v1/courses/{course_code}/calendar.ics", d.handleCourseICS())
	// One Route for /api/v1/courses/{course_code} so GET and PATCH /markdown-theme share the same chi subtree
	// (registering a separate r.Get + r.Route on the same path prefix drops the leaf GET).
	r.Route("/api/v1/courses/{course_code}", func(cr chi.Router) {
		cr.Get("/", d.handleGetCourse())
		cr.Put("/", d.handlePutCourse())
		cr.Patch("/markdown-theme", d.handlePatchCourseMarkdownTheme())
	})
	r.Get("/api/v1/settings/account", d.handleGetSettingsAccount())
	r.Patch("/api/v1/settings/account", d.handlePatchSettingsAccount())
	// More specific /settings/ai/* first (before registerUnimplementedV1).
	r.Get("/api/v1/settings/ai/models", d.handleListAIModels())
	r.Get("/api/v1/settings/ai", d.handleGetSettingsAI())
	r.Put("/api/v1/settings/ai", d.handlePutSettingsAI())
	r.Get("/api/v1/settings/platform", d.handleGetPlatformSettings())
	r.Put("/api/v1/settings/platform", d.handlePutPlatformSettings())
	r.Get("/api/v1/settings/system-prompts", d.handleListSystemPrompts())
	r.Put("/api/v1/settings/system-prompts/{key}", d.handlePutSystemPrompt())
	r.Get("/api/v1/search", d.handleSearchIndex())
	r.Get("/api/v1/reports/learning-activity", d.handleLearningActivityReport())
	r.Post("/api/v1/courses/{course_code}/course-context", d.handlePostCourseContext())
	r.Get("/api/v1/me/oidc-identities", d.handleMyOIDCIdentities())
	r.Delete("/api/v1/me/oidc-identities/{id}", d.handleDeleteMyOIDCIdentity())
	r.Post("/api/v1/me/notebooks/query", d.handleNotebookQuery())
	// Learners: static paths before /{user_id} (must precede registerUnimplementedV1).
	r.Post("/api/v1/learners/concepts/batch", d.handleLearnersConceptsBatch())
	r.Get("/api/v1/learners/{user_id}/concepts", d.handleLearnerConceptsList())
	r.Get("/api/v1/learners/{user_id}/concepts/{concept_id}/theta", d.handleLearnerConceptTheta())
	r.Get("/api/v1/learners/{user_id}/concepts/{concept_id}", d.handleLearnerConceptOne())
	r.Get("/api/v1/learners/{user_id}/misconception-summary", d.handleLearnerMisconceptionSummary())
	r.Post("/api/v1/learners/{user_id}/review", d.handleLearnerReviewSubmit())
	// LMS dashboard: registered before registerUnimplementedV1 so /api/v1/learners/* is not 501.
	r.Get("/api/v1/learners/{user_id}/review-stats", d.handleLearnerReviewStats())
	r.Get("/api/v1/learners/{user_id}/review-queue", d.handleLearnerReviewQueue())
	r.Get("/api/v1/learners/{user_id}/recommendations", d.handleLearnerRecommendations())
	r.Get("/api/v1/courses/{course_code}/structure", d.handleCourseStructure())
	r.Get("/api/v1/courses/{course_code}/structure/archived", d.handleCourseStructureArchived())
	r.Post("/api/v1/courses/{course_code}/structure/modules", d.handleCreateCourseModule())
	r.Patch("/api/v1/courses/{course_code}/structure/modules/{module_id}", d.handlePatchCourseModule())
	r.Delete("/api/v1/courses/{course_code}/structure/modules/{module_id}", d.handleDeleteCourseModule())
	r.Get("/api/v1/courses/{course_code}/structure/modules/{module_id}/delete-preview", d.handleCourseModuleDeletePreview())
	r.Post("/api/v1/courses/{course_code}/structure/modules/{module_id}/headings", d.handleCreateModuleHeading())
	r.Post("/api/v1/courses/{course_code}/structure/modules/{module_id}/content-pages", d.handleCreateModuleContentPage())
	r.Get("/api/v1/courses/{course_code}/content-pages/{item_id}/markups", d.handleListContentPageMarkups())
	r.Post("/api/v1/courses/{course_code}/content-pages/{item_id}/markups", d.handleCreateContentPageMarkup())
	r.Delete("/api/v1/courses/{course_code}/content-pages/{item_id}/markups/{markup_id}", d.handleDeleteContentPageMarkup())
	r.Get("/api/v1/courses/{course_code}/content-pages/{item_id}", d.handleGetModuleContentPage())
	r.Patch("/api/v1/courses/{course_code}/content-pages/{item_id}", d.handlePatchModuleContentPage())
	r.Post("/api/v1/courses/{course_code}/structure/modules/{module_id}/assignments", d.handleCreateModuleAssignment())
	r.Post("/api/v1/courses/{course_code}/structure/modules/{module_id}/quizzes", d.handleCreateModuleQuiz())
	r.Post("/api/v1/courses/{course_code}/structure/modules/{module_id}/external-links", d.handleCreateModuleExternalLink())
	r.Post("/api/v1/courses/{course_code}/structure/modules/{module_id}/lti-links", d.handleCreateModuleLTILink())
	r.Get("/api/v1/courses/{course_code}/lti-external-tools", d.handleCourseLtiExternalTools())
	r.Get("/api/v1/courses/{course_code}/assignments/{item_id}", d.handleGetModuleAssignment())
	r.Patch("/api/v1/courses/{course_code}/assignments/{item_id}", d.handlePatchModuleAssignment())
	r.Get("/api/v1/courses/{course_code}/quizzes/{item_id}", d.handleGetModuleQuiz())
	r.Get("/api/v1/courses/{course_code}/quizzes/{item_id}/markups", d.handleListQuizMarkups())
	r.Post("/api/v1/courses/{course_code}/quizzes/{item_id}/markups", d.handleCreateQuizMarkup())
	r.Delete("/api/v1/courses/{course_code}/quizzes/{item_id}/markups/{markup_id}", d.handleDeleteQuizMarkup())
	r.Get("/api/v1/courses/{course_code}/assignments/{item_id}/markups", d.handleListAssignmentMarkups())
	r.Get("/api/v1/courses/{course_code}/grading", d.handleGetCourseGrading())
	r.Put("/api/v1/courses/{course_code}/grading", d.handlePutCourseGrading())
	r.Get("/api/v1/courses/{course_code}/grading-scheme", d.handleGetCourseGradingScheme())
	r.Put("/api/v1/courses/{course_code}/grading-scheme", d.handlePutCourseGradingScheme())
	r.Get("/api/v1/courses/{course_code}/course-files/{file_id}/content", d.handleGetCourseFileContent())
	r.Patch("/api/v1/courses/{course_code}/structure/items/{item_id}", d.handlePatchCourseStructureItem())
	r.Delete("/api/v1/courses/{course_code}/structure/items/{item_id}", d.handleDeleteCourseStructureItem())
	r.Get("/api/v1/courses/{course_code}/my-grades", d.handleCourseMyGrades())
	r.Get("/api/v1/courses/{course_code}/feed/channels", d.handleFeedChannels())
	r.Post("/api/v1/courses/{course_code}/feed/channels", d.handleCreateFeedChannel())
	r.Get("/api/v1/courses/{course_code}/feed/channels/{channel_id}/messages", d.handleFeedMessagesList())
	r.Post("/api/v1/courses/{course_code}/feed/channels/{channel_id}/messages", d.handleFeedMessagePost())
	r.Get("/api/v1/courses/{course_code}/feed/roster", d.handleFeedRoster())
	r.Get("/api/v1/courses/{course_code}/forums", d.handleDiscussionForumsList())
	r.Post("/api/v1/courses/{course_code}/forums", d.handleDiscussionForumsPost())
	r.Get("/api/v1/courses/{course_code}/forums/{forum_id}/threads", d.handleDiscussionThreadsList())
	r.Post("/api/v1/courses/{course_code}/forums/{forum_id}/threads", d.handleDiscussionThreadsPost())
	r.Get("/api/v1/courses/{course_code}/discussion-threads/{thread_id}", d.handleDiscussionThreadGet())
	r.Patch("/api/v1/courses/{course_code}/discussion-threads/{thread_id}", d.handleDiscussionThreadPatch())
	r.Get("/api/v1/courses/{course_code}/discussion-threads/{thread_id}/posts", d.handleDiscussionPostsList())
	r.Post("/api/v1/courses/{course_code}/discussion-threads/{thread_id}/posts", d.handleDiscussionPostsPost())
	r.Delete("/api/v1/courses/{course_code}/discussion-posts/{post_id}", d.handleDiscussionPostDelete())
	r.Post("/api/v1/courses/{course_code}/discussion-posts/{post_id}/upvote", d.handleDiscussionPostUpvote())
	r.Get("/api/v1/courses/{course_code}/gradebook/grid", d.handleGradebookGrid())
	r.Put("/api/v1/courses/{course_code}/gradebook/grades", d.handlePutCourseGradebookGrades())
	r.Post("/api/v1/courses/{course_code}/enrollments", d.handleCourseEnrollmentsPost())
	r.Post("/api/v1/courses/{course_code}/enrollments/self-as-student", d.handleCourseEnrollmentsSelfStudent())
	r.Patch("/api/v1/courses/{course_code}/enrollments/{enrollment_id}", d.handleCourseEnrollmentsPatch())
	r.Delete("/api/v1/courses/{course_code}/enrollments/{enrollment_id}", d.handleCourseEnrollmentsDelete())
	r.Get("/api/v1/courses/{course_code}/enrollments", d.handleCourseEnrollmentsList())
	r.Get("/api/v1/courses/{course_code}/sections", d.handleCourseSectionsCollection())
	r.Post("/api/v1/courses/{course_code}/sections", d.handleCourseSectionsCollection())
	r.Patch("/api/v1/courses/{course_code}/sections/{section_id}", d.handleCourseSectionItem())
	r.Delete("/api/v1/courses/{course_code}/sections/{section_id}", d.handleCourseSectionItem())
	r.Patch("/api/v1/enrollments/{enrollment_id}/section", d.handleEnrollmentSectionTransfer())
	r.Put("/api/v1/sections/{section_id}/overrides/{item_id}", d.handleSectionAssignmentOverride())
	r.Patch("/api/v1/courses/{course_code}/features", d.handlePatchCourseFeatures())
	r.Patch("/api/v1/courses/{course_code}/archived", d.handlePatchCourseArchived())
	r.Get("/api/v1/courses/{course_code}/outcomes", d.handleCourseOutcomesList())
	r.Post("/api/v1/courses/{course_code}/outcomes", d.handleCourseOutcomesPost())
	r.Patch("/api/v1/courses/{course_code}/outcomes/{outcome_id}", d.handleCourseOutcomePatch())
	r.Post("/api/v1/courses/{course_code}/outcomes/{outcome_id}/sub-outcomes", d.handleCourseOutcomeSubOutcomesPost())
	r.Post("/api/v1/courses/{course_code}/outcomes/{outcome_id}/links", d.handleCourseOutcomeLinksPost())
	r.Delete("/api/v1/courses/{course_code}/outcomes/{outcome_id}/links/{link_id}", d.handleCourseOutcomeLinkDelete())
	r.Delete("/api/v1/courses/{course_code}/outcomes/{outcome_id}", d.handleCourseOutcomeDelete())
	r.Post("/api/v1/courses/{course_code}/factory-reset", d.handlePostFactoryResetCourse())
	r.Patch("/api/v1/courses/{course_code}/blueprint", d.handlePatchCourseBlueprint())
	r.Get("/api/v1/courses/{course_code}/blueprint/children", d.handleGetCourseBlueprintChildren())
	r.Post("/api/v1/courses/{course_code}/blueprint/children", d.handlePostCourseBlueprintChild())
	r.Delete("/api/v1/courses/{course_code}/blueprint/children/{child_course_code}", d.handleDeleteCourseBlueprintChild())
	r.Post("/api/v1/courses/{course_code}/blueprint/push", d.handlePostCourseBlueprintPush())
	r.Get("/api/v1/courses/{course_code}/blueprint/sync-logs", d.handleGetCourseBlueprintSyncLogs())
	// Nesting keeps /syllabus/markups, /syllabus/accept, etc. on the same chi subtree so longer paths
	// are not lost to a mis-ordered /syllabus leaf.
	r.Route("/api/v1/courses/{course_code}/syllabus", func(s chi.Router) {
		s.Get("/acceptance-status", d.handleSyllabusAcceptanceStatus())
		s.Get("/markups", d.handleListSyllabusMarkups())
		s.Post("/markups", d.handleCreateSyllabusMarkup())
		s.Delete("/markups/{markup_id}", d.handleDeleteSyllabusMarkup())
		s.Post("/generate-section", d.handleGenerateSyllabusSection())
		s.Get("/", d.handleGetCourseSyllabus())
		s.Patch("/", d.handlePatchCourseSyllabus())
		s.Post("/accept", d.handlePostSyllabusAccept())
	})
	r.Get("/api/v1/courses/{course_code}/feed/ws", d.handleFeedWS())
	r.Get("/api/v1/courses/{course_code}/import/canvas/ws", d.handleCourseImportCanvasWS())
	r.Get("/api/v1/communication/messages", d.handleCommMessagesList())
	r.Post("/api/v1/communication/messages", d.handleCommMessagesPost())
	r.Get("/api/v1/communication/messages/{id}", d.handleCommMessageGet())
	r.Patch("/api/v1/communication/messages/{id}", d.handleCommMessagePatch())
	r.Get("/api/v1/communication/unread-count", d.handleCommUnread())
	r.Get("/api/v1/communication/ws", d.handleCommWS())
	r.Route("/api/v1", func(s chi.Router) { d.registerAccommodationRoutes(s) })
	r.Route("/api/v1/settings", func(s chi.Router) { d.registerSettingsRBAC(s) })
	r.Post("/api/v1/admin/jobs/irt-calibrate", d.handleAdminIRTCalibrate())
	r.Get("/api/v1/admin/orgs", d.handleAdminOrgsCollection())
	r.Post("/api/v1/admin/orgs", d.handleAdminOrgsCollection())
	r.Get("/api/v1/admin/orgs/{id}", d.handleAdminOrgItem())
	r.Patch("/api/v1/admin/orgs/{id}", d.handleAdminOrgItem())
	r.Delete("/api/v1/admin/orgs/{id}", d.handleAdminOrgItem())
	r.Get("/api/v1/admin/orgs/{orgId}/units", d.handleAdminOrgUnitsCollection())
	r.Post("/api/v1/admin/orgs/{orgId}/units", d.handleAdminOrgUnitsCollection())
	r.Get("/api/v1/admin/orgs/{orgId}/units/tree", d.handleAdminOrgUnitsTree())
	r.Get("/api/v1/admin/orgs/{orgId}/units/{unitId}", d.handleAdminOrgUnitItem())
	r.Patch("/api/v1/admin/orgs/{orgId}/units/{unitId}", d.handleAdminOrgUnitItem())
	r.Delete("/api/v1/admin/orgs/{orgId}/units/{unitId}", d.handleAdminOrgUnitItem())
	r.Post("/api/v1/admin/orgs/{orgId}/units/{unitId}/children", d.handleAdminOrgUnitChildren())
	r.Post("/api/v1/admin/orgs/{orgId}/units/{unitId}/org-unit-admins", d.handleAdminOrgUnitAssignAdmin())
	r.Patch("/api/v1/admin/orgs/{orgId}/courses/{courseCode}/org-unit", d.handleAdminOrgCourseOrgUnit())
	r.Get("/api/v1/admin/orgs/{orgId}/terms", d.handleAdminOrgTermsList())
	r.Put("/api/v1/admin/originality-config", d.handleAdminPutOriginality())
	r.Get("/api/v1/admin/users/{userId}/dsar-export", d.handleAdminDSARExport())
	r.Delete("/api/v1/admin/users/{userId}/sessions", d.handleAdminRevokeUserSessions())
	r.Get("/api/v1/admin/saml/config", d.handleAdminSAMLGet())
	r.Put("/api/v1/admin/saml/config", d.handleAdminSAMLPut())
	r.Get("/api/v1/admin/oidc/providers", d.handleAdminOIDCProvidersGet())
	r.Put("/api/v1/admin/oidc/providers", d.handleAdminOIDCProviderPut())
	r.Post("/api/v1/admin/provisioning/oneroster/upload", d.handleAdminOneRosterUpload())
	r.Get("/api/v1/admin/provisioning/oneroster/sync-runs", d.handleAdminOneRosterSyncRunsList())
	r.Get("/api/v1/admin/provisioning/oneroster/sync-runs/{id}", d.handleAdminOneRosterSyncRunDetail())
	r.Post("/api/v1/admin/provisioning/oneroster/bearer-credentials", d.handleAdminOneRosterBearerPost())
	r.Get("/api/v1/admin/provisioning/scim/tokens", d.handleAdminScimTokensList())
	r.Post("/api/v1/admin/provisioning/scim/tokens", d.handleAdminScimTokenPost())
	r.Delete("/api/v1/admin/provisioning/scim/tokens/{id}", d.handleAdminScimTokenDelete())
	r.Get("/api/v1/admin/provisioning/scim/events", d.handleAdminScimEventsList())
	r.Get("/api/v1/admin/password-policy", d.handleAdminPasswordPolicyGet())
	r.Put("/api/v1/admin/password-policy", d.handleAdminPasswordPolicyPut())
	r.Get("/oneroster/v1p2/*", d.handleOneRosterV1P2())
	r.Route("/scim/v2", func(sr chi.Router) {
		sr.Use(d.scimBearerMiddleware)
		sr.Get("/ServiceProviderConfig", d.handleSCIMServiceProviderConfig())
		sr.Get("/Schemas", d.handleSCIMSchemas())
		sr.Get("/Users", d.handleSCIMUsersCollection())
		sr.Post("/Users", d.handleSCIMUsersCollection())
		sr.Get("/Users/{id}", d.handleSCIMUserOne())
		sr.Put("/Users/{id}", d.handleSCIMUserOne())
		sr.Patch("/Users/{id}", d.handleSCIMUserOne())
		sr.Delete("/Users/{id}", d.handleSCIMUserOne())
		sr.Get("/Groups", d.handleSCIMGroupsCollection())
		sr.Post("/Groups", d.handleSCIMGroupsCollection())
		sr.Patch("/Groups/{id}", d.handleSCIMGroupPatch())
	})
	r.Get("/api/v1/standards/search", d.handleSearchStandards())
	r.Get("/api/v1/standards/{id}", d.handleGetStandard())
	r.Get("/api/v1/standards", d.handleListStandards())
	r.Post("/api/v1/imports/qti", d.handleQTIImportStart())
	r.Get("/api/v1/imports/{job_id}/status", d.handleImportStatus())
	r.Get("/api/v1/imports", d.handleListImports())
	// Virtual classroom meetings (plan 6.4).
	r.Post("/api/v1/courses/{course_code}/meetings", d.handleCreateMeeting())
	r.Get("/api/v1/courses/{course_code}/meetings", d.handleListMeetings())
	r.Get("/api/v1/meetings/{meeting_id}/join", d.handleGetMeetingJoin())
	r.Patch("/api/v1/meetings/{meeting_id}", d.handlePatchMeeting())
	r.Get("/api/v1/meetings/{meeting_id}/attendance", d.handleGetMeetingAttendance())
	r.Get("/api/v1/meetings/{meeting_id}/ical", d.handleGetMeetingIcal())
	r.Post("/api/v1/recommendations/event", d.handleRecommendationEvent())
	r.Post("/api/v1/webhooks/originality/{provider}", d.handleOriginalityWebhook())
	r.Get("/api/v1/surveys/{id}", d.handleGetSurvey())
	r.Put("/api/v1/surveys/{id}", d.handlePutSurvey())
	r.Post("/api/v1/surveys/{id}/respond", d.handleSurveyRespond())
	r.Get("/api/v1/surveys/{id}/results", d.handleSurveyResults())
	r.Get("/api/v1/courses/{course_code}/surveys", d.handleListCourseSurveys())
	r.Post("/api/v1/courses/{course_code}/surveys", d.handleCreateCourseSurvey())
	// Global concept graph (Rust routes/concepts.rs); /search before /{id}.
	r.Get("/api/v1/concepts/search", d.handleConceptsSearch())
	r.Get("/api/v1/concepts", d.handleConceptsList())
	r.Post("/api/v1/concepts", d.handleConceptCreate())
	r.Get("/api/v1/concepts/{id}/ancestors", d.handleConceptAncestors())
	r.Get("/api/v1/concepts/{id}/descendants", d.handleConceptDescendants())
	r.Post("/api/v1/concepts/{id}/prerequisites", d.handleConceptAddPrerequisite())
	r.Delete("/api/v1/concepts/{id}/prerequisites/{prerequisite_id}", d.handleConceptRemovePrerequisite())
	r.Post("/api/v1/concepts/question-tags", d.handleConceptQuestionTagPost())
	r.Delete("/api/v1/concepts/question-tags", d.handleConceptQuestionTagDelete())
	r.Get("/api/v1/concepts/{id}", d.handleConceptGet())
	r.Put("/api/v1/concepts/{id}", d.handleConceptUpdate())
	r.Delete("/api/v1/concepts/{id}", d.handleConceptDelete())
	r.Get("/api/v1/enrollments/{enrollmentID}/diagnostic", d.handleEnrollmentDiagnosticGet())
	r.Post("/api/v1/enrollments/{enrollmentID}/diagnostic/start", d.handleEnrollmentDiagnosticStart())
	r.Post("/api/v1/enrollments/{enrollmentID}/diagnostic/bypass", d.handleEnrollmentDiagnosticBypass())
	r.Post("/api/v1/diagnostic-attempts/{attemptID}/respond", d.handleDiagnosticAttemptRespond())
	r.Get("/api/v1/courses/{course_code}/diagnostic-results", d.handleCourseDiagnosticResults())
	r.Get("/api/v1/courses/{course_code}/diagnostic-config", d.handleCourseDiagnosticConfigGet())
	r.Put("/api/v1/courses/{course_code}/diagnostic-config", d.handleCourseDiagnosticConfigPut())
	d.registerUnimplementedV1(r)
	d.mountRouterErrorHandlers(r)
	return r
}

func defaultReady(p *pgxpool.Pool) ReadyChecker {
	if p == nil {
		return func() error { return errNoDBPool }
	}
	return func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return p.Ping(ctx)
	}
}

var errNoDBPool = &degradedErr{s: "database pool is not configured"}

// degradedErr is a lightweight error type for readiness.
type degradedErr struct{ s string }

func (e *degradedErr) Error() string { return e.s }
