package officehours

import (
	"testing"
	"time"
)

// TestSlotGenerationLogic verifies the slot-generation math without DB access.
func TestSlotGenerationLogic(t *testing.T) {
	t.Run("15-minute slots in a 1-hour window yields 4 slots", func(t *testing.T) {
		count := countSlots("09:00", "10:00", 15)
		if count != 4 {
			t.Errorf("want 4 slots, got %d", count)
		}
	})

	t.Run("30-minute slots in a 2-hour window yields 4 slots", func(t *testing.T) {
		count := countSlots("14:00", "16:00", 30)
		if count != 4 {
			t.Errorf("want 4 slots, got %d", count)
		}
	})

	t.Run("60-minute slots in a 1-hour window yields 1 slot", func(t *testing.T) {
		count := countSlots("10:00", "11:00", 60)
		if count != 1 {
			t.Errorf("want 1 slot, got %d", count)
		}
	})

	t.Run("slot duration larger than window yields 0 slots", func(t *testing.T) {
		count := countSlots("10:00", "10:30", 60)
		if count != 0 {
			t.Errorf("want 0 slots, got %d", count)
		}
	})

	t.Run("window that does not divide evenly trims last slot", func(t *testing.T) {
		// 14:00–15:50 with 30-min slots → 14:00, 14:30, 15:00, 15:30 = 3 slots (not 4, since 15:50 < 16:00)
		count := countSlots("14:00", "15:50", 30)
		if count != 3 {
			t.Errorf("want 3 slots, got %d", count)
		}
	})
}

// TestWeekdayOccurrences verifies that a given weekday appears the expected number
// of times in a 28-day window starting now.
func TestWeekdayOccurrences(t *testing.T) {
	for dow := 0; dow <= 6; dow++ {
		occurrences := countWeekdayOccurrences(dow, 28)
		if occurrences < 4 || occurrences > 5 {
			t.Errorf("day %d: expected 4 or 5 occurrences in 28 days, got %d", dow, occurrences)
		}
	}
}

// countSlots replicates the slot-generation loop without a DB.
func countSlots(startStr, endStr string, durationMinutes int) int {
	start, _ := time.Parse("15:04", startStr)
	end, _ := time.Parse("15:04", endStr)
	duration := time.Duration(durationMinutes) * time.Minute
	count := 0
	cursor := start
	for {
		slotEnd := cursor.Add(duration)
		if slotEnd.After(end) {
			break
		}
		count++
		cursor = slotEnd
	}
	return count
}

// countWeekdayOccurrences counts how many times a weekday appears in the next `days` days.
func countWeekdayOccurrences(dow, days int) int {
	target := time.Weekday(dow)
	now := time.Now()
	count := 0
	for i := 0; i < days; i++ {
		if now.AddDate(0, 0, i).Weekday() == target {
			count++
		}
	}
	return count
}
