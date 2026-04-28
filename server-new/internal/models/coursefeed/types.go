package coursefeed

import (
	"time"

	"github.com/google/uuid"
)

type FeedChannelPublic struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	SortOrder int32     `json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
}

type FeedRosterPerson struct {
	UserID      uuid.UUID `json:"userId"`
	Email       string    `json:"email"`
	DisplayName *string   `json:"displayName"`
}

type FeedMessagePublic struct {
	ID                uuid.UUID           `json:"id"`
	ChannelID         uuid.UUID           `json:"channelId"`
	AuthorUserID      uuid.UUID           `json:"authorUserId"`
	AuthorEmail       string              `json:"authorEmail"`
	AuthorDisplayName *string             `json:"authorDisplayName"`
	ParentMessageID   *uuid.UUID          `json:"parentMessageId"`
	Body              string              `json:"body"`
	MentionsEveryone  bool                `json:"mentionsEveryone"`
	MentionUserIDs    []uuid.UUID         `json:"mentionUserIds"`
	PinnedAt          *time.Time          `json:"pinnedAt"`
	CreatedAt         time.Time           `json:"createdAt"`
	EditedAt          *time.Time          `json:"editedAt"`
	LikeCount         int64               `json:"likeCount"`
	ViewerHasLiked    bool                `json:"viewerHasLiked"`
	Replies           []FeedMessagePublic `json:"replies"`
}

type FeedChannelsResponse struct {
	Channels []FeedChannelPublic `json:"channels"`
}

type FeedRosterResponse struct {
	People []FeedRosterPerson `json:"people"`
}

type FeedMessagesResponse struct {
	Messages []FeedMessagePublic `json:"messages"`
}

type CreateFeedChannelRequest struct {
	Name string `json:"name"`
}

type CreateFeedMessageRequest struct {
	Body             string      `json:"body"`
	ParentMessageID  *uuid.UUID  `json:"parentMessageId"`
	MentionUserIDs   []uuid.UUID `json:"mentionUserIds"`
	MentionsEveryone bool        `json:"mentionsEveryone"`
}

type PatchFeedMessageRequest struct {
	Body string `json:"body"`
}

type PinFeedMessageRequest struct {
	Pinned bool `json:"pinned"`
}

type CreateFeedMessageResponse struct {
	ID uuid.UUID `json:"id"`
}
