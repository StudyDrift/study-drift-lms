package srs

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func endOfUTCDay(t time.Time) time.Time {
	u := t.UTC()
	y, m, d := u.Date()
	return time.Date(y, m, d, 23, 59, 59, 999000000, time.UTC)
}

// ReviewStats matches GET /learners/{id}/review-stats payload fields.
func ReviewStats(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (streak int, dueToday, dueWeek int64, retention float64, err error) {
	todayEnd := endOfUTCDay(time.Now().UTC())
	dueToday, err = CountDueUntil(ctx, pool, userID, todayEnd)
	if err != nil {
		return 0, 0, 0, 0, err
	}
	weekEnd := time.Now().UTC().Add(7 * 24 * time.Hour)
	dueWeek, err = CountDueUntil(ctx, pool, userID, weekEnd)
	if err != nil {
		return 0, 0, 0, 0, err
	}
	streak, err = streakForUser(ctx, pool, userID)
	if err != nil {
		return 0, 0, 0, 0, err
	}
	avgEF, err := AvgEasinessForUser(ctx, pool, userID)
	if err != nil {
		return 0, 0, 0, 0, err
	}
	ef := 2.5
	if avgEF != nil {
		ef = *avgEF
	}
	retention = (ef - 1.3) / 1.2
	if retention < 0 {
		retention = 0
	}
	if retention > 0.99 {
		retention = 0.99
	}
	return streak, dueToday, dueWeek, retention, nil
}

func streakForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (int, error) {
	today := utcDay(time.Now().UTC())
	yesterday := today.AddDate(0, 0, -1)
	var anchor time.Time
	if ok, _ := HasStreakDay(ctx, pool, userID, today); ok {
		anchor = today
	} else {
		anchor = yesterday
	}
	if ok, _ := HasStreakDay(ctx, pool, userID, anchor); !ok {
		return 0, nil
	}
	streak := 0
	d := anchor
	for {
		if ok, err := HasStreakDay(ctx, pool, userID, d); err != nil {
			return 0, err
		} else if !ok {
			break
		}
		streak++
		d = d.AddDate(0, 0, -1)
	}
	return streak, nil
}
