package scim

import (
	"encoding/json"
	"net/http"
)

type groupResource struct {
	Schemas     []string `json:"schemas"`
	ID          string   `json:"id"`
	DisplayName string   `json:"displayName"`
}

type groupListResponse struct {
	Schemas      []string         `json:"schemas"`
	TotalResults int              `json:"totalResults"`
	StartIndex   int              `json:"startIndex"`
	ItemsPerPage int              `json:"itemsPerPage"`
	Resources    []*groupResource `json:"Resources"`
}

// WriteGroupList returns an empty SCIM Group collection (group→role mapping deferred).
func WriteGroupList(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/scim+json")
	_ = json.NewEncoder(w).Encode(groupListResponse{
		Schemas:      []string{"urn:ietf:params:scim:api:messages:2.0:ListResponse"},
		TotalResults: 0,
		StartIndex:   1,
		ItemsPerPage: 0,
		Resources:    []*groupResource{},
	})
}

// WriteGroupCreated returns a placeholder Group so IdP probes can succeed without mapping yet.
func WriteGroupCreated(w http.ResponseWriter, baseURL string, id string) {
	w.Header().Set("Content-Type", "application/scim+json")
	w.Header().Set("Location", baseURL+"/scim/v2/Groups/"+id)
	w.WriteHeader(http.StatusCreated)
	gr := groupResource{
		Schemas:     []string{"urn:ietf:params:scim:schemas:core:2.0:Group"},
		ID:          id,
		DisplayName: "placeholder",
	}
	_ = json.NewEncoder(w).Encode(gr)
}
