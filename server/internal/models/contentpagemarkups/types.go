package contentpagemarkups

import (
	"time"

	"github.com/google/uuid"
)

type ContentPageMarkupResponse struct {
	ID             uuid.UUID  `json:"id"`
	Kind           string     `json:"kind"`
	QuoteText      string     `json:"quoteText"`
	NotebookPageID *string    `json:"notebookPageId"`
	CommentText    *string    `json:"commentText"`
	CreatedAt      time.Time  `json:"createdAt"`
}

type ContentPageMarkupsListResponse struct {
	Markups []ContentPageMarkupResponse `json:"markups"`
}

type CreateContentPageMarkupRequest struct {
	Kind           string  `json:"kind"`
	QuoteText      string  `json:"quoteText"`
	NotebookPageID *string `json:"notebookPageId"`
	CommentText    *string `json:"commentText"`
}
