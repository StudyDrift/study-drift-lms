package httpserver

import "github.com/go-chi/chi/v5"

func (d Deps) registerOrgRoutes(r chi.Router) {
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
	r.Get("/api/v1/orgs/{orgId}/settings/support-widget", d.handleOrgSupportWidgetItem())
	r.Put("/api/v1/orgs/{orgId}/settings/support-widget", d.handleOrgSupportWidgetItem())
}
